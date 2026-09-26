'use client';
import type { BugReport, Sweep } from '@nomad/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ErrorState, PageHeader, SeverityBadge, VerdictChip } from '@/components/ui/primitives';
import { source } from '@/lib/data';
import { ANOMALY_LABEL, host, pathOf } from '@/lib/format';
import { CodeBlock } from './CodeBlock';
import b from './bug.module.css';

export function BugView({ runId, bugId }: { runId: string; bugId: string }) {
  const [bug, setBug] = useState<BugReport | null>(null);
  const [sweeps, setSweeps] = useState<Sweep[]>([]);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([source.getBug(runId, bugId), source.listSweeps(runId).catch(() => [])]).then(
      ([bg, sw]) => {
        if (!alive) return;
        setBug(bg);
        setSweeps(sw);
      },
      (e: Error) => alive && setError(e),
    );
    return () => {
      alive = false;
    };
  }, [runId, bugId]);

  const back = (
    <Link href={`/runs/${encodeURIComponent(runId)}`} className={b.back}>
      ← {runId}
    </Link>
  );
  if (error) return <ErrorState error={error} action={back} />;
  if (!bug) return <div className="skeleton" style={{ height: 480 }} aria-busy="true" />;

  const file = `${bug.id.toLowerCase()}.spec.ts`;
  const history = sweeps.flatMap((s) => {
    const item = s.items.find((i) => i.bugId === bug.id);
    return item ? [{ sweep: s, item }] : [];
  });

  return (
    <div className={b.page}>
      <PageHeader
        crumbs={[{ label: 'Runs', href: '/runs' }, { label: runId, href: `/runs/${encodeURIComponent(runId)}` }, { label: bug.id }]}
        title={bug.title}
        meta={
          <>
            <SeverityBadge severity={bug.severity} />
            <span className="mono">{bug.id}</span>
            <span>{ANOMALY_LABEL[bug.type]}</span>
            <span>found at step {bug.foundAtStep}</span>
            <VerdictChip verdict={bug.status} />
          </>
        }
      />

      <div className={b.grid}>
        <figure className={b.shot}>
          <div className={b.chrome} aria-hidden="true">
            <i />
            <i />
            <i />
            <span className="mono">{pathOf(bug.url)}</span>
          </div>
          {bug.screenshot ? (
            <img src={source.artifactUrl(runId, bug.screenshot)} alt={`Page at the moment ${bug.id} was observed`} />
          ) : (
            <div className={b.noShot}>No screenshot</div>
          )}
          <figcaption>Captured when the anomaly was observed, before verification.</figcaption>
        </figure>

        <div className={b.side}>
          <section className={b.card}>
            <h2>Reproduce</h2>
            <ol className={b.steps}>
              {bug.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            <dl className={b.facts}>
              <dt>Observed</dt>
              <dd>{bug.message}</dd>
              <dt>Page</dt>
              <dd className="mono">{bug.url}</dd>
              <dt>Signature</dt>
              <dd className="mono">{bug.signature}</dd>
            </dl>
          </section>

          <section className={b.card}>
            <h2>Verification</h2>
            <ol className={b.timeline}>
              <li data-tone="found">
                <strong>Found</strong>
                <span>Step {bug.foundAtStep} of the exploration</span>
              </li>
              <li data-tone={bug.status === 'confirmed' ? 'broken' : 'flaky'}>
                <strong>Replayed {bug.confirmations.split('/')[1]}× in fresh browsers</strong>
                <span>
                  Reproduced {bug.confirmations} · {bug.status}
                  {bug.recipe.action ? '' : ' · minimized to a page load'}
                </span>
              </li>
              {history.map(({ sweep, item }) => {
                const healed = item.heals.filter((h) => h.strategy === 'healed');
                return (
                  <li key={sweep.id} data-tone={item.verdict === 'fixed' ? 'fixed' : item.verdict === 'flaky' ? 'flaky' : 'broken'}>
                    <strong>
                      {sweep.label ?? 'Sweep'} <VerdictChip verdict={item.verdict} />
                    </strong>
                    <span>
                      {host(sweep.target)} · reproduced {item.reproduced}
                      {healed.map((h) => (
                        <em key={h.target.name}>
                          {' '}
                          · selector “{h.target.name}” healed to “{h.matched}” ({h.score.toFixed(2)})
                        </em>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
      </div>

      <section className={b.testSection}>
        <div className={b.testHead}>
          <h2>Regression test</h2>
          <p>Fails while the bug exists and passes once it is fixed. Drop it into any Playwright suite.</p>
        </div>
        <CodeBlock code={bug.reproScript} filename={file} downloadHref={source.artifactUrl(runId, `repro/${file}`)} />
      </section>
    </div>
  );
}
