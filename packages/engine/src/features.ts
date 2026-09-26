// Feature vector for the Tier 2 action ranker.
// This file is the single source of truth: the engine logs these vectors with outcome labels
// during runs, the Python trainer learns from those logs, and inference sends the same vectors.
import { hrefPath } from './actions';
import type { StateGraph } from './graph';
import type { Action, StateSnapshot } from '@nomad/contracts';

export const FEATURE_NAMES = [
  'kind_link',
  'kind_button',
  'kind_form',
  'kind_form_empty',
  'target_path_unseen',
  'target_path_depth',
  'target_has_query',
  'in_nav_or_footer',
  'name_length',
  'verb_commerce',
  'verb_submit',
  'verb_destructive',
  'verb_generic_nav',
  'verb_detail',
  'n_fields',
  'has_required_fields',
  'key_global_use',
  'state_visits',
  'steps_since_new_state',
  'position',
  'n_candidates',
] as const;

export const FEATURE_VERSION = 1;

const has = (re: RegExp, s: string) => (re.test(s) ? 1 : 0);
const cap = (x: number) => Math.min(1, Math.max(0, x));

export interface FeatureContext {
  state: StateSnapshot;
  graph: StateGraph;
  stateVisits: number;
  stepsSinceNewState: number;
}

export function featurize(a: Action, i: number, all: Action[], ctx: FeatureContext): number[] {
  const name = (a.target?.name || a.label).toLowerCase();
  const path = a.kind === 'click' && a.target?.role === 'link' ? hrefPath(a.target.href) : '';
  const cleanPath = path.split('?')[0];
  const f = [
    a.kind === 'click' && a.target?.role === 'link' ? 1 : 0,
    a.kind === 'click' && a.target?.role !== 'link' ? 1 : 0,
    a.kind === 'fill_submit' ? 1 : 0,
    a.kind === 'fill_submit_empty' ? 1 : 0,
    path && !ctx.graph.seenPaths.has(path) ? 1 : 0,
    cap(cleanPath.split('/').filter(Boolean).length / 4),
    path.includes('?') ? 1 : 0,
    a.target?.inNav ? 1 : 0,
    cap(name.length / 40),
    has(/add|cart|bag|buy|checkout|order|pay|coupon|redeem/, name),
    has(/submit|apply|subscribe|search|find|log ?in|sign/, name),
    has(/remove|delete|clear|cancel|log ?out/, name),
    has(/^(home|about|back|contact)\b/, name),
    has(/detail|view|more/, name),
    cap((a.fields?.length || 0) / 5),
    a.fields?.some((x) => x.required) ? 1 : 0,
    cap((ctx.graph.globalKeyUse.get(a.key) || 0) / 5),
    cap(ctx.stateVisits / 10),
    cap(ctx.stepsSinceNewState / 10),
    all.length > 1 ? i / (all.length - 1) : 0,
    cap(all.length / 40),
  ];
  return f;
}
