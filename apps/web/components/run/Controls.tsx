'use client';
import { useEffect } from 'react';
import { Kbd } from '@/components/ui/primitives';
import type { Replay } from './use-replay';
import c from './controls.module.css';

const SPEEDS = [1, 2, 4];

function Icon({ d, fill }: { d: string; fill?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={d}
        fill={fill ? 'currentColor' : 'none'}
        stroke={fill ? 'none' : 'currentColor'}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Controls({ replay, live }: { replay: Replay; live: boolean }) {
  const { index, total, playing } = replay;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        replay.toggle();
      } else if (e.key === 'ArrowRight' || e.key === 'l') replay.stepBy(1);
      else if (e.key === 'ArrowLeft' || e.key === 'j') replay.stepBy(-1);
      else if (e.key === 'Home') replay.seek(0);
      else if (e.key === 'End') replay.seek(total);
      else if (['1', '2', '4'].includes(e.key)) replay.setSpeed(Number(e.key));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [replay, total]);

  const stepNo = replay.model.steps.length;
  const done = index >= total;

  return (
    <div className={c.bar}>
      <div className={c.buttons}>
        <button
          className={`btn ${c.play}`}
          onClick={replay.toggle}
          aria-label={playing ? 'Pause' : done ? 'Replay from the start' : 'Play'}
        >
          {playing ? (
            <Icon d="M5 3.5v9M11 3.5v9" />
          ) : done ? (
            <Icon d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3M3.5 3.5v2.8h2.8" />
          ) : (
            <Icon d="M5 3.2v9.6L12.5 8Z" fill />
          )}
          <span>{playing ? 'Pause' : done ? 'Replay' : 'Play'}</span>
        </button>
        <button className="btn btn-ghost" onClick={() => replay.stepBy(-1)} aria-label="Previous step" disabled={index <= 0}>
          <Icon d="M10 3.5 5.5 8l4.5 4.5" />
        </button>
        <button className="btn btn-ghost" onClick={() => replay.stepBy(1)} aria-label="Next step" disabled={done}>
          <Icon d="M6 3.5 10.5 8 6 12.5" />
        </button>
        <div className={c.speed} role="group" aria-label="Replay speed">
          {SPEEDS.map((s) => (
            <button key={s} aria-pressed={replay.speed === s} onClick={() => replay.setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
      </div>

      <div className={c.scrub}>
        <div className={c.track}>
          <input
            type="range"
            min={0}
            max={total}
            value={index}
            onChange={(e) => replay.seek(Number(e.target.value))}
            aria-label="Replay position"
            aria-valuetext={`Step ${stepNo} of ${replay.totalSteps}`}
          />
          <div className={c.marks} aria-hidden="true">
            {replay.bugMarks.map((m) => (
              <i
                key={m.bug.id}
                title={`${m.bug.id} ${m.bug.title}`}
                style={{ left: `${(m.index / Math.max(1, total)) * 100}%`, background: `var(--${m.bug.severity})` }}
                data-past={m.index <= index || undefined}
              />
            ))}
          </div>
        </div>
        <output className={`${c.pos} num`}>
          {live && replay.following ? <span className={c.live}>Live</span> : null}
          {stepNo}
          <span> / {replay.totalSteps}</span>
        </output>
      </div>

      <div className={c.keys} aria-hidden="true">
        <Kbd>Space</Kbd> play <Kbd>←</Kbd>
        <Kbd>→</Kbd> step <Kbd>1</Kbd>
        <Kbd>2</Kbd>
        <Kbd>4</Kbd> speed
      </div>
    </div>
  );
}
