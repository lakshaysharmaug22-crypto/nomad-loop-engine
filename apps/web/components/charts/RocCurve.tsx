'use client';
import * as d3 from 'd3';
import { useState } from 'react';
import { useWidth } from './use-width';
import c from './charts.module.css';

/** ROC curve on held-out runs with the chance diagonal. Single series: the title names it. */
export function RocCurve({
  points,
  auc,
  baseline,
}: {
  points: [number, number][];
  auc: number;
  baseline: { feature: string; test_auc: number };
}) {
  const [ref, width] = useWidth<HTMLDivElement>(360);
  const size = Math.min(width, 380);
  const m = { top: 12, right: 12, bottom: 34, left: 48 };
  const x = d3
    .scaleLinear()
    .domain([0, 1])
    .range([m.left, size - m.right]);
  const y = d3
    .scaleLinear()
    .domain([0, 1])
    .range([size - m.bottom, m.top]);
  const pts = [[0, 0], ...points, [1, 1]] as [number, number][];
  const line = d3
    .line<[number, number]>()
    .x((d) => x(d[0]))
    .y((d) => y(d[1]));
  const [hover, setHover] = useState<number | null>(null);

  return (
    <div ref={ref} className={c.chart}>
      <svg width={size} height={size} role="img" aria-label={`ROC curve, area ${auc.toFixed(3)}`}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line className={c.grid} x1={m.left} x2={size - m.right} y1={y(t)} y2={y(t)} />
            <text className={c.tick} x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
              {t}
            </text>
            <text className={c.tick} x={x(t)} y={size - m.bottom + 18} textAnchor="middle">
              {t}
            </text>
          </g>
        ))}
        <text className={c.axisTitle} x={size - m.right} y={size - 4} textAnchor="end">
          false positive rate
        </text>
        <text className={c.axisTitle} transform={`translate(12,${(m.top + size - m.bottom) / 2}) rotate(-90)`} textAnchor="middle">
          true positive rate
        </text>
        <line className={c.chance} x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} />
        <path d={line(pts) ?? ''} fill="none" stroke="var(--t-ranker)" strokeWidth={2} strokeLinejoin="round" />
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={x(p[0])}
            cy={y(p[1])}
            r={hover === i ? 5 : 9}
            fill={hover === i ? 'var(--t-ranker)' : 'transparent'}
            stroke={hover === i ? 'var(--panel)' : 'none'}
            strokeWidth={2}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
          />
        ))}
        <text className={c.bigLabel} x={x(0.42)} y={y(0.2)}>
          AUC {auc.toFixed(3)}
        </text>
        <text className={c.tick} x={x(0.42)} y={y(0.2) + 18}>
          best single feature {baseline.test_auc.toFixed(2)}
        </text>
      </svg>
      {hover !== null && (
        <div className={c.tooltip} style={{ left: Math.min(x(pts[hover][0]) + 10, size - 150), top: y(pts[hover][1]) - 20 }}>
          <div className={c.tooltipRow}>
            <span>True positives</span>
            <b className="num">{(pts[hover][1] * 100).toFixed(0)}%</b>
          </div>
          <div className={c.tooltipRow}>
            <span>False positives</span>
            <b className="num">{(pts[hover][0] * 100).toFixed(0)}%</b>
          </div>
        </div>
      )}
    </div>
  );
}
