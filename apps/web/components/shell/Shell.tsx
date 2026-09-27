'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { source } from '@/lib/data';
import { pct } from '@/lib/format';
import { toggleTheme, useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';
import { CommandPalette, openPalette } from './CommandPalette';
import { Logo } from './Logo';
import s from './shell.module.css';

const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? 'https://github.com/lakshaysharmaug22-crypto/nomad-loop-engine';

const NAV = [
  { href: '/', label: 'Overview', match: (p: string) => p === '/' },
  { href: '/runs', label: 'Runs', match: (p: string) => p.startsWith('/runs') },
  { href: '/benchmarks', label: 'Benchmarks', match: (p: string) => p.startsWith('/benchmarks') },
  { href: '/healing', label: 'Self-healing', match: (p: string) => p.startsWith('/healing') },
  { href: '/target', label: 'Live target', match: (p: string) => p.startsWith('/target') },
];

function ThemeButton() {
  const theme = useTheme();
  return (
    <button
      className={s.iconBtn}
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden="true"
      >
        {theme === 'dark' ? (
          <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
        ) : (
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
        )}
      </svg>
    </button>
  );
}

function Clock() {
  const [now, setNow] = useState<string>('');
  useEffect(() => {
    const tick = () => setNow(new Date().toISOString().slice(11, 19));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="num">{now} UTC</span>;
}

function StatusLine() {
  const runs = useLoad(() => source.listRuns(), []);
  const bench = useLoad(() => source.getBenchmarks(), []);
  const b = bench.state === 'ready' ? bench.data : null;
  return (
    <footer className={s.status} aria-label="System status">
      <span className={s.statusItem}>
        <i className={source.mode === 'live' ? s.dotLive : s.dotDemo} />
        {source.mode === 'live' ? `Live · ${source.label}` : 'Recorded data'}
      </span>
      <span className={s.statusItem}>{runs.state === 'ready' ? `${runs.data.length} runs` : '— runs'}</span>
      {b?.ranker && <span className={s.statusItem}>ranker AUC {b.ranker.test_auc.toFixed(3)}</span>}
      {b?.heal && <span className={s.statusItem}>healing break {pct(b.heal.healingBreakRate)}</span>}
      <span className={s.statusSpacer} />
      <span className={s.statusItem}>engine 0.2.0</span>
      <span className={s.statusItem}>
        <Clock />
      </span>
    </footer>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [mac, setMac] = useState(true);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), []);

  return (
    <div className={s.shell}>
      <header className={s.bar}>
        <Link href="/" className={s.brand} aria-label="Nomad Loop Engine, overview">
          <Logo />
          <span className={s.brandName}>
            Nomad <span>Loop Engine</span>
          </span>
        </Link>
        <nav className={s.nav} aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={s.navItem} aria-current={n.match(path) ? 'page' : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className={s.barRight}>
          <button className={s.search} onClick={openPalette} aria-label="Search or jump to (Command K)">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <span>Search or jump to</span>
            <kbd>{mac ? '⌘' : 'Ctrl'} K</kbd>
          </button>
          {source.mode === 'live' && (
            <a className={s.docs} href={`${process.env.NEXT_PUBLIC_API_URL}/docs`} target="_blank" rel="noreferrer">
              API
            </a>
          )}
          {REPO_URL && (
            <a className={s.docs} href={REPO_URL} target="_blank" rel="noreferrer">
              Source
            </a>
          )}
          <ThemeButton />
        </div>
      </header>
      <main className={s.main}>{children}</main>
      <StatusLine />
      <CommandPalette />
    </div>
  );
}
