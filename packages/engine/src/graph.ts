// State graph: every distinct UI state is a node, every executed action is an edge.
// Tracks which actions were tried from each state so the explorer never repeats itself.
import type { Action, GraphEdge, GraphNode, StateSnapshot, Tier } from '@nomad/contracts';

export class StateGraph {
  readonly nodes = new Map<string, GraphNode>();
  readonly edges: GraphEdge[] = [];
  private readonly tried = new Map<string, Set<string>>();
  private readonly untriedCount = new Map<string, number>();
  private readonly edgeKeys = new Set<string>();
  /** How many times an action key was executed anywhere (label-level novelty signal). */
  readonly globalKeyUse = new Map<string, number>();
  /** Every URL path ever loaded, for the "leads somewhere new" signal. */
  readonly seenPaths = new Set<string>();

  has(id: string) {
    return this.nodes.has(id);
  }

  /** Adds the state if new. Returns the node and whether it was created. */
  upsert(s: StateSnapshot, step: number): { node: GraphNode; created: boolean } {
    this.seenPaths.add(new URL(s.url).pathname + new URL(s.url).search);
    const existing = this.nodes.get(s.fingerprint);
    if (existing) {
      existing.visits += 1;
      return { node: existing, created: false };
    }
    const node: GraphNode = { id: s.fingerprint, url: s.url, path: s.path, title: s.title, firstSeenStep: step, visits: 1, bugCount: 0 };
    this.nodes.set(node.id, node);
    this.tried.set(node.id, new Set());
    return { node, created: true };
  }

  markTried(stateId: string, a: Action) {
    this.tried.get(stateId)?.add(a.key);
    this.globalKeyUse.set(a.key, (this.globalKeyUse.get(a.key) || 0) + 1);
  }

  wasTried(stateId: string, a: Action) {
    return this.tried.get(stateId)?.has(a.key) ?? false;
  }

  setUntried(stateId: string, n: number) {
    this.untriedCount.set(stateId, n);
  }

  /** Adds an edge unless the same transition already exists. Returns the edge if it was new. */
  addEdge(from: string, to: string, a: Action, tier: Tier, step: number): GraphEdge | null {
    const k = `${from}|${to}|${a.key}`;
    if (this.edgeKeys.has(k)) return null;
    this.edgeKeys.add(k);
    const e: GraphEdge = { from, to, actionKey: a.key, label: a.label, tier, step };
    this.edges.push(e);
    return e;
  }

  /** States that still have untried actions, closest-to-root first. */
  frontier(exclude?: string): GraphNode[] {
    return [...this.nodes.values()]
      .filter((n) => n.id !== exclude && (this.untriedCount.get(n.id) ?? 1) > 0)
      .sort((a, b) => a.firstSeenStep - b.firstSeenStep);
  }

  /** Shortest chain of edges from root to a state (used for human-readable repro steps). */
  pathTo(target: string, root: string): GraphEdge[] {
    if (target === root) return [];
    const prev = new Map<string, GraphEdge>();
    const queue = [root];
    const seen = new Set([root]);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of this.edges) {
        if (e.from !== cur || seen.has(e.to)) continue;
        seen.add(e.to);
        prev.set(e.to, e);
        if (e.to === target) {
          const chain: GraphEdge[] = [];
          let n = target;
          while (n !== root) {
            const pe = prev.get(n)!;
            chain.unshift(pe);
            n = pe.from;
          }
          return chain;
        }
        queue.push(e.to);
      }
    }
    return [];
  }

  toJSON() {
    return { nodes: [...this.nodes.values()], edges: this.edges };
  }
}
