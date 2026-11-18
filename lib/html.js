// HTML helpers and the page frame shared by every page.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Tagged template that escapes interpolated values unless they are marked safe
// with raw(). Arrays are joined.
const SAFE = Symbol('safe');
export const raw = (s) => ({ [SAFE]: String(s ?? '') });
const piece = (v) => (v == null || v === false ? '' : Array.isArray(v) ? v.map(piece).join('') : v[SAFE] ?? esc(v));
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += piece(v) + strings[i + 1]; });
  return raw(out);
}
export const render = (h) => h[SAFE];

// Changes on every start, so browsers fetch fresh CSS and JS after a deploy.
const ASSET_VERSION = Date.now().toString(36);

export const SITE = process.env.SITE_NAME || 'llmtactics.com';

const NAV = [
  ['/', 'The presentation'],
  ['/contribute', 'Contribute'],
];

// `deck`: a full-screen slide page with no top bar or footer.
// `bare`: no top bar or footer, normal scrolling. `nav` replaces the main links (the admin area).
export function page({ title, current = '', body, nav = null, description = '', deck = false, bare = false, noindex = false }) {
  const chrome = !deck && !bare;
  const links = nav ?? html`<nav class="nav" aria-label="Main">
    ${NAV.map(([href, label]) => html`<a href="${href}"${raw(current === href ? ' aria-current="page"' : '')}>${label}</a>`)}
  </nav>`;
  const [brand, tld] = [SITE.replace(/\.[a-z]+$/, ''), SITE.match(/\.[a-z]+$/)?.[0] ?? ''];
  return render(html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title ? `${title} · ${SITE}` : `${SITE}: how people actually use LLMs`}</title>
<meta name="description" content="${description || 'How people work with LLMs, built from what their own assistants find in their history.'}">
${noindex ? raw('<meta name="robots" content="noindex, nofollow">') : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&family=Space+Grotesk:wght@500;600;700&display=swap">
<link rel="stylesheet" href="/static/site.css?v=${raw(ASSET_VERSION)}">
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<script src="/static/site.js?v=${raw(ASSET_VERSION)}" defer></script>
</head>
<body${raw(deck ? ' class="deck-page" data-slide="0"' : '')}>
<a class="skip" href="#main">Skip to content</a>
${chrome ? html`<header class="top">
  <a class="brand" href="/">${brand}<span>${tld}</span></a>
  ${links}
</header>` : ''}
<main id="main">
${body}
</main>
${chrome ? html`<footer class="foot">
  <span class="foot-links"><a href="/contribute.md">Read the prompt</a><a href="/privacy">Privacy</a></span>
</footer>` : ''}
</body>
</html>`);
}

// ---------- small components ----------

// A vertical histogram. bars: [{ label, value, display?, highlight? }]
export function histogram({ bars, label, max = null, unit = '', className = '', marker = null }) {
  const top = max ?? Math.max(1, ...bars.map((b) => b.value || 0));
  return html`<figure class="hist ${className}">
  <div class="hist-bars" role="img" aria-label="${label}">
    ${marker ? html`<div class="hist-marker" style="bottom:${((marker.value / top) * 88).toFixed(1)}%" aria-hidden="true"><span>${marker.label}</span></div>` : ''}
    ${bars.map((b) => html`<div class="hist-col${raw(b.highlight ? ' hl' : '')}">
      <b>${b.display ?? (b.value == null ? '–' : `${b.value}${unit}`)}</b>
      <i style="height:${(((b.value || 0) / top) * 88).toFixed(1)}%"></i>
    </div>`)}
  </div>
  <div class="hist-labels" aria-hidden="true">${bars.map((b) => html`<span>${b.label}</span>`)}</div>
</figure>`;
}

// A stacked histogram. perMonth: [{ label, total, counts[] }], stacks: names.
export function stackedHistogram({ perMonth, stacks, label }) {
  const top = Math.max(1, ...perMonth.map((m) => m.total));
  return html`<figure class="hist stacked">
  <ul class="legend" aria-label="Legend">${stacks.map((s, i) => html`<li><span class="sw s${i}"></span>${s}</li>`)}</ul>
  <div class="hist-bars" role="img" aria-label="${label}">
    ${perMonth.map((m) => html`<div class="hist-col">
      <b>${m.total || ''}</b>
      ${m.counts.map((n, i) => ({ n, i })).reverse().map(({ n, i }) => (n ? html`<i class="seg s${i}" style="height:${((n / top) * 88).toFixed(2)}%"></i>` : ''))}
    </div>`)}
  </div>
  <div class="hist-labels" aria-hidden="true">${perMonth.map((m) => html`<span>${m.label}</span>`)}</div>
</figure>`;
}

// A horizontal bar row.
export const meter = (share, cls = '') => html`<span class="meter ${cls}"><span style="width:${Math.min(100, share)}%"></span></span>`;

export const copyBox = (text, label = 'Copy', size = '') => html`<div class="prompt ${size}">
  <code>${text}</code>
  <button type="button" class="copy" data-copy="${text}">${label}</button>
</div>`;

export const formatNumber = (n) => Number(n).toLocaleString('en-GB');
export const formatDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
