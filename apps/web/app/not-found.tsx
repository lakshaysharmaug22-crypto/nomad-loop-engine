import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 520, margin: '14vh auto', textAlign: 'center', justifyItems: 'center' }}>
      <span style={{ font: '600 11.5px var(--mono)', letterSpacing: '0.08em', color: 'var(--signal-ink)' }}>404 · UNMAPPED STATE</span>
      <h1 style={{ fontSize: 34, letterSpacing: '-0.03em', margin: 0 }}>Nothing mapped here</h1>
      <p style={{ color: 'var(--muted)', margin: 0 }}>
        This page is not part of the explored graph. Press ⌘K to jump to a run, a bug or a page.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <Link href="/" className="btn btn-primary">
          Overview
        </Link>
        <Link href="/runs" className="btn">
          Runs
        </Link>
      </div>
    </div>
  );
}
