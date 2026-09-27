'use client';
// Command palette: jump to any page, run or bug, or run an action. Opens with ⌘K / Ctrl K or "/".
import type { BugReport, RunSummary } from '@nomad/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { source } from '@/lib/data';
import { host } from '@/lib/format';
import { toggleTheme } from '@/lib/theme';
import p from './palette.module.css';

const OPEN = 'nomad-palette-open';
export const openPalette = () => window.dispatchEvent(new Event(OPEN));

type Group = 'Pages' | 'Runs' | 'Bugs' | 'Actions';
interface Item {
  id: string;
  group: Group;
  title: string;
  hint?: string;
  keywords?: string;
  tone?: string;
  run: () => void;
}

/** Subsequence match with bonuses for word starts and contiguous runs. Returns -1 for no match. */
function fuzzy(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) return 1000 - direct;
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    streak = found === ti ? streak + 1 : 0;
    score += 10 + streak * 5 + (found === 0 || /\W/.test(t[found - 1]) ? 15 : 0) - Math.min(8, found - ti);
    ti = found + 1;
  }
  return score;
}

function Icon({ group }: { group: Group }) {
  const d =
    group === 'Pages'
      ? 'M4 5h16v14H4zM4 9h16'
      : group === 'Runs'
        ? 'M5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM19 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6.5 15.5 17.5 8.5'
        : group === 'Bugs'
          ? 'M12 20a6 6 0 0 0 6-6v-3a6 6 0 0 0-12 0v3a6 6 0 0 0 6 6ZM12 11v9M6 13H3M21 13h-3M8 5l1.5 2M16 5l-1.5 2'
          : 'M13 3 4 14h7l-1 7 9-11h-7l1-7Z';
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [bugs, setBugs] = useState<{ runId: string; bug: BugReport }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActive(0);
  }, []);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener(OPEN, onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(OPEN, onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Load runs and their bugs the first time the palette opens.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
    if (loaded.current) return;
    loaded.current = true;
    source
      .listRuns()
      .then(async (rs) => {
        setRuns(rs);
        const details = await Promise.all(rs.slice(0, 12).map((r) => source.getRun(r.id).catch(() => null)));
        setBugs(details.flatMap((d) => (d ? d.bugs.map((bug) => ({ runId: d.id, bug })) : [])));
      })
      .catch(() => {});
  }, [open]);

  const go = useCallback(
    (href: string) => () => {
      close();
      router.push(href);
    },
    [close, router],
  );

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [
      { id: 'p-overview', group: 'Pages', title: 'Overview', hint: 'What Nomad does and the headline results', run: go('/') },
      { id: 'p-runs', group: 'Pages', title: 'Runs', hint: 'Every recorded and live exploration', run: go('/runs') },
      { id: 'p-bench', group: 'Pages', title: 'Benchmarks', hint: 'Policies, ranker, healing, sweeps', run: go('/benchmarks') },
      { id: 'p-heal', group: 'Pages', title: 'Self-healing', hint: 'Candidate scores across a redesign', run: go('/healing') },
      {
        id: 'p-target',
        group: 'Pages',
        title: 'Live target: Vayu Pramaan',
        hint: 'Findings on a real deployed site',
        keywords: 'vayu pramaan production release gate',
        run: go('/target'),
      },
    ];
    for (const r of runs) {
      out.push({
        id: `r-${r.id}`,
        group: 'Runs',
        title: `${host(r.target)} · ${r.id}`,
        hint: r.stats ? `${r.stats.bugs} bugs · ${r.stats.states} states · ${r.policy ?? ''}` : r.status,
        keywords: r.policy,
        run: go(`/runs/${encodeURIComponent(r.id)}`),
      });
    }
    const seen = new Set<string>();
    for (const { runId, bug } of bugs) {
      const key = `${bug.signature}`;
      if (seen.has(key)) continue; // the same bug found by several runs: list it once
      seen.add(key);
      out.push({
        id: `b-${runId}-${bug.id}`,
        group: 'Bugs',
        title: bug.title,
        hint: `${bug.id} · ${bug.severity} · ${runId}`,
        keywords: `${bug.type} ${bug.message}`,
        tone: `var(--${bug.severity})`,
        run: go(`/runs/${encodeURIComponent(runId)}/bugs/${bug.id}`),
      });
    }
    out.push({
      id: 'a-theme',
      group: 'Actions',
      title: 'Toggle light and dark theme',
      hint: 'Theme',
      run: () => {
        toggleTheme();
        close();
      },
    });
    out.push({
      id: 'a-demo',
      group: 'Actions',
      title: 'Replay the demo run',
      hint: 'Watch Nomad explore buggy-shop step by step',
      run: go('/runs/demo'),
    });
    if (source.startRun)
      out.push({ id: 'a-new', group: 'Actions', title: 'Start a new run', hint: 'Explore an app from its URL', run: go('/runs?new=1') });
    if (source.mode === 'live')
      out.push({
        id: 'a-docs',
        group: 'Actions',
        title: 'Open API documentation',
        hint: 'OpenAPI',
        run: () => {
          close();
          window.open(`${process.env.NEXT_PUBLIC_API_URL}/docs`, '_blank', 'noopener');
        },
      });
    out.push({
      id: 'a-cli',
      group: 'Actions',
      title: 'Copy the CLI command',
      hint: 'npx nomad scan <url>',
      run: () => {
        navigator.clipboard?.writeText('npm run nomad -- scan http://localhost:4100 --steps 45').catch(() => {});
        close();
      },
    });
    return out;
  }, [runs, bugs, go, close]);

  const results = useMemo(() => {
    if (!query.trim()) return items.filter((i) => i.group !== 'Bugs' || items.indexOf(i) < 40);
    return items
      .map((i) => ({ i, s: Math.max(fuzzy(query, i.title), fuzzy(query, `${i.hint ?? ''} ${i.keywords ?? ''}`) - 30) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 30)
      .map((x) => x.i);
  }, [items, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      results[active]?.run();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const grouped: { group: Group; items: Item[] }[] = [];
  for (const it of results) {
    const g = grouped.find((x) => x.group === it.group);
    if (g) g.items.push(it);
    else grouped.push({ group: it.group, items: [it] });
  }
  const flat = grouped.flatMap((g) => g.items);

  return (
    <div className={p.scrim} onMouseDown={close}>
      <div className={p.dialog} role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className={p.inputRow}>
          <svg
            width="16"
            height="16"
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
          <input
            ref={inputRef}
            id="palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search runs, bugs, pages and actions"
            aria-controls="palette-list"
            aria-activedescendant={flat[active] ? `pi-${flat[active].id}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd>esc</kbd>
        </div>
        <div className={p.list} id="palette-list" role="listbox" ref={listRef}>
          {!flat.length && <div className={p.empty}>No match for “{query}”.</div>}
          {grouped.map((g) => (
            <div key={g.group} role="group" aria-label={g.group}>
              <div className={p.groupLabel}>{g.group}</div>
              {g.items.map((it) => {
                const idx = flat.indexOf(it);
                return (
                  <div
                    key={it.id}
                    id={`pi-${it.id}`}
                    role="option"
                    aria-selected={idx === active}
                    data-active={idx === active || undefined}
                    className={p.item}
                    onMouseMove={() => setActive(idx)}
                    onClick={it.run}
                  >
                    <span className={p.icon} style={it.tone ? { color: it.tone } : undefined}>
                      <Icon group={it.group} />
                    </span>
                    <span className={p.title}>{it.title}</span>
                    {it.hint && <span className={p.hint}>{it.hint}</span>}
                    <span className={p.enter} aria-hidden="true">
                      ↵
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className={p.foot}>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>/</kbd> or <kbd>⌘K</kbd> anywhere
          </span>
        </div>
      </div>
    </div>
  );
}
