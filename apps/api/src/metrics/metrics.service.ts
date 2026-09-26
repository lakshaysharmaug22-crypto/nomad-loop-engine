// Prometheus metrics for runs, decisions, bugs and self-healing.
import { Injectable } from '@nestjs/common';
import type { RunEvent } from '@nomad/contracts';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  private readonly runs = new Counter({
    name: 'nomad_runs_total',
    help: 'Runs by final status',
    labelNames: ['status'],
    registers: [this.registry],
  });
  private readonly steps = new Counter({
    name: 'nomad_steps_total',
    help: 'Exploration steps by deciding tier',
    labelNames: ['tier'],
    registers: [this.registry],
  });
  private readonly bugs = new Counter({
    name: 'nomad_bugs_total',
    help: 'Bugs reported',
    labelNames: ['severity', 'status'],
    registers: [this.registry],
  });
  private readonly heals = new Counter({
    name: 'nomad_heals_total',
    help: 'Locator outcomes other than an exact match',
    labelNames: ['strategy'],
    registers: [this.registry],
  });
  private readonly stepDuration = new Histogram({
    name: 'nomad_step_duration_seconds',
    help: 'Wall time of one exploration step',
    labelNames: ['tier'],
    buckets: [0.1, 0.25, 0.5, 1, 2, 4, 8, 16],
    registers: [this.registry],
  });
  readonly activeRuns = new Gauge({ name: 'nomad_runs_active', help: 'Runs executing now', registers: [this.registry] });
  readonly queueDepth = new Gauge({ name: 'nomad_queue_waiting', help: 'Jobs waiting in the queue', registers: [this.registry] });

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'nomad_api_' });
  }

  observe(e: RunEvent) {
    if (e.t === 'step') {
      this.steps.inc({ tier: e.decision.tier });
      this.stepDuration.observe({ tier: e.decision.tier }, e.durationMs / 1000);
    } else if (e.t === 'bug') this.bugs.inc({ severity: e.bug.severity, status: e.bug.status });
    else if (e.t === 'heal') this.heals.inc({ strategy: e.heal.strategy });
  }

  runFinished(status: string) {
    this.runs.inc({ status });
  }
}
