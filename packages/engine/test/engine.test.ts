import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateActions, fakeValue } from '../src/actions';
import { correlate, makeAnomaly, checkState } from '../src/anomaly';
import { HashingEmbedder } from '../src/embedder';
import { FEATURE_NAMES, featurize } from '../src/features';
import { StateGraph } from '../src/graph';
import { SelfHealingLocator } from '../src/locator';
import { heuristicScore, HybridPolicy } from '../src/policy';
import { reproScript } from '../src/reporter';
import { score } from '../src/score';
import { fingerprint } from '../src/snapshot';
import type { ElementDescriptor, StateSnapshot } from '@nomad/contracts';

const el = (p: Partial<ElementDescriptor>): ElementDescriptor => ({
  role: 'button',
  name: '',
  tag: 'button',
  cssPath: 'body > main > button',
  context: 'main: Shop',
  inForm: false,
  inNav: false,
  ...p,
});

const state = (p: Partial<StateSnapshot> = {}): StateSnapshot => ({
  url: 'http://shop.test/',
  path: '/',
  title: 'Home',
  fingerprint: 'root',
  status: 200,
  visibleText: 'Welcome',
  elements: [
    el({ role: 'link', tag: 'a', name: 'About', href: 'http://shop.test/about', inNav: true }),
    el({ role: 'link', tag: 'a', name: 'Cart (2)', href: 'http://shop.test/cart', inNav: true }),
    el({ role: 'link', tag: 'a', name: 'Twitter', href: 'https://twitter.com/x' }),
    el({ name: 'Add to cart' }),
  ],
  forms: [
    { submit: el({ name: 'Search', inForm: true }), fields: [{ name: 'q', type: 'text', label: 'Search products', required: false }] },
  ],
  ...p,
});

test('fingerprint masks digits so counters do not create new states', () => {
  const a = fingerprint('/', 'Home', [el({ role: 'link', name: 'Cart (2)' })]);
  const b = fingerprint('/', 'Home', [el({ role: 'link', name: 'Cart (3)' })]);
  const c = fingerprint('/', 'Home', [el({ role: 'link', name: 'Account' })]);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('candidate actions skip off-site links and add filled + empty form variants', () => {
  const acts = candidateActions(state(), 'http://shop.test');
  const kinds = acts.map((a) => a.kind);
  assert.ok(!acts.some((a) => a.target?.href?.includes('twitter')));
  assert.equal(kinds.filter((k) => k === 'fill_submit').length, 1);
  assert.equal(kinds.filter((k) => k === 'fill_submit_empty').length, 1);
  assert.ok(acts.some((a) => a.label.includes('Add to cart')));
});

test('fake values follow field semantics', () => {
  assert.match(fakeValue({ name: 'email', type: 'email', label: 'Email', required: true }), /@/);
  assert.equal(fakeValue({ name: 'pin', type: 'text', label: 'PIN code', required: false }), '411001');
});

test('correlation folds a failed-request console error into the network failure', () => {
  const net = makeAnomaly('network_failure', 'POST /api/cart/items returned 404', 'http://shop.test/product/3');
  const con = makeAnomaly('console_error', 'cart request failed 404', 'http://shop.test/product/3');
  const out = correlate([net, con]);
  assert.equal(out.length, 1);
  assert.match(out[0].message, /related: console/);
});

test('suspicious text on a 5xx page is not reported separately', () => {
  const s = state({ status: 500, path: '/product/4', url: 'http://shop.test/product/4', visibleText: 'TypeError: reading undefined' });
  const out = correlate(checkState(s));
  assert.deepEqual(
    out.map((a) => a.type),
    ['server_error'],
  );
});

test('suspicious text dedups on the token, not the surrounding text', () => {
  const a = checkState(state({ url: 'http://shop.test/cart', visibleText: 'Total: ₹NaN for 2 items' }))[0];
  const b = checkState(state({ url: 'http://shop.test/cart', visibleText: 'Your total: ₹NaN' }))[0];
  assert.equal(a.signature, b.signature);
});

test('self-healing: exact by test id, semantic after a rename, abstains on nonsense', async () => {
  const healer = new SelfHealingLocator(new HashingEmbedder());
  const target = el({ name: 'Add to cart', testId: 'add-to-cart', id: 'add-to-cart', context: 'main: Desk Lamp' });
  const v1 = [target, el({ name: 'Wishlist', cssPath: 'body > main > button:nth-of-type(2)' })];
  assert.equal((await healer.match(target, v1)).strategy, 'exact');

  const v2 = [
    el({ name: 'Add to bag', id: 'add-to-cart-v2x', context: 'main: Desk Lamp', cssPath: 'body > main > div > button' }),
    el({ name: 'Wishlist', cssPath: 'body > main > button:nth-of-type(2)', context: 'main: Desk Lamp' }),
  ];
  const r = await healer.match(target, v2);
  assert.equal(r.strategy, 'healed');
  assert.equal(r.matched?.name, 'Add to bag');

  assert.equal(r.candidates[0].name, 'Add to bag');
  assert.ok(r.candidates[0].score.total > r.candidates[1].score.total);

  const none = await healer.match(target, [el({ role: 'link', tag: 'a', name: 'Privacy policy', context: 'footer:' })]);
  assert.equal(none.strategy, 'failed');
});

test('heuristic prefers unseen links and penalises repeats', () => {
  const g = new StateGraph();
  const s = state();
  g.seenPaths.add('/about');
  const acts = candidateActions(s, 'http://shop.test');
  const ctx = { state: s, graph: g, stateVisits: 1, stepsSinceNewState: 0, candidates: acts, history: [] };
  const about = acts.find((a) => a.target?.name === 'About')!;
  const cart = acts.find((a) => a.target?.name === 'Cart (2)')!;
  assert.ok(heuristicScore(cart, ctx) > heuristicScore(about, ctx));
  g.globalKeyUse.set(cart.key, 2);
  assert.ok(heuristicScore(cart, ctx) < heuristicScore(about, ctx) + 1);
});

test('hybrid policy escalates to the ranker on a tie and records the tier', async () => {
  const g = new StateGraph();
  const s = state({ elements: [el({ name: 'Alpha' }), el({ name: 'Beta', cssPath: 'x' })], forms: [] });
  const acts = candidateActions(s, 'http://shop.test');
  const ranker = {
    score: async (f: number[][]) => {
      assert.equal(f[0].length, FEATURE_NAMES.length);
      return [0.2, 0.9];
    },
  };
  const d = await new HybridPolicy(ranker, null).decide({
    state: s,
    graph: g,
    stateVisits: 1,
    stepsSinceNewState: 0,
    candidates: acts,
    history: [],
  });
  assert.equal(d.tier, 'ranker');
  assert.equal(d.action.target?.name, 'Beta');
  assert.equal(d.trace.heuristic.decided, false);
  assert.equal(d.trace.ranker.decided, true);
  assert.equal(d.trace.candidates[0].chosen, true);
  assert.equal(d.trace.candidates[0].ranker, 0.9);

  const noModels = await new HybridPolicy(null, null).decide({
    state: s,
    graph: g,
    stateVisits: 1,
    stepsSinceNewState: 0,
    candidates: acts,
    history: [],
  });
  assert.equal(noModels.tier, 'fallback');
});

test('feature vector has a fixed length', () => {
  const g = new StateGraph();
  const s = state();
  const acts = candidateActions(s, 'http://shop.test');
  for (const [i, a] of acts.entries())
    assert.equal(featurize(a, i, acts, { state: s, graph: g, stateVisits: 1, stepsSinceNewState: 0 }).length, FEATURE_NAMES.length);
});

test('repro script asserts the right thing per anomaly type', () => {
  const a = makeAnomaly('suspicious_text', 'Page shows “NaN”', 'http://shop.test/cart?removed=1');
  const src = reproScript('NLE-001', 'Suspicious text on /cart', a, {
    fromUrl: 'http://shop.test/cart?removed=1',
    action: null,
    values: {},
  });
  assert.match(src, /not\.toContainText\("NaN"\)/);
  assert.match(src, /page\.goto\("http:\/\/shop\.test\/cart\?removed=1"\)/);
});

test('scoring matches reports to the manifest', () => {
  const bug = {
    id: 'NLE-1',
    title: '',
    type: 'server_error',
    severity: 'critical',
    url: 'http://x/product/4',
    message: 'GET /product/4 returned 500',
  } as any;
  const r = score([{ id: 'B01', title: '500', type: 'server_error', match: { url: '/product/4' }, detectableBy: 'heuristic' }], [bug]);
  assert.equal(r.recall, 1);
  assert.equal(r.precision, 1);
});

test('seeded random is reproducible', async () => {
  const { seededRandom } = await import('../src/policy');
  const a = seededRandom(42),
    b = seededRandom(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('rebase moves a recipe onto another build', async () => {
  const { rebase } = await import('../src/reporter');
  assert.equal(rebase('http://localhost:4100/cart?removed=1', 'http://staging.test:8080'), 'http://staging.test:8080/cart?removed=1');
});
