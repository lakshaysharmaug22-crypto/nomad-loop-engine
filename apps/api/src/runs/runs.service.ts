import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { BugReport, RunDetail, RunEvent, RunSummary, StartRunInput } from '@nomad/contracts';
import { newId } from '../common/ids';
import { CONFIG, type AppConfig } from '../config';
import { JOB_QUEUE, type JobQueue } from '../queue/job-queue';
import { RUN_STORE, type RunStore } from '../store/run-store';
import { WorkerService } from '../worker/worker.service';

/** Artifact files a client may fetch from a run folder. */
const ARTIFACT = /^(screens\/NLE-\d{3}\.png|states\/[0-9a-f]{10}\.jpg|repro\/nle-\d{3}\.spec\.ts)$/;

@Injectable()
export class RunsService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(RUN_STORE) private readonly store: RunStore,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    private readonly worker: WorkerService,
  ) {}

  async start(input: StartRunInput): Promise<RunSummary> {
    const run: RunSummary = { id: newId('run'), target: input.targetUrl, status: 'queued', createdAt: Date.now() };
    await this.store.createRun(run);
    await this.queue.enqueue({ kind: 'run', id: run.id, input });
    return run;
  }

  list(limit?: number) {
    return this.store.listRuns(limit);
  }

  async get(id: string): Promise<RunDetail> {
    const run = await this.store.getRun(id);
    if (!run) throw new NotFoundException(`Run ${id} not found`);
    return run;
  }

  async events(id: string): Promise<RunEvent[]> {
    await this.get(id);
    return this.store.getEvents(id);
  }

  async stop(id: string): Promise<RunSummary> {
    const run = await this.get(id);
    if (run.status === 'queued' && (await this.queue.cancel(id))) {
      await this.store.updateRun(id, { status: 'stopped' });
      return { ...run, status: 'stopped' };
    }
    if (run.status !== 'running') throw new ConflictException(`Run ${id} is ${run.status}`);
    this.worker.requestStop(id);
    return run;
  }

  async bug(id: string, bugId: string): Promise<BugReport> {
    const run = await this.get(id);
    const bug = run.bugs.find((b) => b.id === bugId) ?? (await this.store.getEvents(id)).flatMap((e) => (e.t === 'bug' && e.bug.id === bugId ? [e.bug] : []))[0];
    if (!bug) throw new NotFoundException(`Bug ${bugId} not found in ${id}`);
    return bug;
  }

  artifactPath(id: string, file: string): string {
    if (!ARTIFACT.test(file)) throw new NotFoundException();
    const p = join(this.config.runsDir, id, file);
    if (!existsSync(p)) throw new NotFoundException();
    return p;
  }
}
