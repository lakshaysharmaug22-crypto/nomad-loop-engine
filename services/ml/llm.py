"""Tier 3: local open-weight LLM via Ollama (default qwen2.5:3b-instruct; set LLM_MODEL for 7B).

Two jobs, both returning strict JSON:
  choose — pick the most promising next action when the ranker is unsure
  judge  — decide whether the outcome of an invalid form submission is a bug
"""
from __future__ import annotations

import json
import os
import re

import httpx

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
MODEL = os.environ.get("LLM_MODEL", "qwen2.5:3b-instruct")

CHOOSE_SYSTEM = (
    "You are a QA engineer exploring a web app to find bugs. Pick the ONE next action most likely to "
    "reach unexplored functionality or expose a defect (forms, state changes, edge cases). Avoid actions "
    "similar to the recent history. Reply with JSON only: {\"index\": <number>, \"reason\": \"<max 12 words>\"}."
)

JUDGE_SYSTEM = (
    "You are a QA engineer. A form was submitted with ALL fields left empty. Given the page text before and "
    "after, decide if the app behaved incorrectly (e.g. it accepted the empty submission and reported success "
    "instead of showing validation errors). Reply with JSON only: "
    "{\"is_bug\": true|false, \"title\": \"<short bug title>\", \"reason\": \"<max 20 words>\"}."
)


def _extract_json(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError(f"no JSON in model output: {text[:120]}")
    return json.loads(m.group(0))


async def _chat(system: str, user: str, timeout: float = 90.0) -> dict:
    payload = {
        "model": MODEL,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "format": "json",
        "stream": False,
        "options": {"temperature": 0.2, "num_ctx": 4096},
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.post(f"{OLLAMA_URL}/api/chat", json=payload)
        r.raise_for_status()
        return _extract_json(r.json()["message"]["content"])


async def choose(url: str, title: str, text: str, candidates: list[str], history: list[str]) -> dict:
    numbered = "\n".join(f"{i}. {c}" for i, c in enumerate(candidates))
    user = (
        f"Page: {title} ({url})\nVisible text (truncated):\n{text[:1200]}\n\n"
        f"Recent actions:\n{chr(10).join(history) or '(none)'}\n\nCandidate actions:\n{numbered}"
    )
    out = await _chat(CHOOSE_SYSTEM, user)
    idx = int(out.get("index", -1))
    if not 0 <= idx < len(candidates):
        raise ValueError(f"index {idx} out of range")
    return {"index": idx, "reason": str(out.get("reason", ""))[:120]}


async def judge(action: str, url: str, before: str, after: str) -> dict:
    user = f"Action: {action}\nResulting URL: {url}\n\nBEFORE:\n{before[:800]}\n\nAFTER:\n{after[:800]}"
    out = await _chat(JUDGE_SYSTEM, user)
    return {
        "is_bug": bool(out.get("is_bug", False)),
        "title": str(out.get("title", "Invalid form submission accepted"))[:100],
        "reason": str(out.get("reason", ""))[:200],
    }


async def available() -> bool:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(f"{OLLAMA_URL}/api/tags")
            return r.status_code == 200 and any(m.get("name", "").startswith(MODEL.split(":")[0]) for m in r.json().get("models", []))
    except Exception:
        return False
