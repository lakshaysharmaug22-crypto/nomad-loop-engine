'use client';
// The exploration loop as a flow diagram: five stations joined by streaming wires, with a
// return rail back to the start. The active station advances on a timer (static when the
// viewer prefers reduced motion).
import { useEffect, useState } from 'react';
import o from './overview.module.css';

const STATIONS = [
  {
    name: 'Observe',
    tag: 'state graph',
    body: 'Fingerprints the page by structure, visible text and URL pattern, so a revisit is recognised as the same state.',
  },
  {
    name: 'Decide',
    tag: 'rules → ranker → LLM',
    body: 'Rules take the obvious calls. A trained ranker scores the rest. A local model settles what the ranker is unsure of.',
  },
  {
    name: 'Act',
    tag: 'self-healing locator',
    body: 'Clicks, fills and submits through Playwright, and finds targets by meaning when their selectors drift.',
  },
  {
    name: 'Detect',
    tag: '9 detectors',
    body: 'Watches console, network, rendering and copy, then folds related signals into a single finding.',
  },
  {
    name: 'Report',
    tag: 'replay ×3 → .spec.ts',
    body: 'Shortens the path, replays it three times and writes a Playwright test for every confirmed bug.',
  },
];

export function LoopDiagram() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setActive((a) => (a + 1) % STATIONS.length), 1600);
    return () => clearInterval(id);
  }, []);

  return (
    <div className={o.loop}>
      <ol className={o.stations}>
        {STATIONS.map((s, i) => (
          <li key={s.name} className={o.station} data-active={i === active || undefined} data-done={i < active || undefined}>
            <div className={o.stationHead}>
              <span className={`${o.stationNo} num`}>{String(i + 1).padStart(2, '0')}</span>
              <span className={o.stationName}>{s.name}</span>
            </div>
            <p>{s.body}</p>
            <code className={o.stationTag}>{s.tag}</code>
            {i < STATIONS.length - 1 && <span className={o.link} data-hot={i === active || undefined} aria-hidden="true" />}
          </li>
        ))}
      </ol>
      <div className={o.returnRail} data-hot={active === STATIONS.length - 1 || undefined} aria-hidden="true">
        <span className={o.railUp} />
        <span className={o.railBack} />
        <span className={o.railDown} />
        <em>next step</em>
      </div>
    </div>
  );
}
