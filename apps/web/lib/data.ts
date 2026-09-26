// Data access. Two sources implement the same interface:
//   ApiSource   a running API (NEXT_PUBLIC_API_URL), with live WebSocket updates
//   DemoSource  recorded runs and benchmark results shipped under /public/demo
import type { BugReport, RunDetail, RunEvent, RunSummary, StartRunInput, Sweep } from '@nomad/contracts';
import type { BenchSummary, HealBench } from './bench-types';

export interface DataSource {
  readonly mode: 'live' | 'demo';
  readonly label: string;
  listRuns(): Promise<RunSummary[]>;
  getRun(id: string): Promise<RunDetail>;
  getEvents(id: string): Promise<RunEvent[]>;
  getBug(runId: string, bugId: string): Promise<BugReport>;
  listSweeps(runId: string): Promise<Sweep[]>;
  getBenchmarks(): Promise<BenchSummary | null>;
  getHealBench(): Promise<HealBench | null>;
  artifactUrl(runId: string, path: string): string;
  startRun?(input: StartRunInput): Promise<RunSummary>;
  stopRun?(id: string): Promise<void>;
  startSweep?(runId: string, targetUrl: string, label?: string): Promise<Sweep>;
  liveUrl?: string;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: { field: string; message: string }[],
  ) {
    super(message);
  }
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!res.ok) {
    let body: { message?: string | string[]; errors?: { field: string; message: string }[] } = {};
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new HttpError(res.status, msg || `Request failed (${res.status})`, body.errors);
  }
  return res.json() as Promise<T>;
}

/** Static files (benchmarks) are shared by both sources. */
const loadBench = () => getJson<BenchSummary>('/demo/benchmarks.json').catch(() => null);
const loadHeal = () => getJson<HealBench>('/demo/heal.json').catch(() => null);

class DemoSource implements DataSource {
  readonly mode = 'demo' as const;
  readonly label = 'Recorded runs';
  private index: Promise<RunSummary[]> | null = null;

  listRuns() {
    return (this.index ??= getJson<RunSummary[]>('/demo/runs.json'));
  }
  async getRun(id: string) {
    return getJson<RunDetail>(`/demo/runs/${encodeURIComponent(id)}/run.json`).catch((e) => {
      throw e instanceof HttpError && e.status === 404 ? new HttpError(404, `Run ${id} is not in the recorded set`) : e;
    });
  }
  getEvents(id: string) {
    return getJson<RunEvent[]>(`/demo/runs/${encodeURIComponent(id)}/events.json`);
  }
  async getBug(runId: string, bugId: string) {
    const run = await this.getRun(runId);
    const bug = run.bugs.find((b) => b.id === bugId);
    if (!bug) throw new HttpError(404, `Bug ${bugId} not found`);
    return bug;
  }
  async listSweeps(runId: string) {
    const all = await getJson<Sweep[]>('/demo/sweeps.json').catch(() => []);
    return all.filter((s) => s.sourceRunId === runId);
  }
  getBenchmarks = loadBench;
  getHealBench = loadHeal;
  artifactUrl(runId: string, path: string) {
    return `/demo/runs/${encodeURIComponent(runId)}/${path}`;
  }
}

class ApiSource implements DataSource {
  readonly mode = 'live' as const;
  readonly label: string;
  readonly liveUrl: string;

  constructor(private readonly base: string) {
    this.label = base.replace(/^https?:\/\//, '');
    this.liveUrl = `${base}/live`;
  }
  listRuns() {
    return getJson<RunSummary[]>(`${this.base}/runs`);
  }
  getRun(id: string) {
    return getJson<RunDetail>(`${this.base}/runs/${encodeURIComponent(id)}`);
  }
  getEvents(id: string) {
    return getJson<RunEvent[]>(`${this.base}/runs/${encodeURIComponent(id)}/events`);
  }
  getBug(runId: string, bugId: string) {
    return getJson<BugReport>(`${this.base}/runs/${encodeURIComponent(runId)}/bugs/${encodeURIComponent(bugId)}`);
  }
  listSweeps(runId: string) {
    return getJson<Sweep[]>(`${this.base}/sweeps?runId=${encodeURIComponent(runId)}`);
  }
  getBenchmarks = loadBench;
  getHealBench = loadHeal;
  artifactUrl(runId: string, path: string) {
    return `${this.base}/runs/${encodeURIComponent(runId)}/files/${path}`;
  }
  startRun(input: StartRunInput) {
    return getJson<RunSummary>(`${this.base}/runs`, { method: 'POST', body: JSON.stringify(input) });
  }
  async stopRun(id: string) {
    await getJson(`${this.base}/runs/${encodeURIComponent(id)}/stop`, { method: 'POST' });
  }
  startSweep(runId: string, targetUrl: string, label?: string) {
    return getJson<Sweep>(`${this.base}/sweeps`, { method: 'POST', body: JSON.stringify({ sourceRunId: runId, targetUrl, label }) });
  }
}

const API = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
export const source: DataSource = API ? new ApiSource(API) : new DemoSource();
