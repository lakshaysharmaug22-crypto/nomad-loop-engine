// Decision layer: a three-tier hybrid policy.
//
//   1. Rules    Interpretable novelty scores. Decide when one candidate clearly leads.
//   2. Ranker   A small MLP trained on the engine's own exploration logs (ONNX, via the ML service).
//               Decides whenever its best candidate looks promising.
//   3. LLM      A local open-weight model, asked only when the ranker sees nothing promising.
//
// Every decision carries a trace of what each tier saw, so escalations are measurable and visible.
import type { Action, CandidateScore, Decision, DecisionTrace } from '@nomad/contracts';
import { hrefPath } from './actions';
import { featurize, type FeatureContext } from './features';
import type { LlmClient, RankerClient } from './ml-client';

export interface PolicyContext extends FeatureContext {
  candidates: Action[];
  history: string[];
}

export interface DecisionPolicy {
  readonly name: string;
  decide(ctx: PolicyContext): Promise<Decision>;
}

export interface HybridThresholds {
  /** Rules decide when best − second ≥ this. */
  heuristicMargin: number;
  /** Ranker decides when its best probability ≥ this. Ties between good options are not escalated. */
  rankerMin: number;
}

export const DEFAULT_THRESHOLDS: HybridThresholds = { heuristicMargin: 1.5, rankerMin: 0.55 };
const TRACE_TOP = 6;

/** Tier 1 score: novelty of the target, first tries of forms and buttons, penalties for repeats. */
export function heuristicScore(a: Action, ctx: PolicyContext): number {
  const used = ctx.graph.globalKeyUse.get(a.key) || 0;
  const name = (a.target?.name || '').toLowerCase();
  let s = 0;
  if (a.kind === 'click' && a.target?.role === 'link') {
    s += ctx.graph.seenPaths.has(hrefPath(a.target.href)) ? 0 : 3;
    if (/^(home|about|back)\b/.test(name)) s -= 1;
  } else if (a.kind === 'fill_submit') s += used ? 0 : 2;
  else if (a.kind === 'fill_submit_empty') s += used ? 0 : 1.5;
  else s += used ? 0 : 1.2;
  if (/remove|delete|clear|log ?out/.test(name)) s -= 0.7; // destructive actions: explore, but later
  return s - 2 * used;
}

function top2(xs: number[]) {
  let best = -Infinity;
  let second = -Infinity;
  let idx = 0;
  xs.forEach((x, i) => {
    if (x > best) {
      second = best;
      best = x;
      idx = i;
    } else if (x > second) second = x;
  });
  return { best, second: Number.isFinite(second) ? second : best, idx };
}

const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

function candidateTable(c: Action[], h: number[], r: number[] | null, chosen: number, orderBy: 'heuristic' | 'ranker'): CandidateScore[] {
  const rows = c.map((a, i) => ({
    label: a.label,
    kind: a.kind,
    heuristic: round(h[i], 2),
    ranker: r ? round(r[i]) : undefined,
    chosen: i === chosen,
  }));
  const key = (x: CandidateScore) => (orderBy === 'ranker' && x.ranker !== undefined ? x.ranker : x.heuristic);
  rows.sort((a, b) => Number(b.chosen) - Number(a.chosen) || key(b) - key(a));
  // Keep the chosen action visible even if it is not in the top N.
  const top = rows.slice(0, TRACE_TOP);
  return top.sort((a, b) => key(b) - key(a));
}

export class HybridPolicy implements DecisionPolicy {
  readonly name: string;

  constructor(
    private readonly ranker: RankerClient | null,
    private readonly llm: LlmClient | null,
    private readonly t: HybridThresholds = DEFAULT_THRESHOLDS,
  ) {
    this.name = ['rules', ranker && 'ranker', llm && 'llm'].filter(Boolean).join(' → ');
  }

  async decide(ctx: PolicyContext): Promise<Decision> {
    const c = ctx.candidates;
    const t0 = performance.now();
    const h = c.map((a) => heuristicScore(a, ctx));
    const H = top2(h);
    const hMs = round(performance.now() - t0, 2);
    const trace: DecisionTrace = {
      total: c.length,
      candidates: [],
      heuristic: {
        best: round(H.best, 2),
        second: round(H.second, 2),
        margin: round(H.best - H.second, 2),
        required: this.t.heuristicMargin,
        decided: false,
        ms: hMs,
      },
      ranker: { available: !!this.ranker, threshold: this.t.rankerMin, decided: false },
      llm: { available: !!this.llm, asked: false, decided: false },
    };

    // Tier 1
    if (c.length === 1 || H.best - H.second >= this.t.heuristicMargin) {
      trace.heuristic.decided = true;
      trace.candidates = candidateTable(c, h, null, H.idx, 'heuristic');
      const reason =
        c.length === 1 ? 'only untried action' : `leads by ${(H.best - H.second).toFixed(1)} (needs ${this.t.heuristicMargin})`;
      return { action: c[H.idx], tier: 'heuristic', confidence: Math.min(1, 0.5 + (H.best - H.second) / 6), reason, trace };
    }

    // Tier 2
    let scores: number[] | null = null;
    if (this.ranker) {
      const t1 = performance.now();
      scores = await this.ranker.score(c.map((a, i) => featurize(a, i, c, ctx)));
      trace.ranker.ms = round(performance.now() - t1, 1);
      trace.ranker.available = !!scores;
    }
    const R = scores ? top2(scores) : null;
    if (R) {
      trace.ranker.best = round(R.best);
      if (R.best >= this.t.rankerMin) {
        trace.ranker.decided = true;
        trace.candidates = candidateTable(c, h, scores, R.idx, 'ranker');
        return { action: c[R.idx], tier: 'ranker', confidence: R.best, reason: `p=${R.best.toFixed(2)} ≥ ${this.t.rankerMin}`, trace };
      }
    }

    // Tier 3
    if (this.llm) {
      const t2 = performance.now();
      trace.llm.asked = true;
      const choice = await this.llm.choose({
        url: ctx.state.url,
        title: ctx.state.title,
        text: ctx.state.visibleText.slice(0, 1200),
        candidates: c.map((a) => a.label),
        history: ctx.history.slice(-6),
      });
      trace.llm.ms = round(performance.now() - t2, 0);
      trace.llm.available = !!choice;
      if (choice) {
        trace.llm.decided = true;
        trace.llm.reason = choice.reason;
        trace.candidates = candidateTable(c, h, scores, choice.index, scores ? 'ranker' : 'heuristic');
        return { action: c[choice.index], tier: 'llm', confidence: 0.5, reason: choice.reason, trace };
      }
    }

    // No tier was confident: take the best guess available.
    const idx = R ? R.idx : H.idx;
    trace.candidates = candidateTable(c, h, scores, idx, scores ? 'ranker' : 'heuristic');
    const reason = R ? `best p=${R.best.toFixed(2)} < ${this.t.rankerMin}; LLM unavailable` : 'rules tied; no model available';
    return { action: c[idx], tier: 'fallback', confidence: R ? R.best : 0.3, reason, trace };
  }
}

/** Uniform random choice, used to collect unbiased training data for the ranker. */
export class RandomPolicy implements DecisionPolicy {
  readonly name = 'random';

  constructor(private readonly rand: () => number = Math.random) {}

  async decide(ctx: PolicyContext): Promise<Decision> {
    const c = ctx.candidates;
    const i = Math.floor(this.rand() * c.length);
    const trace: DecisionTrace = {
      total: c.length,
      candidates: c.slice(0, TRACE_TOP).map((a, j) => ({ label: a.label, kind: a.kind, heuristic: 0, chosen: j === i })),
      heuristic: { best: 0, second: 0, margin: 0, required: 0, decided: false, ms: 0 },
      ranker: { available: false, threshold: 0, decided: false },
      llm: { available: false, asked: false, decided: false },
    };
    return { action: c[i], tier: 'fallback', confidence: 0, reason: 'random exploration', trace };
  }
}

/** Seeded linear congruential generator, so random runs are reproducible. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}
