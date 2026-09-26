// Scripts that run inside the page. Kept as plain JavaScript strings so no TypeScript/esbuild
// helpers leak into the browser context when the engine runs under tsx or compiled tsc.

/** Returns { title, elements[], forms[], visibleText } for the current document. */
export const EXTRACT_SCRIPT = String.raw`(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const cssPath = (el) => {
    const parts = [];
    let cur = el;
    while (cur && cur.tagName !== 'BODY' && parts.length < 8) {
      const tag = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (!parent) break;
      const same = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
      parts.unshift(same.length > 1 ? tag + ':nth-of-type(' + (same.indexOf(cur) + 1) + ')' : tag);
      cur = parent;
    }
    return 'body > ' + parts.join(' > ');
  };
  const labelOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    const labels = el.labels;
    if (labels && labels.length) {
      const clone = labels[0].cloneNode(true);
      clone.querySelectorAll('input,select,textarea').forEach((n) => n.remove());
      const t = clean(clone.textContent);
      if (t) return t;
    }
    const text = clean(el.innerText || el.textContent);
    if (text) return text;
    return clean(el.getAttribute('alt') || el.getAttribute('placeholder') || el.value || el.getAttribute('title') || el.getAttribute('name'));
  };
  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit === 'button' || explicit === 'link') return explicit;
    const tag = el.tagName;
    if (tag === 'A') return 'link';
    if (tag === 'BUTTON') return 'button';
    if (tag === 'SELECT') return 'combobox';
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'submit' || t === 'button') return 'button';
      if (t === 'checkbox' || t === 'radio') return 'checkbox';
      return 'textbox';
    }
    return 'other';
  };
  const contextOf = (el) => {
    const container = el.closest('nav,footer,form,section,article,.card,main') || document.body;
    const heading = container.querySelector('h1,h2,h3');
    // The nearest preceding sibling (e.g. the label/input next to a button) carries strong meaning.
    let prev = el.previousElementSibling;
    while (prev && !visible(prev)) prev = prev.previousElementSibling;
    const prevText = prev ? clean((prev.innerText || '') + ' ' + ((prev.querySelector && prev.querySelector('[placeholder]')) ? prev.querySelector('[placeholder]').getAttribute('placeholder') : (prev.getAttribute('placeholder') || ''))) : '';
    return clean(container.tagName.toLowerCase() + ': ' + (heading ? heading.textContent : (container.getAttribute('aria-label') || '')) + (prevText ? ' | ' + prevText : ''));
  };

  const forms = Array.from(document.forms);
  const formFields = forms.map((f) => ({
    fields: Array.from(f.querySelectorAll('input,select,textarea'))
      .filter((i) => !['hidden', 'submit', 'button', 'reset', 'image'].includes((i.type || '').toLowerCase()) && visible(i))
      .map((i) => ({ name: i.getAttribute('name') || i.id || '', type: (i.type || 'text').toLowerCase(), label: labelOf(i), required: !!i.required })),
  }));

  const nodes = Array.from(document.querySelectorAll('a[href],button,input,select,textarea,[role=button],[role=link]')).filter(visible);
  const elements = nodes.map((el) => {
    const form = el.form || el.closest('form');
    const type = el.type ? String(el.type).toLowerCase() : undefined;
    const isSubmit = !!form && ((el.tagName === 'BUTTON' && (type === 'submit' || !el.getAttribute('type'))) || (el.tagName === 'INPUT' && type === 'submit'));
    return {
      role: roleOf(el), name: labelOf(el), tag: el.tagName.toLowerCase(), type,
      placeholder: el.getAttribute('placeholder') || undefined,
      href: el.tagName === 'A' ? el.href : undefined,
      id: el.id || undefined,
      testId: el.getAttribute('data-testid') || undefined,
      cssPath: cssPath(el), context: contextOf(el),
      inForm: !!form, inNav: !!el.closest('nav,footer'),
      formIndex: form ? forms.indexOf(form) : -1, isSubmit,
    };
  });
  return { title: document.title, elements, forms: formFields, visibleText: document.body ? (document.body.innerText || '').slice(0, 4000) : '' };
})()`;

/** Returns src of images that finished loading with zero natural width (broken). */
export const BROKEN_IMAGES_SCRIPT = String.raw`(() => Array.from(document.images)
  .filter((img) => img.complete && img.naturalWidth === 0 && img.getAttribute('src'))
  .map((img) => img.getAttribute('src')))()`;
