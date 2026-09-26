"""Nomad Loop Engine — ML service.

  POST /rank          Tier 2: score candidate actions with the self-trained ONNX ranker
  POST /embed         semantic vectors for self-healing selectors (all-MiniLM-L6-v2)
  POST /llm/choose    Tier 3: local LLM picks an action when the ranker is unsure
  POST /llm/judge     local LLM judges whether an invalid form submission misbehaved
  GET  /health        which components are loaded

Run:  uvicorn app:app --port 8200
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import llm

HERE = Path(__file__).resolve().parent
MODEL_PATH = Path(os.environ.get("RANKER_MODEL", HERE / "ranker" / "model.onnx"))
EMBED_MODEL = os.environ.get("EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2")

app = FastAPI(title="Nomad Loop Engine ML service")

_ranker = None
_embedder = None
_embedder_error: str | None = None


def get_ranker():
    global _ranker
    if _ranker is None and MODEL_PATH.exists():
        import onnxruntime as ort

        _ranker = ort.InferenceSession(str(MODEL_PATH), providers=["CPUExecutionProvider"])
    return _ranker


def get_embedder():
    global _embedder, _embedder_error
    if _embedder is None and _embedder_error is None:
        try:
            from sentence_transformers import SentenceTransformer

            _embedder = SentenceTransformer(EMBED_MODEL, device="cpu")
        except Exception as e:  # model not downloaded / package missing: engine falls back to hashing
            _embedder_error = str(e)[:200]
    return _embedder


class RankIn(BaseModel):
    features: list[list[float]]


class EmbedIn(BaseModel):
    texts: list[str]


class ChooseIn(BaseModel):
    url: str
    title: str
    text: str
    candidates: list[str]
    history: list[str] = []


class JudgeIn(BaseModel):
    action: str
    url: str
    before: str
    after: str


@app.get("/health")
async def health():
    metrics_path = HERE / "ranker" / "metrics.json"
    return {
        "ranker": MODEL_PATH.exists(),
        "ranker_metrics": {k: v for k, v in json.loads(metrics_path.read_text()).items() if k != "features"} if metrics_path.exists() else None,
        "embedder": EMBED_MODEL if get_embedder() is not None else f"unavailable: {_embedder_error}",
        "llm": {"model": llm.MODEL, "available": await llm.available()},
    }


@app.post("/rank")
def rank(body: RankIn):
    sess = get_ranker()
    if sess is None:
        raise HTTPException(503, "ranker model not trained yet — run python -m ranker.train")
    if not body.features:
        return {"scores": []}
    x = np.asarray(body.features, dtype=np.float32)
    expected = sess.get_inputs()[0].shape[1]
    if isinstance(expected, int) and x.shape[1] != expected:
        raise HTTPException(422, f"expected {expected} features, got {x.shape[1]} — retrain after changing features.ts")
    scores = sess.run(None, {"features": x})[0]
    return {"scores": [round(float(s), 4) for s in np.ravel(scores)]}


@app.post("/embed")
def embed(body: EmbedIn):
    model = get_embedder()
    if model is None:
        raise HTTPException(503, f"embedder unavailable: {_embedder_error}")
    vecs = model.encode(body.texts, normalize_embeddings=True, batch_size=64)
    return {"vectors": np.round(vecs, 5).tolist()}


@app.post("/llm/choose")
async def llm_choose(body: ChooseIn):
    try:
        return await llm.choose(body.url, body.title, body.text, body.candidates, body.history)
    except Exception as e:
        raise HTTPException(503, f"llm unavailable: {str(e)[:160]}")


@app.post("/llm/judge")
async def llm_judge(body: JudgeIn):
    try:
        return await llm.judge(body.action, body.url, body.before, body.after)
    except Exception as e:
        raise HTTPException(503, f"llm unavailable: {str(e)[:160]}")
