// Captures a page as a StateSnapshot: interactive elements, forms, visible text and a structural fingerprint.
import { createHash } from 'node:crypto';
import type { Page } from 'playwright-core';
import { EXTRACT_SCRIPT } from './browser-scripts';
import type { ElementDescriptor, FormField, StateSnapshot } from '@nomad/contracts';

type RawElement = ElementDescriptor & { formIndex: number; isSubmit: boolean };
interface RawExtraction {
  title: string;
  elements: RawElement[];
  forms: { fields: FormField[] }[];
  visibleText: string;
}

export async function extract(page: Page): Promise<RawExtraction> {
  return (await page.evaluate(EXTRACT_SCRIPT)) as RawExtraction;
}

export function stripRaw(e: RawElement): ElementDescriptor {
  const { formIndex, isSubmit, ...d } = e;
  return d;
}

/**
 * Structural fingerprint: path (query keys only) + title + the set of interactive
 * elements by role and name, with digits masked so "Cart (2)" and "Cart (3)" collapse.
 */
export function fingerprint(path: string, title: string, elements: ElementDescriptor[]): string {
  const skeleton = Array.from(new Set(elements.map((e) => `${e.role}:${e.name}`.replace(/\d+/g, '#').toLowerCase())))
    .sort()
    .join('|');
  return createHash('sha1')
    .update(`${path}\n${title.replace(/\d+/g, '#')}\n${skeleton}`)
    .digest('hex')
    .slice(0, 10);
}

export function normalizePath(url: string): string {
  const u = new URL(url);
  const keys = Array.from(u.searchParams.keys()).sort();
  return u.pathname + (keys.length ? '?' + keys.join('&') : '');
}

export async function snapshot(page: Page, status: number): Promise<StateSnapshot> {
  const raw = await extract(page);
  const url = page.url();
  const path = normalizePath(url);
  const elements = raw.elements.map(stripRaw);
  const forms = raw.forms
    .map((f, i) => {
      const submit = raw.elements.find((e) => e.formIndex === i && e.isSubmit);
      return submit ? { submit: stripRaw(submit), fields: f.fields } : null;
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);
  return {
    url,
    path,
    title: raw.title,
    fingerprint: fingerprint(path, raw.title, elements),
    elements,
    forms,
    visibleText: raw.visibleText,
    status,
  };
}
