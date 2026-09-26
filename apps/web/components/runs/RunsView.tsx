'use client';
import type { RunSummary } from '@nomad/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ErrorState, PageHeader, StatusPill } from '@/components/ui/primitives';
import { TierBar } from '@/components/ui/TierBar';
import { source } from '@/lib/data';
import { duration, host, relativeTime } from '@/lib/format';
import { useLoad } from '@/lib/use-load';
import { NewRun } from './NewRun';
import s from './runs.module.css';

function Summary({ runs }: { runs: RunSummary[] }) {
  const done = runs.filter((r) => r.stats);
  const sum = (f: (r: RunSummary) => number) => done.reduce((a, r) => a + f(r), 0);
  const tiers = { heuristic: 0, ranker: 0, llm: 0, fallback: 0 };
  for (const r of done) for (const k of Object.keys(tiers) as (keyof typeof tiers)[]) tiers[k] += r.stats!.tierCounts[k] ?? 0;
  const steps = sum((r) => r.stats!.steps);
  const p50s = done.map((r) => r.stats!.stepP50Ms ?? 0).sort((x, y) => x - y);
  const p50 = p50s.length ? p50s[Math.floor(p50s.length / 2)] : undefined;
  const items: [string, React.ReactNode][] = [
    ['Runs', runs.length],
    ['Steps explored', steps.toLocaleString()],
    ['States mapped', sum((r) => r.stats!.states).toLocaleString()],
    ['Bugs reported', sum((r) => r.stats!.bugs)],
    ['Median step', duration(p50)],
  ];
  return (
    <div className={s.summary}>
      {items.map(([k, v]) => (
        <div key={k} className={s.sumItem}>
          <span className={s.sumLabel}>{k}</span>
          <span className={`${s.sumValue} num`}>{v}</span>
        </div>
      ))}
      <div className={s.sumTiers}>
        <span className={s.sumLabel}>Decisions by tier, all runs</span>
        <TierBar counts={tiers} showLegend />
      </div>
    </div>
  );
}

export function RunsView() {
  const runs = useLoad(() => source.listRuns(), []);
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  // The command palette links here with ?new=1 to open the form.
  useEffect(() => {
    if (source.startRun && new URLSearchParams(window.location.search).get('new') === '1') setCreating(true);
  }, []);

  return (
    <div className={s.page}>
      <PageHeader
        crumbs={[{ label: 'Workspace' }]}
        title="Runs"
        meta={<span>Each run explores an app like a user, reports bugs with a reproducible test, and records why every step was taken.</span>}
        actions={
          source.startRun ? (
            <button className="btn btn-primary" onClick={() => setCreating(true)} disabled={creating}>
              New run
            </button>
          ) : (
            <span className={s.demoNote}>Recorded runs. Connect an API to start new ones.</span>
          )
        }
      />
      {creating && <NewRun onClose={() => setCreating(false)} />}
      {runs.state === 'ready' && runs.data.length > 0 && <Summary runs={runs.data} />}

      {runs.state === 'error' && <ErrorState error={runs.error} />}
      {runs.state === 'loading' && <div className="skeleton" style={{ height: 280 }} />}
      {runs.state === 'ready' && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th scope="col">Run</th>
                <th scope="col">Status</th>
                <th scope="col">Policy</th>
                <th scope="col" className={s.num}>
                  Steps
                </th>
                <th scope="col" className={s.num}>
                  States
                </th>
                <th scope="col" className={s.num}>
                  Bugs
                </th>
                <th scope="col">Decided by</th>
                <th scope="col" className={s.num}>
                  Duration
                </th>
                <th scope="col">Started</th>
              </tr>
            </thead>
            <tbody>
              {runs.data.map((r: RunSummary) => (
                <tr key={r.id} onClick={() => router.push(`/runs/${encodeURIComponent(r.id)}`)}>
                  <td>
                    <Link href={`/runs/${encodeURIComponent(r.id)}`} className={s.runCell} onClick={(e) => e.stopPropagation()}>
                      <span className={s.runHost}>{host(r.target)}</span>
                      <span className={s.runId}>{r.id}</span>
                    </Link>
                  </td>
                  <td>
                    <StatusPill status={r.status} />
                  </td>
                  <td>
                    <code className={s.policy}>{r.policy ?? '—'}</code>
                  </td>
                  <td className={`${s.num} num`}>{r.stats?.steps ?? '—'}</td>
                  <td className={`${s.num} num`}>{r.stats?.states ?? '—'}</td>
                  <td className={`${s.num} num`}>
                    <b className={r.stats?.bugs ? s.bugCount : undefined}>{r.stats?.bugs ?? '—'}</b>
                  </td>
                  <td className={s.tiers}>{r.stats ? <TierBar counts={r.stats.tierCounts} /> : '—'}</td>
                  <td className={`${s.num} num`}>{duration(r.stats?.elapsedMs)}</td>
                  <td className={s.when}>{relativeTime(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!runs.data.length && <p className={s.empty}>No runs yet. Start one with New run, or record one with the CLI: nomad scan &lt;url&gt;.</p>}
        </div>
      )}
    </div>
  );
}
