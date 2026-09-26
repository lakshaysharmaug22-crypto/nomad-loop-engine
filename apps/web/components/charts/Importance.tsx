'use client';
import * as d3 from 'd3';
import { useState } from 'react';
import { useWidth } from './use-width';
import c from './charts.module.css';

const PRETTY: Record<string, string> = {
  key_global_use: 'Times already tried',
  target_path_unseen: 'Link leads somewhere new',
  verb_submit: 'Label says submit / search / apply',
  kind_link: 'Is a link',
  has_required_fields: 'Form has required fields',
  kind_form: 'Is a filled form',
  kind_form_empty: 'Is an empty form',
  kind_button: 'Is a button',
  verb_commerce: 'Commerce verb (add, cart, pay)',
  verb_destructive: 'Destructive verb (remove, delete)',
  verb_generic_nav: 'Generic nav (home, about)',
  verb_detail: 'Detail link (view, more)',
  in_nav_or_footer: 'In nav or footer',
  steps_since_new_state: 'Steps since a new state',
  state_visits: 'Visits to this state',
  n_candidates: 'Candidates on the page',
  position: 'Position on the page',
  name_length: 'Label length',
  n_fields: 'Number of form fields',
  target_path_depth: 'Link path depth',
  target_has_query: 'Link has a query string',
};

/** Permutation importance: AUC lost when one feature is shuffled. Bars grow from zero, value at the tip. */
export function Importance({ items, top = 8 }: { items: { feature: string; auc_drop: number }[]; top?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const rows = items.slice(0, top);
  const labelW = Math.min(230, width * 0.45);
  const row = 30;
  const height = rows.length * row + 8;
  const x = d3
    .scaleLinear()
    .domain([0, Math.max(0.01, d3.max(rows, (r) => r.auc_drop) ?? 0.01)])
    .range([0, width - labelW - 56]);
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div ref={ref} className={c.chart}>
      <svg width={width} height={height} role="img" aria-label="Feature importance">
        {rows.map((r, i) => {
          const w = Math.max(2, x(Math.max(0, r.auc_drop)));
          const yy = i * row + 6;
          return (
            <g key={r.feature} onPointerEnter={() => setHover(r.feature)} onPointerLeave={() => setHover(null)}>
              <rect x={0} y={yy - 4} width={width} height={row} fill={hover === r.feature ? 'var(--raised)' : 'transparent'} />
              <text className={c.rowLabel} x={labelW - 10} y={yy + 10} textAnchor="end">
                {PRETTY[r.feature] ?? r.feature}
              </text>
              <path d={`M${labelW},${yy + 2} h${w - 4} a4,4 0 0 1 4,4 v8 a4,4 0 0 1 -4,4 h${-(w - 4)} Z`} fill="var(--t-ranker)" />
              <text className={c.barValue} x={labelW + w + 8} y={yy + 10} dy="0.32em">
                {r.auc_drop.toFixed(3)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
