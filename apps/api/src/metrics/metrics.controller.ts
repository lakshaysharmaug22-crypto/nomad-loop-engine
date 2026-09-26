import { Controller, Get, Header, Inject } from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CONFIG, type AppConfig } from '../config';
import { JOB_QUEUE, type JobQueue } from '../queue/job-queue';
import { RUN_STORE, type RunStore } from '../store/run-store';
import { MetricsService } from './metrics.service';

@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  async scrape() {
    this.metrics.queueDepth.set((await this.queue.depth()).waiting);
    return this.metrics.registry.metrics();
  }
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(RUN_STORE) private readonly store: RunStore,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Component status: store, queue and ML service' })
  async health() {
    let ml: unknown = 'not configured';
    if (this.config.ML_URL) {
      ml = await fetch(`${this.config.ML_URL}/health`, { signal: AbortSignal.timeout(2000) })
        .then((r) => r.json())
        .catch(() => 'unreachable');
    }
    return { ok: true, store: this.store.kind, queue: { kind: this.queue.kind, ...(await this.queue.depth()) }, ml };
  }
}
