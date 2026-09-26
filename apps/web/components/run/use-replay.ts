'use client';
// Replay model: groups a run's event log into frames (one per exploration step) and derives the
// visible state at any frame. Recorded and live runs use the same model; live events append frames.
import type { BugReport, GraphEdge, GraphNode, HealEvent, RunEvent, RunStats } from '@nomad/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type StepEvent = Extract<RunEvent, { t: 'step' }>;

export interface ReplayModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  bugs: BugReport[];
  heals: HealEvent[];
  steps: StepEvent[];
  stats: RunStats | null;
  current: string | null;
  /** Events of the frame just applied (drives animations). */
  fresh: RunEvent[];
  finished: boolean;
}

export function toFrames(events: RunEvent[]): RunEvent[][] {
  const frames: RunEvent[][] = [[]];
  for (const e of events) {
    const f = frames[frames.length - 1];
    f.push(e);
    // A step's own stats event follows it; close the frame there so counters match the step shown.
    if (e.t === 'stats' && f.some((x) => x.t === 'step')) frames.push([]);
  }
  if (!frames[frames.length - 1].length && frames.length > 1) frames.pop();
  return frames;
}

export function buildModel(frames: RunEvent[][], upto: number): ReplayModel {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const bugs: BugReport[] = [];
  const heals: HealEvent[] = [];
  const steps: StepEvent[] = [];
  let stats: RunStats | null = null;
  let current: string | null = null;
  let finished = false;
  for (let i = 0; i < Math.min(upto, frames.length); i++) {
    for (const e of frames[i]) {
      switch (e.t) {
        case 'node_added':
          nodes.set(e.node.id, { ...e.node, visits: 1, bugCount: 0 });
          if (!current) current = e.node.id;
          break;
        case 'edge_added':
          edges.push(e.edge);
          break;
        case 'bug': {
          bugs.push(e.bug);
          const n = nodes.get(e.bug.stateId);
          if (n) n.bugCount++;
          break;
        }
        case 'heal':
          heals.push(e.heal);
          break;
        case 'step': {
          steps.push(e);
          const n = nodes.get(e.stateId);
          if (n && e.from !== e.stateId) n.visits++;
          current = e.stateId;
          break;
        }
        case 'stats':
          stats = e.stats;
          break;
        case 'run_finished':
          stats = e.stats;
          finished = true;
          break;
      }
    }
  }
  return {
    nodes: [...nodes.values()],
    edges,
    bugs,
    heals,
    steps,
    stats,
    current,
    fresh: upto > 0 ? (frames[upto - 1] ?? []) : [],
    finished,
  };
}

export interface Replay {
  model: ReplayModel;
  index: number;
  total: number;
  playing: boolean;
  speed: number;
  following: boolean;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(i: number): void;
  stepBy(d: number): void;
  setSpeed(s: number): void;
  /** Exploration steps in the whole run (frames also hold setup and teardown events). */
  totalSteps: number;
  /** Frame index at which each bug appears (for scrubber markers). */
  bugMarks: { index: number; bug: BugReport }[];
}

const BASE_MS = 1100;

export function useReplay(events: RunEvent[], opts: { live: boolean; startAt?: number }): Replay {
  const frames = useMemo(() => toFrames(events), [events]);
  const total = frames.length;
  const totalSteps = useMemo(() => events.filter((e) => e.t === 'step').length, [events]);
  const [index, setIndex] = useState(() => (opts.live ? total : Math.min(total, opts.startAt ?? Math.max(1, Math.round(total / 3)))));
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(2);
  const [following, setFollowing] = useState(opts.live);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  // Live runs: when new frames arrive while we are at the end, follow them.
  useEffect(() => {
    if (following) setIndex((i) => (i >= total - 2 ? total : i));
  }, [total, following]);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!playing || index >= total) return;
    timer.current = setTimeout(() => setIndex((i) => Math.min(total, i + 1)), BASE_MS / speed);
    return () => clearTimeout(timer.current);
  }, [playing, index, total, speed]);

  const model = useMemo(() => buildModel(frames, index), [frames, index]);

  const bugMarks = useMemo(() => {
    const out: { index: number; bug: BugReport }[] = [];
    frames.forEach((f, i) => f.forEach((e) => e.t === 'bug' && out.push({ index: i + 1, bug: e.bug })));
    return out;
  }, [frames]);

  const seek = useCallback(
    (i: number) => {
      const v = Math.max(0, Math.min(total, i));
      setIndex(v);
      setFollowing(opts.live && v >= total);
    },
    [total, opts.live],
  );

  return {
    model,
    index,
    total,
    playing: playing && index < total,
    speed,
    following,
    play: () => {
      if (index >= total) setIndex(1);
      setPlaying(true);
    },
    pause: () => setPlaying(false),
    toggle: () => {
      if (playing && index < total) setPlaying(false);
      else {
        if (index >= total) setIndex(1);
        setPlaying(true);
      }
    },
    seek: (i) => {
      setPlaying(false);
      seek(i);
    },
    stepBy: (d) => {
      setPlaying(false);
      seek(index + d);
    },
    setSpeed,
    totalSteps,
    bugMarks,
  };
}
