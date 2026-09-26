// End-to-end: boots the compiled API with the file store and in-process queue, runs a short
// exploration against buggy-shop, streams it over WebSocket, then sweeps the bugs on a fixed build.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { RunDetail, Sweep } from '@nomad/contracts';
import { io, type Socket } from 'socket.io-client';

const SHOP = resolve(__dirname, '../../../targets/buggy-shop/server.js');
const port = (base: number) => base + Math.floor(Math.random() * 400);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let app: INestApplication;
let base = '';
let dataDir = '';
const shops: ChildProcess[] = [];
let buggy = '';
let fixed = '';

function startShop(p: number, env: Record<string, string> = {}): Promise<string> {
  const child = spawn(process.execPath, [SHOP], { env: { ...process.env, PORT: String(p), ...env }, stdio: 'pipe' });
  shops.push(child);
  return new Promise((res, rej) => {
    child.stdout!.on('data', (d) => String(d).includes('http://') && res(`http://localhost:${p}`));
    child.on('exit', (c) => rej(new Error(`shop exited ${c}`)));
  });
}

async function json<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const r = await fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const text = await r.text();
  return { status: r.status, body: (text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text) as T };
}

async function waitFor<T>(fn: () => Promise<T | undefined>, ms = 240_000): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v !== undefined) return v;
    await sleep(500);
  }
  throw new Error('timed out');
}

before(async () => {
  buggy = await startShop(port(47100));
  fixed = await startShop(port(47600), { BUGS: 'off' });
  dataDir = mkdtempSync(join(tmpdir(), 'nomad-api-'));
  const apiPort = port(48100);
  Object.assign(process.env, { DATA_DIR: dataDir, PORT: String(apiPort), RUN_CONCURRENCY: '1' });
  delete process.env.DATABASE_URL;
  delete process.env.REDIS_URL;
  delete process.env.ML_URL;
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../dist/app.module');
  const { configureApp } = await import('../dist/app.setup');
  app = configureApp(await NestFactory.create(AppModule, { logger: false }));
  await app.listen(apiPort);
  base = `http://localhost:${apiPort}`;
});

after(async () => {
  await app?.close();
  for (const s of shops) s.kill();
  rmSync(dataDir, { recursive: true, force: true });
});

test('health reports the zero-setup adapters', async () => {
  const { body } = await json<{ store: string; queue: { kind: string } }>('/health');
  assert.equal(body.store, 'file');
  assert.equal(body.queue.kind, 'in-process');
});

test('invalid input is rejected with field errors', async () => {
  const { status, body } = await json<{ errors: { field: string }[] }>('/runs', {
    method: 'POST',
    body: JSON.stringify({ targetUrl: 'ftp://nope', maxSteps: 9999 }),
  });
  assert.equal(status, 400);
  assert.deepEqual(body.errors.map((e) => e.field).sort(), ['maxSteps', 'targetUrl']);
});

test('run → live events → bugs → artifacts → sweep on the fixed build', async () => {
  const { status, body: run } = await json<{ id: string; status: string }>('/runs', {
    method: 'POST',
    body: JSON.stringify({ targetUrl: buggy, maxSteps: 8, verifyRuns: 1 }),
  });
  assert.equal(status, 201);

  const socket: Socket = io(`${base}/live`, { transports: ['websocket'] });
  const seen: string[] = [];
  socket.on('run-event', (m: { event: { t: string } }) => seen.push(m.event.t));
  await new Promise<void>((r) => socket.on('connect', () => socket.emit('subscribe', run.id, () => r())));

  const done = await waitFor(async () => {
    const { body } = await json<RunDetail>(`/runs/${run.id}`);
    return body.status === 'finished' || body.status === 'failed' ? body : undefined;
  });
  socket.close();
  assert.equal(done.status, 'finished', done.error);
  assert.ok(done.bugs.length >= 2, `bugs: ${done.bugs.length}`);
  assert.ok(seen.includes('step') && seen.includes('bug'), `ws events: ${[...new Set(seen)]}`);

  const events = await json<{ t: string }[]>(`/runs/${run.id}/events`);
  assert.equal(events.body[0].t, 'run_started');

  const bug = done.bugs[0];
  const repro = await fetch(`${base}/runs/${run.id}/bugs/${bug.id}/repro`);
  assert.match(await repro.text(), /import \{ test, expect \} from '@playwright\/test'/);
  assert.equal((await fetch(`${base}/runs/${run.id}/files/${bug.screenshot}`)).status, 200);
  assert.equal((await fetch(`${base}/runs/${run.id}/files/..%2F..%2Fetc/passwd`)).status, 404);

  const { body: sweep } = await json<Sweep>('/sweeps', {
    method: 'POST',
    body: JSON.stringify({ sourceRunId: run.id, targetUrl: fixed, label: 'fixed build' }),
  });
  const finished = await waitFor(async () => {
    const { body } = await json<Sweep>(`/sweeps/${sweep.id}`);
    return body.status !== 'running' ? body : undefined;
  });
  assert.equal(finished.status, 'finished');
  assert.ok(finished.items.length > 0);
  assert.ok(
    finished.items.every((i) => i.verdict === 'fixed'),
    JSON.stringify(finished.items.map((i) => [i.bugId, i.verdict])),
  );

  const metrics = await (await fetch(`${base}/metrics`)).text();
  assert.match(metrics, /nomad_steps_total\{tier="/);
  assert.match(metrics, /nomad_runs_total\{status="finished"\} 1/);
});

test('OpenAPI document is generated from the shared schemas', async () => {
  const { body } = await json<{ paths: Record<string, unknown> }>('/docs/openapi.json');
  assert.ok(body.paths['/runs'] && body.paths['/sweeps']);
});
