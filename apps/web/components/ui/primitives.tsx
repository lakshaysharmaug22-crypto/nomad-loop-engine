import type { RunStatus, Severity, Tier } from '@nomad/contracts';
import Link from 'next/link';
import { STATUS_LABEL, sevSoft, sevVar, TIER_LABEL, tierVar } from '@/lib/format';
import u from './ui.module.css';

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={u.badge} style={{ color: sevVar(severity), background: sevSoft(severity) }}>
      <SeverityIcon severity={severity} />
      {severity[0].toUpperCase() + severity.slice(1)}
    </span>
  );
}

/** Shape differs per severity so it never relies on colour alone. */
export function SeverityIcon({ severity, size = 10 }: { severity: Severity; size?: number }) {
  const c = sevVar(severity);
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
      {severity === 'critical' && <path d="M5 0.5 9.5 9H0.5Z" fill={c} />}
      {severity === 'major' && <rect x="1" y="1" width="8" height="8" rx="1.5" transform="rotate(45 5 5)" fill={c} />}
      {severity === 'minor' && <circle cx="5" cy="5" r="4" fill={c} />}
    </svg>
  );
}

const STATUS_TONE: Record<RunStatus, string> = {
  queued: 'var(--muted)',
  running: 'var(--signal)',
  finished: 'var(--ok)',
  failed: 'var(--critical)',
  stopped: 'var(--muted)',
};

export function StatusPill({ status }: { status: RunStatus }) {
  return (
    <span className={u.pill} data-status={status}>
      <i style={{ background: STATUS_TONE[status] }} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function TierChip({ tier, small }: { tier: Tier; small?: boolean }) {
  return (
    <span className={`${u.tier} ${small ? u.tierSmall : ''}`} data-tier={tier} style={{ ['--c' as string]: tierVar(tier) }}>
      {TIER_LABEL[tier]}
    </span>
  );
}

export function VerdictChip({ verdict }: { verdict: 'confirmed' | 'flaky' | 'unverified' | 'still broken' | 'fixed' }) {
  const tone =
    verdict === 'fixed' || verdict === 'confirmed'
      ? 'ok'
      : verdict === 'flaky'
        ? 'major'
        : verdict === 'still broken'
          ? 'critical'
          : 'muted';
  return (
    <span className={u.verdict} data-tone={tone}>
      {verdict}
    </span>
  );
}

export function Stat({ label, value, hint, accent }: { label: string; value: React.ReactNode; hint?: React.ReactNode; accent?: boolean }) {
  return (
    <div className={u.stat}>
      <div className={u.statLabel}>{label}</div>
      <div className={`${u.statValue} num`} data-accent={accent || undefined}>
        {value}
      </div>
      {hint && <div className={u.statHint}>{hint}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  meta,
  actions,
  children,
  crumbs,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  /** Trail above the title; the last entry is the current page. */
  crumbs?: { label: string; href?: string }[];
}) {
  return (
    <header className={u.pageHeader}>
      <div className={u.pageHeaderMain}>
        {crumbs && (
          <nav className={u.crumbs} aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={i}>{c.href ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}</span>
            ))}
          </nav>
        )}
        <h1 className={u.pageTitle}>{title}</h1>
        {meta && <div className={u.pageMeta}>{meta}</div>}
        {children}
      </div>
      {actions && <div className={u.pageActions}>{actions}</div>}
    </header>
  );
}

export function Section({
  title,
  aside,
  children,
  id,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section className={u.section} id={id} aria-labelledby={id ? `${id}-h` : undefined}>
      <div className={u.sectionHead}>
        <h2 id={id ? `${id}-h` : undefined}>{title}</h2>
        {aside && <div className={u.sectionAside}>{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function ErrorState({ error, action }: { error: Error; action?: React.ReactNode }) {
  return (
    <div className={u.errorState} role="alert">
      <strong>Could not load this page.</strong>
      <span>{error.message}</span>
      {action}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className={u.kbd}>{children}</kbd>;
}
