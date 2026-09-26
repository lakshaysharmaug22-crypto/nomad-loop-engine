import { Body, Controller, DefaultValuePipe, Get, HttpCode, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import { StartRunInput } from '@nomad/contracts';
import type { Response } from 'express';
import { openApiSchema } from '../common/openapi';
import { ZodValidationPipe } from '../common/zod.pipe';
import { RunsService } from './runs.service';

@ApiTags('runs')
@Controller('runs')
export class RunsController {
  constructor(private readonly runs: RunsService) {}

  @Get()
  @ApiOperation({ summary: 'List runs, newest first' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  list(@Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number) {
    return this.runs.list(Math.min(limit, 500));
  }

  @Post()
  @ApiOperation({ summary: 'Queue an exploration run' })
  @ApiBody({ schema: openApiSchema(StartRunInput) })
  start(@Body(new ZodValidationPipe(StartRunInput)) input: StartRunInput) {
    return this.runs.start(input);
  }

  @Get(':id')
  @ApiOperation({ summary: 'A run with its state graph and bug reports' })
  @ApiParam({ name: 'id' })
  get(@Param('id') id: string) {
    return this.runs.get(id);
  }

  @Get(':id/events')
  @ApiOperation({ summary: 'Ordered event log, for replaying a run' })
  events(@Param('id') id: string) {
    return this.runs.events(id);
  }

  @Post(':id/stop')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a queued run or stop a running one after its current step' })
  stop(@Param('id') id: string) {
    return this.runs.stop(id);
  }

  @Get(':id/bugs/:bugId')
  @ApiOperation({ summary: 'One bug report' })
  bug(@Param('id') id: string, @Param('bugId') bugId: string) {
    return this.runs.bug(id, bugId);
  }

  @Get(':id/bugs/:bugId/repro')
  @ApiOperation({ summary: 'The generated Playwright test for a bug' })
  @ApiProduces('text/plain')
  async repro(@Param('id') id: string, @Param('bugId') bugId: string, @Res() res: Response) {
    const bug = await this.runs.bug(id, bugId);
    res.type('text/plain').set('Content-Disposition', `inline; filename="${bugId.toLowerCase()}.spec.ts"`).send(bug.reproScript);
  }

  @Get(':id/files/:dir/:name')
  @ApiOperation({ summary: 'A run artifact: screens/NLE-001.png, states/<fingerprint>.jpg, repro/nle-001.spec.ts' })
  file(@Param('id') id: string, @Param('dir') dir: string, @Param('name') name: string, @Res() res: Response) {
    res.set('Cache-Control', 'public, max-age=86400, immutable').sendFile(this.runs.artifactPath(id, `${dir}/${name}`));
  }
}
