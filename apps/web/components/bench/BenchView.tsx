'use client';
import Link from 'next/link';
import { BugsOverSteps, type PolicySeries } from '@/components/charts/BugsOverSteps';
import { Importance } from '@/components/charts/Importance';
import { RocCurve } from '@/components/charts/RocCurve';
import { ErrorState, PageHeader, Section } from '@/components/ui/primitives';
import { TierBar } from '@/components/ui/TierBar';
import type { BenchRun, BenchSummary } from '@/lib/bench-types';
import { source } from '@/lib/data';
import { duration, pct } from '@/lib/format';
import { useLoad } from '@/lib/use-load';
import b from './bench.module.css';

const med = (xs: number[]) => {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  return a.length ? a[Math.floor(a.length / 2)] : NaN;
};

const POLICY_META: Record<string, { label: string; color: string; dashed?: boolean; note: string }> = {
  random: { label: 'Random', color: 'var(--t-fallback)', dashed: true, note: 'uniform choice among untried actions' },
  rules: { label: 'Rules only', color: 'var(--t-heuristic)', note: 'tier 1 alone' },
  hybrid: { label: 'Rules + ranker', color: 'var(--t-ranker)', note: 'tiers 1 and 2; the LLM was offline' },
};

function groups(runs: BenchRun[]) {
  return (['random', 'rules', 'hybrid'] as const)
    .map((k) => ({ key: k, runs: runs.filter((r) => r.label.startsWith(k)) }))
    .filter((g) => g.runs.length);
}

export function BenchView() {
  const res = useLoad(() => source.getBenchmarks(), []);
  if (res.state === 'loading') return <div className="skeleton" style={{ height: 560 }} />;
  if (res.state === 'error') return <ErrorState error={res.error} />;
  if (!res.data) return <ErrorState error={new Error('No benchmark results yet. Run npm run bench, then npm run demo:sync.')} />;
  return <Bench data={res.data} />;
}

function Bench({ data }: { data: BenchSummary }) {
  const runs = data.policies?.runs ?? [];
  const g = groups(runs);
  const target = data.policies?.manifestSize ?? 10;
  const steps = data.policies?.steps ?? 45;
  const series: PolicySeries[] = g.map((x) => ({
    key: x.key,
    label: POLICY_META[x.key].label,
    color: POLICY_META[x.key].color,
    dashed: POLICY_META[x.key].dashed,
    runs: x.runs,
  }));
  const rk = data.ranker;

  return (
    <div className={b.page}>
      <PageHeader
        crumbs={[{ label: 'Evaluation' }]}
        title="Benchmarks"
        meta={
          <span>
            Measured on buggy-shop: 10 planted bugs with a ground-truth manifest, plus a redesigned build and a fixed build. Reproduce with{' '}
            <code>npm run bench</code>. Generated{' '}
            {new Date(data.generatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}.
          </span>
        }
      />

      <Section title="Finding bugs" id="policies" aside={`${steps} steps per run`}>
        <div className={b.card}>
          <BugsOverSteps series={series} steps={steps} target={target} />
          <p className={b.caption}>
            Median bugs found by each step, with the range across runs shaded. One bug needs the local LLM to judge a form that accepts
            empty input, so the rules-and-ranker ceiling is {target - 1}.
          </p>
        </div>
        <div className={b.tableWrap}>
          <table className={b.table}>
            <thead>
              <tr>
                <th scope="col">Policy</th>
                <th scope="col" className={b.num}>
                  Runs
                </th>
                <th scope="col" className={b.num}>
                  Recall
                </th>
                <th scope="col" className={b.num}>
                  Rule-detectable recall
                </th>
                <th scope="col" className={b.num}>
                  Precision
                </th>
                <th scope="col" className={b.num}>
                  States
                </th>
                <th scope="col" className={b.num}>
                  Last bug at step
                </th>
                <th scope="col" className={b.num}>
                  Step p95
                </th>
                <th scope="col">Decided by</th>
              </tr>
            </thead>
            <tbody>
              {g.map((x) => {
                const counts = { heuristic: 0, ranker: 0, llm: 0, fallback: 0 };
                x.runs.forEach((r) =>
                  (Object.keys(counts) as (keyof typeof counts)[]).forEach((t) => (counts[t] += r.stats.tierCounts[t])),
                );
                const all = x.runs.every((r) => r.recallRules >= 0.999);
                return (
                  <tr key={x.key}>
                    <th scope="row">
                      <span className={b.policy}>
                        <i
                          style={{ borderColor: POLICY_META[x.key].color, borderTopStyle: POLICY_META[x.key].dashed ? 'dashed' : 'solid' }}
                        />
                        {POLICY_META[x.key].label}
                      </span>
                      <span className={b.policyNote}>{POLICY_META[x.key].note}</span>
                    </th>
                    <td className={`${b.num} num`}>{x.runs.length}</td>
                    <td className={`${b.num} num`}>{pct(med(x.runs.map((r) => r.recall)))}</td>
                    <td className={`${b.num} num`}>{pct(med(x.runs.map((r) => r.recallRules)))}</td>
                    <td className={`${b.num} num`}>{pct(med(x.runs.map((r) => r.precision)))}</td>
                    <td className={`${b.num} num`}>{med(x.runs.map((r) => r.stats.states))}</td>
                    <td className={`${b.num} num`}>{all ? med(x.runs.map((r) => r.bugSteps.at(-1) ?? NaN)) : 'never all'}</td>
                    <td className={`${b.num} num`}>{duration(med(x.runs.map((r) => r.stats.stepP95Ms ?? NaN)))}</td>
                    <td className={b.tiers}>
                      <TierBar counts={counts} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {rk && (
        <Section title="The trained ranker" id="ranker" aside={`${rk.rows} logged actions from ${rk.runs} runs`}>
          <div className={b.split}>
            <div className={b.card}>
              <h3 className={b.cardTitle}>ROC on held-out runs</h3>
              <RocCurve points={rk.roc_test} auc={rk.test_auc} baseline={rk.baseline_best_single_feature} />
              <dl className={b.facts}>
                <dt>Split by run</dt>
                <dd className="num">
                  {rk.split_rows.train} train · {rk.split_rows.val} validation · {rk.split_rows.test} test rows
                </dd>
                <dt>Precision at p ≥ 0.55</dt>
                <dd className="num">
                  {pct(rk['test_precision_at_0.55'])} of chosen actions paid off, against a base rate of {pct(rk.test_base_rate)}
                </dd>
                <dt>Label</dt>
                <dd>1 when the action reached a new state or surfaced a new bug</dd>
              </dl>
            </div>
            <div className={b.card}>
              <h3 className={b.cardTitle}>What the model relies on</h3>
              <p className={b.caption}>Test AUC lost when one feature is shuffled.</p>
              <Importance items={rk.importance_test} />
            </div>
          </div>
        </Section>
      )}

      <div className={b.split}>
        {data.heal && (
          <Section title="Self-healing" id="healing" aside={<Link href="/healing">Inspect every element →</Link>}>
            <div className={b.card}>
              <div className={b.compare}>
                <CompareBar
                  label="Recorded selectors"
                  broken={data.heal.targets - data.heal.naiveResolved}
                  total={data.heal.targets}
                  tone="var(--critical)"
                />
                <CompareBar
                  label="Self-healing locator"
                  broken={data.heal.targets - data.heal.healingResolved}
                  total={data.heal.targets}
                  tone="var(--critical)"
                />
              </div>
              <p className={b.caption}>
                {data.heal.targets} links, buttons and inputs recorded on the original build, then located again on the redesign.{' '}
                {data.heal.healedSemantically} were found by meaning rather than identity; {data.heal.wrongElement} were matched to the
                wrong element. Embeddings: <code>{data.heal.embedder}</code>.
              </p>
            </div>
          </Section>
        )}
        {data.sweeps && (
          <Section title="Regression sweeps" id="sweeps" aside={<Link href="/runs/demo">Open the demo run →</Link>}>
            <div className={b.card}>
              <ul className={b.sweeps}>
                {data.sweeps.map((s) => (
                  <li key={s.label}>
                    <span className={b.sweepLabel}>{s.label}</span>
                    <span className={b.sweepBar} aria-label={`${s.stillBroken} still broken, ${s.fixed} fixed`}>
                      <i style={{ flexGrow: s.stillBroken, background: 'var(--critical)' }} />
                      <i style={{ flexGrow: s.fixed, background: 'var(--ok)' }} />
                    </span>
                    <span className="num">
                      {s.stillBroken} broken · {s.fixed} fixed
                    </span>
                  </li>
                ))}
              </ul>
              <p className={b.caption}>
                Every bug from the demo run, replayed three times on each build. On the redesign the recorded selectors no longer match, so
                the bugs are only reachable through self-healing.
              </p>
            </div>
          </Section>
        )}
      </div>

      <Section title="Scope" id="scope">
        <ul className={b.scope}>
          <li>
            One seeded app. The ranker is trained and tested on different runs of the same app, so its AUC measures generalisation across
            explorations, not across apps.
          </li>
          <li>The redesign and its label changes were written for this benchmark. They are listed in targets/buggy-shop/redesign.json.</li>
          <li>
            The local LLM was not running for these numbers. Its tier and the empty-form judge are exercised with Ollama in the full setup.
          </li>
        </ul>
      </Section>
    </div>
  );
}

function CompareBar({ label, broken, total, tone }: { label: string; broken: number; total: number; tone: string }) {
  return (
    <div className={b.compareRow}>
      <span className={b.compareLabel}>{label}</span>
      <span className={b.compareTrack}>
        <i style={{ width: `${(broken / total) * 100}%`, background: tone }} />
      </span>
      <span className={`${b.compareValue} num`}>
        {pct(broken / total)} broken <em>({broken})</em>
      </span>
    </div>
  );
}
