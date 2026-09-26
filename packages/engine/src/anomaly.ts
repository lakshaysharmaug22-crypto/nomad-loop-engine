// Anomaly detection. A PageMonitor listens to the browser (console, uncaught errors, failed or
// slow requests); state checks look at the loaded page itself (HTTP status, suspicious text).
import type { Page, Request, Response } from 'playwright-core';
import type { Anomaly, AnomalyType, StateSnapshot } from '@nomad/contracts';

export const SLOW_MS = 3000;

const SEVERITY: Record<AnomalyType, Anomaly['severity']> = {
  server_error: 'critical',
  page_error: 'critical',
  network_failure: 'major',
  broken_link: 'major',
  suspicious_text: 'major',
  llm_judged: 'major',
  console_error: 'minor',
  broken_image: 'minor',
  slow_response: 'minor',
};

const pathOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname;
  } catch {
    return url;
  }
};
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 120);

/** Resource-level issues are deduped by what failed, page-level issues by where they happened. */
const RESOURCE_LEVEL: AnomalyType[] = ['network_failure', 'broken_image', 'slow_response'];

/** `detail` is shown to humans but kept out of the dedup signature. */
export function makeAnomaly(type: AnomalyType, message: string, url: string, detail = ''): Anomaly {
  const msg = norm(message);
  const where = RESOURCE_LEVEL.includes(type) ? '' : pathOf(url);
  return {
    type,
    message: detail ? `${msg} — ${norm(detail)}` : msg,
    url,
    severity: SEVERITY[type],
    signature: `${type}|${where}|${msg.replace(/\d+/g, '#').toLowerCase()}`,
  };
}

export class PageMonitor {
  private buffer: Anomaly[] = [];
  private readonly started = new WeakMap<Request, number>();

  constructor(private readonly page: Page) {
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) this.push('console_error', m.text());
    });
    page.on('pageerror', (err) => this.push('page_error', `${err.name}: ${err.message}`));
    page.on('request', (r) => this.started.set(r, Date.now()));
    page.on('requestfinished', (r) => {
      const t0 = this.started.get(r);
      if (t0 && ['fetch', 'xhr'].includes(r.resourceType()) && Date.now() - t0 > SLOW_MS) {
        this.push('slow_response', `${r.method()} ${pathOf(r.url())} took ${Math.round((Date.now() - t0) / 100) / 10}s`);
      }
    });
    page.on('response', (res: Response) => this.onResponse(res));
    page.on('requestfailed', (r) => {
      if (['fetch', 'xhr'].includes(r.resourceType()))
        this.push('network_failure', `${r.method()} ${pathOf(r.url())} failed: ${r.failure()?.errorText}`);
    });
  }

  private onResponse(res: Response) {
    const req = res.request();
    const status = res.status();
    if (status < 400 || req.isNavigationRequest()) return; // documents are judged by checkState
    const type = req.resourceType();
    if (type === 'image') this.push('broken_image', `Image ${pathOf(res.url())} returned ${status}`);
    else if (type === 'fetch' || type === 'xhr') this.push('network_failure', `${req.method()} ${pathOf(res.url())} returned ${status}`);
  }

  private push(type: AnomalyType, message: string) {
    this.buffer.push(makeAnomaly(type, message, this.page.url()));
  }

  /** Returns and clears everything observed since the last drain. */
  drain(): Anomaly[] {
    const out = this.buffer;
    this.buffer = [];
    return out;
  }
}

const SUSPICIOUS = [/\bNaN\b/, /\bundefined\b/, /\[object Object\]/];

/**
 * Collapses symptoms of the same root cause observed in one step:
 *  - a console error that just reports a failed request is folded into that network failure
 *  - suspicious text on a page that already returned 5xx is part of the server error
 */
export function correlate(batch: Anomaly[]): Anomaly[] {
  const net = batch.filter((a) => a.type === 'network_failure');
  const serverErrorPaths = new Set(batch.filter((a) => a.type === 'server_error').map((a) => pathOf(a.url)));
  const out: Anomaly[] = [];
  for (const a of batch) {
    if (a.type === 'console_error' && net.length && /fail|\b[45]\d\d\b|network|fetch/i.test(a.message)) {
      const host = net[0];
      if (!host.message.includes('related:')) host.message += ` — related: console “${a.message.slice(0, 60)}”`;
      continue;
    }
    if (a.type === 'suspicious_text' && serverErrorPaths.has(pathOf(a.url))) continue;
    out.push(a);
  }
  return out;
}

/** Checks on the loaded document itself. */
export function checkState(s: StateSnapshot): Anomaly[] {
  const out: Anomaly[] = [];
  if (s.status >= 500) out.push(makeAnomaly('server_error', `GET ${s.path} returned ${s.status}`, s.url));
  else if (s.status === 404) out.push(makeAnomaly('broken_link', `GET ${pathOf(s.url)} returned 404`, s.url));
  for (const re of SUSPICIOUS) {
    const m = s.visibleText.match(re);
    if (m) {
      const i = Math.max(0, (m.index || 0) - 30);
      out.push(makeAnomaly('suspicious_text', `Page shows “${m[0]}”`, s.url, `…${s.visibleText.slice(i, i + 70)}…`));
    }
  }
  return out;
}
