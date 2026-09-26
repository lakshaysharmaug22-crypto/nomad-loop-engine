# ADR 0002: Find elements by meaning when their identity breaks

Status: accepted

## Context

Recorded selectors (`data-testid`, `#id`, CSS paths) break whenever a UI is refactored. On the buggy-shop redesign, 51 of 91 recorded elements could no longer be found. Replaying bugs across builds, which sweeps depend on, needs a locator that survives such changes and that does not click the wrong thing.

## Decision

Record every element as a descriptor: role, accessible name, placeholder, link target, test id, element id, CSS path, and context (landmark heading plus the nearest sibling's text). To locate it:

1. Try the recorded identity: test id, then element id, then CSS path with the same role and name. A match is **exact**.
2. Otherwise score every candidate of a compatible role:

   `0.62 · cos(meaning) + 0.18 · same role + 0.12 · cos(context) + 0.08 · same tag`

   where meaning is an embedding of role, name, placeholder and link path.

3. Take the best candidate if it scores at least 0.62; otherwise **abstain**.

Embeddings come from all-MiniLM-L6-v2 in the ML service. A character n-gram hashing embedder is the offline fallback, so the engine never depends on the service being up.

## Consequences

- Wrong clicks are worse than failures: a wrong click produces a misleading result, a failure produces an honest one. The threshold is set to abstain rather than guess, and the benchmark reports wrong-element picks separately.
- Context carries renames that share no words. "Apply coupon" became "Redeem code"; the neighbouring "Coupon code" input is what connects them.
- The weights were set by hand on one redesign. A labelled set of redesigns from real open-source apps would let them be fitted instead.
- Every heal is logged with the full candidate ranking, which the dashboard's inspector shows.
