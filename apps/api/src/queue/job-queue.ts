// Job queue port. Jobs carry their input so any worker (in this process or another one on the
// same Redis) can execute them without extra lookups.
import type { StartRunInput, StartSweepInput } from '@nomad/contracts';

export const JOB_QUEUE = Symbol('JOB_QUEUE');

export type Job = { kind: 'run'; id: string; input: StartRunInput } | { kind: 'sweep'; id: string; input: StartSweepInput };
export type JobProcessor = (job: Job) => Promise<void>;

export interface JobQueue {
  readonly kind: 'in-process' | 'bullmq';
  /** Registers the processor and starts consuming. */
  start(processor: JobProcessor, concurrency: number): Promise<void>;
  enqueue(job: Job): Promise<void>;
  /** Removes a job that has not started yet. Returns true if it was removed. */
  cancel(jobId: string): Promise<boolean>;
  depth(): Promise<{ waiting: number; active: number }>;
  close(): Promise<void>;
}
