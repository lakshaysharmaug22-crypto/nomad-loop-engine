# ADR 0003: Minimize, replay and correlate before reporting

Status: accepted

## Context

An exploring agent sees many symptoms, and not all of them are useful bug reports. Early runs reported the same root cause twice (a failed request and the console error it logged), attributed an asynchronous failure to the wrong action, and produced repro steps that depended on app state that no longer existed.

## Decision

Every anomaly goes through three steps before it becomes a report:

1. **Correlate** within the step. A console error that only reports a failed request is folded into that network failure; suspicious text on a page that already returned 5xx is part of the server error. Deduplicate by a signature of type, location and normalized message.
2. **Minimize.** If simply loading the page where the anomaly appeared reproduces it, that one-line recipe replaces the action replay. It no longer depends on app state (the cart total `NaN` bug replays from its URL, not from "add an item, then remove it").
3. **Replay three times** in fresh browser contexts. Two or more hits: confirmed. One: flaky. None: unverified.

The confirmed recipe becomes a standalone Playwright test with an assertion chosen for the anomaly type.

## Consequences

- On buggy-shop: 9 of 9 generated tests fail on the buggy build and pass on the fixed one, and a 45-step run on the fixed build reports nothing.
- Replays cost time (about a second each). They run once per new signature, not per step.
- Clicks wait briefly before the network settles, so a request started by a click is attributed to that click rather than the next action.
