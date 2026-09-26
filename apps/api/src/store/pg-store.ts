// Postgres store. Migrations in ./migrations run in order inside a transaction at startup,
// guarded by an advisory lock so several API instances can boot at once.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunDetail, RunEvent, RunSummary, Sweep } from '@nomad/contracts';
import { Pool } from 'pg';
import type { RunResult, RunStore } from './run-store';

const MIGRATIONS_DIR = join(__dirname, 'migrations');
const LOCK_KEY = 4_117_020;

interface RunRow {
  id: string;
  target: string;
  status: RunSummary['status'];
  policy: string | null;
  error: string | null;
  stats: RunSummary['stats'] | null;
  graph: RunDetail['graph'];
  bugs: RunDetail['bugs'];
  created_at: Date;
}

interface SweepRow {
  id: string;
  source_run_id: string;
  target: string;
  label: string | null;
  status: Sweep['status'];
  items: Sweep['items'];
  created_at: Date;
  finished_at: Date | null;
}

const toSummary = (r: RunRow): RunSummary => ({
  id: r.id,
  target: r.target,
  status: r.status,
  createdAt: r.created_at.getTime(),
  policy: r.policy ?? undefined,
  stats: r.stats ?? undefined,
  error: r.error ?? undefined,
});

const toSweep = (r: SweepRow): Sweep => ({
  id: r.id,
  sourceRunId: r.source_run_id,
  target: r.target,
  label: r.label ?? undefined,
  status: r.status,
  items: r.items,
  createdAt: r.created_at.getTime(),
  finishedAt: r.finished_at?.getTime(),
});

const COLUMNS: Record<string, string> = { target: 'target', status: 'status', policy: 'policy', error: 'error', stats: 'stats' };

export class PgRunStore implements RunStore {
  readonly kind = 'postgres' as const;
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10 });
  }

  async init() {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
      await client.query(
        'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
      );
      const done = new Set((await client.query<{ version: number }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
      const files = readdirSync(MIGRATIONS_DIR)
        .filter((f) => /^\d+_.+\.sql$/.test(f))
        .sort();
      for (const f of files) {
        const version = parseInt(f, 10);
        if (done.has(version)) continue;
        await client.query('BEGIN');
        try {
          await client.query(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
          throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }

  async createRun(run: RunSummary) {
    await this.pool.query('INSERT INTO runs (id, target, status, policy, created_at) VALUES ($1, $2, $3, $4, $5)', [
      run.id,
      run.target,
      run.status,
      run.policy ?? null,
      new Date(run.createdAt),
    ]);
  }

  async updateRun(id: string, patch: Partial<Omit<RunSummary, 'id'>>) {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      const col = COLUMNS[k];
      if (!col) continue;
      values.push(col === 'stats' ? JSON.stringify(v) : v);
      sets.push(`${col} = $${values.length}`);
    }
    if (!sets.length) return;
    values.push(id);
    await this.pool.query(`UPDATE runs SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length}`, values);
  }

  async saveResult(id: string, r: RunResult) {
    await this.pool.query('UPDATE runs SET stats = $2, graph = $3, bugs = $4, updated_at = now() WHERE id = $1', [
      id,
      JSON.stringify(r.stats),
      JSON.stringify(r.graph),
      JSON.stringify(r.bugs),
    ]);
  }

  async appendEvent(id: string, seq: number, event: RunEvent) {
    await this.pool.query('INSERT INTO run_events (run_id, seq, type, payload) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [
      id,
      seq,
      event.t,
      JSON.stringify(event),
    ]);
  }

  async listRuns(limit = 100) {
    const { rows } = await this.pool.query<RunRow>(
      'SELECT id, target, status, policy, error, stats, NULL AS graph, bugs, created_at FROM runs ORDER BY created_at DESC LIMIT $1',
      [limit],
    );
    return rows.map(toSummary);
  }

  async getRun(id: string): Promise<RunDetail | null> {
    const { rows } = await this.pool.query<RunRow>('SELECT * FROM runs WHERE id = $1', [id]);
    if (!rows[0]) return null;
    return { ...toSummary(rows[0]), graph: rows[0].graph, bugs: rows[0].bugs };
  }

  async getEvents(id: string) {
    const { rows } = await this.pool.query<{ payload: RunEvent }>('SELECT payload FROM run_events WHERE run_id = $1 ORDER BY seq', [id]);
    return rows.map((r) => r.payload);
  }

  async saveSweep(s: Sweep) {
    await this.pool.query(
      `INSERT INTO sweeps (id, source_run_id, target, label, status, items, created_at, finished_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, items = EXCLUDED.items, finished_at = EXCLUDED.finished_at`,
      [
        s.id,
        s.sourceRunId,
        s.target,
        s.label ?? null,
        s.status,
        JSON.stringify(s.items),
        new Date(s.createdAt),
        s.finishedAt ? new Date(s.finishedAt) : null,
      ],
    );
  }

  async getSweep(id: string) {
    const { rows } = await this.pool.query<SweepRow>('SELECT * FROM sweeps WHERE id = $1', [id]);
    return rows[0] ? toSweep(rows[0]) : null;
  }

  async listSweeps(sourceRunId?: string) {
    const { rows } = sourceRunId
      ? await this.pool.query<SweepRow>('SELECT * FROM sweeps WHERE source_run_id = $1 ORDER BY created_at DESC', [sourceRunId])
      : await this.pool.query<SweepRow>('SELECT * FROM sweeps ORDER BY created_at DESC LIMIT 100');
    return rows.map(toSweep);
  }
}
