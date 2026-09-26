'use client';
import type { CandidateScore, HealEvent, Tier } from '@nomad/contracts';
import { TierChip } from '@/components/ui/primitives';
import { duration, TIER_HINT } from '@/lib/format';
import type { StepEvent } from './use-replay';
import t from './trace.module.css';

type StageState = 'decided' | 'escalated' | 'offline' | 'skipped';

interface Stage {
  key: 'rules' | 'ranker' | 'llm';
  name: string;
  tier: Tier;
  state: StageState;
  value: string;
  /** What the value is compared against, e.g. the ranker threshold. */
  need?: string;
  ms?: number;
}

const KIND_LABEL: Record<CandidateScore['kind'], string> = {
  click: 'click',
  fill_submit: 'form',
  fill_submit_empty: 'empty',
  navigate: 'go to',
};

/** 0.55 → ".55", 1 → "1.00": keeps probabilities narrow enough for the pipeline nodes. */
const short = (x: number | undefined) => (x === undefined ? '—' : x.toFixed(2).replace(/^0\./, '.'));

const STATE_NOTE: Record<StageState, string> = {
  decided: 'decided',
  escalated: 'passed on',
  offline: 'offline',
  skipped: 'not needed',
};

function Bar({ value, max, threshold, tone }: { value: number | undefined; max: number; threshold?: number; tone: string }) {
  if (value === undefined) return <span className={t.na}>—</span>;
  const w = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <span className={t.bar}>
      <span className={t.track}>
        <span className={t.fill} style={{ width: `${w * 100}%`, background: tone }} />
        {threshold !== undefined && <i className={t.threshold} style={{ left: `${(threshold / max) * 100}%` }} />}
      </span>
      <span className={`${t.value} num`} data-negative={value < 0 || undefined}>
        {value.toFixed(Math.abs(value) >= 10 ? 0 : 2)}
      </span>
    </span>
  );
}

/** A connector between two pipeline nodes. Active connectors carry flowing particles. */
function Wire({ active, step, delay }: { active: boolean; step: number; delay: number }) {
  return (
    <span className={t.wire} data-active={active || undefined} aria-hidden="true">
      {active && <i key={step} className={t.burst} style={{ animationDelay: `${delay}ms` }} />}
    </span>
  );
}

export function DecisionTrace({ step, heal }: { step: StepEvent | null; heal?: HealEvent }) {
  if (!step) {
    return (
      <section className={t.panel} aria-label="Decision pipeline">
        <div className={t.empty}>
          <span className={t.kicker}>Decision pipeline</span>
          <strong>Waiting for the first step</strong>
          <span>Every action is chosen by a cascade: cheap rules first, then the trained ranker, then a local language model.</span>
        </div>
      </section>
    );
  }
  const d = step.decision;
  const tr = d.trace;

  const rules: StageState = tr.heuristic.decided ? 'decided' : 'escalated';
  const ranker: StageState = tr.heuristic.decided
    ? 'skipped'
    : !tr.ranker.available
      ? 'offline'
      : tr.ranker.decided
        ? 'decided'
        : 'escalated';
  const llm: StageState =
    tr.heuristic.decided || tr.ranker.decided
      ? 'skipped'
      : tr.llm.decided
        ? 'decided'
        : !tr.llm.available || !tr.llm.asked
          ? 'offline'
          : 'escalated';

  const stages: Stage[] = [
    {
      key: 'rules',
      name: 'Rules',
      tier: 'heuristic',
      state: rules,
      value: tr.total === 1 ? 'only one' : `Δ ${tr.heuristic.margin.toFixed(1)}`,
      need: tr.total === 1 ? undefined : `needs ${tr.heuristic.required}`,
      ms: tr.heuristic.ms,
    },
    {
      key: 'ranker',
      name: 'Ranker',
      tier: 'ranker',
      state: ranker,
      value: ranker === 'skipped' || ranker === 'offline' ? '—' : `p ${short(tr.ranker.best)}`,
      need: ranker === 'skipped' || ranker === 'offline' ? undefined : `needs ${short(tr.ranker.threshold)}`,
      ms: tr.ranker.ms,
    },
    {
      key: 'llm',
      name: 'Local LLM',
      tier: 'llm',
      state: llm,
      value: llm === 'decided' ? 'chose' : '—',
      ms: tr.llm.ms,
    },
  ];

  // Where the decision leaves the cascade. A fallback leaves after the last tier.
  const exit = d.tier === 'heuristic' ? 0 : d.tier === 'ranker' ? 1 : 2;
  const verdict =
    d.tier === 'heuristic'
      ? tr.total === 1
        ? 'Only one untried action on this page.'
        : `Leader ahead by ${tr.heuristic.margin.toFixed(1)}, above the ${tr.heuristic.required} the rules require.`
      : d.tier === 'ranker'
        ? `Best probability ${tr.ranker.best?.toFixed(2)} cleared the ${tr.ranker.threshold} threshold.`
        : d.tier === 'llm'
          ? (tr.llm.reason ?? 'The local model picked the action.')
          : TIER_HINT.fallback + '.';

  const maxRule = Math.max(0.1, ...tr.candidates.map((c) => Math.abs(c.heuristic)));
  const hasRanker = tr.candidates.some((c) => c.ranker !== undefined);
  const exitCol = 3 + exit * 2; // grid column of the exit node

  return (
    <section className={t.panel} aria-label={`Decision pipeline for step ${step.step}`}>
      <header className={t.head}>
        <span className={t.kicker}>Decision pipeline</span>
        <span className={t.stepNo}>
          step <span className="num">{String(step.step).padStart(2, '0')}</span>
        </span>
        <span className={t.time}>{duration(step.durationMs)}</span>
      </header>

      <div className={t.pipe} style={{ ['--exit-col' as string]: exitCol, ['--tone' as string]: `var(--t-${d.tier})` }}>
        <div className={t.source}>
          <span className={t.nodeName}>Candidates</span>
          <span className={`${t.sourceN} num`}>{tr.total}</span>
          <span className={t.nodeNeed}>scored</span>
        </div>
        {stages.map((s, i) => (
          <PipeStage key={s.key} stage={s} index={i} reached={i <= exit} stepNo={step.step} />
        ))}
        <span className={t.drop} aria-hidden="true">
          <i key={step.step} className={t.burstDown} style={{ animationDelay: `${(exit + 1) * 110}ms` }} />
        </span>
        <div className={t.out}>
          <div className={t.outHead}>
            <span className={t.nodeName}>Action</span>
            <TierChip tier={d.tier} small />
          </div>
          <div className={t.action}>{d.label}</div>
          <p className={t.verdict}>{verdict}</p>
        </div>
      </div>

      <div className={t.tableWrap}>
        <table className={t.table}>
          <caption className="sr-only">Top candidate actions and their scores</caption>
          <thead>
            <tr>
              <th scope="col">
                Top candidates <span className={t.total}>of {tr.total}</span>
              </th>
              <th scope="col">Rules</th>
              {hasRanker && <th scope="col">Ranker p</th>}
            </tr>
          </thead>
          <tbody>
            {tr.candidates.map((c, i) => (
              <tr key={`${step.step}-${i}`} data-chosen={c.chosen || undefined}>
                <td>
                  <span className={t.kind}>{KIND_LABEL[c.kind]}</span>
                  <span className={t.label} title={c.label}>
                    {c.label.replace(/^(Click link|Click|Fill and submit|Submit) /, '')}
                  </span>
                </td>
                <td>
                  <Bar value={c.heuristic} max={maxRule} tone="var(--t-heuristic)" />
                </td>
                {hasRanker && (
                  <td>
                    <Bar value={c.ranker} max={1} threshold={tr.ranker.threshold} tone="var(--t-ranker)" />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {heal && heal.strategy !== 'exact' && (
        <div className={t.heal} data-strategy={heal.strategy}>
          <strong>{heal.strategy === 'healed' ? 'Selector healed' : 'Element not found'}</strong>
          <span>
            “{heal.target.name}”{' '}
            {heal.strategy === 'healed' ? (
              <>
                → “{heal.matched}” at {heal.score.toFixed(2)}
              </>
            ) : (
              `best match ${heal.score.toFixed(2)} below threshold`
            )}
          </span>
        </div>
      )}
    </section>
  );
}

function PipeStage({ stage: s, index, reached, stepNo }: { stage: Stage; index: number; reached: boolean; stepNo: number }) {
  return (
    <>
      <Wire active={reached} step={stepNo} delay={index * 110} />
      <div
        className={t.node}
        data-state={s.state}
        style={{ ['--c' as string]: `var(--t-${s.tier})` }}
        aria-label={`${s.name}: ${STATE_NOTE[s.state]}`}
      >
        {s.state === 'decided' && (
          <span key={stepNo} className={t.ping} style={{ animationDelay: `${index * 110 + 90}ms` }} aria-hidden="true" />
        )}
        <span className={t.nodeName}>{s.name}</span>
        <span className={`${t.nodeValue} num`}>{s.value}</span>
        <span className={t.nodeNeed}>{s.need ?? '\u00a0'}</span>
        <span className={t.nodeNote}>
          {STATE_NOTE[s.state]}
          {s.ms !== undefined && s.state !== 'skipped' && <em className="num">{s.ms < 1 ? '<1' : Math.round(s.ms)} ms</em>}
        </span>
      </div>
    </>
  );
}
