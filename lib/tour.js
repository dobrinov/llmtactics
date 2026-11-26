// The tour: seven slides that show everyone's numbers first and then ask
// people to take part, and the tool pages that open from its Setups slide.
// The same slides serve three lenses: everyone (/), a company (/c/<id>) and
// one person (/u/<id>). World and Company show totals; You has slides of its
// own that show only that person's answer, nothing counted across people.
// A company's slides show only its own totals, never next to everyone's.
import { page, html, raw, formatNumber, MADE_BY, promptTip } from './html.js';
import { ICON } from './icons.js';
import { connectorBase } from './logos.js';
import { shareRadius, place } from './radar.js';
import { QUADRANTS, TOOL_CATEGORIES, toolAbout, toolUrl, WORLD, COUNTRIES, catalogById, toolCategory, countryLabel } from './shape.js';
import { MIN_GROUP, NO_COUNTRY, firstOfEach, versionNames, harnessNames } from './stats.js';

// The slides, in order. `label` is the short name in the top bar.
export const SLIDES = [
  { id: 'intro', label: 'Intro' },
  { id: 'tactics', label: 'Tactics' },
  { id: 'setups', label: 'Setups' },
  { id: 'models', label: 'Models' },
  { id: 'harnesses', label: 'Harnesses' },
  { id: 'where', label: 'Where' },
  { id: 'join', label: 'Take part' },
];

// The last slide's name for someone who has answered already: it points them
// at the lenses instead of asking them to take part.
const EXPLORE = 'Explore';

// The intro shows how many people took part only once the number impresses.
const SHOW_PEOPLE_FROM = 1000;
const SHOW_COMPANIES_FROM = 10;
// Setups shown before "show more", and how many each click adds.
const SETUPS_FIRST = 7;
const SETUPS_STEP = 8;
const SETUPS_MAX = SETUPS_FIRST + 3 * SETUPS_STEP;

const round = (v) => Math.round(v);
const plural = (n, one, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`;
const quadIndex = (id) => Math.max(0, QUADRANTS.findIndex((q) => q.id === id));
const CATEGORY = Object.fromEntries(TOOL_CATEGORIES.map((c) => [c.id, c.label]));
const KIND_ONE = { harness: 'Coding agent', chat: 'Chat assistant', editor: 'Editor', terminal: 'Terminal', multiplexer: 'Multiplexer', review: 'Review tool', connector: 'Connector', other: 'Other' };

// A tool's address on this site, and its two capital letters (they stand in
// for a logo): the first letters of its first two words, or the first two
// letters of a one-word name. "Claude Code" CC, "tmux" TM, "agent-browser" AB.
// A tool's address: its name in lower case, with dashes for spaces. A name
// with anything besides letters, digits, single spaces and dashes ('C++',
// 'Terminal.app', 'Редактор') also gets a short hash of itself, so 'C' and
// 'C++' get addresses of their own. Always 1 to 80 characters, as the routes
// expect.
export function toolSlug(name) {
  const lower = String(name).toLowerCase();
  const ascii = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (ascii && ascii.length <= 80 && /^[a-z0-9]+([ -][a-z0-9]+)*$/.test(lower)) return ascii;
  let h = 0x811c9dc5;
  for (const ch of lower) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0;
  return `${ascii.slice(0, 60).replace(/-+$/, '') || 'tool'}-${h.toString(36)}`;
}
// Fixed letters for well-known tools whose initials would clash ("Codex CLI" and "Claude Code").
const MONOGRAMS = { 'codex cli': 'CX', 'claude': 'CL', 'chatgpt': 'GP', 'gemini': 'GM', 'gemini cli': 'GE', 'ghostty': 'GT', 'cursor': 'CU', 'github copilot': 'GC', 'windsurf': 'WS', 'warp': 'WA', 'zed': 'ZD', 'zellij': 'ZJ', 'terminal.app': 'TA' };
const monogram = (name) => {
  if (MONOGRAMS[String(name).toLowerCase()]) return MONOGRAMS[String(name).toLowerCase()];
  const words = String(name).split(/[\s\-_.]+/).filter((w) => w && !/^(a|an|the|our|my)$/i.test(w));
  if (!words.length) return '?';
  // Whole characters (an emoji is two UTF-16 units), letters and digits only.
  const chars = (w) => Array.from(w).filter((c) => /[\p{L}\p{N}]/u.test(c));
  const [a, b] = words.map(chars).filter((c) => c.length);
  if (!a) return '?';
  return (b ? a[0] + b[0] : a.slice(0, 2).join('')).toUpperCase();
};

// Tools with a logo (table tool_logos, found by `npm run analyse`): lower-case
// name → its address. The server sets this from the database and refreshes it.
let LOGOS = new Map();
export function setLogos(rows) {
  LOGOS = new Map(rows.map((r) => [r.name, { src: `/logos/${toolSlug(r.name)}?v=${new Date(r.checked_at).getTime().toString(36)}`, raster: r.content_type !== 'image/svg+xml' }]));
}
// The avatar's look: its classes, and what goes inside (the logo, or the two letters if there is none).
const markClass = (name) => { const l = LOGOS.get(String(name).toLowerCase()); return l ? (l.raster ? ' logo raster' : ' logo') : ''; };
// An MCP server or connector for another product also gets a small MCP badge.
const MCP_BADGE = raw('<span class="tc-badge" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.85 0a4.16 4.16 0 0 0-2.95 1.217L1.456 10.66a.835.835 0 0 0 0 1.18.835.835 0 0 0 1.18 0l9.442-9.442a2.49 2.49 0 0 1 3.541 0 2.49 2.49 0 0 1 0 3.541L8.59 12.97l-.1.1a.835.835 0 0 0 0 1.18.835.835 0 0 0 1.18 0l.1-.098 7.03-7.034a2.49 2.49 0 0 1 3.542 0l.049.05a2.49 2.49 0 0 1 0 3.54l-8.54 8.54a1.96 1.96 0 0 0 0 2.755l1.753 1.753a.835.835 0 0 0 1.18 0 .835.835 0 0 0 0-1.18l-1.753-1.753a.266.266 0 0 1 0-.394l8.54-8.54a4.185 4.185 0 0 0 0-5.9l-.05-.05a4.16 4.16 0 0 0-2.95-1.218c-.2 0-.401.02-.6.048a4.17 4.17 0 0 0-1.17-3.552A4.16 4.16 0 0 0 13.85 0m0 3.333a.84.84 0 0 0-.59.245L6.275 10.56a4.186 4.186 0 0 0 0 5.902 4.186 4.186 0 0 0 5.902 0L19.16 9.48a.835.835 0 0 0 0-1.18.835.835 0 0 0-1.18 0l-6.985 6.984a2.49 2.49 0 0 1-3.54 0 2.49 2.49 0 0 1 0-3.54l6.983-6.985a.835.835 0 0 0 0-1.18.84.84 0 0 0-.59-.245"/></svg></span>');
const mark = (name) => {
  const l = LOGOS.get(String(name).toLowerCase());
  return html`${l ? html`<img src="${l.src}" alt="" loading="lazy" decoding="async">` : monogram(name)}${connectorBase(name) ? MCP_BADGE : ''}`;
};

// Words for the person a You lens is about: the owner reads "you"; anyone else
// with the link reads the page's name, or "this person".
export const whoFor = (profile, isOwner) => (isOwner
  ? { lens: 'You', subj: 'you', Subj: 'You', poss: 'your', Poss: 'Your', does: 'do' }
  : { lens: profile?.name || 'This person', subj: profile?.name || 'this person', Subj: profile?.name || 'This person', poss: profile?.name ? `${profile.name}’s` : 'their', Poss: profile?.name ? `${profile.name}’s` : 'Their', does: 'does' });

// ---------- the frame: top bar, side arrows ----------


// The World · Company · You switch. On the tour, public/site.js points each link at
// the slide being shown, so the other lens opens there (or at its first slide).
const lensSwitch = (lenses, current, suffix = '') => (lenses.length > 1 ? html`<nav class="lens" aria-label="Whose numbers">
    ${lenses.map((l) => html`<a href="${suffix && l.href === '/' ? '' : l.href}${suffix}"${raw(l.id === current ? ' aria-current="page"' : '')}>${l.label}</a>`)}
  </nav>` : '');

const takePartHref = (t) => `${t.home}#join`;

// slides: the ones this tour shows (an empty tour has only the first and last).
function tourBar(t, slides) {
  return html`<header class="tour-bar">
  <span class="tour-where" data-where>01 · Intro</span>
  <nav class="tour-dots" aria-label="Slides">
    ${slides.map((s, i) => html`<a class="tdot-nav" href="#${s.id}" data-goto="${i}" data-deck-dot aria-label="${`${i + 1}: ${s.label}`}"${raw(i === 0 ? ' aria-current="step"' : '')}><i></i><span class="tip">${s.label}</span></a>`)}
  </nav>
  <div class="tour-right">
    ${lensSwitch(t.lenses, t.lens)}
    ${t.tookPart ? '' : html`<a class="tour-join" href="#join" data-goto="${slides.length - 1}">Take part</a>`}
  </div>
</header>
<a class="tour-side prev" href="#intro" data-deck-step="-1" aria-label="Previous slide">${raw(ICON.left)}</a>
<a class="tour-side next" href="#${slides[1].id}" data-deck-step="1" aria-label="Next slide">${raw(ICON.right)}</a>`;
}

const slideHead = (title, meta) => html`<header class="tour-head"><h2>${title}</h2>${meta ? html`<p>${meta}</p>` : ''}</header>`;

// ---------- the tour ----------

// t: see tourData() in server.js.
export function tourPage(t) {
  const title = t.lens === 'company' ? t.groupName : t.lens === 'you' ? (t.profile?.name || (t.who?.subj === 'you' ? 'Your results' : 'Their results')) : '';
  const empty = !t.all.radar.total;
  // Someone who has answered already is not asked to take part again.
  const slides = (empty && t.lens !== 'you' ? [SLIDES[0], SLIDES.at(-1)] : SLIDES)
    .map((s) => (s.id === 'join' && t.tookPart ? { ...s, label: EXPLORE } : s));
  return page({
    title,
    deck: true,
    noindex: t.lens !== 'everyone',
    styles: ['tour.css'],
    body: html`
<div class="deck tour" data-deck data-tour>
  ${introSlide(t)}
  ${t.lens === 'you' ? html`${myTacticsSlide(t)}${mySetupSlide(t)}${myListSlide(t, 'models')}${myListSlide(t, 'harnesses')}${myWhereSlide(t)}`
    : empty ? '' : html`${habitsSlide(t)}${setupsSlide(t)}${stackSlide(t, 'models')}${stackSlide(t, 'harnesses')}${whereSlide(t)}`}
  ${joinSlide(t, slides.length)}
</div>
${tourBar(t, slides)}`,
  });
}

function introSlide(t) {
  const c = t.counts;
  const eyebrow = t.lens === 'everyone' && c.people >= SHOW_PEOPLE_FROM
    ? `${formatNumber(c.people)} people${c.companies >= SHOW_COMPANIES_FROM ? ` · ${formatNumber(c.companies)} companies` : ''}${c.countries > 1 ? ` · ${c.countries} countries` : ''}`
    : t.lens === 'company' ? `${plural(t.group.radar.total, 'person', 'people')} at ${t.groupName}` : '';
  const headline = t.lens === 'company' ? `How ${t.groupName} works with LLMs`
    : t.lens === 'you' ? (t.who.subj === 'you' ? 'How you work with LLMs' : `How ${t.who.subj} works with LLMs`)
      : 'How people around the world work with LLMs?';
  const lede = t.lens === 'company' ? `Only ${t.groupName}’s answers, as totals from ${MIN_GROUP} people up. World shows everyone’s.`
    : t.lens === 'you' ? `Only ${t.who.poss} own answer, from ${monthOf(t.me.latest.created_at)}. World shows everyone’s.`
      : !t.all.radar.total ? 'Assistants read their own history with the people they work for, name the habits they find, and send them here after a yes. Nothing has been counted yet: yours could be the first.'
        : 'Their own assistants read their history, named the habits they found, and sent them here after a yes.';
  const you = t.lenses.find((l) => l.id === 'you');
  return html`<section class="slide tslide intro" id="intro" aria-label="1: Intro">
    <div class="intro-inner">
      ${eyebrow ? html`<p class="eyebrow">${eyebrow}</p>` : ''}
      <h1>${headline}</h1>
      <p class="lede">${lede}</p>
      ${t.owner?.code ? html`<p class="note-line ht" tabindex="0">Keep ${t.who.poss} page: editor’s code <code>${t.owner.code}</code><button type="button" class="linklike" data-copy="${t.owner.code}">Copy</button><span class="tip wide">It lets you rename, lock or delete this page from any browser. It is shown only for a few minutes.</span></p>` : ''}
      ${t.owner?.review ? html`<p class="note-line">${t.owner.review}</p>` : ''}
      <div class="intro-actions">
        ${t.all.radar.total || t.lens === 'you' ? html`<a class="go" href="#tactics" data-goto="1">Start ${raw(ICON.arrow)}</a>` : html`<a class="go" href="#join" data-goto="1">${t.tookPart ? EXPLORE : 'Take part'} ${raw(ICON.arrow)}</a>`}
        ${you && t.lens !== 'you' ? html`<a class="quiet" href="${you.href}">Your results</a>` : ''}
      </div>
    </div>
  </section>`;
}

// ---------- 02 tactics: the radar ----------

// The radar's tinted quadrants, its rings (one label per ring, centre outwards;
// an empty label shows none) and the quadrant names that filter it.
const RING_AT = ['60%', '73.4%', '85.2%', '95.3%'];
const SHARE_RINGS = ['Most', 'Many', 'Some', 'Few'];
const radarDisc = (labels) => html`<div class="tradar-disc" aria-hidden="true">
        <i class="qt q0"></i><i class="qt q1"></i><i class="qt q2"></i><i class="qt q3"></i>
        <i class="ring r1"></i><i class="ring r2"></i><i class="ring r3"></i>
        ${labels.map((l, i) => (l ? html`<span class="ring-label" style="left:${RING_AT[i]}">${l}</span>` : ''))}
      </div>
      ${QUADRANTS.map((q, i) => html`<button type="button" class="quad q${i}" data-quad="${q.id}" aria-pressed="false" title="${q.blurb}">${q.label}</button>`)}`;

function habitsSlide(t) {
  const all = new Map(t.all.radar.patterns.map((p) => [p.id, p]));
  const company = t.lens === 'company';
  const you = t.lens === 'you';
  const mine = you ? t.me.patterns : null;
  // On a person's page, every catalog habit of their latest answer has a dot,
  // also one still waiting for review that nobody's counted answer has yet.
  // Habits outside the catalog are left out.
  const missing = you ? [...mine].filter((id) => !all.has(id) && catalogById.has(id))
    .map((id) => ({ ...catalogById.get(id), count: 0, share: 0, status: 'active', trend: [] })) : [];
  const source = company ? t.group.radar.patterns : [...t.all.radar.patterns, ...missing];
  const size = (p) => (you ? (mine.has(p.id) ? 30 : 12) : 16 + Math.round(p.share / 6));
  // Dot sizes are in px at the radar's full 560px (600 radar units); they scale with it (tour.css).
  const items = place(source.map((p) => ({ ...p, q: quadIndex(p.quadrant), radius: shareRadius(p.share), size: (size(p) * 600) / 560 })));
  // The order Previous and Next step through in a habit's card: round the radar, centre outwards.
  const order = [...items].sort((a, b) => a.q - b.q || a.radius - b.radius);
  // Each dot's number in the legend: its place in that order, so 1 is the most
  // common Brief tactic. Dots large enough show it too.
  const code = new Map(order.map((p, i) => [p.id, String(i + 1)]));
  const labelled = (p) => size(p) >= 20;
  const hollow = (p) => p.status === 'fading' || p.status === 'stopped';
  const shareLine = (p) => (company ? `${p.share}% at ${t.groupName}`
    : you ? (mine.has(p.id) ? `${t.who.Subj} ${t.who.does} this · ${!t.me.counted ? (p.count ? `${p.share}% of people do too` : 'not counted yet') : p.count > 1 ? `${p.share}% of people, ${t.who.subj} included` : `only ${t.who.subj} so far`}` : `${p.share}% of people`)
      : `${p.share}% of people`);
  const meta = company ? `Closer to the centre: more people at ${t.groupName} do it. Select a dot for details.`
    : you ? `${t.who.Poss} ${plural(mine.size, 'habit')} ${mine.size === 1 ? 'is the large dot' : 'are the large dots'}. Closer to the centre: more people do it.`
      : 'Closer to the centre: more people do it. Select a dot for details.';
  return html`<section class="slide tslide" id="tactics" aria-label="2: Tactics">
    ${slideHead(company ? `The tactics at ${t.groupName}` : you ? `Where ${t.who.subj} sit${t.who.subj === 'you' ? '' : 's'} on the radar` : 'The tactics people work with', meta)}
    <div class="tradar-wrap">
    <div class="tradar" data-tradar>
      ${radarDisc(SHARE_RINGS)}
      ${items.map((p) => html`<button type="button" class="hdot q${p.q}${you ? (mine.has(p.id) ? ' mine' : ' dim') : ''}${hollow(p) ? ' hollow' : ''}" data-q="${p.quadrant}" popovertarget="h-${p.id}" style="left:${p.x}%;top:${p.y}%;--s:${size(p)}px" aria-label="${`${code.get(p.id)} ${p.title}: ${shareLine(p)}`}">${labelled(p) ? html`<span class="hcode" aria-hidden="true">${code.get(p.id)}</span>` : ''}<span class="tip">${code.get(p.id)} · ${p.title}<br><span class="tip-note">${shareLine(p)}</span></span></button>`)}
    </div>
    <nav class="tlegend" data-tlegend aria-label="Tactics on the radar">
      ${QUADRANTS.map((q, qi) => {
        const rows = order.filter((p) => p.q === qi);
        return rows.length ? html`<div class="tleg-group" data-q="${q.id}">
          <h3 class="tleg-head q${qi}">${q.label}</h3>
          <ol>${rows.map((p) => html`<li><button type="button" class="tleg-row${you && !mine.has(p.id) ? ' dim' : ''}${you && mine.has(p.id) ? ' mine' : ''}" popovertarget="h-${p.id}" aria-label="${`${code.get(p.id)} ${p.title}: ${shareLine(p)}`}"><span class="tleg-code q${qi}${hollow(p) ? ' hollow' : ''}">${code.get(p.id)}</span><span class="tleg-title">${p.title}</span><span class="tleg-share">${p.count ? `${p.share}%` : '–'}</span></button></li>`)}</ol>
        </div>` : '';
      })}
    </nav>
    </div>
    ${order.map((p, i) => habitCard({ ...p, code: code.get(p.id) }, shareLine(p), company ? t.group.radar.patterns.find((x) => x.id === p.id) : all.get(p.id),
    order.length > 1 ? { prev: order[(i - 1 + order.length) % order.length], next: order[(i + 1) % order.length], at: i + 1, of: order.length } : null))}
  </section>`;
}

function habitCard(p, line, source, nav = null) {
  const trend = source?.trend ?? [];
  const top = Math.max(1, ...trend.map((m) => m.share));
  return html`<div class="tcard" id="h-${p.id}" popover role="dialog" aria-labelledby="h-${p.id}-t">
    <div class="tcard-top"><span class="badge q${p.q}">${QUADRANTS[p.q].label}${p.code ? ` · ${p.code}` : ''}</span><button type="button" class="x" popovertarget="h-${p.id}" popovertargetaction="hide" aria-label="Close">${raw(ICON.close)}</button></div>
    <h3 id="h-${p.id}-t">${p.title}</h3>
    <p class="tcard-share">${line}</p>
    <p>${p.summary}</p>
    ${trend.length ? html`<div class="mini-trend q${p.q}" role="img" aria-label="${`Share each month: ${trend.map((m) => `${m.label} ${m.n ? `${m.share}%` : NONE_SHOWN}`).join(', ')}`}">${trend.map((m) => html`<span class="ht" tabindex="-1"><i style="height:${m.n ? Math.max(4, (m.share / top) * 100).toFixed(0) : 0}%"></i><b>${m.label}</b><span class="tip">${m.label}: ${m.n ? `${m.share}%` : NONE_SHOWN}</span></span>`)}</div>` : ''}
    ${p.when ? html`<p class="muted small"><b>When:</b> ${p.when}</p>` : ''}
    ${nav ? html`<div class="tcard-nav">
      <button type="button" class="tcard-step" data-card-to="h-${nav.prev.id}" data-card-step="-1"${raw(nav.at === 1 ? ' data-card-wrap' : '')} aria-label="${`Previous: ${nav.prev.title}`}">${raw(ICON.left)}</button>
      <span class="muted small">${nav.at} of ${nav.of}</span>
      <button type="button" class="tcard-step" data-card-to="h-${nav.next.id}" data-card-step="1"${raw(nav.at === nav.of ? ' data-card-wrap' : '')} aria-label="${`Next: ${nav.next.title}`}">${raw(ICON.right)}</button>
    </div>` : ''}
  </div>`;
}

// A month with no answers, or (for a company) too few to show without pointing at someone.
const NONE_SHOWN = 'too few answers to show';

// ---------- 03 setups ----------

// The setups a lens shows: rows of tools with their share, and the remainder
// ("N other setups") that the Show more button opens step by step.
function setupsSlide(t) {
  const company = t.lens === 'company';
  const you = t.lens === 'you';
  const data = company ? t.group.setups : t.all.setups;
  const total = data.total || 1;
  // At a company, a setup gets its own row only from MIN_GROUP people, so no row is one colleague's.
  const list = (company ? data.setups.filter((s) => s.count >= MIN_GROUP) : data.setups).slice(0, SETUPS_MAX);
  const mineKey = you ? t.me.setupKey : null;
  const mineTools = you ? t.me.tools : new Set();
  // One scale for every row: the most common setup fills the bar. The remainder's bar may run full.
  const top = Math.max(1, ...list.map((s) => s.share));
  const toolShare = shareLookup(t);
  const seen = new Map();
  const avatars = (tools, forceMine) => html`<span class="avatars">${tools.map((x) => {
    seen.set(toolSlug(x.name), x);
    const dim = you && !forceMine && !mineTools.has(x.name.toLowerCase());
    return html`<button type="button" class="tc k-${x.category}${markClass(x.name)}${dim ? ' dim' : ''}" popovertarget="tp-${toolSlug(x.name)}" aria-label="${`${x.name}: details`}">${mark(x.name)}<span class="tip">${x.name}</span></button>`;
  })}</span>`;
  const row = (s, rank, { pinned = false, hidden = false } = {}) => {
    const id = `s-${pinned ? 'mine' : rank}`;
    const isMine = s.key === mineKey;
    const overlap = s.tools.filter((x) => mineTools.has(x.name.toLowerCase())).length;
    const workIn = (n) => `${plural(n, 'person works', 'people work')} in exactly this setup.`;
    const note = company ? `${round(s.share)}% of ${t.groupName} work in exactly this setup.`
      : isMine ? `${t.who.Poss} setup. ${s.count ? workIn(s.count) : 'Nobody in the current numbers shares it.'}`
        : you ? `${overlap} of ${t.who.poss} ${plural(t.me.setupSize, 'tool')} · ${workIn(s.count)}`
          : workIn(s.count);
    return html`<li class="srow${isMine && you ? ' mine' : ''}"${raw(hidden ? ' hidden data-more' : '')}>
      <span class="rank">${pinned ? (s.count ? `#${rank}` : '—') : rank}</span>
      ${avatars(s.tools, isMine)}
      <button type="button" class="sbar" aria-expanded="false" aria-controls="${id}" data-toggle>
        <span class="bars"><span class="bar"><i style="width:${Math.min(100, (s.share / top) * 100).toFixed(1)}%"></i></span></span>
        <strong>${round(s.share)}%</strong>
      </button>
      <p class="snote" id="${id}" hidden>${note}</p>
    </li>`;
  };
  // A person's own setup, also when nobody in the current numbers shares it.
  const mineAt = mineKey ? data.setups.findIndex((s) => s.key === mineKey) : -1;
  const mineRank = mineAt >= 0 ? mineAt + 1 : data.setups.length + 1;
  const mineSetup = !mineKey ? null : mineAt >= 0 ? data.setups[mineAt] : { key: mineKey, tools: t.me.setupTools, count: 0, share: 0 };
  // Among the rows shown first, a person's setup is marked in place; otherwise it is pinned on top (and not listed again).
  const pinMine = mineSetup && !(mineAt >= 0 && mineAt < SETUPS_FIRST);
  // The rows under the pinned one: the list without it. The pinned row is always
  // shown, so its share and its place never count towards the rest.
  const pinnedIn = pinMine && mineAt >= 0;
  const others = list.map((s, i) => ({ s, rank: i + 1 })).filter(({ rank }) => !(pinnedIn && rank - 1 === mineAt));
  const pinnedShare = pinnedIn ? mineSetup.share : 0;
  // What the last row says after 0, 1, 2… clicks on Show more.
  const steps = [];
  for (let shown = Math.min(SETUPS_FIRST, others.length); ; shown = Math.min(others.length, shown + SETUPS_STEP)) {
    const rest = data.setups.length - (pinnedIn ? 1 : 0) - shown;
    const share = Math.max(0, 100 - pinnedShare - others.slice(0, shown).reduce((a, { s }) => a + s.share, 0));
    const none = data.none ? ` and ${plural(data.none, 'person', 'people')} who named no coding tools` : '';
    steps.push({
      label: rest > 0 ? (company ? `${plural(rest, shown ? 'other setup' : 'setup')}, each of fewer than ${MIN_GROUP} people${none ? ',' : ''}${none}` : `${plural(rest, 'other setup')}, each rarer${none ? ',' : ''}${none}`) : `${none.replace(/^ and /, '')}`,
      share: round(share), w: Math.min(100, (share / top) * 100).toFixed(1), more: shown < others.length ? Math.min(SETUPS_STEP, others.length - shown) : 0,
    });
    if (shown >= others.length) break;
  }
  const meta = company ? `Every person at ${t.groupName} works in one setup, so the rows add up to 100%. Select a tool for details.`
    : you ? (!mineSetup ? `${t.who.Poss} answer named no coding tools.` : mineSetup.count === 1 ? `Nobody else works exactly like ${t.who.subj} yet.` : mineSetup.count ? `${round(mineSetup.share)}% of people work exactly like ${t.who.subj}.` : `Nobody in the last few months works exactly like ${t.who.subj}.`)
      : 'Each person works in one setup, so the rows add up to 100%. Select a tool for details.';
  const first = steps[0];
  return html`<section class="slide tslide" id="setups" aria-label="3: Setups">
    ${slideHead(company ? `The setups ${t.groupName} works in` : you ? (mineSetup && mineAt !== 0 && mineSetup.share < 5 ? `${t.who.Poss} setup is rarer than most` : `${t.who.Poss} setup, among everyone’s`) : 'The setups people work in',
      html`${meta} · <a href="${t.home === '/' ? '' : t.home}/tools">All tools</a>`)}
    <ol class="setups" data-setups>
      ${pinMine ? row(mineSetup, mineRank, { pinned: true }) : ''}
      ${others.map(({ s, rank }, j) => row(s, rank, { hidden: j >= SETUPS_FIRST }))}
      ${first.share > 0 || first.more ? html`<li class="srow other" data-other data-steps="${JSON.stringify(steps)}">
        <span></span>
        <span class="other-text"><span class="ht" tabindex="0" data-other-label>${first.label}<span class="tip">Every person has exactly one setup, so all rows add up to 100%.</span></span>
          <button type="button" class="more" data-more-btn${raw(first.more ? '' : ' hidden')}>Show ${first.more} more</button>
          <button type="button" class="more less" data-less-btn hidden>Show fewer</button></span>
        <span class="sbar static"><span class="bars"><span class="bar grey"><i style="width:${first.w}%" data-other-bar></i></span></span><strong data-other-share>${first.share}%</strong></span>
      </li>` : ''}
    </ol>
    ${[...seen.values()].map((x) => toolPopover(t, x, toolShare(x.name)))}
  </section>`;
}

// A tool's share under the current lens, and among everyone.
function shareLookup(t) {
  const all = new Map(t.all.tools.map((x) => [x.name.toLowerCase(), x]));
  const group = t.group ? new Map(t.group.tools.map((x) => [x.name.toLowerCase(), x])) : null;
  return (name) => {
    const a = all.get(name.toLowerCase());
    const g = group?.get(name.toLowerCase());
    return { all: a?.share ?? 0, group: group ? g?.share ?? 0 : null, daily: a?.daily ?? null, groupDaily: g?.daily ?? null };
  };
}

// How often a tool is used: its users' daily share (the lens's group's when
// it has enough answers), and in the You lens, how often this person said.
function dailyFigure(t, name, share) {
  const own = t.lens === 'you' ? t.me.toolFrequency?.get(name.toLowerCase()) : null;
  // At a company, only its own users' share (shown once enough of them answered).
  const daily = t.lens === 'company' ? share.groupDaily : share.daily;
  const whose = t.lens === 'company' ? `of ${t.groupName}’s users` : 'of its users';
  return html`${daily != null ? html`<span><strong>${daily}%</strong><span>${whose} use it daily</span></span>` : ''}${own ? html`<span><strong>${FREQUENCY_WORD[own]}</strong><span>${t.who.subj === 'you' ? 'how often you use it' : 'how often they use it'}</span></span>` : ''}`;
}
const FREQUENCY_WORD = { daily: 'Daily', weekly: 'Weekly', occasionally: 'Now and then' };

function toolPopover(t, x, share) {
  const base = t.home === '/' ? '' : t.home;
  const company = t.lens === 'company';
  const yours = t.lens === 'you' && t.me.tools.has(x.name.toLowerCase());
  return html`<div class="tcard tool-pop" id="tp-${toolSlug(x.name)}" popover role="dialog" aria-labelledby="tp-${toolSlug(x.name)}-t">
    <div class="tcard-top"><span class="tool-id"><span class="tc big k-${x.category}${markClass(x.name)}" aria-hidden="true">${mark(x.name)}</span><span><h3 id="tp-${toolSlug(x.name)}-t">${x.name}</h3><span class="muted small">${KIND_ONE[x.category] ?? 'Tool'}</span></span></span>
      <button type="button" class="x" popovertarget="tp-${toolSlug(x.name)}" popovertargetaction="hide" aria-label="Close">${raw(ICON.close)}</button></div>
    ${toolAbout(x.name) ? html`<p class="muted">${toolAbout(x.name)}</p>` : ''}
    <div class="figures">
      ${company ? html`<span><strong>${share.group ?? 0}%</strong><span>of ${t.groupName}</span></span>` : ''}
      ${company ? '' : html`<span><strong>${share.all}%</strong><span>${yours ? `of people, ${t.who.subj} too` : 'of people use it'}</span></span>`}
      ${dailyFigure(t, x.name, share)}
    </div>
    <div class="tcard-links"><a href="${base}/tools/${toolSlug(x.name)}">Tool details →</a><a class="muted" href="${base}/tools">${company ? `All of ${t.groupName}’s tools` : 'All tools people use'}</a></div>
  </div>`;
}

// ---------- 04 models and 05 harnesses: stacked bars by month ----------

const STACK_COLORS = 7; // s0..s6, then grey for Other

function stackSlide(t, kind) {
  const company = t.lens === 'company';
  const you = t.lens === 'you';
  const views = kind === 'models' ? [['families', 'Families'], ['versions', 'Versions']] : [['harnesses', null]];
  const titles = {
    models: company ? `The models ${t.groupName} works with` : you ? `${t.who.Poss} models, among everyone’s` : 'The models people work with',
    harnesses: company ? `The coding agents ${t.groupName} works in` : you ? `${t.who.Poss} coding agents, among everyone’s` : 'The coding agents people work in',
  };
  const named = you && t.me[views[0][0]]?.size;
  const meta = company ? `Each month adds up to 100%: everyone at ${t.groupName} counts once, split over what they named. Hover a block for its share.`
    : you && !named ? `${t.who.Poss} answer named no ${kind === 'models' ? 'models' : 'coding agent'}.`
    : you ? `${t.who.Poss} ${kind === 'models' ? 'models' : 'agents'} are in colour. A dot marks months ${t.who.subj} answered.`
      : 'Each month adds up to 100%: everyone counts once, split over what they named. Hover a block for its share.';
  const at = SLIDES.findIndex((s) => s.id === kind) + 1;
  return html`<section class="slide tslide" id="${kind}" aria-label="${`${at}: ${SLIDES[at - 1].label}`}">
    ${slideHead(titles[kind], meta)}
    ${views.length > 1 ? html`<div class="seg-switch" role="group" aria-label="Show">${views.map(([id, label], i) => html`<button type="button" data-stack-view="${id}" aria-pressed="${i === 0}">${label}</button>`)}</div>` : ''}
    ${views.map(([id], i) => stackChart(t, id, { hidden: i > 0, company, you }))}
  </section>`;
}

function stackChart(t, id, { hidden, company, you }) {
  const main = company ? t.group[id] : t.all[id];
  const mineNames = you ? t.me[id] : null;
  // Colours follow the bar's names.
  const color = (_, name) => (name === 'Other' || !main.names.includes(name) ? 'so' : `s${Math.min(STACK_COLORS - 1, main.names.indexOf(name))}`);
  const bar = (stack, m, cls) => html`<span class="mstack ${cls}">${stack.names.map((name, i) => ({ name, v: m.parts[i], i })).filter((p) => p.v > 0.4).map((p) => html`<span class="seg ht ${color(stack.names, p.name)}${mineNames && !mineNames.has(p.name) ? ' dim' : ''}" style="height:${p.v.toFixed(2)}%" tabindex="-1"><span class="tip">${m.label} · ${p.name} ${round(p.v)}%</span></span>`)}</span>`;
  return html`<figure class="stacks" data-stack="${id}"${raw(hidden ? ' hidden' : '')}>
    <div class="stack-cols" role="img" aria-label="${main.months.map((m) => `${m.label}: ${main.names.map((n, i) => `${n} ${round(m.parts[i])}%`).join(', ')}`).join('; ')}">
      ${main.months.map((m) => html`<div class="stack-col">
        ${you && t.me.months.has(m.key) ? html`<i class="answered" title="${`${t.who.Subj} answered in ${m.label}`}"></i>` : ''}
        <div class="stack-pair">
          ${m.n ? bar(main, m, '') : html`<span class="mstack empty"></span>`}
        </div>
        <span class="stack-label">${m.label}</span>
      </div>`)}
    </div>
    <figcaption class="stack-legend">${main.names.map((name) => html`<span class="${mineNames && !mineNames.has(name) ? 'dim' : ''}"><i class="${color(main.names, name)}"></i>${name}</span>`)}</figcaption>
  </figure>`;
}

// ---------- 06 where ----------

function whereSlide(t) {
  const company = t.lens === 'company';
  const where = (company ? t.group.where : t.all.where).filter((c) => c.id !== NO_COUNTRY);
  const byId = new Map(where.map((c) => [c.id, c]));
  const max = Math.max(1, ...where.map((c) => c.count));
  const level = (n) => Math.min(4, 1 + Math.floor((3.999 * Math.log(n)) / Math.log(max + 1)));
  const mine = t.lens === 'you' ? t.me.country : null;
  const people = (c) => plural(c.count, 'person', 'people');
  const elsewhere = company ? t.group.elsewhere : 0;
  const meta = company ? `Where ${t.groupName}’s ${plural(where.reduce((a, c) => a + c.count, 0) + elsewhere, 'answer')} came from.${elsewhere ? ` ${elsewhere === where.reduce((a, c) => a + c.count, 0) + elsewhere ? 'All of them' : formatNumber(elsewhere)} from countries with fewer than ${MIN_GROUP} people, not shown.` : ''}`
    : mine ? `${t.who.Poss} country is in orange. Hover a country for its count.` : `${plural(where.length, 'country', 'countries')} so far. Hover one for its count.`;
  return html`<section class="slide tslide" id="where" aria-label="6: Where">
    ${slideHead(company ? `Where ${t.groupName} works from` : 'Where the answers came from', meta)}
    <div class="map-box">
      <svg class="tworld" viewBox="0 0 ${WORLD.width} ${WORLD.height}" role="img" aria-label="${`World map. Answers came from: ${where.map((c) => `${c.label} (${c.count})`).join(', ')}`}" data-map>
        ${COUNTRIES.filter((c) => c.d && !byId.has(c.id) && c.id !== mine).map((c) => html`<path d="${c.d}"/>`)}
        ${COUNTRIES.filter((c) => c.d && (byId.has(c.id) || c.id === mine)).map((c) => html`<path class="${c.id === mine ? 'mine' : `m${level(byId.get(c.id).count)}`}" d="${c.d}" data-tip="${c.label}" data-tip-note="${byId.has(c.id) ? people(byId.get(c.id)) : ''}${c.id === mine ? `${byId.has(c.id) ? ' · ' : ''}${t.who.poss} country` : ''}"/>`)}
      </svg>
      <div class="map-tip" role="tooltip" hidden data-map-tip><b></b><span></span></div>
      <div class="map-scale" aria-hidden="true"><span>Fewer</span><i class="m1"></i><i class="m2"></i><i class="m3"></i><i class="m4"></i><span>More</span></div>
    </div>
  </section>`;
}

// ---------- 07 take part ----------

// at: its number among the slides shown.
function joinSlide(t, at) {
  if (t.tookPart) return exploreSlide(t, at);
  const counts = (where) => html`<span class="counts-in">Counts in ${where.map((w) => html`<span class="in-tag ${w.cls}">${w.label}</span>`)}</span>`;
  return html`<section class="slide tslide tjoin" id="join" aria-label="${`${at}: Take part`}">
    <div class="join-inner">
      <h2>Add yours</h2>
      <p class="lede">Usually a few minutes. Your assistant does the work, and nothing is sent without your yes.</p>
      <div class="join-cards">
        <a class="join-card" href="${t.again ?? '/contribute'}"><strong>Just me</strong><span>A page with your own results</span>${counts([{ label: 'World', cls: 'all' }])}</a>
        ${t.joinCompany
          ? html`<a class="join-card" href="${t.joinCompany}"><strong>With ${t.groupName}</strong><span>Add your answer to ${t.groupName}’s page</span>${counts([{ label: t.groupName, cls: 'co' }, { label: 'World', cls: 'all' }])}</a>`
          : html`<a class="join-card" href="/contribute?for=company"><strong>With my company</strong><span>A page for your team, and a link for colleagues</span>${counts([{ label: 'Your company', cls: 'co' }, { label: 'World', cls: 'all' }])}</a>`}
      </div>
      ${promptTip('What does my assistant do?')}
      ${joinFoot(t)}
    </div>
  </section>`;
}

// The last slide for a browser that has answered already: one card per lens
// (World, Company, You), each opening at its first numbers; the one being
// looked at goes back to its start. A lens it does not
// have yet (no company) is offered as a card to start it. Running the survey
// again stays, as a quiet link.
function exploreSlide(t, at) {
  const about = {
    everyone: 'Everyone’s answers, from around the world',
    company: `${t.lenses.find((l) => l.id === 'company')?.label ?? 'Your company'}’s totals only`,
    you: t.who && t.who.subj !== 'you' ? `Only ${t.who.poss} own answer` : 'Only your own answer',
  };
  const card = (l) => (l.id === t.lens
    ? html`<a class="join-card here" href="#intro" data-goto="0" aria-current="page"><strong>${l.label}</strong><span>${about[l.id]}</span><span class="counts-in"><span class="in-tag here">You are here</span></span></a>`
    : html`<a class="join-card" href="${l.href}#tactics"><strong>${l.label}</strong><span>${about[l.id]}</span></a>`);
  const noCompany = !t.lenses.some((l) => l.id === 'company');
  const n = t.lenses.length + (noCompany ? 1 : 0);
  return html`<section class="slide tslide tjoin" id="join" aria-label="${`${at}: ${EXPLORE}`}">
    <div class="join-inner">
      <h2>Your answer is in</h2>
      <p class="lede">See it on its own, and everyone’s totals${t.lenses.some((l) => l.id === 'company') ? ' and your company’s' : ''}.</p>
      <div class="join-cards n${n}">
        ${t.lenses.map(card)}
        ${noCompany ? html`<a class="join-card" href="/contribute?for=company"><strong>Your company</strong><span>A page for your team, and a link for colleagues</span></a>` : ''}
      </div>
      <p class="muted small"><a href="${t.again ?? '/contribute'}">Run the survey again</a>${t.joinCompany ? html` · <a href="${t.joinCompany}">Add your answer to ${t.groupName}’s page</a>` : ''}</p>
      ${joinFoot(t)}
    </div>
  </section>`;
}

const joinFoot = (t) => html`${t.owner?.invite ? html`<p class="muted small"><button type="button" class="linklike" data-copy="${t.owner.invite}">Copy an invitation link for a friend</button></p>` : ''}
      <p class="muted small foot-line">${t.owner?.edit ? html`<a href="${t.owner.edit}">Edit or delete ${t.owner.kind === 'c' ? 'this page' : 'your page'}</a> · ` : ''}<a href="/contribute.md">Read the prompt</a> · <a href="/privacy">Privacy</a> · ${MADE_BY}</p>`;

// ---------- tool pages ----------

function toolsFrame(t, { title, back, backLabel, body, styles = [] }) {
  return page({
    title,
    bare: true,
    noindex: t.lens !== 'everyone',
    styles: ['tour.css', ...styles],
    body: html`<div class="tools-page">
  <header class="tour-bar static">
    <a class="back" href="${back}">${raw(ICON.left)}${backLabel}</a>
    <span class="tour-where">Tools</span>
    <div class="tour-right">${lensSwitch(t.lenses, t.lens, t.suffix)}</div>
  </header>
  ${body}
</div>`,
  });
}

// Every tool people named, grouped by kind, most used first.
export function toolsIndexPage(t) {
  if (t.lens === 'you') return myToolsPage(t);
  const base = t.home === '/' ? '' : t.home;
  const company = t.lens === 'company';
  const you = t.lens === 'you';
  const share = shareLookup(t);
  const groups = TOOL_CATEGORIES.map((c) => ({ ...c, tools: (company ? t.group : t.all).tools.filter((x) => x.category === c.id) }))
    .filter((g) => g.tools.length)
    .map((g) => ({ ...g, tools: [...g.tools].sort((a, b) => (company ? (share(b.name).group ?? 0) - (share(a.name).group ?? 0) : b.share - a.share)) }));
  const line = (x) => {
    const s = share(x.name);
    return company ? `${s.group ?? 0}% of ${t.groupName}` : you && t.me.tools.has(x.name.toLowerCase()) ? `${t.who.subj === 'you' ? 'yours' : 'theirs'} · ${s.all}%` : `${s.all}% of people`;
  };
  return toolsFrame(t, {
    title: 'Tools',
    back: `${t.home}#setups`, backLabel: 'Setups',
    body: html`<div class="tools-head">
    <h1>${company ? `The tools ${t.groupName} works with` : you ? `${t.who.Poss} tools, among everyone’s` : 'Every tool people work with'}</h1>
    <p>${plural((company ? t.group : t.all).tools.length, 'tool')} from ${plural((company ? t.group : t.all).radar.total, 'answer')}${company ? `. Select one for ${t.groupName}’s numbers.` : you ? `. ${t.who.Poss} tools are in full colour.` : '. Hover for what a tool is, select one for details.'}</p>
    <label class="find"><span class="sr-only">Find a tool</span>${raw(ICON.search)}<input type="search" placeholder="Find a tool" data-tool-filter></label>
  </div>
  <div class="tools-list" data-tools-list>
    ${groups.map((g) => html`<section class="tool-group" data-group>
      <h2>${g.label}<small data-count="${g.tools.length}">${plural(g.tools.length, 'tool')}</small></h2>
      <ul>${g.tools.map((x) => html`<li data-name="${x.name.toLowerCase()}"><a class="tool-tile ht${you && !t.me.tools.has(x.name.toLowerCase()) ? ' dim' : ''}" href="${base}/tools/${toolSlug(x.name)}">
        <span class="tc k-${x.category}${markClass(x.name)}" aria-hidden="true">${mark(x.name)}</span>
        <span class="tool-tile-text"><strong>${x.name}</strong><span>${line(x)}</span></span>
        ${toolAbout(x.name) ? html`<span class="tip wide">${toolAbout(x.name)}</span>` : ''}
      </a></li>`)}</ul>
    </section>`)}
    <p class="muted" data-no-match hidden>No tool by that name yet.</p>
  </div>`,
  });
}

// One tool: its share, six months of it, and what people use it with.
export function toolPage(t, { tool, detail, groupDetail = null, prev, next }) {
  if (t.lens === 'you') return myToolPage(t, tool);
  const base = t.home === '/' ? '' : t.home;
  const company = t.lens === 'company';
  const yours = t.lens === 'you' && t.me.tools.has(tool.name.toLowerCase());
  const series = (company ? groupDetail ?? { series: [] } : detail).series;
  // What it is used with and for, under the lens: at a company, only once
  // ${MIN_GROUP} colleagues use it, so no section describes one of them.
  const about = !company ? detail : groupDetail && groupDetail.count >= MIN_GROUP ? groupDetail : { with: [], uses: [] };
  const top = Math.max(1, ...series.map((m) => m.share));
  const url = toolUrl(tool.name);
  return toolsFrame(t, {
    title: tool.name,
    back: `${base}/tools`, backLabel: 'All tools',
    body: html`<article class="tool-detail">
    <div class="tool-detail-head">
      <span class="tc huge k-${tool.category}${markClass(tool.name)}" aria-hidden="true">${mark(tool.name)}</span>
      <div>
        <p class="eyebrow">${KIND_ONE[tool.category] ?? 'Tool'}${yours ? ` · ${t.who.subj === 'you' ? 'one of yours' : 'one of theirs'}` : ''}</p>
        <h1>${tool.name}</h1>
        ${toolAbout(tool.name) ? html`<p class="lede">${toolAbout(tool.name)}</p>` : ''}
      </div>
    </div>
    <div class="figures big">
      ${company && groupDetail ? html`<span><strong>${groupDetail.share}%</strong><span>of ${t.groupName}</span></span>` : ''}
      ${company ? '' : html`<span><strong>${detail.share}%</strong><span>of people use it</span></span>`}
      ${dailyFigure(t, tool.name, shareLookup(t)(tool.name))}
    </div>
    <section aria-label="Share each month">
      <h2 class="label">Share each month${company ? ` · ${t.groupName}` : ''}</h2>
      <div class="month-cols">${series.map((m) => html`<span class="ht" tabindex="0"><i style="height:${Math.max(3, (m.share / top) * 100).toFixed(0)}%" class="k-${tool.category}"></i><b>${m.label}</b><span class="tip">${m.label}: ${m.n ? `${m.share}% of ${plural(m.n, 'answer')}` : NONE_SHOWN}</span></span>`)}</div>
    </section>
    ${about.with.length ? html`<section>
      <h2 class="label">Most often used with</h2>
      <ul class="with-list">${about.with.map((w) => html`<li><a class="ht" href="${base}/tools/${toolSlug(w.name)}"><span class="tc k-${w.category}${markClass(w.name)}" aria-hidden="true">${mark(w.name)}</span><span><strong>${w.name}</strong><span class="muted small">${w.share}% of its users</span></span></a></li>`)}</ul>
    </section>` : ''}
    ${about.uses.length ? html`<section><h2 class="label">What people use it for</h2><ul class="plain-list">${about.uses.map((u) => html`<li>${u}</li>`)}</ul></section>` : ''}
    ${url ? html`<p><a class="quiet" href="${url}" target="_blank" rel="noopener noreferrer">${url.startsWith('https://duckduckgo.com/') ? 'Search the web' : 'Visit its site'} ↗<span class="sr-only"> (opens in a new tab)</span></a></p>` : ''}
  </article>
  ${prev ? html`<a class="tour-side prev" href="${base}/tools/${toolSlug(prev.name)}" aria-label="${`Previous tool: ${prev.name}`}">${raw(ICON.left)}<span class="tip">${prev.name}</span></a>` : ''}
  ${next ? html`<a class="tour-side next" href="${base}/tools/${toolSlug(next.name)}" aria-label="${`Next tool: ${next.name}`}">${raw(ICON.right)}<span class="tip">${next.name}</span></a>` : ''}`,
  });
}

// ---------- the You lens: one person's own answer, nothing counted across people ----------

// Pages that show only what one person said: their tactics, their tools, their
// models and agents, their country. No shares, no ranks, nothing from anyone
// else; World and Company are where the totals are.

const monthOf = (iso) => new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const verb = (t, base) => (t.who.subj === 'you' ? base : `${base}s`);
const STATUS_WORD = { new: 'Recently started', fading: 'Fading out', stopped: 'Stopped' };
// Free text the person wrote (what a tool is for) is shown on their own page only.
const ownerSees = (t) => t.owner?.kind === 'u';

// The person's tools in their latest answer, each name once.
export function myTools(me) {
  return firstOfEach(me.latest.tools).map((x) => ({ name: x.name, category: toolCategory(x.name, x.kind), frequency: x.frequency, usedFor: x.used_for }));
}
// Their catalog tactics, each once, in radar order. Tactics outside the catalog are left out.
function myTactics(t) {
  const seen = new Set();
  return t.me.latest.patterns
    .filter((p) => catalogById.has(p.catalog_id) && !seen.has(p.catalog_id) && seen.add(p.catalog_id))
    .map((p) => { const c = catalogById.get(p.catalog_id); return { ...c, q: quadIndex(c.quadrant), frequency: p.frequency, status: p.status }; })
    .sort((a, b) => a.q - b.q);
}
// Earlier answers worth listing next to the latest (never a rejected or flagged one).
const earlierAnswers = (t) => t.me.history.slice(0, -1).filter((c) => c.status === 'accepted' || c.status === 'pending').reverse();

// On the You radar, distance from the centre is how often the person said
// they use a tactic (no one else's numbers): the middle of each ring, and
// the outer ring where they did not say.
const FREQUENCY_RADIUS = { daily: 52, weekly: 140, occasionally: 211 };
const UNSAID_RADIUS = 268;

function myTacticsSlide(t) {
  const list = myTactics(t);
  const code = new Map(list.map((p, i) => [p.id, String(i + 1)]));
  const hollow = (p) => p.status === 'fading' || p.status === 'stopped';
  const line = (p) => [FREQUENCY_WORD[p.frequency], STATUS_WORD[p.status]].filter(Boolean).join(' · ') || `${t.who.Subj} ${t.who.does} this`;
  const SIZE = 30; // px at the radar's full 560px, as on the other lenses
  const items = place(list.map((p) => ({ ...p, radius: FREQUENCY_RADIUS[p.frequency] ?? UNSAID_RADIUS, size: (SIZE * 600) / 560 })));
  return html`<section class="slide tslide" id="tactics" aria-label="2: Tactics">
    ${slideHead(`${t.who.Poss} tactics`, list.length ? `${plural(list.length, 'tactic')} from ${t.who.poss} answer, by the part of the work they shape. Closer to the centre: ${t.who.subj} ${verb(t, 'use')} it more often.` : `${t.who.Poss} answer named no tactics from the catalog.`)}
    ${list.length ? html`<div class="tradar-wrap">
    <div class="tradar" data-tradar>
      ${radarDisc(['Daily', 'Weekly', 'Less', ''])}
      ${items.map((p) => html`<button type="button" class="hdot q${p.q}${hollow(p) ? ' hollow' : ''}" data-q="${p.quadrant}" popovertarget="h-${p.id}" style="left:${p.x}%;top:${p.y}%;--s:${SIZE}px" aria-label="${`${code.get(p.id)} ${p.title}: ${line(p)}`}"><span class="hcode" aria-hidden="true">${code.get(p.id)}</span><span class="tip">${code.get(p.id)} · ${p.title}<br><span class="tip-note">${line(p)}</span></span></button>`)}
    </div>
    <nav class="tlegend" data-tlegend aria-label="${`${t.who.Poss} tactics`}">
      ${QUADRANTS.map((q, qi) => {
        const rows = list.filter((p) => p.q === qi);
        return rows.length ? html`<div class="tleg-group" data-q="${q.id}">
          <h3 class="tleg-head q${qi}">${q.label}</h3>
          <ol>${rows.map((p) => html`<li><button type="button" class="tleg-row" popovertarget="h-${p.id}" aria-label="${`${code.get(p.id)} ${p.title}: ${line(p)}`}"><span class="tleg-code q${qi}${hollow(p) ? ' hollow' : ''}">${code.get(p.id)}</span><span class="tleg-title">${p.title}</span><span class="tleg-share">${FREQUENCY_WORD[p.frequency] ?? ''}</span></button></li>`)}</ol>
        </div>` : '';
      })}
    </nav>
    </div>` : ''}
    ${list.map((p, i) => habitCard({ ...p, code: code.get(p.id) }, line(p), null,
      list.length > 1 ? { prev: list[(i - 1 + list.length) % list.length], next: list[(i + 1) % list.length], at: i + 1, of: list.length } : null))}
  </section>`;
}

// Their tools grouped by kind, as tiles that open the tool's page under this lens.
function myToolGroups(t, { filter = false } = {}) {
  const tools = myTools(t.me);
  const groups = TOOL_CATEGORIES.map((c) => ({ ...c, tools: tools.filter((x) => x.category === c.id) })).filter((g) => g.tools.length);
  return html`${groups.map((g) => html`<section class="tool-group"${raw(filter ? ' data-group' : '')}>
    <h2>${g.label}<small data-count="${g.tools.length}">${plural(g.tools.length, 'tool')}</small></h2>
    <ul>${g.tools.map((x) => html`<li data-name="${x.name.toLowerCase()}"><a class="tool-tile ht" href="${t.home}/tools/${toolSlug(x.name)}">
      <span class="tc k-${x.category}${markClass(x.name)}" aria-hidden="true">${mark(x.name)}</span>
      <span class="tool-tile-text"><strong>${x.name}</strong><span>${FREQUENCY_WORD[x.frequency] ?? KIND_ONE[x.category] ?? 'Tool'}</span></span>
      ${x.usedFor && ownerSees(t) ? html`<span class="tip wide">${x.usedFor}</span>` : toolAbout(x.name) ? html`<span class="tip wide">${toolAbout(x.name)}</span>` : ''}
    </a></li>`)}</ul>
  </section>`)}`;
}

function mySetupSlide(t) {
  const n = myTools(t.me).length;
  return html`<section class="slide tslide" id="setups" aria-label="3: Setups">
    ${slideHead(`${t.who.Poss} setup`, n ? html`${plural(n, 'tool')} ${t.who.subj} ${verb(t, 'work')} with, by kind. Select one for details. · <a href="${t.home}/tools">All ${t.who.poss} tools</a>` : `${t.who.Poss} answer named no tools.`)}
    ${n ? html`<div class="my-tools">${myToolGroups(t)}</div>` : ''}
  </section>`;
}

// Models or coding agents: the latest answer's, then each earlier answer's.
function myListSlide(t, kind) {
  const models = kind === 'models';
  const names = (c) => [...new Set(models ? versionNames(c) : harnessNames(c))];
  const latest = names(t.me.latest);
  const often = new Map(myTools(t.me).map((x) => [x.name.toLowerCase(), x.frequency]));
  const earlier = earlierAnswers(t).map((c) => ({ when: monthOf(c.created_at), names: names(c) })).filter((a) => a.names.length);
  const what = models ? 'models' : 'coding agents';
  const at = SLIDES.findIndex((s) => s.id === kind) + 1;
  return html`<section class="slide tslide" id="${kind}" aria-label="${`${at}: ${SLIDES[at - 1].label}`}">
    ${slideHead(`${t.who.Poss} ${what}`, latest.length ? `Named in ${t.who.poss} answer from ${monthOf(t.me.latest.created_at)}.` : `${t.who.Poss} answer named no ${what}.`)}
    <div class="my-list">
      ${latest.length ? html`<ul class="chips">${latest.map((name) => (models
        ? html`<li class="chip mine">${name}</li>`
        : html`<li><a class="chip mine" href="${t.home}/tools/${toolSlug(name)}"><span class="tc k-harness${markClass(name)}" aria-hidden="true">${mark(name)}</span>${name}${FREQUENCY_WORD[often.get(name.toLowerCase())] ? html`<small>${FREQUENCY_WORD[often.get(name.toLowerCase())]}</small>` : ''}</a></li>`))}</ul>` : ''}
      ${earlier.length ? html`<div class="my-earlier"><h3 class="label">Earlier answers</h3><ol>${earlier.map((a) => html`<li><span class="when">${a.when}</span><span>${a.names.join(' · ')}</span></li>`)}</ol></div>` : ''}
    </div>
  </section>`;
}

function myWhereSlide(t) {
  const mine = t.me.country && t.me.country !== NO_COUNTRY ? t.me.country : null;
  return html`<section class="slide tslide" id="where" aria-label="6: Where">
    ${slideHead(`Where ${t.who.subj} ${verb(t, 'work')} from`, mine ? `${t.who.Poss} answer came from ${countryLabel(mine)}.` : `${t.who.Poss} answer named no country.`)}
    <div class="map-box">
      <svg class="tworld" viewBox="0 0 ${WORLD.width} ${WORLD.height}" role="img" aria-label="${mine ? `World map with ${countryLabel(mine)} marked` : 'World map'}" data-map>
        ${COUNTRIES.filter((c) => c.d && c.id !== mine).map((c) => html`<path d="${c.d}"/>`)}
        ${COUNTRIES.filter((c) => c.d && c.id === mine).map((c) => html`<path class="mine" d="${c.d}" data-tip="${c.label}" data-tip-note="${`${t.who.poss} country`}"/>`)}
      </svg>
      <div class="map-tip" role="tooltip" hidden data-map-tip><b></b><span></span></div>
    </div>
  </section>`;
}

function myToolsPage(t) {
  const n = myTools(t.me).length;
  return toolsFrame(t, {
    title: 'Tools',
    back: `${t.home}#setups`, backLabel: 'Setup',
    body: html`<div class="tools-head">
    <h1>${t.who.Poss} tools</h1>
    <p>${n ? `${plural(n, 'tool')} from ${t.who.poss} answer in ${monthOf(t.me.latest.created_at)}. Everyone’s numbers are under World.` : `${t.who.Poss} answer named no tools.`}</p>
    ${n > 8 ? html`<label class="find"><span class="sr-only">Find a tool</span>${raw(ICON.search)}<input type="search" placeholder="Find a tool" data-tool-filter></label>` : ''}
  </div>
  <div class="tools-list" data-tools-list>
    ${myToolGroups(t, { filter: true })}
    <p class="muted" data-no-match hidden>No tool by that name in ${t.who.poss} answer.</p>
  </div>`,
  });
}

// One tool under the You lens: what the person said about it, and nothing about anyone else.
function myToolPage(t, tool) {
  const list = myTools(t.me);
  const at = list.findIndex((x) => x.name.toLowerCase() === tool.name.toLowerCase());
  const mine = at >= 0 ? list[at] : null;
  const category = mine?.category ?? tool.category;
  const prev = list.length > 1 && mine ? list[(at - 1 + list.length) % list.length] : null;
  const next = list.length > 1 && mine ? list[(at + 1) % list.length] : null;
  const url = toolUrl(tool.name);
  const theirs = t.who.subj === 'you' ? 'yours' : 'theirs';
  return toolsFrame(t, {
    title: tool.name,
    back: `${t.home}/tools`, backLabel: `${t.who.Poss} tools`,
    body: html`<article class="tool-detail">
    <div class="tool-detail-head">
      <span class="tc huge k-${category}${markClass(tool.name)}" aria-hidden="true">${mark(tool.name)}</span>
      <div>
        <p class="eyebrow">${KIND_ONE[category] ?? 'Tool'} · ${mine ? `one of ${theirs}` : `not in ${t.who.poss} answer`}</p>
        <h1>${tool.name}</h1>
        ${toolAbout(tool.name) ? html`<p class="lede">${toolAbout(tool.name)}</p>` : ''}
      </div>
    </div>
    ${mine ? html`<div class="figures big">
      <span><strong>${FREQUENCY_WORD[mine.frequency] ?? 'Not said'}</strong><span>how often ${t.who.subj} ${verb(t, 'use')} it</span></span>
      <span><strong>${monthOf(t.me.latest.created_at)}</strong><span>${t.who.poss} latest answer</span></span>
    </div>` : ''}
    ${mine?.usedFor && ownerSees(t) ? html`<section><h2 class="label">What you use it for</h2><p>${mine.usedFor}</p></section>` : ''}
    <p class="my-links"><a class="quiet" href="/tools/${toolSlug(tool.name)}">Everyone’s numbers for ${tool.name} →</a>${url ? html` <a class="quiet" href="${url}" target="_blank" rel="noopener noreferrer">${url.startsWith('https://duckduckgo.com/') ? 'Search the web' : 'Visit its site'} ↗<span class="sr-only"> (opens in a new tab)</span></a>` : ''}</p>
  </article>
  ${prev ? html`<a class="tour-side prev" href="${t.home}/tools/${toolSlug(prev.name)}" aria-label="${`Previous tool: ${prev.name}`}">${raw(ICON.left)}<span class="tip">${prev.name}</span></a>` : ''}
  ${next ? html`<a class="tour-side next" href="${t.home}/tools/${toolSlug(next.name)}" aria-label="${`Next tool: ${next.name}`}">${raw(ICON.right)}<span class="tip">${next.name}</span></a>` : ''}`,
  });
}

export { CATEGORY };
