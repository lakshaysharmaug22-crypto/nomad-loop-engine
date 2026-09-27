'use client';
// Live target: what Nomad found on Vayu Pramaan, a real deployed site it guards on every release.
import { ErrorState, PageHeader, Section, SeverityBadge, Stat, VerdictChip } from '@/components/ui/primitives';
import { duration, host, TIER_LABEL } from '@/lib/format';
import { loadTarget, VAYU_REPO, VAYU_URL } from '@/lib/target';
import { useLoad } from '@/lib/use-load';
import t from './target.module.css';

export function TargetView() {
  const res = useLoad(() => loadTarget(), []);
  const header = (
    <PageHeader
      title="Live target: Vayu Pramaan"
      meta={
        <span className={t.target}>
          <span>Delhi air-quality forecasting observatory</span>
          <a href={VAYU_URL} target="_blank" rel="noopener">
            {host(VAYU_URL)} ↗
          </a>
          <a href={VAYU_REPO} target="_blank" rel="noopener">
            repository ↗
          </a>
        </span>
      }
    >
      <p style={{ margin: '8px 0 0', maxWidth: '68ch', color: 'var(--ink-2)' }}>
        Nomad runs against this production site after every deploy. It explores the app like a user, files each confirmed bug with a
        replayable test, and blocks the release on a major or critical one. Benchmarks use a seeded app; these are findings on a real one.
      </p>
    </PageHeader>
  );
  if (res.state === 'loading')
    return (
      <>
        {header}
        <div className={t.empty}>Loading the latest scan…</div>
      </>
    );
  if (res.state === 'error')
    return (
      <>
        {header}
        <ErrorState error={res.error} />
      </>
    );
  const r = res.data.report;

  if (r.status === 'not_run' || !r.stats) {
    return (
      <>
        {header}
        <div className={t.empty}>
          The release gate is wired into Vayu Pramaan&apos;s deploy workflow. Results appear here after its first scan.
        </div>
        <Cross />
      </>
    );
  }
  const s = r.stats,
    bugs = r.bugs ?? [],
    hist = r.history ?? [];
  const blocked = hist.filter((h) => h.verdict === 'blocked').length;
  const tiers = Object.entries(s.tierCounts ?? {}).filter(([, v]) => v > 0);
  return (
    <>
      {header}
      <Section
        title="Latest scan"
        aside={
          <span className={t.verdict} data-v={r.verdict}>
            <i />
            {r.verdict === 'ship' ? 'Shipped' : 'Blocked'}
          </span>
        }
      >
        <div className={t.grid}>
          <Stat label="Steps explored" value={s.steps} />
          <Stat label="UI states found" value={s.states} hint={`${s.edges} transitions`} />
          <Stat
            label="Bugs reported"
            value={bugs.length}
            accent={bugs.length > 0}
            hint={`${bugs.filter((b) => b.status === 'confirmed').length} confirmed`}
          />
          <Stat
            label="Scan time"
            value={duration((r.duration_s ?? 0) * 1000)}
            hint={s.stepP95Ms ? `step p95 ${s.stepP95Ms} ms` : undefined}
          />
          <Stat label="Releases scanned" value={hist.length || 1} hint={`${blocked} blocked`} />
        </div>
        {tiers.length > 0 && (
          <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            Decided by {tiers.map(([k, v]) => `${TIER_LABEL[k as keyof typeof TIER_LABEL] ?? k} ${v}`).join(' · ')}
            {r.commit ? ` · commit ${r.commit.slice(0, 7)}` : ''}
            {r.finished ? ` · ${new Date(r.finished).toLocaleString()}` : ''}
          </p>
        )}
      </Section>

      <Section title="Bugs on the live site" aside={<span>{bugs.length} total</span>}>
        {bugs.length === 0 ? (
          <div className={t.empty}>No bugs in the latest scan.</div>
        ) : (
          <div className={t.bugs}>
            {bugs.map((b) => (
              <article key={b.id} className={t.bug}>
                <SeverityBadge severity={b.severity} />
                <h3>{b.title}</h3>
                <VerdictChip verdict={b.status} />
                <p>
                  Found at step {b.foundAtStep} · {b.confirmations} replays · {b.message}
                </p>
                {b.steps?.length > 0 && (
                  <ol>
                    {b.steps.slice(0, 6).map((st, i) => (
                      <li key={i}>{st}</li>
                    ))}
                  </ol>
                )}
              </article>
            ))}
          </div>
        )}
      </Section>

      {hist.length > 1 && (
        <Section title="Release history" aside={<span>green shipped · red blocked</span>}>
          <div className={t.panel}>
            <div className={t.hist} role="img" aria-label={`${hist.length} scans, ${blocked} blocked`}>
              {hist.slice(-40).map((h) => (
                <span
                  key={h.run_id}
                  data-v={h.verdict}
                  style={{ height: `${Math.max(12, Math.min(100, (h.states / Math.max(...hist.map((x) => x.states), 1)) * 100))}%` }}
                  title={`${new Date(h.finished).toLocaleString()} · ${h.verdict} · ${h.bugs} bugs · ${h.states} states`}
                />
              ))}
            </div>
          </div>
        </Section>
      )}
      <Cross />
    </>
  );
}

function Cross() {
  return (
    <div className={t.cross} style={{ marginTop: 24 }}>
      <span>Vayu Pramaan shows this same report in its own &quot;Tested by Nomad Loop&quot; row.</span>
      <a href={`${VAYU_URL}/#nomad`} target="_blank" rel="noopener">
        See it on Vayu Pramaan ↗
      </a>
    </div>
  );
}
