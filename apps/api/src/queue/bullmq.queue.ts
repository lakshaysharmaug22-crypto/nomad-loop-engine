// BullMQ queue on Redis. Used when REDIS_URL is set: jobs survive API restarts, and more workers
// can be added by running further API instances against the same Redis.
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { Job, JobProcessor, JobQueue } from './job-queue';

const QUEUE_NAME = 'nomad-jobs';

function connection(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

export class BullMqQueue implements JobQueue {
  readonly kind = 'bullmq' as const;
  private readonly queue: Queue<Job>;
  private worker: Worker<Job> | null = null;
  private readonly conn: ConnectionOptions;

  constructor(redisUrl: string) {
    this.conn = connection(redisUrl);
    this.queue = new Queue<Job>(QUEUE_NAME, {
      connection: this.conn,
      defaultJobOptions: { removeOnComplete: 500, removeOnFail: 500, attempts: 1 },
    });
  }

  async start(processor: JobProcessor, concurrency: number) {
    this.worker = new Worker<Job>(QUEUE_NAME, (job) => processor(job.data), { connection: this.conn, concurrency });
    await this.worker.waitUntilReady();
  }

  async enqueue(job: Job) {
    // The job id doubles as the BullMQ id, so an accidental double submit is ignored.
    await this.queue.add(job.kind, job, { jobId: job.id });
  }

  async cancel(jobId: string) {
    const job = await this.queue.getJob(jobId);
    if (!job || !(await job.isWaiting())) return false;
    await job.remove();
    return true;
  }

  async depth() {
    const c = await this.queue.getJobCounts('waiting', 'active', 'delayed');
    return { waiting: (c.waiting ?? 0) + (c.delayed ?? 0), active: c.active ?? 0 };
  }

  async close() {
    await this.worker?.close();
    await this.queue.close();
  }
}
