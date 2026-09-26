'use client';
import type { GraphNode, RunDetail, RunEvent, Sweep } from '@nomad/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { ErrorState, PageHeader, SeverityIcon, Stat, StatusPill, TierChip, VerdictChip } from '@/components/ui/primitives';
import { source } from '@/lib/data';
import { ANOMALY_LABEL, duration, host, pathOf, relativeTime } from '@/lib/format';
import { Controls } from './Controls';
import { DecisionTrace } from './DecisionTrace';
import { StateMap } from './StateMap';
import { useReplay, type StepEvent } from './use-replay';
import r from './run.module.css';

type Tab = 'bugs' | 'steps' | 'sweeps';

export function RunView({ id }: { id: string }) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [events, setEvents] = useState<RunEvent[] | null>(null);
  const [sweeps, setSweeps] = useState<Sweep[]>([]);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([source.getRun(id), source.getEvents(id), source.listSweeps(id).catch(() => [])]).then(
      ([run, ev, sw]) => {
        if (!alive) return;
        setRun(run);
        setEvents(ev);
        setSweeps(sw);
      },
      (e: Error) => alive && setError(e),
    );
    return () => {
      alive = false;
    };
  }, [id]);

  // Live runs: append streamed events after the ones already loaded over REST.
  const isLive = source.mode === 'live' && (run?.status === 'running' || run?.status === 'queued');
  const loaded = useRef(0);
  loaded.current = events?.length ?? 0;
  useEffect(() => {
    if (!isLive || !source.liveUrl) return;
    const socket = io(source.liveUrl, { transports: ['websocket'] });
    socket.on('connect', () => socket.emit('subscribe', id));
    socket.on('run-event', (m: { seq: number; event: RunEvent }) => {
      if (m.seq < loaded.current) return;
      setEvents((prev) => (prev ? [...prev, m.event] : [m.event]));
      if (m.event.t === 'run_finished') source.getRun(id).then(setRun);
    });
    return () => {
      socket.close();
    };
  }, [id, isLive]);

  if (error)
    return (
      <ErrorState
        error={error}
        action={
          <Link href="/runs" className="btn">
            Back to runs
          </Link>
        }
      />
    );
  if (!run || !events) return <RunSkeleton />;
  return <RunLoaded run={run} events={events} sweeps={sweeps} live={isLive} />;
}

function RunLoaded({ run, events, sweeps, live }: { run: RunDetail; events: RunEvent[]; sweeps: Sweep[]; live: boolean }) {
  const replay = useReplay(events, { live });
  const { model } = replay;
  const [tab, setTab] = useState<Tab>('bugs');
  const prevIndex = useRef(replay.index);
  const animate = replay.index === prevIndex.current + 1;
  useEffect(() => {
    prevIndex.current = replay.index;
  }, [replay.index]);

  const step = model.steps[model.steps.length - 1] ?? null;
  const heal = step ? model.heals.find((h) => h.step === step.step) : undefined;
  const stats = model.stats ?? run.stats;
  const started = events.find((e): e is Extract<RunEvent, { t: 'run_started' }> => e.t === 'run_started');
  const finalStats = run.stats;
  const onSelectState = useCallback(
    (stateId: string) => {
      const s = model.steps.find((x) => x.stateId === stateId);
      if (s) replay.seek(s.step);
    },
    [model.steps, replay],
  );

  return (
    <div className={r.page}>
      <PageHeader
        crumbs={[{ label: 'Runs', href: '/runs' }, { label: run.id }]}
        title={host(run.target)}
        meta={
          <>
            <StatusPill status={live ? 'running' : run.status} />
            <span>
              Policy <code>{run.policy ?? started?.policy ?? '—'}</code>
            </span>
            {started?.embedder && (
              <span>
                Embeddings <code>{started.embedder}</code>
              </span>
            )}
            <span>{relativeTime(run.createdAt || started?.at || 0)}</span>
          </>
        }
        actions={
          live && source.stopRun ? (
            <button className="btn" onClick={() => source.stopRun!(run.id)}>
              Stop run
            </button>
          ) : null
        }
      />

      <div className={r.stats}>
        <Stat label="States" value={stats?.states ?? 0} />
        <Stat label="Transitions" value={stats?.edges ?? 0} />
        <Stat
          label="Bugs"
          value={model.bugs.length}
          accent={model.bugs.length > 0}
          hint={finalStats ? `${finalStats.bugs} in the full run` : undefined}
        />
        <Stat label="Confirmed" value={model.bugs.filter((b) => b.status === 'confirmed').length} hint="reproduced in ≥ 2 of 3 replays" />
        <Stat label="Step p95" value={duration(finalStats?.stepP95Ms)} hint={`p50 ${duration(finalStats?.stepP50Ms)}`} />
        <Stat label="LLM calls" value={stats?.llmCalls ?? 0} hint={`${finalStats?.steps ?? 0} steps total`} />
      </div>

      <div className={r.grid}>
        <div className={r.mapCol}>
          <StateMap
            runId={run.id}
            nodes={model.nodes}
            edges={model.edges}
            bugs={model.bugs}
            current={model.current}
            animate={animate}
            onSelectState={onSelectState}
            live={live}
            footer={<Controls replay={replay} live={live} />}
          />
        </div>
        <DecisionTrace step={step} heal={heal} />
      </div>

      <div className={r.tabs} role="tablist" aria-label="Run details">
        {(
          [
            ['bugs', `Bugs`, model.bugs.length],
            ['steps', 'Step log', model.steps.length],
            ['sweeps', 'Regression sweeps', sweeps.length],
          ] as const
        ).map(([k, label, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={r.tab} onClick={() => setTab(k)}>
            {label} <span className="num">{n}</span>
          </button>
        ))}
      </div>

      {tab === 'bugs' && <BugList runId={run.id} bugs={model.bugs} total={run.bugs.length} />}
      {tab === 'steps' && <StepLog steps={model.steps} nodes={model.nodes} onSeek={(s) => replay.seek(s)} current={step?.step} />}
      {tab === 'sweeps' && <SweepList sweeps={sweeps} runId={run.id} />}
    </div>
  );
}

function BugList({ runId, bugs, total }: { runId: string; bugs: RunDetail['bugs']; total: number }) {
  if (!bugs.length)
    return (
      <p className={r.empty}>{total ? `No bugs yet at this point of the replay. ${total} appear later.` : 'No bugs found in this run.'}</p>
    );
  return (
    <ul className={r.bugs}>
      {[...bugs].reverse().map((b) => (
        <li key={b.id}>
          <Link
            href={`/runs/${encodeURIComponent(runId)}/bugs/${b.id}`}
            className={r.bug}
            style={{ ['--sev' as string]: `var(--${b.severity})` }}
          >
            <span className={r.bugId}>
              <SeverityIcon severity={b.severity} /> {b.id}
            </span>
            <span className={r.bugTitle}>{b.title}</span>
            <span className={r.bugMeta}>
              {ANOMALY_LABEL[b.type]} · step {b.foundAtStep}
            </span>
            <VerdictChip verdict={b.status} />
            <span className={r.bugConf}>{b.confirmations}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function StepLog({
  steps,
  nodes,
  onSeek,
  current,
}: {
  steps: StepEvent[];
  nodes: GraphNode[];
  onSeek: (s: number) => void;
  current?: number;
}) {
  const pathById = useMemo(() => new Map(nodes.map((n) => [n.id, n.path])), [nodes]);
  if (!steps.length) return <p className={r.empty}>No steps yet.</p>;
  return (
    <div className={r.logWrap}>
      <table className={r.log}>
        <thead>
          <tr>
            <th scope="col">Step</th>
            <th scope="col">Decided by</th>
            <th scope="col">Action</th>
            <th scope="col">Landed on</th>
            <th scope="col" className={r.right}>
              Time
            </th>
          </tr>
        </thead>
        <tbody>
          {[...steps].reverse().map((s) => (
            <tr
              key={s.step}
              data-current={s.step === current || undefined}
              onClick={() => onSeek(s.step)}
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onSeek(s.step)}
            >
              <td className="num">{s.step}</td>
              <td>
                <TierChip tier={s.decision.tier} small />
              </td>
              <td className={r.logAction}>{s.decision.label}</td>
              <td className={r.logPath}>{pathById.get(s.stateId) ?? '—'}</td>
              <td className={`${r.right} num`}>{duration(s.durationMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SweepList({ sweeps, runId }: { sweeps: Sweep[]; runId: string }) {
  if (!sweeps.length)
    return (
      <p className={r.empty}>No sweeps yet. A sweep replays every bug of this run against another build, such as a fix or a redesign.</p>
    );
  return (
    <div className={r.sweeps}>
      {sweeps.map((s) => {
        const broken = s.items.filter((i) => i.verdict === 'still broken').length;
        const fixed = s.items.filter((i) => i.verdict === 'fixed').length;
        const healed = s.items.flatMap((i) => i.heals).filter((h) => h.strategy === 'healed').length;
        return (
          <article key={s.id} className={r.sweep}>
            <header>
              <h3>{s.label ?? host(s.target)}</h3>
              <span className={r.sweepMeta}>
                {host(s.target)} · {fixed} fixed · {broken} still broken
                {healed ? ` · ${healed} selector${healed > 1 ? 's' : ''} healed` : ''}
              </span>
            </header>
            <ul>
              {s.items.map((i) => (
                <li key={i.bugId}>
                  <Link href={`/runs/${encodeURIComponent(runId)}/bugs/${i.bugId}`}>
                    <span className={r.bugId}>
                      <SeverityIcon severity={i.severity} /> {i.bugId}
                    </span>
                    <span className={r.sweepTitle}>{i.title}</span>
                  </Link>
                  <span className={r.sweepPath}>{pathOf(i.replayedOn)}</span>
                  {i.heals.some((h) => h.strategy === 'healed') && <span className={r.healTag}>healed</span>}
                  <VerdictChip verdict={i.verdict} />
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </div>
  );
}

function RunSkeleton() {
  return (
    <div className={r.page} aria-busy="true">
      <div className="skeleton" style={{ height: 34, width: 320 }} />
      <div className="skeleton" style={{ height: 64 }} />
      <div className={r.grid}>
        <div className="skeleton" style={{ height: 520 }} />
        <div className="skeleton" style={{ height: 520 }} />
      </div>
    </div>
  );
}
