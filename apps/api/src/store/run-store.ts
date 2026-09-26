// Persistence port for runs, their event logs and sweeps.
// Artifacts (screenshots, thumbnails, repro tests) always live on disk under DATA_DIR/runs/<id>;
// the store indexes metadata and events so the API can list, filter and replay.
import type { BugReport, GraphEdge, GraphNode, RunDetail, RunEvent, RunStats, RunSummary, Sweep } from '@nomad/contracts';

export const RUN_STORE = Symbol('RUN_STORE');

export interface RunResult {
  stats: RunStats;
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  bugs: BugReport[];
}

export interface RunStore {
  readonly kind: 'file' | 'postgres';
  init(): Promise<void>;
  close(): Promise<void>;

  createRun(run: RunSummary): Promise<void>;
  updateRun(id: string, patch: Partial<Omit<RunSummary, 'id'>>): Promise<void>;
  saveResult(id: string, result: RunResult): Promise<void>;
  appendEvent(id: string, seq: number, event: RunEvent): Promise<void>;
  listRuns(limit?: number): Promise<RunSummary[]>;
  getRun(id: string): Promise<RunDetail | null>;
  getEvents(id: string): Promise<RunEvent[]>;

  saveSweep(sweep: Sweep): Promise<void>;
  getSweep(id: string): Promise<Sweep | null>;
  listSweeps(sourceRunId?: string): Promise<Sweep[]>;
}
