// Scores a run's bug reports against a ground-truth manifest (recall, precision, per-bug match).
import type { BugReport } from '@nomad/contracts';

export interface ManifestBug {
  id: string;
  title: string;
  type: string;
  match: { url?: string; message?: string };
  detectableBy: 'heuristic' | 'llm';
}

export interface ScoreResult {
  found: { id: string; title: string; by: string }[];
  missed: { id: string; title: string; detectableBy: string }[];
  unmatchedReports: string[];
  recall: number;
  recallHeuristicOnly: number;
  precision: number;
}

export function matches(m: ManifestBug, b: BugReport): boolean {
  if (b.type !== m.type) return false;
  if (m.match.url && !b.url.includes(m.match.url) && !b.message.includes(m.match.url)) return false;
  if (m.match.message && !b.message.includes(m.match.message)) return false;
  return true;
}

export function score(manifest: ManifestBug[], bugs: BugReport[]): ScoreResult {
  const used = new Set<string>();
  const found: ScoreResult['found'] = [];
  const missed: ScoreResult['missed'] = [];
  for (const m of manifest) {
    const hit = bugs.find((b) => matches(m, b));
    if (hit) {
      used.add(hit.id);
      found.push({ id: m.id, title: m.title, by: hit.id });
    } else missed.push({ id: m.id, title: m.title, detectableBy: m.detectableBy });
  }
  const heuristicTotal = manifest.filter((m) => m.detectableBy === 'heuristic').length;
  const heuristicFound = found.filter((f) => manifest.find((m) => m.id === f.id)?.detectableBy === 'heuristic').length;
  const unmatchedReports = bugs.filter((b) => !used.has(b.id)).map((b) => `${b.id} ${b.title}`);
  return {
    found,
    missed,
    unmatchedReports,
    recall: manifest.length ? found.length / manifest.length : 0,
    recallHeuristicOnly: heuristicTotal ? heuristicFound / heuristicTotal : 0,
    precision: bugs.length ? (bugs.length - unmatchedReports.length) / bugs.length : 1,
  };
}
