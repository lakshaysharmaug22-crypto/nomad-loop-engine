// Imperative D3 scene for the state map. React owns the data; this class owns the simulation,
// the flowing edges and the reticle, so frames can animate without re-rendering React.
import * as d3 from 'd3';
import type { GraphEdge, GraphNode, Severity, Tier } from '@nomad/contracts';

type SimNode = d3.SimulationNodeDatum & { id: string; path: string; visits: number; bugCount: number; sev: Severity | null; root: boolean };
type SimLink = d3.SimulationLinkDatum<SimNode> & { key: string; tier: Tier; step: number };

export interface SceneInput {
  nodes: GraphNode[];
  edges: GraphEdge[];
  current: string | null;
  worstSeverity: Map<string, Severity>;
}

const SEV_RANK: Record<Severity, number> = { critical: 3, major: 2, minor: 1 };
export const worstBy = (items: { stateId: string; severity: Severity }[]) => {
  const m = new Map<string, Severity>();
  for (const b of items) {
    const cur = m.get(b.stateId);
    if (!cur || SEV_RANK[b.severity] > SEV_RANK[cur]) m.set(b.stateId, b.severity);
  }
  return m;
};

export class MapScene {
  private readonly svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly world: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly edgeG: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly flowG: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly reticle: d3.Selection<SVGGElement, unknown, null, undefined>;
  private reticlePos: { x: number; y: number } | null = null;
  private readonly rippleG: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly nodeG: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly traveler: d3.Selection<SVGGElement, unknown, null, undefined>;
  private readonly sim: d3.Simulation<SimNode, SimLink>;
  private readonly nodes: SimNode[] = [];
  private readonly byId = new Map<string, SimNode>();
  private links: SimLink[] = [];
  private current: string | null = null;
  private hovered: string | null = null;
  private freshEdge: string | null = null;
  private W = 0;
  private H = 0;
  private view = { k: 1, x: 0, y: 0 };
  private trip: { a: SimNode; b: SimNode; t0: number; ms: number } | null = null;
  private timer: d3.Timer | null = null;
  private readonly reduced: boolean;

  constructor(
    private readonly el: SVGSVGElement,
    private readonly onHover: (n: { id: string; x: number; y: number } | null) => void,
    private readonly onSelect: (id: string) => void,
  ) {
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.svg = d3.select(el);
    this.svg.selectAll('*').remove();
    this.world = this.svg.append('g');
    this.edgeG = this.world.append('g');
    this.flowG = this.world.append('g').attr('class', 'flows');
    this.rippleG = this.world.append('g');
    this.reticle = this.world.append('g').attr('class', 'reticle').attr('opacity', 0);
    const spin = this.reticle.append('g').attr('class', 'spin');
    spin.append('circle').attr('r', 17);
    for (const a of [0, 90, 180, 270])
      this.reticle
        .append('line')
        .attr('class', 'tick')
        .attr('x1', 0)
        .attr('y1', -21)
        .attr('x2', 0)
        .attr('y2', -26)
        .attr('transform', `rotate(${a})`);
    this.nodeG = this.world.append('g');
    this.traveler = this.world.append('g').attr('class', 'traveler').attr('opacity', 0);
    this.traveler
      .append('rect')
      .attr('x', -5)
      .attr('y', -5)
      .attr('width', 10)
      .attr('height', 10)
      .attr('rx', 2)
      .attr('transform', 'rotate(45)');

    this.sim = d3
      .forceSimulation<SimNode, SimLink>(this.nodes)
      .force(
        'link',
        d3
          .forceLink<SimNode, SimLink>([])
          .id((d) => d.id)
          .distance(64)
          .strength(0.5),
      )
      .force('charge', d3.forceManyBody().strength(-280))
      .force('collide', d3.forceCollide(30))
      .force('x', d3.forceX(0).strength(0.05))
      .force('y', d3.forceY(0).strength(0.05))
      .alphaDecay(0.03)
      .on('tick', () => this.render());
    this.resize();
  }

  destroy() {
    this.sim.stop();
    this.timer?.stop();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    this.W = r.width;
    this.H = r.height;
    this.svg.attr('viewBox', `0 0 ${this.W} ${this.H}`);
    const ratio = this.H / Math.max(1, this.W);
    (this.sim.force('x') as d3.ForceX<SimNode>).strength(0.05 * Math.max(0.6, ratio));
    (this.sim.force('y') as d3.ForceY<SimNode>).strength(0.05 / Math.max(0.6, ratio));
    this.render();
  }

  update(input: SceneInput, animate: boolean) {
    const seen = new Set<string>();
    for (const n of input.nodes) {
      seen.add(n.id);
      let d = this.byId.get(n.id);
      if (!d) {
        const anchor = (this.current && this.byId.get(this.current)) || this.nodes[0];
        d = {
          id: n.id,
          path: n.path,
          visits: n.visits,
          bugCount: n.bugCount,
          sev: null,
          root: this.nodes.length === 0,
          x: anchor ? (anchor.x ?? 0) + (Math.random() - 0.5) * 30 : 0,
          y: anchor ? (anchor.y ?? 0) + (Math.random() - 0.5) * 30 : 0,
        };
        this.nodes.push(d);
        this.byId.set(d.id, d);
        if (animate) this.ripple(d, 'var(--signal)', false);
      }
      const prevBugs = d.bugCount;
      d.visits = n.visits;
      d.bugCount = n.bugCount;
      d.sev = input.worstSeverity.get(n.id) ?? null;
      if (animate && n.bugCount > prevBugs && d.sev) this.ripple(d, `var(--${d.sev})`, true);
    }
    // Seeking backwards: drop nodes that do not exist yet at this frame.
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      if (!seen.has(this.nodes[i].id)) {
        this.byId.delete(this.nodes[i].id);
        this.nodes.splice(i, 1);
      }
    }
    const keys = new Set<string>();
    this.links = [];
    for (const e of input.edges) {
      if (e.from === e.to) continue;
      const key = `${e.from}>${e.to}`;
      if (keys.has(key) || !this.byId.has(e.from) || !this.byId.has(e.to)) continue;
      keys.add(key);
      this.links.push({ key, source: e.from, target: e.to, tier: e.tier, step: e.step });
    }
    const last = input.edges[input.edges.length - 1];
    this.freshEdge = animate && last ? `${last.from}>${last.to}` : null;

    const prev = this.current;
    this.current = input.current;
    this.sim.nodes(this.nodes);
    (this.sim.force('link') as d3.ForceLink<SimNode, SimLink>).links(this.links);
    this.sim.alpha(animate ? Math.max(this.sim.alpha(), 0.35) : 0.7).restart();
    if (animate) this.render();
    if (animate && prev && input.current && prev !== input.current) this.travel(prev, input.current, 700);
    if (!animate) {
      this.trip = null;
      this.traveler.attr('opacity', 0);
      for (let i = 0; i < 60; i++) this.sim.tick(); // settle instantly when seeking
      this.reticlePos = null;
      this.render(true);
    }
  }

  setHovered(id: string | null) {
    this.hovered = id;
    this.render();
  }

  private travel(from: string, to: string, ms: number) {
    const a = this.byId.get(from);
    const b = this.byId.get(to);
    if (!a || !b || this.reduced) return;
    this.trip = { a, b, t0: performance.now(), ms };
    this.traveler.attr('opacity', 1);
    // Animate only while a trip is in flight; no idle frame loop.
    this.timer?.stop();
    this.timer = d3.timer(() => {
      this.moveTraveler();
      if (!this.trip) {
        this.timer?.stop();
        this.timer = null;
      }
    });
  }

  private moveTraveler() {
    if (!this.trip) return;
    const p = Math.min(1, (performance.now() - this.trip.t0) / this.trip.ms);
    const e = d3.easeCubicInOut(p);
    const { a, b } = this.trip;
    const x = (a.x ?? 0) + ((b.x ?? 0) - (a.x ?? 0)) * e;
    const y = (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * e;
    this.traveler.attr('transform', `translate(${x},${y})`);
    if (p >= 1) {
      this.trip = null;
      this.traveler.transition().duration(250).attr('opacity', 0);
    }
  }

  private ripple(node: SimNode, color: string, big: boolean) {
    if (this.reduced) return;
    const c = this.rippleG
      .append('circle')
      .datum(node)
      .attr('class', 'ripple')
      .attr('stroke', color)
      .attr('r', 6)
      .attr('opacity', 0.9)
      .attr('cx', node.x ?? 0)
      .attr('cy', node.y ?? 0);
    c.transition()
      .duration(big ? 1500 : 900)
      .ease(d3.easeCubicOut)
      .attr('r', big ? 40 : 24)
      .attr('opacity', 0)
      .remove();
  }

  private fit() {
    if (!this.nodes.length) return { k: 1, x: this.W / 2, y: this.H / 2 };
    const xs = this.nodes.map((d) => d.x ?? 0);
    const ys = this.nodes.map((d) => d.y ?? 0);
    const minX = Math.min(...xs) - 70;
    const maxX = Math.max(...xs) + 70;
    const minY = Math.min(...ys) - 44;
    const maxY = Math.max(...ys) + 54;
    const k = Math.min(1.7, (this.W - 24) / (maxX - minX), (this.H - 72) / (maxY - minY));
    return { k, x: this.W / 2 - (k * (minX + maxX)) / 2, y: (this.H + 20) / 2 - (k * (minY + maxY)) / 2 };
  }

  private curve(l: SimLink) {
    const s = l.source as SimNode;
    const t = l.target as SimNode;
    const sx = s.x ?? 0;
    const sy = s.y ?? 0;
    const tx = t.x ?? 0;
    const ty = t.y ?? 0;
    const dx = tx - sx;
    const dy = ty - sy;
    const dist = Math.hypot(dx, dy) || 1;
    const bend = Math.min(26, dist * 0.18);
    return `M${sx},${sy} Q${(sx + tx) / 2 - (dy / dist) * bend},${(sy + ty) / 2 + (dx / dist) * bend} ${tx},${ty}`;
  }

  /**
   * Greedy label placement: the current state, the hovered state and states with bugs claim space
   * first; any label that would overlap one already placed is hidden (it still shows on hover).
   */
  private placeLabels(r: (d: SimNode) => number): Set<string> {
    const pri = (d: SimNode) =>
      (d.id === this.hovered ? 1000 : 0) + (d.id === this.current ? 500 : 0) + (d.root ? 60 : 0) + (d.sev ? 40 : 0) + d.visits;
    const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const shown = new Set<string>();
    for (const d of [...this.nodes].sort((a, b) => pri(b) - pri(a))) {
      const w = Math.min(20, d.path.length) * 6.1;
      const cx = d.x ?? 0;
      const top = (d.y ?? 0) + r(d) + 4;
      const box = { x0: cx - w / 2, x1: cx + w / 2, y0: top, y1: top + 12 };
      const clash = boxes.some((o) => box.x0 < o.x1 && box.x1 > o.x0 && box.y0 < o.y1 && box.y1 > o.y0);
      const onNode = this.nodes.some(
        (n) => n !== d && Math.abs((n.x ?? 0) - cx) < w / 2 + 4 && (n.y ?? 0) > top - 6 && (n.y ?? 0) < top + 16,
      );
      if (clash || (onNode && d.id !== this.current && d.id !== this.hovered)) continue;
      boxes.push(box);
      shown.add(d.id);
    }
    return shown;
  }

  private render(snap = false) {
    const target = this.fit();
    const a = snap || this.reduced ? 1 : 0.14;
    this.view = {
      k: this.view.k + (target.k - this.view.k) * a,
      x: this.view.x + (target.x - this.view.x) * a,
      y: this.view.y + (target.y - this.view.y) * a,
    };
    this.world.attr('transform', `translate(${this.view.x},${this.view.y}) scale(${this.view.k})`);
    const hov = this.hovered;
    const linked = (l: SimLink) => !!hov && ((l.source as SimNode).id === hov || (l.target as SimNode).id === hov);

    // Recent transitions carry the brightest flow; older ones keep a faint drift.
    const lastStep = this.links.reduce((m, l) => Math.max(m, l.step), 0);
    const edgeClass = (base: string) => (l: SimLink) =>
      `${base} tier-${l.tier}${l.step > lastStep - 6 ? ' recent' : ''}${l.key === this.freshEdge ? ' fresh' : ''}${
        linked(l) ? ' linked' : ''
      }${hov && !linked(l) ? ' dim' : ''}`;
    this.edgeG
      .selectAll<SVGPathElement, SimLink>('path')
      .data(this.links, (l) => l.key)
      .join('path')
      .attr('class', edgeClass('edge'))
      .attr('d', (l) => this.curve(l));
    this.flowG
      .selectAll<SVGPathElement, SimLink>('path')
      .data(this.links, (l) => l.key)
      .join('path')
      .attr('class', edgeClass('flow'))
      .attr('d', (l) => this.curve(l));

    const g = this.nodeG
      .selectAll<SVGGElement, SimNode>('g.node')
      .data(this.nodes, (d) => d.id)
      .join((enter) => {
        const n = enter.append('g').attr('class', 'node').attr('tabindex', 0).attr('role', 'button');
        n.append('circle').attr('class', 'hit').attr('r', 16);
        n.append('circle').attr('class', 'halo');
        n.append('circle').attr('class', 'dot');
        n.append('text').attr('class', 'label').attr('text-anchor', 'middle');
        n.on('pointerenter focus', (ev: Event, d) => {
          this.hovered = d.id;
          const r = (ev.currentTarget as Element).getBoundingClientRect();
          const host = this.el.getBoundingClientRect();
          this.onHover({ id: d.id, x: r.left + r.width / 2 - host.left, y: r.top - host.top });
          this.render();
        });
        n.on('pointerleave blur', () => {
          this.hovered = null;
          this.onHover(null);
          this.render();
        });
        n.on('click', (_e, d) => this.onSelect(d.id));
        n.on('keydown', (ev: KeyboardEvent, d) => ev.key === 'Enter' && this.onSelect(d.id));
        return n;
      })
      .attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
      .attr('aria-label', (d) => `State ${d.path}${d.bugCount ? `, ${d.bugCount} bug${d.bugCount > 1 ? 's' : ''}` : ''}`)
      .style('color', (d) => (d.sev ? `var(--${d.sev})` : null))
      .classed('current', (d) => d.id === this.current)
      .classed('root', (d) => d.root)
      .classed('has-bug', (d) => d.bugCount > 0)
      .classed(
        'dim',
        (d) =>
          !!hov &&
          d.id !== hov &&
          !this.links.some((l) => linked(l) && ((l.source as SimNode).id === d.id || (l.target as SimNode).id === d.id)),
      );
    const r = (d: SimNode) => 5.5 + Math.min(4, d.visits * 0.45);
    g.select<SVGCircleElement>('circle.dot')
      .attr('r', r)
      .style('fill', (d) => (d.sev ? `var(--${d.sev})` : null));
    g.select<SVGCircleElement>('circle.halo').attr('r', (d) => r(d) + 5);
    const shown = this.placeLabels(r);
    g.select<SVGTextElement>('text.label')
      .attr('y', (d) => r(d) + 14)
      .classed('hidden', (d) => !shown.has(d.id))
      .text((d) => (d.path.length > 20 ? `${d.path.slice(0, 19)}…` : d.path));

    const cur = this.current ? this.byId.get(this.current) : null;
    if (cur) {
      const tx = cur.x ?? 0;
      const ty = cur.y ?? 0;
      const p = this.reticlePos;
      const f = snap || this.reduced || !p ? 1 : 0.22;
      this.reticlePos = p ? { x: p.x + (tx - p.x) * f, y: p.y + (ty - p.y) * f } : { x: tx, y: ty };
      this.reticle.attr('opacity', 1).attr('transform', `translate(${this.reticlePos.x},${this.reticlePos.y})`);
    } else {
      this.reticle.attr('opacity', 0);
    }

    this.rippleG
      .selectAll<SVGCircleElement, SimNode>('circle')
      .attr('cx', (d) => d.x ?? 0)
      .attr('cy', (d) => d.y ?? 0);
    if (this.trip) this.moveTraveler();
  }
}
