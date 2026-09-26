// Self-healing benchmark.
//
// Records every link, button and textbox on a set of pages from one build, then finds each one
// again on a redesigned build in two ways:
//   naive    the selector a test recorder would store: data-testid, else #id, else CSS path
//   healing  SelfHealingLocator (recorded identity first, then semantic match)
// The oracle pairs elements across builds by link target, or by label via a known rename map.
import type { ElementDescriptor, HealCandidate } from '@nomad/contracts';
import { hrefPath } from '../actions';
import { launchBrowser } from '../browser';
import type { Embedder } from '../embedder';
import { SelfHealingLocator } from '../locator';
import { extract, stripRaw } from '../snapshot';

export interface RedesignSpec {
  pages: string[];
  /** Lower-case v1 label → v2 label. */
  renamed: Record<string, string>;
}

export interface HealBenchRow {
  page: string;
  target: { role: string; name: string; context: string; id?: string; testId?: string };
  expected: string;
  naive: boolean;
  healed: boolean;
  strategy: 'exact' | 'healed' | 'failed';
  via?: string;
  score: number;
  picked?: string;
  candidates: HealCandidate[];
}

export interface HealBenchResult {
  embedder: string;
  targets: number;
  naiveResolved: number;
  healingResolved: number;
  naiveBreakRate: number;
  healingBreakRate: number;
  wrongElement: number;
  abstained: number;
  healedSemantically: number;
  rows: HealBenchRow[];
}

const norm = (s: string) => s.toLowerCase().replace(/\d+/g, '#').trim();

function truth(t: ElementDescriptor, pool: ElementDescriptor[], renamed: Record<string, string>) {
  const want = renamed[norm(t.name)] ?? norm(t.name);
  const same = pool.filter((c) => c.role === t.role && norm(c.name) === want);
  if (t.role === 'link')
    return (
      same.find((c) => hrefPath(c.href) === hrefPath(t.href)) ??
      pool.find((c) => c.role === 'link' && hrefPath(c.href) === hrefPath(t.href))
    );
  if (same.length === 1) return same[0];
  return same.find((c) => c.cssPath === t.cssPath) ?? same[0]; // duplicates such as two "Remove" buttons
}

function naiveResolve(t: ElementDescriptor, pool: ElementDescriptor[]) {
  if (t.testId) return pool.find((c) => c.testId === t.testId);
  if (t.id) return pool.find((c) => c.id === t.id);
  return pool.find((c) => c.cssPath === t.cssPath);
}

export async function healBench(v1: string, v2: string, spec: RedesignSpec, embedder: Embedder): Promise<HealBenchResult> {
  const healer = new SelfHealingLocator(embedder);
  await embedder.ready?.();
  const browser = await launchBrowser();
  const page = await browser.newPage();
  const rows: HealBenchRow[] = [];
  try {
    for (const p of spec.pages) {
      await page.goto(v1 + p, { waitUntil: 'domcontentloaded' });
      const before = (await extract(page)).elements.map(stripRaw).filter((e) => ['link', 'button', 'textbox'].includes(e.role));
      await page.goto(v2 + p, { waitUntil: 'domcontentloaded' });
      const after = (await extract(page)).elements.map(stripRaw);
      for (const t0 of before) {
        const t = { ...t0, href: t0.href ? t0.href.replace(v1, v2) : undefined };
        const gt = truth(t, after, spec.renamed);
        if (!gt) continue; // removed in the redesign: not a fair test
        const r = await healer.match(t, after);
        rows.push({
          page: p,
          target: { role: t.role, name: t.name, context: t.context, id: t.id, testId: t.testId },
          expected: gt.name,
          naive: naiveResolve(t, after)?.cssPath === gt.cssPath,
          healed: r.matched?.cssPath === gt.cssPath,
          strategy: r.strategy,
          via: r.via,
          score: r.score,
          picked: r.matched?.name,
          candidates: r.candidates,
        });
      }
    }
  } finally {
    await browser.close();
  }
  const n = rows.length || 1;
  const naiveResolved = rows.filter((r) => r.naive).length;
  const healingResolved = rows.filter((r) => r.healed).length;
  return {
    embedder: embedder.name,
    targets: rows.length,
    naiveResolved,
    healingResolved,
    naiveBreakRate: +(1 - naiveResolved / n).toFixed(3),
    healingBreakRate: +(1 - healingResolved / n).toFixed(3),
    wrongElement: rows.filter((r) => !r.healed && r.strategy !== 'failed').length,
    abstained: rows.filter((r) => r.strategy === 'failed').length,
    healedSemantically: rows.filter((r) => r.strategy === 'healed').length,
    rows,
  };
}
