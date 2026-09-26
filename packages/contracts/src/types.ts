// Domain types shared by the engine, the API and the web app.

export type Role = 'link' | 'button' | 'textbox' | 'checkbox' | 'combobox' | 'other';

/** A durable description of an interactive element, rich enough to find it again after the DOM changes. */
export interface ElementDescriptor {
  role: Role;
  /** Accessible name: aria-label, label text, visible text, alt or placeholder. */
  name: string;
  tag: string;
  type?: string;
  placeholder?: string;
  href?: string;
  id?: string;
  testId?: string;
  /** Structural CSS path captured at record time. Fast but brittle. */
  cssPath: string;
  /** Closest landmark heading plus the nearest sibling's text. */
  context: string;
  inForm: boolean;
  inNav: boolean;
}

export interface FormField {
  name: string;
  type: string;
  label: string;
  required: boolean;
}

export type ActionKind = 'click' | 'fill_submit' | 'fill_submit_empty' | 'navigate';

export interface Action {
  kind: ActionKind;
  /** Stable key, unique per state: used to avoid re-trying the same action. */
  key: string;
  label: string;
  target?: ElementDescriptor;
  /** For form actions: the fields to fill before clicking the submit target. */
  fields?: FormField[];
  /** For navigate: absolute URL. */
  url?: string;
}

export interface StateSnapshot {
  url: string;
  path: string;
  title: string;
  fingerprint: string;
  elements: ElementDescriptor[];
  forms: { submit: ElementDescriptor; fields: FormField[] }[];
  visibleText: string;
  status: number;
}

export type AnomalyType =
  | 'server_error'
  | 'broken_link'
  | 'console_error'
  | 'page_error'
  | 'network_failure'
  | 'broken_image'
  | 'suspicious_text'
  | 'slow_response'
  | 'llm_judged';

export type Severity = 'critical' | 'major' | 'minor';

export interface Anomaly {
  type: AnomalyType;
  message: string;
  url: string;
  /** Dedup key: type + normalized location + normalized message. */
  signature: string;
  severity: Severity;
}

export type Tier = 'heuristic' | 'ranker' | 'llm' | 'fallback';

/** One candidate action as each tier saw it. */
export interface CandidateScore {
  label: string;
  kind: ActionKind;
  heuristic: number;
  ranker?: number;
  chosen: boolean;
}

/** Why a step was decided by the tier that decided it, and why earlier tiers passed. */
export interface DecisionTrace {
  total: number;
  /** Top candidates, best first by the deciding tier's own score. */
  candidates: CandidateScore[];
  heuristic: { best: number; second: number; margin: number; required: number; decided: boolean; ms: number };
  ranker: { available: boolean; best?: number; threshold: number; decided: boolean; ms?: number };
  llm: { available: boolean; asked: boolean; decided: boolean; reason?: string; ms?: number };
}

export interface Decision {
  action: Action;
  tier: Tier;
  confidence: number;
  reason: string;
  trace: DecisionTrace;
  /** Values chosen for form fields, if any. */
  values?: Record<string, string>;
}

export interface GraphNode {
  id: string; // fingerprint
  url: string;
  path: string;
  title: string;
  firstSeenStep: number;
  visits: number;
  bugCount: number;
  /** Thumbnail of the state, relative to the run folder. */
  thumb?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  actionKey: string;
  label: string;
  tier: Tier;
  step: number;
}

/** Minimal steps that reproduce a bug: open a URL, optionally perform one action. */
export interface ReproRecipe {
  fromUrl: string;
  action: Action | null; // null: the bug appears on page load
  values: Record<string, string>;
}

export interface BugReport {
  id: string;
  title: string;
  type: AnomalyType;
  severity: Severity;
  url: string;
  message: string;
  signature: string;
  foundAtStep: number;
  stateId: string;
  steps: string[];
  reproScript: string;
  screenshot?: string; // relative to the run folder
  /** e.g. "3/3" confirmed replays. */
  confirmations: string;
  status: 'confirmed' | 'flaky' | 'unverified';
  recipe: ReproRecipe;
}

/** How one candidate scored against a lost element. total = weighted sum of the parts. */
export interface HealScore {
  semantic: number;
  role: number;
  context: number;
  tag: number;
  total: number;
}

export interface HealCandidate {
  name: string;
  role: Role;
  context: string;
  score: HealScore;
}

export interface HealEvent {
  step: number;
  target: { name: string; role: Role; context: string; id?: string; testId?: string };
  strategy: 'exact' | 'healed' | 'failed';
  via?: 'testId' | 'id' | 'cssPath' | 'semantic';
  score: number;
  matched?: string;
  /** Top candidates considered by the semantic matcher (empty for exact matches). */
  candidates: HealCandidate[];
}

export interface RunStats {
  steps: number;
  states: number;
  edges: number;
  bugs: number;
  tierCounts: Record<Tier, number>;
  heals: { exact: number; healed: number; failed: number };
  llmCalls: number;
  elapsedMs: number;
  /** Median / 95th percentile wall time of a step, ms. */
  stepP50Ms?: number;
  stepP95Ms?: number;
}

export type RunEvent =
  | { t: 'run_started'; runId: string; target: string; at: number; policy: string; embedder: string }
  | { t: 'node_added'; node: GraphNode }
  | { t: 'edge_added'; edge: GraphEdge }
  | {
      t: 'step';
      step: number;
      from: string;
      stateId: string;
      durationMs: number;
      decision: { label: string; kind: ActionKind; tier: Tier; confidence: number; reason: string; trace: DecisionTrace };
    }
  | { t: 'bug'; bug: BugReport }
  | { t: 'heal'; heal: HealEvent }
  | { t: 'stats'; stats: RunStats }
  | { t: 'run_finished'; at: number; stats: RunStats };

export type RunStatus = 'queued' | 'running' | 'finished' | 'failed' | 'stopped';

export interface RunSummary {
  id: string;
  target: string;
  status: RunStatus;
  createdAt: number;
  policy?: string;
  stats?: RunStats;
  error?: string;
}

export interface RunDetail extends RunSummary {
  graph: { nodes: GraphNode[]; edges: GraphEdge[] } | null;
  bugs: BugReport[];
}

export type SweepVerdict = 'still broken' | 'fixed' | 'flaky';

export interface SweepItem {
  bugId: string;
  title: string;
  severity: Severity;
  verdict: SweepVerdict;
  reproduced: string; // "3/3"
  replayedOn: string;
  heals: HealEvent[];
}

/** Replaying every bug of an earlier run against a new build (a fix, a redesign). */
export interface Sweep {
  id: string;
  sourceRunId: string;
  target: string;
  label?: string;
  status: 'running' | 'finished' | 'failed';
  createdAt: number;
  finishedAt?: number;
  items: SweepItem[];
}
