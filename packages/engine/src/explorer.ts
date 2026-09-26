// The exploration loop: snapshot → decide (hybrid policy) → act (self-healing) → observe → report.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Anomaly, BugReport, RunEvent, RunStats, StateSnapshot } from '@nomad/contracts';
import type { Browser, Page } from 'playwright-core';
import { candidateActions, fakeValues, sameOrigin } from './actions';
import { checkState, correlate, makeAnomaly, PageMonitor } from './anomaly';
import { launchBrowser } from './browser';
import type { Embedder } from './embedder';
import { gotoAndSettle, NavStatus, perform, toHealEvent } from './executor';
import { FEATURE_NAMES, FEATURE_VERSION, featurize } from './features';
import { StateGraph } from './graph';
import { SelfHealingLocator } from './locator';
import type { LlmClient } from './ml-client';
import type { DecisionPolicy } from './policy';
import { bugTitle, minimizeAndVerify, reproScript, type ReproRecipe } from './reporter';
import { snapshot } from './snapshot';

export interface ExploreOptions {
  runId: string;
  targetUrl: string;
  maxSteps: number;
  policy: DecisionPolicy;
  embedder: Embedder;
  /** Optional LLM that judges the outcome of empty form submissions. */
  judge?: LlmClient | null;
  runDir: string;
  verifyRuns?: number;
  onEvent?: (e: RunEvent) => void;
  /** Append (features, label) rows here for ranker training. */
  trainingLog?: string;
  /** Save a small JPEG of every new state (used by the dashboard's graph previews). */
  thumbnails?: boolean;
  browser?: Browser;
  shouldStop?: () => boolean;
}

export interface ExploreResult {
  runId: string;
  target: string;
  policy: string;
  embedder: string;
  stats: RunStats;
  bugs: BugReport[];
  graph: ReturnType<StateGraph['toJSON']>;
}

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

export async function explore(o: ExploreOptions): Promise<ExploreResult> {
  for (const d of ['screens', 'repro', 'states']) mkdirSync(join(o.runDir, d), { recursive: true });
  const eventsFile = join(o.runDir, 'events.jsonl');
  writeFileSync(eventsFile, '');
  const emit = (e: RunEvent) => {
    appendFileSync(eventsFile, JSON.stringify(e) + '\n');
    o.onEvent?.(e);
  };

  const t0 = Date.now();
  const origin = new URL(o.targetUrl).origin;
  const graph = new StateGraph();
  const locator = new SelfHealingLocator(o.embedder);
  const bugs: BugReport[] = [];
  const seenSignatures = new Set<string>();
  const stepTimes: number[] = [];
  const stats: RunStats = {
    steps: 0,
    states: 0,
    edges: 0,
    bugs: 0,
    tierCounts: { heuristic: 0, ranker: 0, llm: 0, fallback: 0 },
    heals: { exact: 0, healed: 0, failed: 0 },
    llmCalls: 0,
    elapsedMs: 0,
  };
  const snapshotStats = (): RunStats => ({
    ...stats,
    states: graph.nodes.size,
    edges: graph.edges.length,
    bugs: bugs.length,
    elapsedMs: Date.now() - t0,
    stepP50Ms: Math.round(percentile(stepTimes, 50)),
    stepP95Ms: Math.round(percentile(stepTimes, 95)),
    tierCounts: { ...stats.tierCounts },
    heals: { ...stats.heals },
  });

  const ownBrowser = !o.browser;
  const browser = o.browser ?? (await launchBrowser());
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page: Page = await context.newPage();
  const monitor = new PageMonitor(page);
  const nav = new NavStatus(page);
  await o.embedder.ready?.();
  emit({ t: 'run_started', runId: o.runId, target: o.targetUrl, at: t0, policy: o.policy.name, embedder: o.embedder.name });

  const report = async (anomalies: Anomaly[], recipe: ReproRecipe, state: StateSnapshot, step: number) => {
    for (const a of anomalies) {
      if (seenSignatures.has(a.signature)) continue;
      seenSignatures.add(a.signature);
      const id = `NLE-${String(bugs.length + 1).padStart(3, '0')}`;
      const screenshot = `screens/${id}.png`;
      await page.screenshot({ path: join(o.runDir, screenshot) }).catch(() => {});
      const v = await minimizeAndVerify(browser, recipe, a, locator, o.verifyRuns ?? 3);
      const title = bugTitle(a, v.recipe);
      const bug: BugReport = {
        id,
        title,
        type: a.type,
        severity: a.severity,
        url: a.url,
        message: a.message,
        signature: a.signature,
        foundAtStep: step,
        stateId: state.fingerprint,
        steps: [`Open ${v.recipe.fromUrl}`, ...(v.recipe.action ? [v.recipe.action.label] : []), `Observe: ${a.message}`],
        reproScript: reproScript(id, title, a, v.recipe),
        screenshot,
        confirmations: `${v.hits}/${v.runs}`,
        status: v.status,
        recipe: v.recipe,
      };
      writeFileSync(join(o.runDir, 'repro', `${id.toLowerCase()}.spec.ts`), bug.reproScript);
      bugs.push(bug);
      const node = graph.nodes.get(state.fingerprint);
      if (node) node.bugCount++;
      emit({ t: 'bug', bug });
    }
  };

  const enter = async (s: StateSnapshot, step: number) => {
    const { node, created } = graph.upsert(s, step);
    if (created) {
      if (o.thumbnails !== false) {
        node.thumb = `states/${node.id}.jpg`;
        await page.screenshot({ path: join(o.runDir, node.thumb), type: 'jpeg', quality: 42 }).catch(() => (node.thumb = undefined));
      }
      emit({ t: 'node_added', node: { ...node } });
    }
    return created;
  };

  // Step 0: land on the target.
  let status = await gotoAndSettle(page, o.targetUrl, nav);
  let state = await snapshot(page, status);
  await enter(state, 0);
  await report(correlate([...monitor.drain(), ...checkState(state)]), { fromUrl: o.targetUrl, action: null, values: {} }, state, 0);
  emit({ t: 'stats', stats: snapshotStats() });

  let stepsSinceNew = 0;
  let guard = 0;
  const history: string[] = [];

  for (let step = 1; step <= o.maxSteps && guard < o.maxSteps * 4; guard++) {
    if (o.shouldStop?.()) break;
    const cands = candidateActions(state, origin).filter((a) => !graph.wasTried(state.fingerprint, a));
    graph.setUntried(state.fingerprint, cands.length);

    if (!cands.length) {
      // Dead end: jump to the oldest state that still has untried actions.
      const next = graph.frontier(state.fingerprint)[0];
      if (!next) break;
      status = await gotoAndSettle(page, next.url, nav);
      monitor.drain();
      state = await snapshot(page, status);
      if (!graph.has(state.fingerprint)) await enter(state, step);
      if (state.fingerprint !== next.id) graph.setUntried(next.id, 0); // that URL no longer reproduces the state
      continue;
    }

    const stepStart = Date.now();
    const node = graph.nodes.get(state.fingerprint)!;
    const ctx = { state, graph, stateVisits: node.visits, stepsSinceNewState: stepsSinceNew, candidates: cands, history };
    const decision = await o.policy.decide(ctx);
    const features = featurize(decision.action, cands.indexOf(decision.action), cands, ctx);
    stats.tierCounts[decision.tier]++;
    if (decision.tier === 'llm') stats.llmCalls++;

    const values = decision.values ?? fakeValues(decision.action.fields || [], state.visibleText);
    graph.markTried(state.fingerprint, decision.action);
    const before = state;
    monitor.drain();
    const res = await perform(page, decision.action, values, locator, nav);
    stats.heals[res.heal.strategy]++;
    if (res.heal.strategy !== 'exact' && decision.action.target)
      emit({ t: 'heal', heal: toHealEvent(step, decision.action.target, res.heal) });

    // Wandered off-site: come back and treat the action as a dead end.
    if (!sameOrigin(page.url(), origin)) {
      status = await gotoAndSettle(page, before.url, nav);
      monitor.drain();
      state = await snapshot(page, status);
      continue;
    }

    state = await snapshot(page, res.status);
    const created = await enter(state, step);
    stepsSinceNew = created ? 0 : stepsSinceNew + 1;
    const edge = graph.addEdge(before.fingerprint, state.fingerprint, decision.action, decision.tier, step);
    if (edge) emit({ t: 'edge_added', edge });

    const anomalies = correlate([...monitor.drain(), ...checkState(state)]);
    if (decision.action.kind === 'fill_submit_empty' && o.judge) {
      const verdict = await o.judge.judge({
        action: decision.action.label,
        url: state.url,
        before: before.visibleText.slice(0, 800),
        after: state.visibleText.slice(0, 800),
      });
      if (verdict) stats.llmCalls++;
      if (verdict?.isBug) anomalies.push(makeAnomaly('llm_judged', verdict.title, before.url, verdict.reason));
    }
    const newFindings = anomalies.filter((a) => !seenSignatures.has(a.signature)).length;
    await report(anomalies, { fromUrl: before.url, action: decision.action, values }, state, step);

    if (o.trainingLog) {
      const row = {
        v: FEATURE_VERSION,
        names: step === 1 ? FEATURE_NAMES : undefined,
        x: features,
        y: created || newFindings > 0 ? 1 : 0,
        kind: decision.action.kind,
        run: o.runId,
      };
      appendFileSync(o.trainingLog, JSON.stringify(row) + '\n');
    }

    const durationMs = Date.now() - stepStart;
    stepTimes.push(durationMs);
    history.push(decision.action.label);
    stats.steps = step;
    emit({
      t: 'step',
      step,
      from: before.fingerprint,
      stateId: state.fingerprint,
      durationMs,
      decision: {
        label: decision.action.label,
        kind: decision.action.kind,
        tier: decision.tier,
        confidence: Number(decision.confidence.toFixed(3)),
        reason: decision.reason,
        trace: decision.trace,
      },
    });
    emit({ t: 'stats', stats: snapshotStats() });
    step++;
  }

  const final = snapshotStats();
  const result: ExploreResult = {
    runId: o.runId,
    target: o.targetUrl,
    policy: o.policy.name,
    embedder: o.embedder.name,
    stats: final,
    bugs,
    graph: graph.toJSON(),
  };
  writeFileSync(join(o.runDir, 'run.json'), JSON.stringify(result, null, 2));
  emit({ t: 'run_finished', at: Date.now(), stats: final });
  await context.close();
  if (ownBrowser) await browser.close();
  return result;
}
