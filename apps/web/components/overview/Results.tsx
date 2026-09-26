'use client';
// Headline benchmark results, each with a small chart of the comparison behind the number.
import Link from 'next/link';
import { useWidth } from '@/components/charts/use-width';
import type { BenchRun, BenchSummary } from '@/lib/bench-types';
import { pct } from '@/lib/format';
import o from './overview.module.css';

const median = (xs: number[]) => {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : NaN;
};

function Pair({
  rows,
  max,
  format,
}: {
  rows: { label: string; value: number; tone: string }[];
  max: number;
  format: (v: number) => string;
}) {
  return (
    <div className={o.pair}>
      {rows.map((r) => (
        <div key={r.label} className={o.pairRow}>
          <span className={o.pairLabel}>{r.label}</span>
          <span className={o.pairTrack}>
            <i style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: r.tone }} />
          </span>
          <span className={`${o.pairValue} num`}>{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

function MiniRoc({ points }: { points: [number, number][] }) {
  const [ref, width] = useWidth<HTMLDivElement>(240, 120);
  const W = width;
  const H = 70;
  const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${(x * W).toFixed(1)},${(H - y * H).toFixed(1)}`).join('');
  return (
    <div ref={ref} className={o.rocWrap}>
      <svg className={o.roc} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="ROC curve on held-out runs">
        <path d={`M0,${H} L${W},0`} className={o.rocDiag} />
        <path d={`${d} L${W},${H} L0,${H}Z`} className={o.rocArea} />
        <path d={d} className={o.rocLine} pathLength={1} />
      </svg>
    </div>
  );
}

export function Results({ bench }: { bench: BenchSummary }) {
  const runs = bench.policies?.runs ?? [];
  const by = (p: string) => runs.filter((r) => r.label.startsWith(p));
  const hybrid = by('hybrid');
  const rules = by('rules');
  const random = by('random');
  const best = hybrid.length ? hybrid : rules;
  const lastBug = (rs: BenchRun[]) => median(rs.map((r) => (r.recallRules >= 0.999 ? (r.bugSteps.at(-1) ?? NaN) : NaN)));
  const recallBest = median(best.map((r) => r.recallRules));
  const recallRandom = median(random.map((r) => r.recallRules));
  const stepsHybrid = lastBug(hybrid);
  const stepsRules = lastBug(rules);
  const heal = bench.heal;
  const ranker = bench.ranker;

  return (
    <div className={o.results}>
      <Link href="/benchmarks" className={o.result}>
        <span className={o.resultKicker}>Recall</span>
        <span className={`${o.resultValue} num`}>{pct(recallBest)}</span>
        <span className={o.resultLabel}>of rule-detectable planted bugs found in {bench.policies?.steps ?? 45} steps</span>
        <Pair
          rows={[
            { label: 'Nomad', value: recallBest, tone: 'var(--signal)' },
            { label: 'Random', value: recallRandom, tone: 'var(--faint)' },
          ]}
          max={1}
          format={(v) => pct(v)}
        />
      </Link>
      <Link href="/benchmarks" className={o.result}>
        <span className={o.resultKicker}>Speed</span>
        <span className={`${o.resultValue} num`}>
          {Number.isFinite(stepsHybrid) ? stepsHybrid : '—'}
          <small> steps</small>
        </span>
        <span className={o.resultLabel}>to find every bug with the ranker, median of repeated runs</span>
        <Pair
          rows={[
            { label: 'Ranker', value: stepsHybrid, tone: 'var(--t-ranker)' },
            { label: 'Rules', value: stepsRules, tone: 'var(--t-heuristic)' },
          ]}
          max={Math.max(stepsHybrid || 0, stepsRules || 0, 1)}
          format={(v) => (Number.isFinite(v) ? String(v) : '—')}
        />
      </Link>
      {heal && (
        <Link href="/healing" className={o.result}>
          <span className={o.resultKicker}>Self-healing</span>
          <span className={`${o.resultValue} num`}>{pct(heal.healingBreakRate)}</span>
          <span className={o.resultLabel}>
            of {heal.targets} selectors broken by a redesign with healing on, and {heal.wrongElement} wrong picks
          </span>
          <Pair
            rows={[
              { label: 'Healing', value: heal.healingBreakRate, tone: 'var(--ok)' },
              { label: 'Naive', value: heal.naiveBreakRate, tone: 'var(--critical)' },
            ]}
            max={1}
            format={(v) => pct(v)}
          />
        </Link>
      )}
      {ranker && (
        <Link href="/benchmarks" className={o.result}>
          <span className={o.resultKicker}>Ranker</span>
          <span className={`${o.resultValue} num`}>{ranker.test_auc.toFixed(3)}</span>
          <span className={o.resultLabel}>
            ROC AUC on held-out runs, against {ranker.baseline_best_single_feature.test_auc.toFixed(2)} for the best single feature
          </span>
          <MiniRoc points={ranker.roc_test} />
        </Link>
      )}
    </div>
  );
}
