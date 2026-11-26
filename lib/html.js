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
// Link previews need absolute URLs, so the share image is addressed from PUBLIC_URL.
const ORIGIN = (process.env.PUBLIC_URL || `https://${SITE}`).replace(/\/$/, '');
const DESCRIPTION = 'How people work with LLMs, built from what their own assistants find in their history.';
const OG_ALT = `${SITE}: how people actually use LLMs, built from what their own assistants find in their history.`;

// `deck`: a full-screen slide page with no top bar or footer.
// `bare`: no top bar or footer, normal scrolling. `nav`: the top bar's links (the admin area).
// Public pages are all `deck` or `bare`, so none has a top bar to offer Contribute in.
// Who made the site, for the foot of a page.
export const MADE_BY = html`Made by <a href="https://dobrinov.github.io/me" target="_blank" rel="noopener noreferrer">Deyan Dobrinov<span class="sr-only"> (opens in a new tab)</span></a>`;

// `styles`: more stylesheets from /static, after site.css.
export function page({ title, body, nav = null, description = '', deck = false, bare = false, noindex = false, styles = [] }) {
  const chrome = !deck && !bare;
  const links = nav ?? '';
  const [brand, tld] = [SITE.replace(/\.[a-z]+$/, ''), SITE.match(/\.[a-z]+$/)?.[0] ?? ''];
  const fullTitle = title ? `${title} · ${SITE}` : `${SITE}: how people actually use LLMs`;
  const desc = description || DESCRIPTION;
  const image = `${ORIGIN}/static/og.png`;
  return render(html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${desc}">
${noindex ? raw('<meta name="robots" content="noindex, nofollow">') : ''}
<meta name="theme-color" content="#f5f6f8">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE}">
<meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${OG_ALT}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${fullTitle}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${image}">
<meta name="twitter:image:alt" content="${OG_ALT}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&family=Space+Grotesk:wght@500;600;700&display=swap">
<link rel="stylesheet" href="/static/site.css?v=${raw(ASSET_VERSION)}">
${styles.map((s) => html`<link rel="stylesheet" href="/static/${s}?v=${raw(ASSET_VERSION)}">`)}
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
  <span>${MADE_BY}</span>
  <span class="foot-links"><a href="/contribute.md">Read the prompt</a><a href="/privacy">Privacy</a></span>
</footer>` : ''}
</body>
</html>`);
}

// ---------- small components ----------

// A company page's name, or how to call one without a name. Everyone who sees a
// company page has its link, so it is theirs: 'Your company' to start a label,
// 'your company' (`mid`) inside a sentence.
// What the pasted prompt does, as a hover tip for people wary of pasting it.
// Keep it in step with survey/contribute.md: each point is one of its rules.
// Always a span: a p cannot hold the tip's list, so the browser would close it
// early and spill the list onto the page.
const PROMPT_DOES = [
  ['Asks you first.', 'Nothing is read before your yes, and you can name projects to skip.'],
  ['Only reads.', 'Its last 30 days with you, secrets masked, and which coding tools you use, by name only.'],
  ['How you work, not what on.', 'Never code, file names, paths, or project or people’s names.'],
  ['Shows you the exact answer.', 'Nothing is sent until you say yes.'],
  ['Used for nothing else.', 'Only the shared numbers and your own page. No account, no email.'],
];
export const promptTip = (label = 'What does this prompt do?') => raw(`<span class="ask ht" tabindex="0">${esc(label)}<span class="tip wide does">`
  + `<ul>${PROMPT_DOES.map(([head, text]) => `<li><b>${esc(head)}</b> ${esc(text)}</li>`).join('')}</ul>`
  + '<a href="/contribute.md" target="_blank" rel="noopener">Read the prompt</a> · <a href="/llm-survey.py" target="_blank" rel="noopener">the script it runs</a>'
  + '</span></span>');

export const companyName =(c, { mid = false } = {}) => c?.name || (mid ? 'your company' : 'Your company');
export const formatNumber = (n) => Number(n).toLocaleString('en-GB');
export const formatDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
