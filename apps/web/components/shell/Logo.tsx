/** The mark: a trail that loops back on itself and ends at a waypoint. Ink body, signal waypoint. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="8" fill="var(--ink)" />
      <path
        d="M7.5 22.5c3 0 4.2-2.9 5.4-6.2 1.3-3.5 2.6-6.9 6.3-6.9 2.7 0 4.3 1.9 4.3 4.2 0 2.5-2 4.3-4.5 4.3-2.8 0-4-2.3-2.8-4.9"
        fill="none"
        stroke="var(--panel)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7.5" cy="22.5" r="2.6" fill="var(--signal)" />
    </svg>
  );
}
