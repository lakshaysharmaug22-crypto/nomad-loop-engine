// Turns a StateSnapshot into the candidate actions the policy can choose from.
import type { Action, FormField, StateSnapshot } from '@nomad/contracts';

const mask = (s: string) => s.replace(/\d+/g, '#').toLowerCase().trim();

export function hrefPath(href: string | undefined): string {
  if (!href) return '';
  try {
    const u = new URL(href);
    return u.pathname + u.search;
  } catch {
    return '';
  }
}

export function sameOrigin(href: string, base: string): boolean {
  try {
    return new URL(href).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

export function candidateActions(state: StateSnapshot, origin: string): Action[] {
  const out = new Map<string, Action>();
  const add = (a: Action) => {
    if (!out.has(a.key)) out.set(a.key, a);
  };

  for (const el of state.elements) {
    if (el.role === 'link' && el.href) {
      if (!sameOrigin(el.href, origin)) continue;
      if (/^(mailto|tel|javascript):/i.test(el.href)) continue;
      const path = hrefPath(el.href);
      if (path === new URL(state.url).pathname + new URL(state.url).search) continue; // self link
      add({ kind: 'click', key: `click:link:${mask(el.name)}:${path}`, label: `Click link “${el.name || path}”`, target: el });
    } else if (el.role === 'button' && !el.inForm) {
      add({ kind: 'click', key: `click:button:${mask(el.name)}`, label: `Click “${el.name}”`, target: el });
    }
  }

  for (const form of state.forms) {
    const fieldsKey = form.fields.map((f) => f.name).join(',');
    add({
      kind: 'fill_submit',
      key: `form:${mask(form.submit.name)}:${fieldsKey}`,
      label: form.fields.length ? `Fill and submit “${form.submit.name}” form` : `Submit “${form.submit.name}”`,
      target: form.submit,
      fields: form.fields,
    });
    if (form.fields.length) {
      add({
        kind: 'fill_submit_empty',
        key: `form-empty:${mask(form.submit.name)}:${fieldsKey}`,
        label: `Submit “${form.submit.name}” form empty`,
        target: form.submit,
        fields: form.fields,
      });
    }
  }
  return [...out.values()];
}

/** Realistic default values for a form field, chosen from its type, name and label. */
export function fakeValue(f: FormField, pageWords: string[] = []): string {
  const hint = `${f.type} ${f.name} ${f.label}`.toLowerCase();
  if (f.type === 'email' || hint.includes('email')) return 'nomad.tester@example.com';
  if (f.type === 'password' || hint.includes('password')) return 'Nomad#2026';
  if (f.type === 'number') return '3';
  if (f.type === 'tel' || /phone|mobile/.test(hint)) return '9876543210';
  if (/pin|zip|postal/.test(hint)) return '411001';
  if (/address|street/.test(hint)) return '12 MG Road, Pune';
  if (/name/.test(hint)) return 'Asha Verma';
  if (/coupon|promo|code/.test(hint)) return 'SAVE10';
  if (/search|query|^q\b|\bq\b/.test(hint)) return pageWords.find((w) => w.length > 3) || 'lamp';
  return 'test input';
}

export function fakeValues(fields: FormField[], pageText = ''): Record<string, string> {
  const words = pageText
    .split(/\W+/)
    .filter((w) => /^[A-Za-z]{4,}$/.test(w))
    .slice(10, 60);
  return Object.fromEntries(fields.map((f) => [f.name, fakeValue(f, words)]));
}
