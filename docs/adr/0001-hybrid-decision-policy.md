# ADR 0001: A three-tier hybrid decision policy

Status: accepted

## Context

At each step the explorer has 5 to 40 untried actions. Picking well is the difference between finding every bug in 30 steps and never finding some of them. Options considered:

- **An LLM for every step.** Strong on unusual pages, but slow (seconds per call), costly, and hard to evaluate. Most steps do not need reasoning: an unseen link is obviously worth following.
- **Rules only.** Free and predictable, but ties are common (several unseen links, several forms) and rules cannot learn which kinds of actions tend to pay off.
- **A learned ranker only.** Fast and measurable, but it has nothing to say on pages unlike its training data.

## Decision

Chain three tiers, each of which decides or escalates:

1. **Rules** score novelty: unseen link targets, first tries of forms and buttons, penalties for repeats and destructive actions. They decide when the leader is ahead by at least 1.5.
2. **Ranker**: an MLP (21 → 32 → 16 → 1) trained on the engine's own logs. The label is whether the action reached a new state or surfaced a new bug. It decides whenever its best candidate has p ≥ 0.55. Ties between several good options are not escalated, because any of them is a fine move.
3. **Local LLM** (Qwen2.5 via Ollama) is asked only when the ranker sees nothing promising. If it is unavailable, the ranker's best guess is used and the step is recorded as a fallback.

Every decision records a trace: candidate scores per tier, margins, thresholds, latencies. Tier usage is therefore measured rather than assumed.

## Consequences

- LLM calls are rare and explainable. The cost of the system scales with how unusual the app is, not with the number of steps.
- The ranker is trained on data the engine collects itself: random-policy runs give unbiased labels, and features are defined once in `features.ts`, used both for logging and inference.
- Features are app-agnostic (kind, novelty, verbs, position), but the model has so far been trained and tested on one app. Its test AUC measures generalisation across explorations, not across apps. Training on runs of several apps is the next step.
- The ONNX export keeps inference in the Python service fast on CPU and avoids a PyTorch dependency at serving time.
