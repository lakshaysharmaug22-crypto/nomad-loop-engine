// Self-healing locator.
//
// First tries the recorded identity (test id, element id, structural CSS path). When the DOM has
// changed and none of those still point at a matching element, it finds the element again by
// meaning. Each candidate on the page is scored as
//
//   0.62 · cos(embed(role name placeholder href))   what the element is
// + 0.18 · same role
// + 0.12 · cos(embed(context))                      where it lives (landmark heading, neighbour text)
// + 0.08 · same tag
//
// The best candidate above HEAL_THRESHOLD wins; below it the locator abstains rather than act on
// the wrong element.
import type { ElementDescriptor, HealCandidate, HealScore, Role } from '@nomad/contracts';
import type { Locator, Page } from 'playwright-core';
import { hrefPath } from './actions';
import { cosine, type Embedder } from './embedder';
import { extract, stripRaw } from './snapshot';

export const HEAL_THRESHOLD = 0.62;
export const HEAL_WEIGHTS = { semantic: 0.62, role: 0.18, context: 0.12, tag: 0.08 } as const;

export interface MatchResult {
  strategy: 'exact' | 'healed' | 'failed';
  score: number;
  matched?: ElementDescriptor;
  via?: 'testId' | 'id' | 'cssPath' | 'semantic';
  /** Semantic ranking, best first (empty when an exact identity matched). */
  candidates: HealCandidate[];
}

export interface LocateResult extends MatchResult {
  locator: Locator | null;
}

export function describe(e: ElementDescriptor): string {
  return [e.role, e.name, e.placeholder || '', hrefPath(e.href)].join(' ').trim();
}

const compatibleRole = (a: Role, b: Role) => a === b || (a === 'link' && b === 'button') || (a === 'button' && b === 'link');
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export class SelfHealingLocator {
  constructor(private readonly embedder: Embedder) {}

  /** Pure matching step, separate from the browser so it can be unit tested and benchmarked. */
  async match(target: ElementDescriptor, candidates: ElementDescriptor[], keep = 5): Promise<MatchResult> {
    const sameName = (c: ElementDescriptor) => c.name.toLowerCase() === target.name.toLowerCase();

    if (target.testId) {
      const hit = candidates.find((c) => c.testId === target.testId && c.role === target.role);
      if (hit) return { strategy: 'exact', score: 1, matched: hit, via: 'testId', candidates: [] };
    }
    if (target.id) {
      const hit = candidates.find((c) => c.id === target.id && c.role === target.role);
      if (hit) return { strategy: 'exact', score: 1, matched: hit, via: 'id', candidates: [] };
    }
    const byPath = candidates.find((c) => c.cssPath === target.cssPath && c.role === target.role && sameName(c));
    if (byPath) return { strategy: 'exact', score: 1, matched: byPath, via: 'cssPath', candidates: [] };

    const pool = candidates.filter((c) => compatibleRole(c.role, target.role));
    if (!pool.length) return { strategy: 'failed', score: 0, candidates: [] };

    const vecs = await this.embedder.embed([describe(target), target.context, ...pool.map(describe), ...pool.map((c) => c.context)]);
    const scored = pool.map((c, i) => {
      const s: HealScore = {
        semantic: r3(cosine(vecs[0], vecs[2 + i])),
        role: c.role === target.role ? 1 : 0,
        context: r3(cosine(vecs[1], vecs[2 + pool.length + i])),
        tag: c.tag === target.tag ? 1 : 0,
        total: 0,
      };
      s.total = r3(
        HEAL_WEIGHTS.semantic * s.semantic + HEAL_WEIGHTS.role * s.role + HEAL_WEIGHTS.context * s.context + HEAL_WEIGHTS.tag * s.tag,
      );
      return { el: c, s };
    });
    scored.sort((a, b) => b.s.total - a.s.total);
    const ranked: HealCandidate[] = scored
      .slice(0, keep)
      .map(({ el, s }) => ({ name: el.name, role: el.role, context: el.context, score: s }));
    const best = scored[0];
    if (best.s.total < HEAL_THRESHOLD) return { strategy: 'failed', score: best.s.total, candidates: ranked };
    return { strategy: 'healed', score: best.s.total, matched: best.el, via: 'semantic', candidates: ranked };
  }

  async locate(page: Page, target: ElementDescriptor): Promise<LocateResult> {
    const raw = await extract(page);
    const r = await this.match(target, raw.elements.map(stripRaw));
    return { ...r, locator: r.matched ? page.locator(r.matched.cssPath).first() : null };
  }
}
