// Executes queued jobs: explorations and regression sweeps.
import { join } from 'node:path';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { StartRunInput, StartSweepInput, Sweep } from '@nomad/contracts';
import { explore, HttpLlm, HttpRanker, HybridPolicy, makeEmbedder, SelfHealingLocator, sweepBugs } from '@nomad/engine';
import { BrowserProvider } from '../browser.provider';
import { CONFIG, type AppConfig } from '../config';
import { EventBus } from '../events.bus';
import { MetricsService } from '../metrics/metrics.service';
import { JOB_QUEUE, type Job, type JobQueue } from '../queue/job-queue';
import { RUN_STORE, type RunStore } from '../store/run-store';

@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(WorkerService.name);
  private readonly stopRequests = new Set<string>();

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(RUN_STORE) private readonly store: RunStore,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    private readonly bus: EventBus,
    private readonly metrics: MetricsService,
    private readonly browsers: BrowserProvider,
  ) {}

  async onApplicationBootstrap() {
    await this.queue.start((job) => this.process(job), this.config.RUN_CONCURRENCY);
    this.log.log(`worker started (${this.queue.kind}, concurrency ${this.config.RUN_CONCURRENCY})`);
  }

  async onApplicationShutdown() {
    await this.queue.close();
  }

  requestStop(id: string) {
    this.stopRequests.add(id);
  }

  private async process(job: Job) {
    this.metrics.activeRuns.inc();
    try {
      if (job.kind === 'run') await this.runExploration(job.id, job.input);
      else await this.runSweep(job.id, job.input);
    } finally {
      this.metrics.activeRuns.dec();
      this.stopRequests.delete(job.id);
    }
  }

  private async runExploration(id: string, input: StartRunInput) {
    const ml = this.config.ML_URL;
    const policy = new HybridPolicy(ml ? new HttpRanker(ml) : null, ml ? new HttpLlm(ml) : null);
    await this.store.updateRun(id, { status: 'running', policy: policy.name });
    let seq = 0;
    try {
      const result = await explore({
        runId: id,
        targetUrl: input.targetUrl,
        maxSteps: input.maxSteps,
        verifyRuns: input.verifyRuns,
        policy,
        judge: ml ? new HttpLlm(ml) : null,
        embedder: makeEmbedder(ml),
        runDir: join(this.config.runsDir, id),
        browser: await this.browsers.get(),
        trainingLog: join(this.config.dataDir, 'training.jsonl'),
        shouldStop: () => this.stopRequests.has(id),
        onEvent: (event) => {
          const n = seq++;
          this.metrics.observe(event);
          this.bus.publish({ channel: id, kind: 'run', event, seq: n });
          this.store.appendEvent(id, n, event).catch((e) => this.log.error(`event ${n} of ${id}: ${e.message}`));
          if (event.t === 'stats') this.store.updateRun(id, { stats: event.stats }).catch(() => {});
        },
      });
      await this.store.saveResult(id, { stats: result.stats, graph: result.graph, bugs: result.bugs });
      const status = this.stopRequests.has(id) ? 'stopped' : 'finished';
      await this.store.updateRun(id, { status, stats: result.stats });
      this.metrics.runFinished(status);
    } catch (e) {
      const message = (e as Error).message.split('\n')[0];
      this.log.error(`run ${id} failed: ${message}`);
      await this.store.updateRun(id, { status: 'failed', error: message });
      this.metrics.runFinished('failed');
    }
  }

  private async runSweep(id: string, input: StartSweepInput) {
    const sweep = (await this.store.getSweep(id)) as Sweep;
    const source = await this.store.getRun(input.sourceRunId);
    try {
      if (!source) throw new Error(`run ${input.sourceRunId} not found`);
      const locator = new SelfHealingLocator(makeEmbedder(this.config.ML_URL));
      await sweepBugs(await this.browsers.get(), source.bugs, input.targetUrl, locator, 3, (item) => {
        sweep.items.push(item);
        this.store.saveSweep(sweep).catch(() => {});
        this.bus.publish({ channel: id, kind: 'sweep', item, sweep: { id, status: 'running' } });
      });
      sweep.status = 'finished';
    } catch (e) {
      this.log.error(`sweep ${id} failed: ${(e as Error).message}`);
      sweep.status = 'failed';
    }
    sweep.finishedAt = Date.now();
    await this.store.saveSweep(sweep);
    this.bus.publish({ channel: id, kind: 'sweep', sweep: { id, status: sweep.status } });
  }
}
