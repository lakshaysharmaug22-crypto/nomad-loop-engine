'use client';
import type { BugReport, GraphEdge, GraphNode } from '@nomad/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { source } from '@/lib/data';
import { MapScene, worstBy } from './map-scene';
import m from './map.module.css';

interface Props {
  runId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  bugs: BugReport[];
  current: string | null;
  /** True when the model advanced by one frame (animate); false after a seek (snap). */
  animate: boolean;
  onSelectState?: (id: string) => void;
  footer?: React.ReactNode;
  live?: boolean;
  /** Hide the HUD and legend (compact embeds such as the overview page). */
  bare?: boolean;
  className?: string;
}

export function StateMap({ runId, nodes, edges, bugs, current, animate, onSelectState, footer, live, bare, className }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const sceneRef = useRef<MapScene | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const worst = useMemo(() => worstBy(bugs), [bugs]);
  const onSelectRef = useRef(onSelectState);
  onSelectRef.current = onSelectState;

  // The scene lives for the component's lifetime; data flows in through update().
  useEffect(() => {
    const scene = new MapScene(svgRef.current!, setHover, (id) => onSelectRef.current?.(id));
    sceneRef.current = scene;
    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(svgRef.current!);
    return () => {
      ro.disconnect();
      scene.destroy();
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.update({ nodes, edges, current, worstSeverity: worst }, animate);
  }, [nodes, edges, current, worst, animate]);

  const node = hover ? nodes.find((n) => n.id === hover.id) : null;
  const nodeBugs = node ? bugs.filter((b) => b.stateId === node.id) : [];
  const here = current ? nodes.find((n) => n.id === current) : null;

  return (
    <section className={`${m.map} ${className ?? ''}`} aria-label="State graph">
      <svg ref={svgRef} className={m.svg} role="img" aria-label={`${nodes.length} states and ${edges.length} transitions explored`} />
      {!bare && (
        <div className={m.hud}>
          <div className={m.hudLeft}>
            <div className={m.hudTitle} data-live={live || undefined}>
              <i aria-hidden="true" />
              {live ? 'Exploring live' : 'State graph'} · <span className="num">{nodes.length}</span> states ·{' '}
              <span className="num">{edges.length}</span> moves
            </div>
            {here && (
              <div className={m.hudCurrent} aria-live="polite">
                {here.path}
                <span>{here.id}</span>
              </div>
            )}
          </div>
          <div className={m.legend} aria-hidden="true">
            <span>
              <b className={m.keyHeuristic} />
              Rules
            </span>
            <span>
              <b className={m.keyRanker} />
              Ranker
            </span>
            <span>
              <b className={m.keyLlm} />
              LLM
            </span>
            <span>
              <b className={m.keyFallback} />
              Fallback
            </span>
          </div>
        </div>
      )}
      {node && hover && (
        <div className={m.tip} style={{ left: hover.x, top: hover.y }} role="tooltip">
          {node.thumb && <img src={source.artifactUrl(runId, node.thumb)} alt="" width={224} height={140} />}
          <div className={m.tipBody}>
            <div className={m.tipPath}>{node.path}</div>
            <div className={m.tipMeta}>
              {node.title} · first seen step {node.firstSeenStep} · visited {node.visits}×
            </div>
            {nodeBugs.map((b) => (
              <div key={b.id} className={m.tipBug}>
                <i style={{ background: `var(--${b.severity})` }} />
                {b.id} {b.title}
              </div>
            ))}
          </div>
        </div>
      )}
      {footer}
    </section>
  );
}
