"""Service tests: ranker training/export/inference and API behaviour without an LLM running."""
import json
import random
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient


def _synthetic_log(path: Path, n_runs: int = 6, rows: int = 60, n_features: int = 21):
    """Label depends on a couple of features, so a working model must beat chance."""
    rng = random.Random(0)
    with path.open("w") as f:
        for r in range(n_runs):
            for i in range(rows):
                x = [rng.random() for _ in range(n_features)]
                y = 1 if (x[4] > 0.5 and x[16] < 0.6) or rng.random() < 0.05 else 0
                f.write(json.dumps({"x": x, "y": y, "run": f"r{r}", "names": [f"f{k}" for k in range(n_features)] if i == 0 else None}) + "\n")


def test_train_exports_onnx_that_learns(tmp_path, monkeypatch):
    from ranker import train as T

    monkeypatch.setattr(T, "METRICS_PATH", tmp_path / "metrics.json")
    log = tmp_path / "log.jsonl"
    _synthetic_log(log)
    out = tmp_path / "model.onnx"
    m = T.train([str(log)], epochs=250, out=out)
    assert out.exists()
    assert m["test_auc"] > 0.75
    assert len(m["roc_test"]) == 40 and m["importance_test"][0]["feature"] in ("f4", "f16")

    import onnxruntime as ort

    sess = ort.InferenceSession(str(out))
    scores = sess.run(None, {"features": np.random.rand(5, 21).astype(np.float32)})[0]
    assert scores.shape == (5,)
    assert ((scores >= 0) & (scores <= 1)).all()


def test_auc_basic():
    from ranker.train import auc

    assert auc(np.array([0, 0, 1, 1]), np.array([0.1, 0.2, 0.8, 0.9])) == 1.0
    assert auc(np.array([0, 0, 1, 1]), np.array([0.9, 0.8, 0.2, 0.1])) == 0.0


def test_rank_endpoint_and_llm_degradation(tmp_path, monkeypatch):
    from ranker import train as T

    monkeypatch.setattr(T, "METRICS_PATH", tmp_path / "metrics.json")
    log = tmp_path / "log.jsonl"
    _synthetic_log(log)
    model = tmp_path / "model.onnx"
    T.train([str(log)], epochs=50, out=model)

    import app as A

    monkeypatch.setattr(A, "MODEL_PATH", model)
    monkeypatch.setattr(A, "_ranker", None)
    monkeypatch.setattr(A.llm, "OLLAMA_URL", "http://127.0.0.1:9")  # nothing listens here
    client = TestClient(A.app)

    r = client.post("/rank", json={"features": [[0.5] * 21, [0.1] * 21]})
    assert r.status_code == 200 and len(r.json()["scores"]) == 2
    assert client.post("/rank", json={"features": [[0.5] * 3]}).status_code == 422
    # No LLM running → 503, which the engine treats as "tier unavailable" and falls back.
    assert client.post("/llm/choose", json={"url": "u", "title": "t", "text": "", "candidates": ["a", "b"]}).status_code == 503
