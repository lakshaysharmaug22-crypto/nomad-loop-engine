#!/usr/bin/env node
// nomad: command-line interface for the exploration engine.
//
//   nomad scan <url>                explore an app and report bugs (exit 1 with --fail-on)
//   nomad sweep <run-dir> <url>     replay a run's bugs against another build
//   nomad score <run-dir> <manifest>
//   nomad heal-bench <v1> <v2> --spec redesign.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { BugReport, RunEvent, Severity } from '@nomad/contracts';
import { Command, Option } from 'commander';
import { healBench } from '../bench/heal';
import { launchBrowser } from '../browser';
import { makeEmbedder } from '../embedder';
import { explore } from '../explorer';
import { SelfHealingLocator } from '../locator';
import { HttpLlm, HttpRanker } from '../ml-client';
import { HybridPolicy, RandomPolicy, seededRandom, type DecisionPolicy } from '../policy';
import { sweepBugs } from '../reporter';
import { score, type ManifestBug } from '../score';

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = { dim: paint(2), bold: paint(1), red: paint(31), yellow: paint(33), green: paint(32), cyan: paint(36) };
const SEV_RANK: Record<Severity, number> = { minor: 1, major: 2, critical: 3 };
const sevColor = (s: Severity) => (s === 'critical' ? c.red : s === 'major' ? c.yellow : c.cyan)(s.padEnd(8));
const pct = (x: number) => `${Math.round(x * 100)}%`;

function runId() {
  return `run-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
}

function readRun(dir: string): { bugs: BugReport[]; target: string } {
  const f = join(resolve(dir), 'run.json');
  if (!existsSync(f)) throw new Error(`No run.json in ${dir}`);
  return JSON.parse(readFileSync(f, 'utf8'));
}

const program = new Command();
program.name('nomad').description('Autonomous exploratory testing for web apps').version('0.2.0');

program
  .command('scan')
  .description('explore a web app, report bugs with repro tests')
  .argument('<url>', 'start URL of the app under test')
  .option('-s, --steps <n>', 'maximum exploration steps', '60')
  .option('--ml-url <url>', 'ML service (ranker, embeddings, local LLM)', process.env.ML_URL)
  .addOption(new Option('--policy <name>', 'decision policy').choices(['hybrid', 'random']).default('hybrid'))
  .option('--seed <n>', 'seed for the random policy', '1')
  .option('-o, --out <dir>', 'runs directory', 'runs')
  .option('--run-id <id>', 'run folder name')
  .option('--verify-runs <n>', 'replays per bug for the flake check', '3')
  .option('--manifest <file>', 'score against a ground-truth bug manifest')
  .option('--min-recall <x>', 'with --manifest: exit 1 if rules-detectable recall is below x (0-1)')
  .option('--min-precision <x>', 'with --manifest: exit 1 if precision is below x (0-1)')
  .option('--train-log <file>', 'append ranker training rows to this JSONL file')
  .option('--no-thumbnails', 'skip state thumbnails')
  .addOption(
    new Option('--fail-on <severity>', 'exit 1 if a bug of this severity or worse is confirmed').choices(['minor', 'major', 'critical']),
  )
  .option('--json', 'print the result as JSON')
  .action(async (url: string, o) => {
    const ml: string | undefined = o.mlUrl;
    const policy: DecisionPolicy =
      o.policy === 'random'
        ? new RandomPolicy(seededRandom(Number(o.seed)))
        : new HybridPolicy(ml ? new HttpRanker(ml) : null, ml ? new HttpLlm(ml) : null);
    const id = o.runId ?? runId();
    const dir = join(resolve(o.out), id);
    const quiet = !!o.json;
    if (!quiet) console.log(`${c.bold('nomad scan')} ${url}  ${c.dim(`policy ${policy.name} · up to ${o.steps} steps · ${dir}`)}`);

    const onEvent = (e: RunEvent) => {
      if (quiet) return;
      if (e.t === 'bug') {
        const b = e.bug;
        console.log(
          `  ${c.dim(`step ${String(b.foundAtStep).padStart(3)}`)}  ${b.id}  ${sevColor(b.severity)} ${b.title}  ${c.dim(`${b.status} ${b.confirmations}`)}`,
        );
      } else if (e.t === 'heal' && e.heal.strategy === 'healed') {
        console.log(
          `  ${c.dim(`step ${String(e.heal.step).padStart(3)}`)}  healed   “${e.heal.target.name}” → “${e.heal.matched}” ${c.dim(`(${e.heal.score})`)}`,
        );
      }
    };

    const result = await explore({
      runId: id,
      targetUrl: url,
      maxSteps: Number(o.steps),
      policy,
      embedder: makeEmbedder(ml),
      judge: ml && o.policy !== 'random' ? new HttpLlm(ml) : null,
      runDir: dir,
      verifyRuns: Number(o.verifyRuns),
      trainingLog: o.trainLog,
      thumbnails: o.thumbnails,
      onEvent,
    });

    const s = result.stats;
    const manifest: ManifestBug[] | null = o.manifest ? JSON.parse(readFileSync(resolve(o.manifest), 'utf8')).bugs : null;
    const sc = manifest ? score(manifest, result.bugs) : null;

    if (quiet) {
      console.log(
        JSON.stringify({ runId: id, dir, stats: s, bugs: result.bugs.map(({ reproScript, recipe, ...b }) => b), score: sc }, null, 2),
      );
    } else {
      console.log(
        `\n${c.bold('done')}  ${s.steps} steps  ${s.states} states  ${s.bugs} bugs  ${(s.elapsedMs / 1000).toFixed(1)}s  ${c.dim(`step p50 ${s.stepP50Ms}ms · p95 ${s.stepP95Ms}ms`)}`,
      );
      console.log(
        `${c.dim('decided by')}  rules ${s.tierCounts.heuristic} · ranker ${s.tierCounts.ranker} · llm ${s.tierCounts.llm} · fallback ${s.tierCounts.fallback}`,
      );
      if (sc && manifest) {
        console.log(
          `${c.dim('score')}       recall ${pct(sc.recall)} (${sc.found.length}/${manifest.length}) · rules-detectable ${pct(sc.recallHeuristicOnly)} · precision ${pct(sc.precision)}`,
        );
        for (const m of sc.missed) console.log(`  ${c.yellow('missed')}  ${m.id} ${m.title} ${c.dim(`(${m.detectableBy})`)}`);
        for (const u of sc.unmatchedReports) console.log(`  ${c.yellow('extra')}   ${u}`);
      }
    }

    if (sc && (o.minRecall || o.minPrecision)) {
      const low: string[] = [];
      if (o.minRecall && sc.recallHeuristicOnly < Number(o.minRecall))
        low.push(`recall ${pct(sc.recallHeuristicOnly)} < ${pct(Number(o.minRecall))}`);
      if (o.minPrecision && sc.precision < Number(o.minPrecision))
        low.push(`precision ${pct(sc.precision)} < ${pct(Number(o.minPrecision))}`);
      if (low.length) {
        console.error(c.red(`\nquality gate failed: ${low.join(', ')}`));
        process.exitCode = 1;
      }
    }

    if (o.failOn) {
      const worst = result.bugs.filter((b) => b.status === 'confirmed' && SEV_RANK[b.severity] >= SEV_RANK[o.failOn as Severity]);
      if (worst.length) {
        if (!quiet) console.error(c.red(`\n${worst.length} confirmed bug(s) at or above ${o.failOn}`));
        process.exitCode = 1;
      }
    }
  });

program
  .command('sweep')
  .description("replay a run's bugs against another build (a fix, a redesign)")
  .argument('<run-dir>', 'folder of an earlier run')
  .argument('<url>', 'base URL of the build to check')
  .option('--ml-url <url>', 'ML service for semantic embeddings', process.env.ML_URL)
  .option('--runs <n>', 'replays per bug', '3')
  .option('--json', 'print the result as JSON')
  .action(async (dir: string, url: string, o) => {
    const run = readRun(dir);
    const browser = await launchBrowser();
    try {
      const items = await sweepBugs(browser, run.bugs, url, new SelfHealingLocator(makeEmbedder(o.mlUrl)), Number(o.runs), (it) => {
        if (o.json) return;
        const v =
          it.verdict === 'fixed' ? c.green('fixed        ') : it.verdict === 'flaky' ? c.yellow('flaky        ') : c.red('still broken ');
        const healed = it.heals.filter((h) => h.strategy === 'healed').length;
        console.log(`  ${it.bugId}  ${v} ${it.title}  ${c.dim(`${it.reproduced}${healed ? ` · ${healed} selector healed` : ''}`)}`);
      });
      if (o.json) console.log(JSON.stringify(items, null, 2));
      else {
        const fixed = items.filter((i) => i.verdict === 'fixed').length;
        console.log(`\n${fixed}/${items.length} fixed on ${url}`);
      }
    } finally {
      await browser.close();
    }
  });

program
  .command('score')
  .description('score a run against a ground-truth bug manifest')
  .argument('<run-dir>')
  .argument('<manifest>')
  .action((dir: string, manifestPath: string) => {
    const run = readRun(dir);
    const manifest: ManifestBug[] = JSON.parse(readFileSync(resolve(manifestPath), 'utf8')).bugs;
    console.log(JSON.stringify(score(manifest, run.bugs), null, 2));
  });

program
  .command('heal-bench')
  .description('measure selector breakage across a redesign, naive vs self-healing')
  .argument('<v1>', 'base URL of the original build')
  .argument('<v2>', 'base URL of the redesigned build')
  .requiredOption('--spec <file>', 'redesign spec: pages and known label renames')
  .option('--ml-url <url>', 'ML service for semantic embeddings', process.env.ML_URL)
  .option('--out <file>', 'write the full result here')
  .action(async (v1: string, v2: string, o) => {
    const spec = JSON.parse(readFileSync(resolve(o.spec), 'utf8'));
    const r = await healBench(v1, v2, spec, makeEmbedder(o.mlUrl));
    const { rows, ...summary } = r;
    console.log(JSON.stringify(summary, null, 2));
    for (const row of rows.filter((x) => !x.healed))
      console.log(
        `  miss  ${row.page} ${row.target.role} “${row.target.name}” → ${row.picked ?? 'no match'} (${row.strategy} ${row.score})`,
      );
    if (o.out) {
      mkdirSync(dirname(resolve(o.out)), { recursive: true });
      writeFileSync(resolve(o.out), JSON.stringify(r, null, 2));
    }
  });

program.parseAsync().catch((e) => {
  console.error(c.red(String(e?.message ?? e)));
  process.exit(1);
});
