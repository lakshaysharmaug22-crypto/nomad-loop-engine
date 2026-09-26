// Executes an Action in the browser through the self-healing locator and reports the resulting
// document status. Shared by the explorer and by bug re-verification so both behave identically.
import type { Action, ElementDescriptor, HealEvent } from '@nomad/contracts';
import type { Page } from 'playwright-core';
import type { LocateResult, SelfHealingLocator } from './locator';

export const SETTLE_MS = 4500;

export async function settle(page: Page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => {});
}

/** Tracks the HTTP status of the latest main-frame document load. */
export class NavStatus {
  last = 200;
  constructor(page: Page) {
    page.on('response', (r) => {
      if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) this.last = r.status();
    });
  }
}

export async function gotoAndSettle(page: Page, url: string, nav: NavStatus): Promise<number> {
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
  if (res) nav.last = res.status();
  await settle(page);
  return nav.last;
}

export interface ExecResult {
  ok: boolean;
  status: number;
  heal: LocateResult;
  error?: string;
}

export async function perform(
  page: Page,
  a: Action,
  values: Record<string, string>,
  locator: SelfHealingLocator,
  nav: NavStatus,
): Promise<ExecResult> {
  if (a.kind === 'navigate' && a.url) {
    const status = await gotoAndSettle(page, a.url, nav);
    return { ok: true, status, heal: { locator: null, strategy: 'exact', score: 1, candidates: [] } };
  }
  if (!a.target)
    return { ok: false, status: nav.last, heal: { locator: null, strategy: 'failed', score: 0, candidates: [] }, error: 'no target' };

  const heal = await locator.locate(page, a.target);
  if (!heal.locator) return { ok: false, status: nav.last, heal, error: `could not locate “${a.target.name}”` };

  try {
    if (a.kind === 'fill_submit' || a.kind === 'fill_submit_empty') {
      const form = heal.locator.locator('xpath=ancestor::form[1]');
      for (const f of a.fields || []) {
        if (!f.name) continue;
        const input = form.locator(`[name="${f.name.replace(/"/g, '\\"')}"]`).first();
        if (f.type === 'checkbox' || f.type === 'radio') {
          if (a.kind === 'fill_submit') await input.check({ timeout: 3000 }).catch(() => {});
        } else {
          await input.fill(a.kind === 'fill_submit' ? (values[f.name] ?? '') : '', { timeout: 3000 });
        }
      }
    }
    await heal.locator.click({ timeout: 5000 });
    // Give click handlers a moment to start their requests, otherwise networkidle can resolve
    // before a fetch begins and its failure would be attributed to the next action.
    await page.waitForTimeout(300);
    await settle(page);
    return { ok: true, status: nav.last, heal };
  } catch (e) {
    await settle(page);
    return { ok: false, status: nav.last, heal, error: (e as Error).message.split('\n')[0] };
  }
}

export function toHealEvent(step: number, target: ElementDescriptor, r: LocateResult): HealEvent {
  return {
    step,
    target: { name: target.name, role: target.role, context: target.context, id: target.id, testId: target.testId },
    strategy: r.strategy,
    via: r.via,
    score: r.score,
    matched: r.matched?.name,
    candidates: r.candidates,
  };
}
