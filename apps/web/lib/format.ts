import type { AnomalyType, RunStatus, Severity, Tier } from '@nomad/contracts';

export const TIERS: Tier[] = ['heuristic', 'ranker', 'llm', 'fallback'];

export const TIER_LABEL: Record<Tier, string> = {
  heuristic: 'Rules',
  ranker: 'Ranker',
  llm: 'Local LLM',
  fallback: 'Fallback',
};

export const TIER_HINT: Record<Tier, string> = {
  heuristic: 'Novelty rules found a clear winner',
  ranker: 'The trained ranker found a promising action',
  llm: 'The local model chose when the ranker saw nothing promising',
  fallback: "No tier was confident; the ranker's best guess was used",
};

export const tierVar = (t: Tier) => `var(--t-${t})`;

export const SEVERITY_ORDER: Severity[] = ['critical', 'major', 'minor'];
export const sevVar = (s: Severity) => `var(--${s})`;
export const sevSoft = (s: Severity) => `var(--${s}-soft)`;

export const ANOMALY_LABEL: Record<AnomalyType, string> = {
  server_error: 'Server error',
  broken_link: 'Broken link',
  console_error: 'Console error',
  page_error: 'Uncaught exception',
  network_failure: 'Failed request',
  broken_image: 'Broken image',
  suspicious_text: 'Suspicious text',
  slow_response: 'Slow response',
  llm_judged: 'Judged incorrect',
};

export const STATUS_LABEL: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  finished: 'Finished',
  failed: 'Failed',
  stopped: 'Stopped',
};

export function duration(ms: number | undefined): string {
  if (ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function relativeTime(at: number): string {
  if (!at) return '—';
  const d = Date.now() - at;
  const m = Math.round(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export const pct = (x: number | null | undefined, digits = 0) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(digits)}%`);

export const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

export function pathOf(url: string) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}
