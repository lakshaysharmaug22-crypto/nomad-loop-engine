// Shapes of the benchmark files produced by `npm run bench` (benchmarks/results).
import type { BugReport, HealCandidate, RunStats } from '@nomad/contracts';

export interface BenchRun {
  policy: string;
  label: string;
  stats: RunStats;
  bugSteps: number[];
  stateSteps: number[];
  recall: number;
  recallRules: number;
  precision: number;
  missed: string[];
  bugs: Pick<BugReport, 'id' | 'title' | 'severity' | 'type' | 'foundAtStep' | 'status'>[];
}

export interface RankerMetrics {
  rows: number;
  runs: number;
  split_rows: { train: number; val: number; test: number };
  positive_rate: number;
  train_auc: number;
  val_auc: number;
  test_auc: number;
  baseline_best_single_feature: { feature: string; test_auc: number };
  test_base_rate: number | null;
  'test_precision_at_0.55': number | null;
  roc_test: [number, number][];
  calibration_test: { bin: [number, number]; predicted: number; observed: number; n: number }[];
  importance_test: { feature: string; auc_drop: number }[];
}

export interface HealSummary {
  embedder: string;
  targets: number;
  naiveResolved: number;
  healingResolved: number;
  naiveBreakRate: number;
  healingBreakRate: number;
  wrongElement: number;
  abstained: number;
  healedSemantically: number;
}

export interface HealRow {
  page: string;
  target: { role: string; name: string; context: string; id?: string; testId?: string };
  expected: string;
  naive: boolean;
  healed: boolean;
  strategy: 'exact' | 'healed' | 'failed';
  via?: string;
  score: number;
  picked?: string;
  candidates: HealCandidate[];
}

export interface HealBench extends HealSummary {
  rows: HealRow[];
}

export interface BenchSummary {
  generatedAt: string;
  ml: 'on' | 'off';
  policies?: { steps: number; manifestSize: number; runs: BenchRun[] };
  demo?: BenchRun;
  heal?: HealSummary;
  sweeps?: { label: string; items: number; stillBroken: number; fixed: number }[];
  ranker?: RankerMetrics | null;
}
