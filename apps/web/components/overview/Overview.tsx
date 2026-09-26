'use client';
import type { BugReport, RunDetail, RunEvent, Sweep } from '@nomad/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { highlight } from 'sugar-high';
import { SeverityIcon } from '@/components/ui/primitives';
import type { BenchSummary, HealRow } from '@/lib/bench-types';
import { source } from '@/lib/data';
import { useLoad } from '@/lib/use-load';
import { LiveMap } from './LiveMap';
import { LoopDiagram } from './LoopDiagram';
import { Results } from './Results';
import o from './overview.module.css';

const DEMO = 'demo';
const CLI = 'npm run nomad -- scan http://localhost:4100 --steps 45';
const HEAL_THRESHOLD = 0.62;

interface DemoData {
  run: RunDetail;
  events: RunEvent[];
}

function CopyLine({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className={o.cli}>
      <span className={o.prompt} aria-hidden="true">
        $
      </span>
      <code>{text}</code>
      <button
        className={o.copy}
        onClick={() => {
          navigator.clipboard?.writeText(text).then(
            () => {
              setDone(true);
              setTimeout(() => setDone(false), 1400);
            },
            () => {},
          );
        }}
        aria-label="Copy command"
      >
        {done ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/** Reveals children once scrolled into view (sets data-in on the element). */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.dataset.in = '';
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

function Section({
  kicker,
  title,
  lead,
  children,
  id,
}: {
  kicker: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
  id?: string;
}) {
  const ref = useReveal<HTMLElement>();
  return (
    <section ref={ref} className={o.section} id={id} aria-labelledby={id ? `${id}-title` : undefined}>
      <header className={o.sectionHead}>
        <span className={o.kicker}>{kicker}</span>
        <h2 id={id ? `${id}-title` : undefined}>{title}</h2>
        {lead && <p>{lead}</p>}
      </header>
      {children}
    </section>
  );
}

function Terminal({ run }: { run: RunDetail }) {
  const ref = useReveal<HTMLDivElement>();
  const s = run.stats;
  const sev: Record<BugReport['severity'], string> = { critical: 'crit', major: 'major', minor: 'minor' };
  const lines: { cls?: string; text: React.ReactNode }[] = [
    { cls: o.tCmd, text: `$ ${CLI}` },
    { cls: o.tDim, text: `nomad scan http://localhost:4100  policy hybrid · up to 45 steps · runs/${run.id}` },
    ...run.bugs.slice(0, 6).map((b) => ({
      text: (
        <>
          <span className={o.tDim}>{`  step ${String(b.foundAtStep).padStart(3)}  `}</span>
          {b.id} <span data-sev={b.severity}>{sev[b.severity].padEnd(5)}</span> {b.title}{' '}
          <span className={o.tDim}>
            {b.status} {b.confirmations}
          </span>
        </>
      ),
    })),
    { cls: o.tDim, text: `  … ${Math.max(0, run.bugs.length - 6)} more` },
    ...(s
      ? [
          {
            cls: o.tDone,
            text: `done  ${s.steps} steps  ${s.states} states  ${s.bugs} bugs  ${(s.elapsedMs / 1000).toFixed(1)}s`,
          },
          {
            cls: o.tDim,
            text: `decided by  rules ${s.tierCounts.heuristic} · ranker ${s.tierCounts.ranker} · llm ${s.tierCounts.llm} · fallback ${s.tierCounts.fallback}`,
          },
        ]
      : []),
  ];
  return (
    <div ref={ref} className={o.terminal} role="img" aria-label="Command line output of the recorded demo run">
      <div className={o.termBar}>
        <i />
        <i />
        <i />
        <span>nomad · zsh</span>
      </div>
      <pre>
        {lines.map((l, i) => (
          <span key={i} className={`${o.tLine} ${l.cls ?? ''}`} style={{ animationDelay: `${i * 140}ms` }}>
            {l.text}
          </span>
        ))}
        <span className={o.caret} style={{ animationDelay: `${lines.length * 140}ms` }} />
      </pre>
    </div>
  );
}

function TestPeek({ bug }: { bug: BugReport }) {
  const code = bug.reproScript
    .split('\n')
    .filter((l) => !l.startsWith('//'))
    .join('\n')
    .trim();
  const lines = highlight(code).split('\n').slice(0, 16);
  return (
    <pre className={`code ${o.peek}`}>
      <code>
        {lines.map((l, i) => (
          <span key={i} className={o.peekLine}>
            <span className={o.peekLn}>{i + 1}</span>
            <span dangerouslySetInnerHTML={{ __html: l || ' ' }} />
          </span>
        ))}
      </code>
    </pre>
  );
}

function HealPeek({ row }: { row: HealRow }) {
  return (
    <div className={o.healPeek}>
      <div className={o.healLost}>
        <span className={o.miniLabel}>Lost after redesign</span>
        <span>
          <code>{row.target.role}</code> “{row.target.name}”
        </span>
      </div>
      <div className={o.healRows}>
        {row.candidates.slice(0, 4).map((c) => {
          const picked = c.name === row.picked;
          return (
            <div key={c.name} className={o.healRow} data-picked={picked || undefined}>
              <span className={o.healName}>“{c.name}”</span>
              <span className={o.healTrack}>
                <i style={{ width: `${c.score.total * 100}%` }} />
                <b style={{ left: `${HEAL_THRESHOLD * 100}%` }} />
              </span>
              <span className={`${o.healScore} num`}>{c.score.total.toFixed(2)}</span>
            </div>
          );
        })}
      </div>
      <span className={o.healFoot}>score = 0.62 semantic + 0.18 role + 0.12 context + 0.08 tag · threshold {HEAL_THRESHOLD}</span>
    </div>
  );
}

function SweepPeek({ sweeps }: { sweeps: NonNullable<BenchSummary['sweeps']> }) {
  return (
    <div className={o.sweepPeek}>
      {sweeps.map((s) => (
        <div key={s.label} className={o.sweepRow}>
          <div className={o.sweepHead}>
            <span>{s.label}</span>
            <span className="num">
              {s.fixed} fixed · {s.stillBroken} still broken
            </span>
          </div>
          <div className={o.sweepBar} role="img" aria-label={`${s.label}: ${s.fixed} fixed, ${s.stillBroken} still broken`}>
            {Array.from({ length: s.items }, (_, i) => (
              <i key={i} data-state={i < s.fixed ? 'fixed' : 'broken'} style={{ animationDelay: `${i * 50}ms` }} />
            ))}
          </div>
        </div>
      ))}
      <div className={o.sweepLegend}>
        <span>
          <i data-state="fixed" /> fixed
        </span>
        <span>
          <i data-state="broken" /> still broken
        </span>
        <span className={o.sweepNote}>one cell per bug, each replayed 3× on the build</span>
      </div>
    </div>
  );
}

export function Overview() {
  const demo = useLoad<DemoData>(
    () => Promise.all([source.getRun(DEMO), source.getEvents(DEMO)]).then(([run, events]) => ({ run, events })),
    [],
  );
  const bench = useLoad(() => source.getBenchmarks(), []);
  const heal = useLoad(() => source.getHealBench(), []);
  const sweeps = useLoad<Sweep[]>(() => source.listSweeps(DEMO).catch(() => []), []);

  const run = demo.state === 'ready' ? demo.data.run : null;
  const b = bench.state === 'ready' ? bench.data : null;
  const exampleBug = run?.bugs.find((x) => x.type === 'page_error') ?? run?.bugs[0];
  const healRow =
    heal.state === 'ready' && heal.data
      ? (heal.data.rows.find((r) => r.strategy === 'healed' && r.target.name === 'Add to cart') ??
        heal.data.rows.find((r) => r.strategy === 'healed'))
      : undefined;
  const hasSweeps = sweeps.state === 'ready' && sweeps.data.length > 0;

  return (
    <div className={o.page}>
      <section className={o.hero}>
        <div className={o.heroCopy}>
          <span className={o.eyebrow}>
            <i aria-hidden="true" />
            Autonomous exploratory QA
          </span>
          <h1>
            Finds the bugs your test suite <em>never visits.</em>
          </h1>
          <p className={o.lead}>
            Nomad explores a web app the way a curious user would. Every move is chosen by a three-tier decision cascade, every anomaly is
            replayed three times to confirm it, and every confirmed bug comes back as a minimal Playwright test.
          </p>
          <div className={o.ctas}>
            <Link href={`/runs/${DEMO}`} className="btn btn-signal">
              Replay the demo run
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </Link>
            <Link href="/runs" className="btn">
              Browse runs
            </Link>
            <Link href="/benchmarks" className="btn btn-ghost">
              Benchmarks
            </Link>
          </div>
          <CopyLine text={CLI} />
          <ul className={o.stack} aria-label="Built with">
            {['TypeScript', 'Playwright', 'NestJS', 'PyTorch → ONNX', 'Qwen2.5 on Ollama', 'Next.js'].map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
        <div className={o.heroMap}>
          {demo.state === 'ready' ? (
            <LiveMap runId={DEMO} events={demo.data.events} />
          ) : (
            <div className={`skeleton ${o.mapSkeleton}`} aria-label="Loading the demo run" />
          )}
        </div>
      </section>

      {b && (
        <Section kicker="Measured" title="Numbers from the benchmark suite, not from a slide." id="results">
          <Results bench={b} />
        </Section>
      )}

      <Section
        kicker="How it works"
        title="One loop, run once per step."
        lead="Each step observes the page, decides what to try, acts, checks for anything broken and reports what it can prove."
        id="loop"
      >
        <LoopDiagram />
      </Section>

      <Section kicker="What a run gives you" title="Evidence you can act on." id="outputs">
        <div className={o.cards}>
          <article className={o.card}>
            <div className={o.cardHead}>
              <h3>A test for every bug</h3>
              <p>The path is shortened to the fewest steps that still fail, then written as a standalone spec.</p>
            </div>
            {exampleBug ? <TestPeek bug={exampleBug} /> : <div className="skeleton" style={{ height: 260 }} />}
            {exampleBug && (
              <Link href={`/runs/${DEMO}/bugs/${exampleBug.id}`} className={o.cardLink}>
                <SeverityIcon severity={exampleBug.severity} /> {exampleBug.id} · {exampleBug.title} →
              </Link>
            )}
          </article>
          <article className={o.card}>
            <div className={o.cardHead}>
              <h3>Selectors that survive a redesign</h3>
              <p>When an element disappears, candidates are scored by meaning, role and position on the page.</p>
            </div>
            {healRow ? <HealPeek row={healRow} /> : <div className="skeleton" style={{ height: 220 }} />}
            <Link href="/healing" className={o.cardLink}>
              All {heal.state === 'ready' && heal.data ? heal.data.targets : ''} healing decisions →
            </Link>
          </article>
          <article className={o.card}>
            <div className={o.cardHead}>
              <h3>Regression sweeps</h3>
              <p>Replay every bug of a run against another build and get a verdict for each: fixed, still broken or flaky.</p>
            </div>
            {b?.sweeps?.length ? <SweepPeek sweeps={b.sweeps} /> : <div className="skeleton" style={{ height: 160 }} />}
            <Link href={`/runs/${DEMO}`} className={o.cardLink}>
              {hasSweeps ? 'Sweeps of the demo run →' : 'Open the demo run →'}
            </Link>
          </article>
        </div>
      </Section>

      <Section
        kicker="Quick start"
        title="Point it at a URL."
        lead="Runs locally with Node 20. The ranker and the local model are optional."
        id="start"
      >
        <div className={o.start}>
          <ol className={o.startSteps}>
            <li>
              <b>Install and build</b>
              <code>npm install && npm run build</code>
            </li>
            <li>
              <b>Scan an app</b>
              <code>npm run nomad -- scan &lt;url&gt; --steps 60</code>
            </li>
            <li>
              <b>Gate CI on it</b>
              <code>--fail-on major --min-recall 1</code>
            </li>
            <li>
              <b>Or run everything</b>
              <code>docker compose up --build</code>
            </li>
          </ol>
          {run ? <Terminal run={run} /> : <div className="skeleton" style={{ height: 300 }} />}
        </div>
      </Section>

      <footer className={o.foot}>
        <span>Nomad Loop Engine · MIT License</span>
        <span>© 2026 Lakshay</span>
      </footer>
    </div>
  );
}
