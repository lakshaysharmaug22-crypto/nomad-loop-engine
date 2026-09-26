'use client';
import { useMemo, useState } from 'react';
import { ErrorState, PageHeader, Stat } from '@/components/ui/primitives';
import type { HealBench, HealRow } from '@/lib/bench-types';
import { source } from '@/lib/data';
import { pct } from '@/lib/format';
import { useLoad } from '@/lib/use-load';
import h from './heal.module.css';

const WEIGHTS = { semantic: 0.62, role: 0.18, context: 0.12, tag: 0.08 } as const;
const PARTS = [
  { key: 'semantic', label: 'Meaning', cls: h.pSemantic },
  { key: 'context', label: 'Context', cls: h.pContext },
  { key: 'role', label: 'Role', cls: h.pRole },
  { key: 'tag', label: 'Tag', cls: h.pTag },
] as const;
const THRESHOLD = 0.62;
const mask = (s: string) => s.toLowerCase().replace(/\d+/g, '#');

type Filter = 'semantic' | 'naive-broke' | 'all';

export function HealView() {
  const res = useLoad(() => source.getHealBench(), []);
  if (res.state === 'loading') return <div className="skeleton" style={{ height: 520 }} />;
  if (res.state === 'error') return <ErrorState error={res.error} />;
  if (!res.data)
    return <ErrorState error={new Error('No self-healing results yet. Run npm run bench -- --only heal, then npm run demo:sync.')} />;
  return <Inspector data={res.data} />;
}

function Inspector({ data }: { data: HealBench }) {
  const [filter, setFilter] = useState<Filter>('semantic');
  const rows = useMemo(() => {
    const r = data.rows.filter((x) => (filter === 'semantic' ? x.strategy !== 'exact' : filter === 'naive-broke' ? !x.naive : true));
    return r.sort((a, b) => Number(a.healed) - Number(b.healed) || a.score - b.score);
  }, [data, filter]);
  const [selected, setSelected] = useState<HealRow | null>(null);
  const current = selected && rows.includes(selected) ? selected : (rows[0] ?? null);

  const counts: Record<Filter, number> = {
    semantic: data.rows.filter((x) => x.strategy !== 'exact').length,
    'naive-broke': data.rows.filter((x) => !x.naive).length,
    all: data.rows.length,
  };

  return (
    <div className={h.page}>
      <PageHeader
        crumbs={[{ label: 'Evaluation' }]}
        title="Self-healing"
        meta={
          <span>
            Every link, button and input was recorded on the original build and located again on a redesign with renamed ids, removed test
            ids and reworded labels. Select an element to see how each candidate scored.
          </span>
        }
      />
      <div className={h.stats}>
        <Stat label="Elements" value={data.targets} />
        <Stat label="Broken, recorded selectors" value={pct(data.naiveBreakRate)} hint={`${data.targets - data.naiveResolved} elements`} />
        <Stat
          label="Broken, self-healing"
          value={pct(data.healingBreakRate)}
          accent
          hint={`${data.targets - data.healingResolved} elements`}
        />
        <Stat label="Found by meaning" value={data.healedSemantically} hint="identity no longer matched" />
        <Stat label="Wrong element" value={data.wrongElement} hint={`${data.abstained} abstained`} />
      </div>

      <div className={h.filters} role="tablist" aria-label="Filter elements">
        {(
          [
            ['semantic', 'Needed healing'],
            ['naive-broke', 'Recorded selector broke'],
            ['all', 'All elements'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}>
            {label} <span className="num">{counts[k]}</span>
          </button>
        ))}
      </div>

      <div className={h.panes}>
        <ul className={h.list} aria-label="Elements">
          {rows.map((r, i) => (
            <li key={`${r.page}-${r.target.role}-${r.target.name}-${i}`}>
              <button className={h.item} aria-pressed={r === current} onClick={() => setSelected(r)}>
                <span className={h.itemRole}>{r.target.role}</span>
                <span className={h.itemName}>
                  {r.target.name}
                  {mask(r.expected) !== mask(r.target.name) && <em> → {r.expected}</em>}
                </span>
                <span className={h.itemPage}>{r.page}</span>
                <span className={h.itemTags}>
                  {!r.naive && <span className={h.tagBroke}>selector broke</span>}
                  <span className={r.healed ? h.tagOk : h.tagBad}>
                    {r.healed
                      ? r.strategy === 'exact'
                        ? `exact · ${r.via}`
                        : `healed ${r.score.toFixed(2)}`
                      : r.strategy === 'failed'
                        ? 'abstained'
                        : 'wrong'}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {!rows.length && <li className={h.none}>Nothing in this view.</li>}
        </ul>
        {current && <Detail row={current} />}
      </div>
    </div>
  );
}

function Detail({ row }: { row: HealRow }) {
  const max = 1;
  return (
    <section className={h.detail} aria-label={`Scores for ${row.target.name}`}>
      <div className={h.targetCard}>
        <div className={h.cardLabel}>Recorded on the original build</div>
        <div className={h.targetName}>
          <span className={h.itemRole}>{row.target.role}</span> {row.target.name}
        </div>
        <dl className={h.ids}>
          <dt>Test id</dt>
          <dd className="mono">{row.target.testId ?? '—'}</dd>
          <dt>Element id</dt>
          <dd className="mono">{row.target.id ?? '—'}</dd>
          <dt>Context</dt>
          <dd>{row.target.context || '—'}</dd>
        </dl>
        <div className={h.verdict} data-ok={row.healed || undefined}>
          {row.strategy === 'exact'
            ? `Identity still matched (${row.via}); no healing needed.`
            : row.healed
              ? `Recorded identity is gone. Matched “${row.picked}” by meaning at ${row.score.toFixed(3)}.`
              : row.strategy === 'failed'
                ? `No candidate reached ${THRESHOLD}; the locator abstained instead of guessing.`
                : `Matched “${row.picked}”, but the correct element was “${row.expected}”.`}
          {!row.naive && ' A recorded selector would have failed here.'}
        </div>
      </div>

      {row.candidates.length > 0 && (
        <div className={h.cands}>
          <div className={h.candsHead}>
            <span>Candidates on the redesign</span>
            <span className={h.partsKey}>
              {PARTS.map((p) => (
                <span key={p.key}>
                  <i className={p.cls} /> {p.label} ×{WEIGHTS[p.key]}
                </span>
              ))}
            </span>
          </div>
          <ol className={h.candList}>
            {row.candidates.map((c, i) => {
              const winner = i === 0 && row.strategy === 'healed';
              const correct = c.name === row.expected;
              return (
                <li key={`${c.name}-${i}`} data-winner={winner || undefined} style={{ animationDelay: `${i * 60}ms` }}>
                  <div className={h.candTop}>
                    <span className={h.itemRole}>{c.role}</span>
                    <span className={h.candName}>{c.name || '(no name)'}</span>
                    {correct && <span className={h.tagOk}>correct</span>}
                    <span className={`${h.candScore} num`}>{c.score.total.toFixed(3)}</span>
                  </div>
                  <div
                    className={h.stack}
                    role="img"
                    aria-label={`meaning ${c.score.semantic}, context ${c.score.context}, role ${c.score.role}, tag ${c.score.tag}`}
                  >
                    {PARTS.map((p) => (
                      <span
                        key={p.key}
                        className={p.cls}
                        style={{ width: `${((WEIGHTS[p.key] * c.score[p.key]) / max) * 100}%` }}
                        title={`${p.label}: ${c.score[p.key]} × ${WEIGHTS[p.key]}`}
                      />
                    ))}
                    <i className={h.threshold} style={{ left: `${THRESHOLD * 100}%` }} />
                  </div>
                  <div className={h.candCtx}>{c.context}</div>
                </li>
              );
            })}
          </ol>
          <p className={h.note}>
            The vertical mark is the {THRESHOLD} threshold. Below it the locator abstains rather than act on the wrong element.
          </p>
        </div>
      )}
    </section>
  );
}
