'use client';
// The hero instrument: the recorded demo run replaying on a loop, paused while off screen.
import type { BugReport, RunEvent } from '@nomad/contracts';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { StateMap } from '@/components/run/StateMap';
import { useReplay } from '@/components/run/use-replay';
import { SeverityIcon, TierChip } from '@/components/ui/primitives';
import o from './overview.module.css';

export function LiveMap({ runId, events }: { runId: string; events: RunEvent[] }) {
  const replay = useReplay(events, { live: false, startAt: 1 });
  const { model, index, total } = replay;
  const hostRef = useRef<HTMLDivElement>(null);
  const ctl = useRef(replay);
  ctl.current = replay;
  const prev = useRef(index);
  const animate = index === prev.current + 1;
  useEffect(() => {
    prev.current = index;
  }, [index]);

  // Reduced motion: show the finished map instead of animating.
  const reduced = useRef(false);
  useEffect(() => {
    reduced.current = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced.current) ctl.current.seek(total);
  }, [total]);

  // Loop: hold the finished map for a moment, then start again.
  useEffect(() => {
    if (reduced.current || index < total) return;
    const id = setTimeout(() => {
      ctl.current.seek(1);
      ctl.current.play();
    }, 2600);
    return () => clearTimeout(id);
  }, [index, total]);

  // Pause while scrolled out of view.
  useEffect(() => {
    const el = hostRef.current;
    if (!el || reduced.current) return;
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? ctl.current.play() : ctl.current.pause()), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const step = model.steps[model.steps.length - 1];
  const lastBug: BugReport | undefined = model.bugs[model.bugs.length - 1];

  return (
    <div ref={hostRef} className={o.liveMap}>
      <StateMap
        runId={runId}
        nodes={model.nodes}
        edges={model.edges}
        bugs={model.bugs}
        current={model.current}
        animate={animate}
        live
        className={o.liveMapInner}
        onSelectState={() => {}}
        footer={
          <div className={o.ticker}>
            <div className={o.tickerRow}>
              <span className={`${o.tickerStep} num`}>{String(step?.step ?? 0).padStart(2, '0')}</span>
              {step ? <TierChip tier={step.decision.tier} small /> : <span className={o.tickerIdle}>starting</span>}
              <span className={o.tickerAction}>{step?.decision.label ?? 'Opening http://localhost:4100'}</span>
            </div>
            <div className={o.tickerRow}>
              <span className={o.tickerBugs}>
                <b className="num">{model.bugs.length}</b> bugs
              </span>
              {lastBug && (
                <span key={lastBug.id} className={o.tickerBug}>
                  <SeverityIcon severity={lastBug.severity} /> {lastBug.title}
                </span>
              )}
              <Link href={`/runs/${runId}`} className={o.tickerLink}>
                Open run →
              </Link>
            </div>
            <div className={o.progress} aria-hidden="true">
              <i style={{ width: `${(index / Math.max(1, total)) * 100}%` }} />
            </div>
          </div>
        }
      />
    </div>
  );
}
