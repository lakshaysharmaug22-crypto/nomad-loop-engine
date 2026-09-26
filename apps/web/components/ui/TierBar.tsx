import type { RunStats } from '@nomad/contracts';
import { TIER_LABEL, TIERS } from '@/lib/format';
import s from './tierbar.module.css';

/** Stacked share of steps per deciding tier. Fallback is hatched so it never relies on colour alone. */
export function TierBar({
  counts,
  height = 8,
  showLegend = false,
}: {
  counts: RunStats['tierCounts'];
  height?: number;
  showLegend?: boolean;
}) {
  const total = TIERS.reduce((a, t) => a + (counts[t] ?? 0), 0);
  const label = TIERS.map((t) => `${TIER_LABEL[t]} ${counts[t] ?? 0}`).join(', ');
  return (
    <div className={s.wrap}>
      <div className={s.bar} style={{ height }} role="img" aria-label={`Steps decided by: ${label}`}>
        {total === 0 ? (
          <span className={s.empty} />
        ) : (
          TIERS.map((t) =>
            counts[t] ? <span key={t} data-tier={t} style={{ flexGrow: counts[t] }} title={`${TIER_LABEL[t]}: ${counts[t]}`} /> : null,
          )
        )}
      </div>
      {showLegend && (
        <div className={s.legend}>
          {TIERS.map((t) => (
            <span key={t}>
              <i data-tier={t} />
              {TIER_LABEL[t]} <b className="num">{counts[t] ?? 0}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
