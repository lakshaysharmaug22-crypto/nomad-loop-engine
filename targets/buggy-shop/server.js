// Buggy Shop — a small storefront with planted bugs.
// Every planted bug is listed in bugs.manifest.json so a run can be scored for recall.
// LAYOUT_VERSION=2 renames ids/classes, drops test ids and rewords some labels,
// which breaks brittle selectors and exercises self-healing.

const express = require('express');

// Flags mirror the env vars so the builds start the same way on every shell: --layout 2 --no-bugs --port 4101
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? '') : undefined;
};
const V2 = (arg('layout') ?? process.env.LAYOUT_VERSION) === '2';
// BUGS=off (or --no-bugs) serves a fixed build: every repro script should then pass.
const BUGGY = !process.argv.includes('--no-bugs') && process.env.BUGS !== 'off';
const PORT = Number(arg('port') ?? process.env.PORT ?? 4100);
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const products = [
  { id: 1, name: 'Canvas Backpack', price: 1499, color: '#5b7c99' },
  { id: 2, name: 'Steel Water Bottle', price: 699, color: '#8a9a5b', brokenImage: BUGGY }, // B06
  { id: 3, name: 'Desk Lamp', price: 2199, color: '#c9a227', brokenCartApi: BUGGY }, // B03
  { id: 4, name: 'Noise-Cancelling Headphones', price: 8999, color: '#7a4e8c', serverError: BUGGY }, // B01
  { id: 5, name: 'Notebook Set', price: 349, color: '#b5523b' },
];

const cart = new Map(); // productId -> qty (single shared cart is fine for a test target)

const id = (base) => (V2 ? `${base}-v2x` : base);
const tid = (name) => (V2 ? '' : ` data-testid="${name}"`);
const L = {
  addToCart: V2 ? 'Add to bag' : 'Add to cart',
  checkout: V2 ? 'Proceed to checkout' : 'Checkout',
  applyCoupon: V2 ? 'Redeem code' : 'Apply coupon',
  search: V2 ? 'Find' : 'Search',
};

function swatch(p) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='120'><rect width='160' height='120' fill='${p.color}'/></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function layout(title, body, { script = '' } = {}) {
  const nav = `
    <nav class="${V2 ? 'topbar' : 'nav'}" aria-label="Main">
      <a href="/" id="${id('nav-home')}"${tid('nav-home')}>Home</a>
      <a href="/cart" id="${id('nav-cart')}"${tid('nav-cart')}>Cart (${[...cart.values()].reduce((a, b) => a + b, 0)})</a>
      <a href="/account" id="${id('nav-account')}"${tid('nav-account')}>Account</a>
      <form action="/search" method="get" role="search" class="${V2 ? 'finder' : 'search'}">
        <input name="q" id="${id('search-input')}" placeholder="Search products" aria-label="Search products"${tid('search-input')}>
        <button type="submit" id="${id('search-btn')}"${tid('search-btn')}>${L.search}</button>
      </form>
    </nav>`;
  const footer = `
    <footer>
      <a href="/about">About</a>
      <a href="/careers">Careers</a>
      <form action="/newsletter" method="post" class="newsletter">
        <input type="email" name="email" placeholder="Your email" aria-label="Newsletter email" required>
        <button type="submit">Subscribe</button>
      </form>
    </footer>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} · Buggy Shop</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;margin:0;color:#222}nav,footer{display:flex;gap:16px;padding:12px 24px;background:#f3f3f3;align-items:center;flex-wrap:wrap}
main{padding:24px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}.card{border:1px solid #ddd;padding:12px;border-radius:6px}
.err{color:#b00020}.ok{color:#1b7f3b}</style></head>
<body>${nav}<main>${body}</main>${footer}
<script>${script}</script></body></html>`;
}

app.get('/', (req, res) => {
  const cards = products
    .map(
      (p) => `<div class="card ${V2 ? 'tile' : 'product'}">
        <img src="${p.brokenImage ? '/img/bottle-missing.png' : swatch(p)}" alt="${p.name}" width="160" height="120">
        <h3>${p.name}</h3><p>₹${p.price}</p>
        <a href="/product/${p.id}" id="${id('view-' + p.id)}"${tid('view-' + p.id)}>View details</a>
      </div>`,
    )
    .join('');
  res.send(
    layout(
      'Home',
      `<h1>Buggy Shop</h1><div class="grid">${cards}</div>
    <section><h2>Recommended for you</h2><div id="recs">Loading…</div></section>`,
      {
        script: `fetch('/api/recommendations').then(r=>r.json()).then(d=>{document.getElementById('recs').textContent=d.items.join(', ')})`,
      },
    ),
  );
});

app.get('/product/:id', (req, res) => {
  const p = products.find((x) => x.id === Number(req.params.id));
  if (!p) return res.status(404).send(layout('Not found', '<h1>Product not found</h1>'));
  if (p.serverError) {
    // B01: unhandled server error on a product page
    return res
      .status(500)
      .send("<h1>500 Internal Server Error</h1><pre>TypeError: Cannot read properties of undefined (reading 'stock')</pre>");
  }
  res.send(
    layout(
      p.name,
      `<h1>${p.name}</h1>
    <img src="${p.brokenImage ? '/img/bottle-missing.png' : swatch(p)}" alt="${p.name}" width="320" height="240">
    <p>Price: ₹${p.price}</p>
    <button id="${id('add-to-cart')}"${tid('add-to-cart')} class="${V2 ? 'btn-bag' : 'btn-primary'}">${L.addToCart}</button>
    <p id="msg" role="status"></p>`,
      {
        script: `document.getElementById('${id('add-to-cart')}').addEventListener('click',()=>{
      fetch('${p.brokenCartApi ? '/api/cart/items' : '/api/cart'}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:${p.id}})})
        .then(r=>{ if(!r.ok) throw new Error('cart request failed '+r.status); return r.json(); })
        .then(()=>{document.getElementById('msg').textContent='Added to cart'})
        .catch(e=>{console.error(e.message)});
    });`,
      },
    ),
  );
});

app.post('/api/cart', (req, res) => {
  const pid = Number(req.body.id);
  cart.set(pid, (cart.get(pid) || 0) + 1);
  res.json({ ok: true, count: cart.get(pid) });
});
// B03: /api/cart/items is never registered → 404 on "Add to cart" for the desk lamp.

app.get('/cart', (req, res) => {
  const rows = [...cart.entries()]
    .map(([pid, qty]) => {
      const p = products.find((x) => x.id === pid);
      return `<li>${p.name} × ${qty} — ₹${p.price * qty}
        <form action="/cart/remove" method="post" style="display:inline"><input type="hidden" name="id" value="${pid}"><button type="submit">Remove</button></form></li>`;
    })
    .join('');
  // B08: after any removal the total is computed from a stale field and renders NaN
  const total =
    BUGGY && req.query.removed
      ? Number(undefined)
      : [...cart.entries()].reduce((s, [pid, q]) => s + products.find((x) => x.id === pid).price * q, 0);
  res.send(
    layout(
      'Cart',
      `<h1>Your cart</h1><ul>${rows || '<li>Cart is empty</li>'}</ul>
    <p>Total: ₹${total}</p>
    <label>Coupon <input name="coupon" id="${id('coupon')}" placeholder="Coupon code"></label>
    <button id="${id('apply-coupon')}"${tid('apply-coupon')}>${L.applyCoupon}</button>
    <p><a href="/checkout" id="${id('checkout-link')}"${tid('checkout-link')}>${L.checkout}</a></p>`,
      {
        // B07: uncaught exception when applying a coupon
        script: `document.getElementById('${id('apply-coupon')}').addEventListener('click',()=>{ const rules = ${BUGGY ? 'window.couponRules' : '{ validate(){} }'}; rules.validate(document.getElementById('${id('coupon')}').value); });`,
      },
    ),
  );
});

app.post('/cart/remove', (req, res) => {
  cart.delete(Number(req.body.id));
  res.redirect('/cart?removed=1');
});

app.get('/checkout', (req, res) => {
  res.send(
    layout(
      'Checkout',
      `<h1>Checkout</h1>
    <form action="/checkout" method="post" id="${id('checkout-form')}" novalidate>
      <label>Full name <input name="name" autocomplete="name"></label><br>
      <label>Email <input name="email" type="email"></label><br>
      <label>Address <input name="address"></label><br>
      <label>PIN code <input name="pin" inputmode="numeric"></label><br>
      <button type="submit"${tid('place-order')}>Place order</button>
    </form>`,
    ),
  );
});

app.post('/checkout', (req, res) => {
  // B04: no server-side validation — an empty form still "places" an order
  if (!BUGGY && (!req.body.name || !req.body.email || !req.body.address)) {
    return res
      .status(422)
      .send(
        layout(
          'Checkout',
          '<h1>Checkout</h1><p class="err">Please fill in name, email and address.</p><a href="/checkout">Back to checkout</a>',
        ),
      );
  }
  res.send(layout('Order placed', `<h1 class="ok">Order placed!</h1><p>Confirmation sent to ${req.body.email || ''}.</p>`));
});

app.get('/search', (req, res) => {
  const q = (req.query.q || '').toString();
  const hits = products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  res.send(
    layout(
      'Search',
      `<h1>Results for “${q}”</h1><ul>${hits.map((p) => `<li><a href="/product/${p.id}">${p.name}</a></li>`).join('') || '<li>No results</li>'}</ul>`,
      {
        // B02: empty query triggers a console error from a missing analytics helper
        script: BUGGY && q.trim() === '' ? `console.error('SearchAnalytics: query must be a non-empty string')` : '',
      },
    ),
  );
});

app.get('/account', (req, res) => res.redirect('/login?next=/account'));

app.get('/login', (req, res) => {
  res.send(
    layout(
      'Log in',
      `<h1>Log in</h1>
    <form action="/login" method="post">
      <label>Email <input name="email" type="email" required></label><br>
      <label>Password <input name="password" type="password" required></label><br>
      <button type="submit">Log in</button>
    </form>`,
    ),
  );
});

app.post('/login', (req, res) => {
  res.send(layout('Log in', `<h1>Log in</h1><p class="err">Invalid email or password.</p><a href="/login">Try again</a>`));
});

app.post('/newsletter', (req, res) => {
  // B09: success message interpolates an object
  const sub = { email: req.body.email };
  res.send(layout('Newsletter', `<h1>Thanks!</h1><p>Subscribed: ${BUGGY ? sub : sub.email}</p>`));
});

app.get('/about', (req, res) => res.send(layout('About', '<h1>About us</h1><p>We sell useful things.</p>')));
if (!BUGGY) app.get('/careers', (req, res) => res.send(layout('Careers', '<h1>Careers</h1><p>No open roles right now.</p>')));
// B05: /careers is linked from the footer but has no route → 404

app.get('/api/recommendations', (req, res) => {
  // B10: recommendations endpoint is very slow
  setTimeout(() => res.json({ items: ['Notebook Set', 'Canvas Backpack'] }), BUGGY ? 3500 : 50);
});

app.use((req, res) => res.status(404).send(layout('Not found', '<h1>404 — Page not found</h1>')));

app.listen(PORT, () => console.log(`buggy-shop (layout v${V2 ? 2 : 1}${BUGGY ? '' : ', bugs off'}) on http://localhost:${PORT}`));
