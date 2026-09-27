// Live target: Vayu Pramaan, a production site that Nomad scans on every deploy.
// Vayu Pramaan's CI writes the report (data/nomad.json on its site); both dashboards read the same file.
import type { AnomalyType, Severity } from '@nomad/contracts';

export const VAYU_URL = (process.env.NEXT_PUBLIC_VAYU_URL ?? 'https://vayu-pramaan.vercel.app').replace(/\/$/, '');
export const VAYU_REPO = 'https://github.com/lakshaysharmaug22-crypto/vayu-pramaan';

export interface TargetBug {
  id: string;
  title: string;
  type: AnomalyType;
  severity: Severity;
  status: 'confirmed' | 'flaky' | 'unverified';
  confirmations: string;
  foundAtStep: number;
  url: string;
  message: string;
  steps: string[];
}

export interface TargetRun {
  run_id: string;
  finished: string;
  verdict: 'ship' | 'blocked';
  steps: number;
  states: number;
  bugs: number;
  duration_s: number;
  commit?: string;
}

export interface TargetReport {
  status: 'complete' | 'error' | 'not_run';
  run_id?: string;
  finished?: string;
  target_url?: string;
  commit?: string;
  verdict?: 'ship' | 'blocked';
  duration_s?: number;
  stats?: {
    steps: number;
    states: number;
    edges: number;
    bugs: number;
    tierCounts: Record<string, number>;
    heals?: { exact: number; healed: number; failed: number };
    stepP50Ms?: number;
    stepP95Ms?: number;
  };
  bugs?: TargetBug[];
  history?: TargetRun[];
}

export async function loadTarget(): Promise<{ report: TargetReport; from: string }> {
  const urls = [`${VAYU_URL}/data/nomad.json`, '/demo/vayu-target.json'];
  for (const u of urls) {
    try {
      const r = await fetch(u, { cache: 'no-store' });
      if (r.ok) return { report: (await r.json()) as TargetReport, from: u };
    } catch {
      /* try the next source */
    }
  }
  return { report: { status: 'not_run' }, from: 'none' };
}
