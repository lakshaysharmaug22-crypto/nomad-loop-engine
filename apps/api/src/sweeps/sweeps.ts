import { Body, Controller, Get, Inject, Injectable, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { StartSweepInput, type Sweep } from '@nomad/contracts';
import { newId } from '../common/ids';
import { openApiSchema } from '../common/openapi';
import { ZodValidationPipe } from '../common/zod.pipe';
import { JOB_QUEUE, type JobQueue } from '../queue/job-queue';
import { RUN_STORE, type RunStore } from '../store/run-store';

@Injectable()
export class SweepsService {
  constructor(
    @Inject(RUN_STORE) private readonly store: RunStore,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  async start(input: StartSweepInput): Promise<Sweep> {
    const source = await this.store.getRun(input.sourceRunId);
    if (!source) throw new NotFoundException(`Run ${input.sourceRunId} not found`);
    const sweep: Sweep = {
      id: newId('sweep'),
      sourceRunId: input.sourceRunId,
      target: input.targetUrl,
      label: input.label,
      status: 'running',
      createdAt: Date.now(),
      items: [],
    };
    await this.store.saveSweep(sweep);
    await this.queue.enqueue({ kind: 'sweep', id: sweep.id, input });
    return sweep;
  }

  async get(id: string) {
    const s = await this.store.getSweep(id);
    if (!s) throw new NotFoundException(`Sweep ${id} not found`);
    return s;
  }

  list(runId?: string) {
    return this.store.listSweeps(runId);
  }
}

@ApiTags('sweeps')
@Controller('sweeps')
export class SweepsController {
  constructor(private readonly sweeps: SweepsService) {}

  @Post()
  @ApiOperation({ summary: 'Replay every bug of a run against another build (a fix or a redesign)' })
  @ApiBody({ schema: openApiSchema(StartSweepInput) })
  start(@Body(new ZodValidationPipe(StartSweepInput)) input: StartSweepInput) {
    return this.sweeps.start(input);
  }

  @Get()
  @ApiOperation({ summary: 'List sweeps, optionally for one source run' })
  @ApiQuery({ name: 'runId', required: false })
  list(@Query('runId') runId?: string) {
    return this.sweeps.list(runId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.sweeps.get(id);
  }
}
