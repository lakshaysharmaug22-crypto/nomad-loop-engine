import { Logger, Module, type OnApplicationShutdown, Inject } from '@nestjs/common';
import { BrowserProvider } from './browser.provider';
import { CONFIG, loadConfig, type AppConfig } from './config';
import { EventBus } from './events.bus';
import { HealthController, MetricsController } from './metrics/metrics.controller';
import { MetricsService } from './metrics/metrics.service';
import { BullMqQueue } from './queue/bullmq.queue';
import { InProcessQueue } from './queue/in-process.queue';
import { JOB_QUEUE } from './queue/job-queue';
import { LiveGateway } from './runs/live.gateway';
import { RunsController } from './runs/runs.controller';
import { RunsService } from './runs/runs.service';
import { FileRunStore } from './store/file-store';
import { PgRunStore } from './store/pg-store';
import { RUN_STORE, type RunStore } from './store/run-store';
import { SweepsController, SweepsService } from './sweeps/sweeps';
import { WorkerService } from './worker/worker.service';

@Module({
  controllers: [RunsController, SweepsController, HealthController, MetricsController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    {
      provide: RUN_STORE,
      inject: [CONFIG],
      useFactory: async (c: AppConfig): Promise<RunStore> => {
        const store = c.DATABASE_URL ? new PgRunStore(c.DATABASE_URL) : new FileRunStore(c.runsDir);
        await store.init();
        new Logger('Store').log(`using ${store.kind} store`);
        return store;
      },
    },
    {
      provide: JOB_QUEUE,
      inject: [CONFIG],
      useFactory: (c: AppConfig) => (c.REDIS_URL ? new BullMqQueue(c.REDIS_URL) : new InProcessQueue()),
    },
    EventBus,
    MetricsService,
    BrowserProvider,
    WorkerService,
    RunsService,
    SweepsService,
    LiveGateway,
  ],
})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(RUN_STORE) private readonly store: RunStore) {}

  async onApplicationShutdown() {
    await this.store.close();
  }
}
