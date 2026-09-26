// Contract tests: every RunStore and JobQueue implementation must behave the same.
// Postgres needs DATABASE_URL and BullMQ needs REDIS_URL; each is skipped without it (CI provides both).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunEvent, RunSummary, Sweep } from '@nomad/contracts';
import { FileRunStore } from '../src/store/file-store';
import { PgRunStore } from '../src/store/pg-store';
import type { RunStore } from '../src/store/run-store';
import { InProcessQueue } from '../src/queue/in-process.queue';
import { BullMqQueue } from '../src/queue/bullmq.queue';
import type { Job, JobQueue } from '../src/queue/job-queue';

const stats = {
  steps: 2,
  states: 2,
  edges: 1,
  bugs: 0,
  tierCounts: { heuristic: 1, ranker: 1, llm: 0, fallback: 0 },
  heals: { exact: 2, healed: 0, failed: 0 },
  llmCalls: 0,
  elapsedMs: 10,
};

function storeContract(name: string, make: () => Promise<{ store: RunStore; cleanup: () => Promise<void> }>) {
  describe(`RunStore: ${name}`, () => {
    let store: RunStore;
    let cleanup: () => Promise<void>;
    before(async () => ({ store, cleanup } = await make()));
    after(async () => cleanup());

    test('run lifecycle: create, update, save result, list, get', async () => {
      const run: RunSummary = { id: 'run-a', target: 'http://x.test', status: 'queued', createdAt: 1000 };
      await store.createRun(run);
      await store.createRun({ ...run, id: 'run-b', createdAt: 2000 });
      await store.updateRun('run-a', { status: 'running', policy: 'rules → ranker' });
      await store.updateRun('run-a', { status: 'finished', stats });
      await store.saveResult('run-a', { stats, graph: { nodes: [], edges: [] }, bugs: [] });

      const list = await store.listRuns();
      assert.deepEqual(list.map((r) => r.id).slice(0, 2), ['run-b', 'run-a']);
      const a = await store.getRun('run-a');
      assert.equal(a?.status, 'finished');
      assert.equal(a?.stats?.steps, 2);
      assert.equal(await store.getRun('missing'), null);
    });

    test('events come back in sequence order', async () => {
      if (store.kind === 'file') return; // the engine owns events.jsonl for the file store
      const evs: RunEvent[] = [
        { t: 'run_started', runId: 'run-a', target: 'http://x.test', at: 1, policy: 'p', embedder: 'e' },
        { t: 'stats', stats },
      ];
      await store.appendEvent('run-a', 1, evs[1]);
      await store.appendEvent('run-a', 0, evs[0]);
      await store.appendEvent('run-a', 0, evs[0]); // duplicate delivery is ignored
      assert.deepEqual(
        (await store.getEvents('run-a')).map((e) => e.t),
        ['run_started', 'stats'],
      );
    });

    test('sweeps are upserted and filtered by source run', async () => {
      const s: Sweep = { id: 'sweep-1', sourceRunId: 'run-a', target: 'http://y.test', status: 'running', createdAt: 5, items: [] };
      await store.saveSweep(s);
      await store.saveSweep({
        ...s,
        status: 'finished',
        finishedAt: 9,
        items: [
          { bugId: 'NLE-001', title: 't', severity: 'minor', verdict: 'fixed', reproduced: '0/3', replayedOn: 'http://y.test/', heals: [] },
        ],
      });
      const got = await store.getSweep('sweep-1');
      assert.equal(got?.status, 'finished');
      assert.equal(got?.items.length, 1);
      assert.equal((await store.listSweeps('run-a')).length, 1);
      assert.equal((await store.listSweeps('run-b')).length, 0);
    });
  });
}

storeContract('file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nomad-store-'));
  const store = new FileRunStore(join(dir, 'runs'));
  await store.init();
  return { store, cleanup: async () => rmSync(dir, { recursive: true, force: true }) };
});

if (process.env.DATABASE_URL) {
  storeContract('postgres', async () => {
    const store = new PgRunStore(process.env.DATABASE_URL!);
    await store.init();
    await store.init(); // migrations are idempotent
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query("DELETE FROM runs WHERE id IN ('run-a', 'run-b')");
    await pool.end();
    return { store, cleanup: () => store.close() };
  });
} else {
  test('RunStore: postgres', { skip: 'set DATABASE_URL to run' }, () => {});
}

function queueContract(name: string, make: () => JobQueue, skip = false) {
  describe(`JobQueue: ${name}`, { skip }, () => {
    test('processes jobs with bounded concurrency and supports cancel', async () => {
      const q = make();
      const p = Math.random().toString(36).slice(2, 7); // BullMQ keeps finished job ids; stay unique per test run
      const id = (n: string) => `${p}-${n}`;
      let running = 0;
      let peak = 0;
      const done: string[] = [];
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      await q.start(async (job: Job) => {
        running++;
        peak = Math.max(peak, running);
        if (job.id === id('j1') || job.id === id('j2')) await gate; // occupy both slots
        await new Promise((r) => setTimeout(r, 30));
        done.push(job.id);
        running--;
      }, 2);
      const input = { targetUrl: 'http://x.test', maxSteps: 1, verifyRuns: 1 };
      for (const n of ['j1', 'j2', 'j3', 'j4']) await q.enqueue({ kind: 'run', id: id(n), input });
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(await q.cancel(id('j4')), true);
      release();
      const t0 = Date.now();
      while (done.length < 3 && Date.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 50));
      assert.deepEqual(done.sort(), ['j1', 'j2', 'j3'].map(id));
      assert.ok(peak <= 2, `peak concurrency ${peak}`);
      await q.close();
    });
  });
}

queueContract('in-process', () => new InProcessQueue());
queueContract('bullmq', () => new BullMqQueue(process.env.REDIS_URL ?? 'redis://localhost:6379'), !process.env.REDIS_URL);
