"""Tier 2 action ranker: train a small PyTorch MLP on exploration logs and export it to ONNX.

Each log row is one executed action: the feature vector the engine computed before acting
(see packages/engine/src/features.ts) and a label — 1 if the action reached a
new state or surfaced a new bug, else 0. The model learns which actions are worth trying.

    python -m ranker.train --data ranker/data/training-random.jsonl ranker/data/training.jsonl ranker/data/training-bench.jsonl
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import numpy as np
import torch
from torch import nn

HERE = Path(__file__).resolve().parent
MODEL_PATH = HERE / "model.onnx"
METRICS_PATH = HERE / "metrics.json"


class ActionRanker(nn.Module):
    def __init__(self, n_features: int, hidden: int = 32):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(n_features, hidden),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(hidden, hidden // 2),
            nn.ReLU(),
            nn.Linear(hidden // 2, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:  # returns probabilities
        return torch.sigmoid(self.net(x)).squeeze(-1)


def load(paths: list[str]) -> tuple[np.ndarray, np.ndarray, list[str], list[str]]:
    xs, ys, runs, names = [], [], [], []
    for p in paths:
        for line in Path(p).read_text().splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get("names"):
                names = row["names"]
            xs.append(row["x"])
            ys.append(row["y"])
            runs.append(row.get("run", p))
    return np.asarray(xs, dtype=np.float32), np.asarray(ys, dtype=np.float32), runs, names


def auc(y: np.ndarray, p: np.ndarray) -> float:
    """Rank-based ROC AUC (no sklearn needed at inference/test time)."""
    pos, neg = p[y == 1], p[y == 0]
    if len(pos) == 0 or len(neg) == 0:
        return float("nan")
    order = np.argsort(np.concatenate([pos, neg]))
    ranks = np.empty_like(order, dtype=np.float64)
    ranks[order] = np.arange(1, len(order) + 1)
    return float((ranks[: len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def split_by_run(runs: list[str], seed: int, fractions=(0.6, 0.2, 0.2)) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Train / validation / test split by whole runs, so every score measures unseen explorations.

    Validation picks the epoch (early stopping); test is only touched once, for the reported numbers.
    """
    uniq = sorted(set(runs))
    random.Random(seed).shuffle(uniq)
    n = len(uniq)
    if n < 3:  # tiny datasets: fall back to a row split
        idx = np.random.default_rng(seed).permutation(len(runs))
        cut1, cut2 = int(len(runs) * fractions[0]), int(len(runs) * (fractions[0] + fractions[1]))
        masks = [np.zeros(len(runs), dtype=bool) for _ in range(3)]
        masks[0][idx[:cut1]] = True
        masks[1][idx[cut1:cut2]] = True
        masks[2][idx[cut2:]] = True
        return masks[0], masks[1], masks[2]
    n_test = max(1, round(n * fractions[2]))
    n_val = max(1, round(n * fractions[1]))
    test_runs, val_runs = set(uniq[:n_test]), set(uniq[n_test : n_test + n_val])
    te = np.array([r in test_runs for r in runs])
    va = np.array([r in val_runs for r in runs])
    return ~(te | va), va, te


def roc_points(y: np.ndarray, p: np.ndarray, n: int = 40) -> list[list[float]]:
    pts = []
    for t in np.linspace(1.0, 0.0, n):
        pred = p >= t
        tpr = float((pred & (y == 1)).sum() / max(1, (y == 1).sum()))
        fpr = float((pred & (y == 0)).sum() / max(1, (y == 0).sum()))
        pts.append([round(fpr, 4), round(tpr, 4)])
    return pts


def calibration(y: np.ndarray, p: np.ndarray, bins: int = 5) -> list[dict]:
    edges = np.linspace(0, 1, bins + 1)
    out = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (p >= lo) & (p < hi if hi < 1 else p <= hi)
        if m.any():
            out.append({"bin": [round(float(lo), 2), round(float(hi), 2)], "predicted": round(float(p[m].mean()), 3), "observed": round(float(y[m].mean()), 3), "n": int(m.sum())})
    return out


def permutation_importance(model: nn.Module, X: np.ndarray, y: np.ndarray, names: list[str], seed: int, repeats: int = 5) -> list[dict]:
    """Drop in test AUC when one feature is shuffled; larger drop = the model relies on it more."""
    rng = np.random.default_rng(seed)
    with torch.no_grad():
        base = auc(y, model(torch.from_numpy(X)).numpy())
    out = []
    for j, name in enumerate(names):
        drops = []
        for _ in range(repeats):
            Xp = X.copy()
            Xp[:, j] = rng.permutation(Xp[:, j])
            with torch.no_grad():
                drops.append(base - auc(y, model(torch.from_numpy(Xp)).numpy()))
        out.append({"feature": name, "auc_drop": round(float(np.nanmean(drops)), 4)})
    return sorted(out, key=lambda d: -d["auc_drop"])


def train(paths: list[str], epochs: int = 400, lr: float = 3e-3, seed: int = 7, out: Path = MODEL_PATH) -> dict:
    torch.manual_seed(seed)
    X, y, runs, names = load(paths)
    names = names or [f"f{i}" for i in range(X.shape[1])]
    tr, va, te = split_by_run(runs, seed)
    model = ActionRanker(X.shape[1])
    pos_weight = float((y[tr] == 0).sum() / max(1, (y[tr] == 1).sum()))
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-3)
    Xt, yt = torch.from_numpy(X[tr]), torch.from_numpy(y[tr])
    Xv = torch.from_numpy(X[va])
    weights = torch.where(yt == 1, torch.tensor(pos_weight), torch.tensor(1.0))

    best, best_state, patience, epoch = -1.0, None, 0, 0
    for epoch in range(epochs):
        model.train()
        opt.zero_grad()
        loss = nn.functional.binary_cross_entropy(model(Xt), yt, weight=weights)
        loss.backward()
        opt.step()
        model.eval()
        with torch.no_grad():
            v_auc = auc(y[va], model(Xv).numpy())
        if not np.isnan(v_auc) and v_auc > best + 1e-4:
            best, best_state, patience = v_auc, {k: v.clone() for k, v in model.state_dict().items()}, 0
        else:
            patience += 1
            if patience > 50:
                break
    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()

    with torch.no_grad():
        p_tr = model(Xt).numpy()
        p_te = model(torch.from_numpy(X[te])).numpy()
    y_te = y[te]
    # Baseline: the single most predictive raw feature, to show what the model adds beyond one signal.
    single = [(auc(y_te, X[te][:, j]), names[j]) for j in range(X.shape[1])]
    single = [s for s in single if not np.isnan(s[0])]
    best_single = max(single) if single else (float("nan"), "")
    metrics = {
        "rows": int(len(y)),
        "runs": len(set(runs)),
        "split_rows": {"train": int(tr.sum()), "val": int(va.sum()), "test": int(te.sum())},
        "positive_rate": round(float(y.mean()), 3),
        "train_auc": round(auc(y[tr], p_tr), 3),
        "val_auc": round(best, 3),
        "test_auc": round(auc(y_te, p_te), 3),
        "baseline_best_single_feature": {"feature": best_single[1], "test_auc": round(float(best_single[0]), 3)},
        "test_base_rate": round(float(y_te.mean()), 3) if te.any() else None,
        "test_precision_at_0.55": round(float(y_te[p_te >= 0.55].mean()), 3) if (p_te >= 0.55).any() else None,
        "epochs_run": epoch + 1,
        "roc_test": roc_points(y_te, p_te),
        "calibration_test": calibration(y_te, p_te),
        "importance_test": permutation_importance(model, X[te], y_te, names, seed),
        "features": names,
    }

    torch.onnx.export(
        model,
        torch.zeros(1, X.shape[1]),
        str(out),
        input_names=["features"],
        output_names=["scores"],
        dynamic_axes={"features": {0: "n"}, "scores": {0: "n"}},
        opset_version=17,
        dynamo=False,  # classic TorchScript exporter: no onnxscript dependency, dynamic batch axis
    )
    METRICS_PATH.write_text(json.dumps(metrics, indent=2))
    return metrics


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", nargs="+", required=True)
    ap.add_argument("--epochs", type=int, default=400)
    args = ap.parse_args()
    m = train(args.data, epochs=args.epochs)
    skip = {"features", "roc_test", "calibration_test", "importance_test"}
    print(json.dumps({k: v for k, v in m.items() if k not in skip}, indent=2))
    print("top features:", ", ".join(f"{d['feature']} ({d['auc_drop']})" for d in m["importance_test"][:5]))
    print(f"exported {MODEL_PATH}")
