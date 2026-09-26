// Copies benchmark results and recorded runs into public/demo, the data the dashboard serves
// when no API is configured (e.g. a static deployment).
//   node scripts/sync-demo.mjs
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const bench = join(root, 'benchmarks');
const out = resolve(here, '../public/demo');
const RUNS = ['demo', 'hybrid-1', 'rules-1', 'random-1'];

const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'runs'), { recursive: true });

const index = [];
for (const id of RUNS) {
  const src = join(bench, 'runs', id);
  if (!existsSync(join(src, 'run.json'))) {
    console.warn(`skip ${id}: not recorded`);
    continue;
  }
  const run = read(join(src, 'run.json'));
  const events = readFileSync(join(src, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const started = events.find((e) => e.t === 'run_started');
  const summary = { id, target: run.target, status: 'finished', createdAt: started?.at ?? 0, policy: run.policy, stats: run.stats };
  const dst = join(out, 'runs', id);
  mkdirSync(dst, { recursive: true });
  writeFileSync(join(dst, 'run.json'), JSON.stringify({ ...summary, graph: run.graph, bugs: run.bugs }));
  writeFileSync(join(dst, 'events.json'), JSON.stringify(events));
  for (const dir of ['screens', 'states', 'repro']) {
    if (existsSync(join(src, dir)) && readdirSync(join(src, dir)).length) cpSync(join(src, dir), join(dst, dir), { recursive: true });
  }
  index.push(summary);
}
writeFileSync(
  join(out, 'runs.json'),
  JSON.stringify(index.sort((a, b) => (a.id === 'demo' ? -1 : b.id === 'demo' ? 1 : b.createdAt - a.createdAt))),
);

const results = join(bench, 'results');
if (existsSync(join(results, 'summary.json'))) cpSync(join(results, 'summary.json'), join(out, 'benchmarks.json'));
if (existsSync(join(results, 'sweeps.json'))) cpSync(join(results, 'sweeps.json'), join(out, 'sweeps.json'));
if (existsSync(join(results, 'heal.json'))) cpSync(join(results, 'heal.json'), join(out, 'heal.json'));

console.log(`demo data: ${index.length} runs → ${out}`);
