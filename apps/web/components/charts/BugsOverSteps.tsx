'use client';
import * as d3 from 'd3';
import { useMemo, useState } from 'react';
import type { BenchRun } from '@/lib/bench-types';
import { useWidth } from './use-width';
import c from './charts.module.css';

export interface PolicySeries {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
  runs: BenchRun[];
}

/** Cumulative bugs found by step: median line per policy with a min–max band across its runs. */
export function BugsOverSteps({ series, steps, target }: { series: PolicySeries[]; steps: number; target: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 300;
  const m = { top: 16, right: 92, bottom: 34, left: 40 };
  const x = d3
    .scaleLinear()
    .domain([0, steps])
    .range([m.left, width - m.right]);
  const y = d3
    .scaleLinear()
    .domain([0, target])
    .range([height - m.bottom, m.top]);

  const data = useMemo(
    () =>
      series.map((s) => {
        const curves = s.runs.map((r) => d3.range(steps + 1).map((st) => r.bugSteps.filter((b) => b <= st).length));
        const pts = d3.range(steps + 1).map((st) => {
          const vals = curves.map((cv) => cv[st]).sort((a, b) => a - b);
          return { st, med: d3.median(vals) ?? 0, lo: vals[0] ?? 0, hi: vals[vals.length - 1] ?? 0 };
        });
        return { ...s, pts };
      }),
    [series, steps],
  );

  const line = d3
    .line<{ st: number; med: number }>()
    .x((d) => x(d.st))
    .y((d) => y(d.med))
    .curve(d3.curveStepAfter);
  const band = d3
    .area<{ st: number; lo: number; hi: number }>()
    .x((d) => x(d.st))
    .y0((d) => y(d.lo))
    .y1((d) => y(d.hi))
    .curve(d3.curveStepAfter);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const st = Math.round(x.invert(e.clientX - rect.left + m.left));
    setHover(Math.max(0, Math.min(steps, st)));
  };

  // Direct labels at line ends, nudged apart so they never collide.
  const ends = data.map((d) => ({ key: d.key, label: d.label, y: y(d.pts[steps].med), v: d.pts[steps].med })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 16) ends[i].y = ends[i - 1].y + 16;

  return (
    <div ref={ref} className={c.chart}>
      <div className={c.legend}>
        {series.map((s) => (
          <span key={s.key}>
            <i className={s.dashed ? c.keyDashed : c.keyLine} style={{ borderColor: s.color }} />
            {s.label}
            <em>
              {s.runs.length} run{s.runs.length > 1 ? 's' : ''}
            </em>
          </span>
        ))}
      </div>
      <svg width={width} height={height} role="img" aria-label="Bugs found versus exploration steps for each policy">
        {y.ticks(Math.min(target, 5)).map((t) => (
          <g key={t}>
            <line className={c.grid} x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} />
            <text className={c.tick} x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {x.ticks(6).map((t) => (
          <text key={t} className={c.tick} x={x(t)} y={height - m.bottom + 18} textAnchor="middle">
            {t}
          </text>
        ))}
        <text className={c.axisTitle} x={width - m.right} y={height - 4} textAnchor="end">
          steps
        </text>
        <line className={c.target} x1={m.left} x2={width - m.right} y1={y(target)} y2={y(target)} />
        <text className={c.targetLabel} x={m.left + 4} y={y(target) - 6}>
          all {target} planted bugs
        </text>
        {data.map((d) => (
          <path key={`b-${d.key}`} d={band(d.pts) ?? ''} fill={d.color} opacity={0.1} />
        ))}
        {data.map((d) => (
          <path
            key={`l-${d.key}`}
            d={line(d.pts) ?? ''}
            fill="none"
            stroke={d.color}
            strokeWidth={2}
            strokeDasharray={d.dashed ? '5 4' : undefined}
            strokeLinejoin="round"
          />
        ))}
        {data.map((d) => (
          <circle key={`e-${d.key}`} cx={x(steps)} cy={y(d.pts[steps].med)} r={4} fill={d.color} stroke="var(--panel)" strokeWidth={2} />
        ))}
        {ends.map((e) => (
          <text key={`t-${e.key}`} className={c.endLabel} x={x(steps) + 10} y={e.y} dy="0.32em">
            {e.label} <tspan className={c.endValue}>{e.v}</tspan>
          </text>
        ))}
        {hover !== null && (
          <g pointerEvents="none">
            <line className={c.cross} x1={x(hover)} x2={x(hover)} y1={m.top} y2={height - m.bottom} />
            {data.map((d) => (
              <circle key={d.key} cx={x(hover)} cy={y(d.pts[hover].med)} r={4} fill={d.color} stroke="var(--panel)" strokeWidth={2} />
            ))}
          </g>
        )}
        <rect
          x={m.left}
          y={m.top}
          width={width - m.left - m.right}
          height={height - m.top - m.bottom}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hover !== null && (
        <div className={c.tooltip} style={{ left: Math.min(x(hover) + 12, width - 190), top: 40 }}>
          <div className={c.tooltipHead}>Step {hover}</div>
          {data.map((d) => (
            <div key={d.key} className={c.tooltipRow}>
              <i style={{ background: d.color }} />
              <span>{d.label}</span>
              <b className="num">
                {d.pts[hover].med}
                {d.pts[hover].lo !== d.pts[hover].hi && (
                  <em>
                    {' '}
                    ({d.pts[hover].lo}–{d.pts[hover].hi})
                  </em>
                )}
              </b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
