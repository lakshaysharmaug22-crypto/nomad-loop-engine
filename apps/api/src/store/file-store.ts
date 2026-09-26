// File-backed store: zero setup. The engine already writes events.jsonl and run.json into each run
// folder, so this store adds a small meta.json for lifecycle state and reads everything else from
// disk. Runs recorded by the CLI into the same folder show up automatically.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunDetail, RunEvent, RunSummary, Sweep } from '@nomad/contracts';
import type { RunResult, RunStore } from './run-store';

const readJson = <T>(f: string): T | null => {
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as T;
  } catch {
    return null;
  }
};

export class FileRunStore implements RunStore {
  readonly kind = 'file' as const;
  private readonly sweepsDir: string;

  constructor(private readonly runsDir: string) {
    this.sweepsDir = join(runsDir, '..', 'sweeps');
  }

  async init() {
    mkdirSync(this.runsDir, { recursive: true });
    mkdirSync(this.sweepsDir, { recursive: true });
  }

  async close() {}

  private metaPath(id: string) {
    return join(this.runsDir, id, 'meta.json');
  }

  private readSummary(id: string): RunSummary | null {
    const meta = readJson<RunSummary>(this.metaPath(id));
    if (meta) return meta;
    // A folder written by the CLI: derive the summary from its run.json.
    const run = readJson<{ target: string; policy?: string; stats: RunSummary['stats'] }>(join(this.runsDir, id, 'run.json'));
    if (!run) return null;
    const first = this.getEventsSync(id).find((e) => e.t === 'run_started');
    return {
      id,
      target: run.target,
      status: 'finished',
      createdAt: first && 'at' in first ? first.at : 0,
      policy: run.policy,
      stats: run.stats,
    };
  }

  async createRun(run: RunSummary) {
    mkdirSync(join(this.runsDir, run.id), { recursive: true });
    writeFileSync(this.metaPath(run.id), JSON.stringify(run, null, 2));
  }

  async updateRun(id: string, patch: Partial<Omit<RunSummary, 'id'>>) {
    const cur = this.readSummary(id);
    if (!cur) return;
    writeFileSync(this.metaPath(id), JSON.stringify({ ...cur, ...patch }, null, 2));
  }

  async saveResult() {
    // The engine writes run.json itself.
  }

  async appendEvent() {
    // The engine appends to events.jsonl itself.
  }

  async listRuns(limit = 100) {
    if (!existsSync(this.runsDir)) return [];
    return readdirSync(this.runsDir)
      .map((id) => this.readSummary(id))
      .filter((r): r is RunSummary => r !== null)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  async getRun(id: string): Promise<RunDetail | null> {
    const summary = this.readSummary(id);
    if (!summary) return null;
    const run = readJson<RunResult>(join(this.runsDir, id, 'run.json'));
    return { ...summary, graph: run?.graph ?? null, bugs: run?.bugs ?? [] };
  }

  private getEventsSync(id: string): RunEvent[] {
    const f = join(this.runsDir, id, 'events.jsonl');
    if (!existsSync(f)) return [];
    return readFileSync(f, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as RunEvent);
  }

  async getEvents(id: string) {
    return this.getEventsSync(id);
  }

  async saveSweep(sweep: Sweep) {
    writeFileSync(join(this.sweepsDir, `${sweep.id}.json`), JSON.stringify(sweep, null, 2));
  }

  async getSweep(id: string) {
    return readJson<Sweep>(join(this.sweepsDir, `${id}.json`));
  }

  async listSweeps(sourceRunId?: string) {
    if (!existsSync(this.sweepsDir)) return [];
    return readdirSync(this.sweepsDir)
      .map((f) => readJson<Sweep>(join(this.sweepsDir, f)))
      .filter((s): s is Sweep => !!s && (!sourceRunId || s.sourceRunId === sourceRunId))
      .sort((a, b) => b.createdAt - a.createdAt);
  }
}
