// Benchmark harness: reproduces every number in the README.
//
//   npm run bench -- --only baselines                      random + rules runs (also logs ranker training data)
//   python -m ranker.train --data ranker/data/*.jsonl      retrain the ranker on those logs
//   npm run bench -- --ml-url http://localhost:8200 --only hybrid,demo,heal,sweep
// Options: --repeats 3  --random-seeds 5  --steps 45
//
// Starts three builds of buggy-shop (original, redesigned, fixed), then:
//   1. explores the original with random / rules / hybrid policies and records bugs-vs-steps curves
//   2. measures selector breakage across the redesign, naive vs self-healing
//   3. sweeps the demo run's bugs across the redesign and the fixed build
// Results land in benchmarks/results/summary.json (read by the web app and the README).
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { BugReport, RunStats } from '@nomad/contracts';
import {
  explore,
  healBench,
  HttpLlm,
  HttpRanker,
  HybridPolicy,
  launchBrowser,
  makeEmbedder,
  RandomPolicy,
  score,
  seededRandom,
  SelfHealingLocator,
  sweepBugs,
  type DecisionPolicy,
  type ManifestBug,
} from '@nomad/engine';

const ROOT = resolve(__dirname, '..');
const SHOP = join(ROOT, 'targets/buggy-shop/server.js');
const OUT = join(ROOT, 'benchmarks/results');
const RUNS = join(ROOT, 'benchmarks/runs');
const manifest: ManifestBug[] = JSON.parse(readFileSync(join(ROOT, 'targets/buggy-shop/bugs.manifest.json'), 'utf8')).bugs;
const redesign = JSON.parse(readFileSync(join(ROOT, 'targets/buggy-shop/redesign.json'), 'utf8'));

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const ML = arg('ml-url', process.env.ML_URL);
const REPEATS = Number(arg('repeats', '3'));
const SEEDS = Number(arg('random-seeds', '5'));
const STEPS = Number(arg('steps', '45'));
const ONLY = arg('only'); // comma list of: baselines, hybrid, demo, heal, sweep, clean (default: all)

const PORTS = { v1: 4100, v2: 4101, fixed: 4102 };
const url = (p: number) => `http://localhost:${p}`;
const procs = new Map<number, ChildProcess>();

function startShop(port: number, env: Record<string, string>): Promise<void> {
  procs.get(port)?.kill();
  const child = spawn(process.execPath, [SHOP], { env: { ...process.env, PORT: String(port), ...env }, stdio: 'pipe' });
  procs.set(port, child);
  return new Promise((res, rej) => {
    child.stdout!.on('data', (d) => String(d).includes('http://') && res());
    child.on('error', rej);
  });
}
const restartV1 = () => startShop(PORTS.v1, {}); // fresh server = empty cart, so runs are independent

interface RunRecord {
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

async function runOnce(
  policy: DecisionPolicy,
  label: string,
  opts: { thumbnails?: boolean; verifyRuns?: number; trainLog?: string } = {},
): Promise<RunRecord> {
  await restartV1();
  const dir = join(RUNS, label);
  rmSync(dir, { recursive: true, force: true });
  const r = await explore({
    runId: label,
    targetUrl: url(PORTS.v1),
    maxSteps: STEPS,
    policy,
    embedder: makeEmbedder(ML),
    judge: ML && policy.name !== 'random' ? new HttpLlm(ML) : null,
    runDir: dir,
    verifyRuns: opts.verifyRuns ?? 1,
    thumbnails: opts.thumbnails ?? false,
    trainingLog: opts.trainLog,
  });
  const sc = score(manifest, r.bugs);
  const rec: RunRecord = {
    policy: policy.name,
    label,
    stats: r.stats,
    bugSteps: r.bugs.map((b) => b.foundAtStep).sort((a, b) => a - b),
    stateSteps: r.graph.nodes.map((n) => n.firstSeenStep).sort((a, b) => a - b),
    recall: sc.recall,
    recallRules: sc.recallHeuristicOnly,
    precision: sc.precision,
    missed: sc.missed.map((m) => m.id),
    bugs: r.bugs.map(({ id, title, severity, type, foundAtStep, status }) => ({ id, title, severity, type, foundAtStep, status })),
  };
  console.log(
    `  ${label.padEnd(12)} bugs ${r.bugs.length}  states ${r.stats.states}  recall ${Math.round(sc.recall * 100)}%  last bug @${rec.bugSteps.at(-1) ?? '-'}  ${(r.stats.elapsedMs / 1000).toFixed(0)}s`,
  );
  return rec;
}

function load<T>(f: string, d: T): T {
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return d;
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(RUNS, { recursive: true });
  await Promise.all([restartV1(), startShop(PORTS.v2, { LAYOUT_VERSION: '2' }), startShop(PORTS.fixed, { BUGS: 'off' })]);
  const summaryPath = join(OUT, 'summary.json');
  const summary = load<Record<string, unknown>>(summaryPath, {});
  const want = (part: string) => !ONLY || ONLY.split(',').includes(part);
  const trainLog = join(ROOT, 'services/ml/ranker/data/training-bench.jsonl');

  try {
    const policies = (summary.policies as { steps: number; manifestSize: number; runs: RunRecord[] }) ?? {
      steps: STEPS,
      manifestSize: manifest.length,
      runs: [],
    };
    const keep = (prefix: string) => (policies.runs = policies.runs.filter((r) => !r.label.startsWith(prefix)));

    if (want('baselines')) {
      console.log(`baselines: random x${SEEDS}, rules x${REPEATS}, ${STEPS} steps each`);
      keep('random');
      keep('rules');
      rmSync(trainLog, { force: true });
      for (let s = 1; s <= SEEDS; s++)
        policies.runs.push(await runOnce(new RandomPolicy(seededRandom(s * 101)), `random-${s}`, { trainLog }));
      for (let i = 1; i <= REPEATS; i++) policies.runs.push(await runOnce(new HybridPolicy(null, null), `rules-${i}`, { trainLog }));
      summary.policies = { ...policies, steps: STEPS };
      writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    }

    if (want('hybrid')) {
      if (!ML) throw new Error('hybrid needs --ml-url');
      console.log(`hybrid x${REPEATS}, ${STEPS} steps each`);
      keep('hybrid');
      for (let i = 1; i <= REPEATS; i++)
        policies.runs.push(await runOnce(new HybridPolicy(new HttpRanker(ML), new HttpLlm(ML)), `hybrid-${i}`));
      summary.policies = { ...policies, steps: STEPS };
      writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    }

    if (want('demo')) {
      console.log('demo run (thumbnails, 3x verification)');
      const policy = ML ? new HybridPolicy(new HttpRanker(ML), new HttpLlm(ML)) : new HybridPolicy(null, null);
      summary.demo = await runOnce(policy, 'demo', { thumbnails: true, verifyRuns: 3 });
      writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    }

    if (want('heal')) {
      console.log('self-healing across the redesign');
      const r = await healBench(url(PORTS.v1), url(PORTS.v2), redesign, makeEmbedder(ML));
      writeFileSync(join(OUT, 'heal.json'), JSON.stringify(r, null, 2));
      const { rows: _rows, ...s } = r;
      summary.heal = s;
      console.log(
        `  ${r.targets} elements  naive break ${Math.round(r.naiveBreakRate * 100)}%  healing break ${Math.round(r.healingBreakRate * 100)}%  wrong ${r.wrongElement}`,
      );
      writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    }

    if (want('sweep')) {
      console.log('regression sweeps of the demo run');
      const demo = load<{ bugs: BugReport[] }>(join(RUNS, 'demo', 'run.json'), { bugs: [] });
      const browser = await launchBrowser();
      const locator = new SelfHealingLocator(makeEmbedder(ML));
      const sweeps = [];
      for (const [label, port] of [
        ['Redesign', PORTS.v2],
        ['Fixed build', PORTS.fixed],
      ] as const) {
        const items = await sweepBugs(browser, demo.bugs, url(port), locator, 3);
        sweeps.push({
          id: `sweep-${label.toLowerCase().replace(' ', '-')}`,
          sourceRunId: 'demo',
          target: url(port),
          label,
          status: 'finished',
          createdAt: Date.now(),
          finishedAt: Date.now(),
          items,
        });
        const healed = items.flatMap((i) => i.heals).filter((h) => h.strategy === 'healed').length;
        console.log(
          `  ${label.padEnd(12)} still broken ${items.filter((i) => i.verdict === 'still broken').length}  fixed ${items.filter((i) => i.verdict === 'fixed').length}  healed selectors ${healed}`,
        );
      }
      await browser.close();
      writeFileSync(join(OUT, 'sweeps.json'), JSON.stringify(sweeps, null, 2));
      summary.sweeps = sweeps.map((s) => ({
        label: s.label,
        items: s.items.length,
        stillBroken: s.items.filter((i) => i.verdict === 'still broken').length,
        fixed: s.items.filter((i) => i.verdict === 'fixed').length,
      }));
      writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    }

    if (want('clean')) {
      console.log('false positives on the fixed build');
      const policy = ML ? new HybridPolicy(new HttpRanker(ML), new HttpLlm(ML)) : new HybridPolicy(null, null);
      await startShop(PORTS.fixed, { BUGS: 'off' });
      const r = await explore({
        runId: 'clean',
        targetUrl: url(PORTS.fixed),
        maxSteps: STEPS,
        policy,
        embedder: makeEmbedder(ML),
        judge: null,
        runDir: join(RUNS, 'clean'),
        verifyRuns: 1,
        thumbnails: false,
      });
      summary.clean = { steps: r.stats.steps, states: r.stats.states, bugs: r.bugs.length, reports: r.bugs.map((b) => b.title) };
      console.log(`  ${r.stats.steps} steps  ${r.stats.states} states  ${r.bugs.length} reports`);
      writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    }

    const metricsPath = join(ROOT, 'services/ml/ranker/metrics.json');
    summary.ranker = load(metricsPath, null);
    summary.generatedAt = new Date().toISOString();
    summary.ml = ML ? 'on' : 'off';
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`wrote ${summaryPath}`);
  } finally {
    for (const p of procs.values()) p.kill();
  }
}

main().catch((e) => {
  console.error(e);
  for (const p of procs.values()) p.kill();
  process.exit(1);
});
