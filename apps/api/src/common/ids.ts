import { randomBytes } from 'node:crypto';

/** Sortable, readable ids: run-20260926-173012-k3f9 */
export function newId(prefix: 'run' | 'sweep'): string {
  const d = new Date().toISOString().replace(/\D/g, '');
  return `${prefix}-${d.slice(0, 8)}-${d.slice(8, 14)}-${randomBytes(2).toString('hex')}`;
}
