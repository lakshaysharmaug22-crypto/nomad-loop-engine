// In-process queue with bounded concurrency. Default when REDIS_URL is not set.
import type { Job, JobProcessor, JobQueue } from './job-queue';

export class InProcessQueue implements JobQueue {
  readonly kind = 'in-process' as const;
  private readonly waiting: Job[] = [];
  private active = 0;
  private concurrency = 1;
  private processor: JobProcessor | null = null;
  private closed = false;
  private readonly idle = new Set<() => void>();

  async start(processor: JobProcessor, concurrency: number) {
    this.processor = processor;
    this.concurrency = concurrency;
    this.pump();
  }

  async enqueue(job: Job) {
    this.waiting.push(job);
    this.pump();
  }

  async cancel(jobId: string) {
    const i = this.waiting.findIndex((j) => j.id === jobId);
    if (i < 0) return false;
    this.waiting.splice(i, 1);
    return true;
  }

  async depth() {
    return { waiting: this.waiting.length, active: this.active };
  }

  /** Resolves when nothing is waiting or running (used by tests and graceful shutdown). */
  drained(): Promise<void> {
    if (!this.active && !this.waiting.length) return Promise.resolve();
    return new Promise((res) => this.idle.add(res));
  }

  async close() {
    this.closed = true;
    await this.drained();
  }

  private pump() {
    if (!this.processor || this.closed) return;
    while (this.active < this.concurrency && this.waiting.length) {
      const job = this.waiting.shift()!;
      this.active++;
      this.processor(job)
        .catch(() => {}) // the processor records its own failures
        .finally(() => {
          this.active--;
          if (!this.active && !this.waiting.length) for (const r of this.idle) r();
          if (!this.active && !this.waiting.length) this.idle.clear();
          this.pump();
        });
    }
  }
}
