# Benchmark method

Everything in the README's results table comes from `npm run bench` and is written to `benchmarks/results/summary.json`, which the dashboard's Benchmarks page reads.

## Target

`targets/buggy-shop` is a small storefront with 10 planted bugs listed in `bugs.manifest.json`, each with the anomaly type the engine should report and a URL or message pattern that identifies it. Nine are detectable by rules; one (checkout accepts an empty form) needs the LLM judge.

Three builds run side by side:

| Build    | Port | Difference                                                                                |
| -------- | ---- | ----------------------------------------------------------------------------------------- |
| Original | 4100 | the planted bugs                                                                          |
| Redesign | 4101 | `LAYOUT_VERSION=2`: renamed ids, no test ids, reworded labels (listed in `redesign.json`) |
| Fixed    | 4102 | `BUGS=off`: every planted bug fixed                                                       |

## Policies

Each run explores the original build for 45 steps, starting from a fresh server so runs are independent.

- **Random**: uniform choice among untried actions, 5 seeds. Also the ranker's unbiased training data.
- **Rules only**: tier 1 alone, 3 runs.
- **Rules + ranker**: tiers 1 and 2 with the trained model, 3 runs. The LLM tier is included when Ollama is running.

Reported per policy: recall against the manifest, recall over rule-detectable bugs, precision (reports that match a planted bug), states found, the step at which the last bug was found, and step latency.

## Ranker

Rows are `(features, label)` pairs logged by every run. Runs, not rows, are split 60/20/20 into train, validation and test, so every score is on explorations the model never saw. Validation chooses the epoch; test is used once. Reported: ROC AUC, the best single feature's AUC as a baseline, precision at the decision threshold against the base rate, calibration, and permutation importance.

## Self-healing

Every link, button and textbox on eight pages of the original build is recorded, then located on the redesign two ways: the selector a recorder would store (test id, else id, else CSS path) and the self-healing locator. The oracle pairs elements by link target, or by label through the rename list. Reported: break rates, elements found by meaning, wrong-element picks, and abstentions.

## Sweeps

Every bug from the demo run is replayed three times on the redesign and on the fixed build. On the redesign the bugs are still present but their recorded selectors are not, so reproducing them depends on self-healing. On the fixed build every bug should be reported fixed.

## Limits

- One seeded app. Results on open-source apps are the next addition.
- The redesign was written for the benchmark.
- Numbers without Ollama leave the LLM tier and the empty-form judge unexercised.
