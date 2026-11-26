// The tour: seven slides that show everyone's numbers first and then ask
// people to take part, and the tool pages that open from its Setups slide.
// The same slides serve three lenses: everyone (/), a company (/c/<id>) and
// one person (/u/<id>). A lens changes the numbers on a slide, not the slides.
import { page, html, raw, formatNumber, MADE_BY } from './html.js';
import { shareRadius, place } from './radar.js';
import { QUADRANTS, TOOL_CATEGORIES, toolAbout, toolUrl, WORLD, COUNTRIES } from './shape.js';
import { MIN_GROUP, NO_COUNTRY } from './stats.js';

// The slides, in order. `label` is the short name in the top bar.
export const SLIDES = [
  { id: 'intro', label: 'Intro' },
  { id: 'habits', label: 'Habits' },
  { id: 'setups', label: 'Setups' },
  { id: 'models', label: 'Models' },
  { id: 'harnesses', label: 'Harnesses' },
  { id: 'where', label: 'Where' },
  { id: 'join', label: 'Take part' },
];

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
export const toolSlug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'tool';
// Fixed letters for well-known tools whose initials would clash ("Codex CLI" and "Claude Code").
const MONOGRAMS = { 'codex cli': 'CX', 'claude': 'CL', 'chatgpt': 'GP', 'gemini': 'GM', 'gemini cli': 'GE', 'ghostty': 'GT', 'cursor': 'CU', 'github copilot': 'GC', 'windsurf': 'WS', 'warp': 'WA', 'zed': 'ZD', 'zellij': 'ZJ', 'terminal.app': 'TA' };
const monogram = (name) => {
  if (MONOGRAMS[String(name).toLowerCase()]) return MONOGRAMS[String(name).toLowerCase()];
  const words = String(name).split(/[\s\-_.]+/).filter((w) => w && !/^(a|an|the|our|my)$/i.test(w));
  if (!words.length) return '?';
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
};

// Words for the person a You lens is about: the owner reads "you"; anyone else
// with the link reads the page's name, or "this person".
export const whoFor = (profile, isOwner) => (isOwner
  ? { lens: 'You', subj: 'you', Subj: 'You', poss: 'your', Poss: 'Your', does: 'do' }
  : { lens: profile?.name || 'This person', subj: profile?.name || 'this person', Subj: profile?.name || 'This person', poss: profile?.name ? `${profile.name}’s` : 'their', Poss: profile?.name ? `${profile.name}’s` : 'Their', does: 'does' });

// ---------- the frame: top bar, side arrows ----------

const ICON = {
  left: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  right: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  arrow: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  close: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
};

// The Everyone · Company · You switch. Each link opens the same slide (site.js
// keeps the slide's #id on them) through another lens.
const lensSwitch = (lenses, current, suffix = '') => (lenses.length > 1 ? html`<nav class="lens" aria-label="Whose numbers">
    ${lenses.map((l) => html`<a href="${suffix && l.href === '/' ? '' : l.href}${suffix}"${raw(suffix ? '' : ' data-lens-link')}${raw(l.id === current ? ' aria-current="page"' : '')}>${l.label}</a>`)}
  </nav>` : '');

const takePartHref = (t) => `${t.home}#join`;

function tourBar(t) {
  return html`<header class="tour-bar">
  <span class="tour-where" data-where>01 · Intro</span>
  <nav class="tour-dots" aria-label="Slides">
    ${SLIDES.map((s, i) => html`<a class="tdot-nav" href="#${s.id}" data-goto="${i}" data-deck-dot aria-label="${`${i + 1}: ${s.label}`}"${raw(i === 0 ? ' aria-current="step"' : '')}><i></i><span class="tip">${s.label}</span></a>`)}
  </nav>
  <div class="tour-right">
    ${lensSwitch(t.lenses, t.lens)}
    <a class="tour-join" href="#join" data-goto="${SLIDES.length - 1}">Take part</a>
  </div>
</header>
<a class="tour-side prev" href="#intro" data-deck-step="-1" aria-label="Previous slide">${raw(ICON.left)}</a>
<a class="tour-side next" href="#habits" data-deck-step="1" aria-label="Next slide">${raw(ICON.right)}</a>`;
}

const slideHead = (title, meta) => html`<header class="tour-head"><h2>${title}</h2>${meta ? html`<p>${meta}</p>` : ''}</header>`;

// ---------- the tour ----------

// t: see tourData() in server.js.
export function tourPage(t) {
  const title = t.lens === 'company' ? t.groupName : t.lens === 'you' ? (t.profile?.name || 'Your results') : '';
  const empty = !t.all.radar.total;
  return page({
    title,
    deck: true,
    noindex: t.lens !== 'everyone',
    styles: ['tour.css'],
    body: html`
<div class="deck tour" data-deck data-tour>
  ${introSlide(t)}
  ${empty ? '' : html`${habitsSlide(t)}${setupsSlide(t)}${stackSlide(t, 'models')}${stackSlide(t, 'harnesses')}${whereSlide(t)}`}
  ${joinSlide(t)}
</div>
${tourBar(t)}`,
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
  const lede = t.lens === 'company' ? `Next to everyone else’s numbers. Only totals, from ${MIN_GROUP} people up.`
    : t.lens === 'you' ? `${t.who.Poss} answer, and where it sits among everyone’s.`
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
        <a class="go" href="#${t.all.radar.total ? 'habits' : 'join'}" data-goto="${t.all.radar.total ? 1 : SLIDES.length - 1}">${t.all.radar.total ? 'Start' : 'Take part'} ${raw(ICON.arrow)}</a>
        ${you && t.lens !== 'you' ? html`<a class="quiet" href="${you.href}">Your results</a>` : ''}
      </div>
    </div>
  </section>`;
}

// ---------- 02 habits: the radar ----------

function habitsSlide(t) {
  const all = new Map(t.all.radar.patterns.map((p) => [p.id, p]));
  const company = t.lens === 'company';
  const you = t.lens === 'you';
  const source = company ? t.group.radar.patterns : t.all.radar.patterns;
  const mine = you ? t.me.patterns : null;
  const size = (p) => (you ? (mine.has(p.id) ? 30 : 12) : 16 + Math.round(p.share / 6));
  // Dot sizes are in px at the radar's full 560px (600 radar units); they scale with it (tour.css).
  const items = place(source.map((p) => ({ ...p, q: quadIndex(p.quadrant), radius: shareRadius(p.share), size: (size(p) * 600) / 560 })));
  // The order Previous and Next step through in a habit's card: round the radar, centre outwards.
  const order = [...items].sort((a, b) => a.q - b.q || a.radius - b.radius);
  // At a company, a faint dot marks the same habit's share among everyone, on the same line from the centre.
  const ghost = (p) => {
    const r = shareRadius(all.get(p.id)?.share ?? 0);
    return { x: (50 + ((p.x - 50) * r) / p.radius).toFixed(2), y: (50 + ((p.y - 50) * r) / p.radius).toFixed(2) };
  };
  const shareLine = (p) => (company ? `${p.share}% at ${t.groupName} · ${all.get(p.id)?.share ?? 0}% of everyone`
    : you ? (mine.has(p.id) ? `${t.who.Subj} ${t.who.does} this · ${p.share}% of people do too` : `${p.share}% of people`)
      : `${p.share}% of people`);
  const meta = company ? `Dots: ${t.groupName}. Faint dots: everyone. Closer to the centre: more people.`
    : you ? `${t.who.Poss} ${plural(mine.size, 'habit')} are the large dots. Closer to the centre: more people do it.`
      : 'Closer to the centre: more people do it. Select a dot for details.';
  return html`<section class="slide tslide" id="habits" aria-label="2: Habits">
    ${slideHead(company ? `The habits at ${t.groupName}` : you ? `Where ${t.who.subj} sit${t.who.subj === 'you' ? '' : 's'} on the radar` : 'The habits people work with', meta)}
    <div class="tradar" data-tradar>
      <div class="tradar-disc" aria-hidden="true">
        <i class="qt q0"></i><i class="qt q1"></i><i class="qt q2"></i><i class="qt q3"></i>
        <i class="ring r1"></i><i class="ring r2"></i><i class="ring r3"></i>
        <span class="ring-label" style="left:60%">Most</span><span class="ring-label" style="left:73.4%">Many</span><span class="ring-label" style="left:85.2%">Some</span><span class="ring-label" style="left:95.3%">Few</span>
      </div>
      ${QUADRANTS.map((q, i) => html`<button type="button" class="quad q${i}" data-quad="${q.id}" aria-pressed="false" title="${q.blurb}">${q.label}</button>`)}
      ${company ? html`<svg class="tradar-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${items.map((p) => { const g = ghost(p); return html`<line data-q="${p.quadrant}" x1="${p.x}" y1="${p.y}" x2="${g.x}" y2="${g.y}"/>`; })}</svg>
        ${items.map((p) => { const g = ghost(p); return html`<i class="ghost q${p.q}" data-q="${p.quadrant}" style="left:${g.x}%;top:${g.y}%" aria-hidden="true"></i>`; })}` : ''}
      ${items.map((p) => html`<button type="button" class="hdot q${p.q}${you ? (mine.has(p.id) ? ' mine' : ' dim') : ''}${p.status === 'fading' || p.status === 'stopped' ? ' hollow' : ''}" data-q="${p.quadrant}" popovertarget="h-${p.id}" style="left:${p.x}%;top:${p.y}%;--s:${size(p)}px" aria-label="${`${p.title}: ${shareLine(p)}`}"><span class="tip">${p.title}<br><span class="tip-note">${shareLine(p)}</span></span></button>`)}
    </div>
    ${order.map((p, i) => habitCard(p, shareLine(p), company ? t.group.radar.patterns.find((x) => x.id === p.id) : all.get(p.id),
    order.length > 1 ? { prev: order[(i - 1 + order.length) % order.length], next: order[(i + 1) % order.length], at: i + 1, of: order.length } : null))}
  </section>`;
}

function habitCard(p, line, source, nav = null) {
  const trend = source?.trend ?? [];
  const top = Math.max(1, ...trend.map((m) => m.share));
  return html`<div class="tcard" id="h-${p.id}" popover role="dialog" aria-labelledby="h-${p.id}-t">
    <div class="tcard-top"><span class="badge q${p.q}">${QUADRANTS[p.q].label}</span><button type="button" class="x" popovertarget="h-${p.id}" popovertargetaction="hide" aria-label="Close">${raw(ICON.close)}</button></div>
    <h3 id="h-${p.id}-t">${p.title}</h3>
    <p class="tcard-share">${line}</p>
    <p>${p.summary}</p>
    ${trend.length ? html`<div class="mini-trend q${p.q}" role="img" aria-label="${`Share each month: ${trend.map((m) => `${m.label} ${m.n ? `${m.share}%` : NONE_SHOWN}`).join(', ')}`}">${trend.map((m) => html`<span class="ht" tabindex="-1"><i style="height:${m.n ? Math.max(4, (m.share / top) * 100).toFixed(0) : 0}%"></i><b>${m.label}</b><span class="tip">${m.label}: ${m.n ? `${m.share}%` : NONE_SHOWN}</span></span>`)}</div>` : ''}
    ${p.when ? html`<p class="muted small"><b>When:</b> ${p.when}</p>` : ''}
    ${nav ? html`<div class="tcard-nav">
      <button type="button" class="tcard-step" data-card-to="h-${nav.prev.id}" data-card-step="-1" aria-label="${`Previous: ${nav.prev.title}`}">${raw(ICON.left)}</button>
      <span class="muted small">${nav.at} of ${nav.of}</span>
      <button type="button" class="tcard-step" data-card-to="h-${nav.next.id}" data-card-step="1" aria-label="${`Next: ${nav.next.title}`}">${raw(ICON.right)}</button>
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
  const allByKey = new Map(t.all.setups.setups.map((s) => [s.key, s]));
  const total = data.total || 1;
  const list = data.setups.slice(0, SETUPS_MAX);
  const mineKey = you ? t.me.setupKey : null;
  const mineTools = you ? t.me.tools : new Set();
  // One scale for every row: the most common setup fills the bar. The remainder's bar may run full.
  const top = Math.max(1, ...list.map((s) => s.share));
  const toolShare = shareLookup(t);
  const seen = new Map();
  const avatars = (tools, forceMine) => html`<span class="avatars">${tools.map((x) => {
    seen.set(toolSlug(x.name), x);
    const dim = you && !forceMine && !mineTools.has(x.name.toLowerCase());
    return html`<button type="button" class="tc k-${x.category}${dim ? ' dim' : ''}" popovertarget="tp-${toolSlug(x.name)}" aria-label="${`${x.name}: details`}">${monogram(x.name)}<span class="tip">${x.name}</span></button>`;
  })}</span>`;
  const row = (s, rank, { pinned = false, hidden = false } = {}) => {
    const id = `s-${pinned ? 'mine' : rank}`;
    const isMine = s.key === mineKey;
    const everyone = allByKey.get(s.key);
    const overlap = s.tools.filter((x) => mineTools.has(x.name.toLowerCase())).length;
    const note = company ? `${round(s.share)}% of ${t.groupName} · ${round(everyone?.share ?? 0)}% of everyone work in exactly this setup.`
      : isMine ? `${t.who.Poss} setup. ${s.count ? `${plural(s.count, 'person', 'people')} work in exactly this setup.` : 'Nobody in the current numbers shares it.'}`
        : you ? `${overlap} of ${t.who.poss} ${plural(t.me.setupSize, 'tool')} · ${plural(s.count, 'person', 'people')} work in exactly this setup.`
          : `${plural(s.count, 'person', 'people')} work in exactly this setup.`;
    return html`<li class="srow${isMine && you ? ' mine' : ''}"${raw(hidden ? ' hidden data-more' : '')}>
      <span class="rank">${pinned ? (s.count ? `#${rank}` : '—') : rank}</span>
      ${avatars(s.tools, isMine)}
      <button type="button" class="sbar" aria-expanded="false" aria-controls="${id}" data-toggle>
        <span class="bars"><span class="bar"><i style="width:${Math.min(100, (s.share / top) * 100).toFixed(1)}%"></i></span>${company ? html`<span class="bar thin"><i style="width:${Math.min(100, ((everyone?.share ?? 0) / top) * 100).toFixed(1)}%"></i></span>` : ''}</span>
        <strong>${round(s.share)}%</strong>
      </button>
      <p class="snote" id="${id}" hidden>${note}</p>
    </li>`;
  };
  // What the last row says after 0, 1, 2… clicks on Show more.
  const steps = [];
  for (let shown = Math.min(SETUPS_FIRST, list.length); ; shown = Math.min(list.length, shown + SETUPS_STEP)) {
    const rest = data.setups.length - shown;
    const share = Math.max(0, 100 - list.slice(0, shown).reduce((a, s) => a + s.share, 0));
    const none = data.none ? ` and ${plural(data.none, 'person', 'people')} who named no coding tools` : '';
    steps.push({
      label: rest > 0 ? `${plural(rest, 'other setup')}, each rarer${none ? ',' : ''}${none}` : `${none.replace(/^ and /, '')}`,
      share: round(share), w: Math.min(100, (share / top) * 100).toFixed(1), more: shown < list.length ? Math.min(SETUPS_STEP, list.length - shown) : 0,
    });
    if (shown >= list.length) break;
  }
  // A person's own setup, also when nobody in the current numbers shares it.
  const mineAt = mineKey ? data.setups.findIndex((s) => s.key === mineKey) : -1;
  const mineRank = mineAt >= 0 ? mineAt + 1 : data.setups.length + 1;
  const mineSetup = !mineKey ? null : mineAt >= 0 ? data.setups[mineAt] : { key: mineKey, tools: t.me.setupTools, count: 0, share: 0 };
  // Among the rows shown first, a person's setup is marked in place; otherwise it is pinned on top (and not listed again).
  const pinMine = mineSetup && !(mineAt >= 0 && mineAt < SETUPS_FIRST);
  const meta = company ? `Every person at ${t.groupName} works in one setup, so the rows add up to 100%. Thin grey bar: the same setup among everyone.`
    : you ? (!mineSetup ? `${t.who.Poss} answer named no coding tools.` : mineSetup.count ? `${round(mineSetup.share)}% of people work exactly like ${t.who.subj}.` : `Nobody in the last few months works exactly like ${t.who.subj}.`)
      : 'Each person works in one setup, so the rows add up to 100%. Select a tool for details.';
  const first = steps[0];
  return html`<section class="slide tslide" id="setups" aria-label="3: Setups">
    ${slideHead(company ? `The setups ${t.groupName} works in` : you ? (mineSetup && mineAt !== 0 && mineSetup.share < 5 ? `${t.who.Poss} setup is rarer than most` : `${t.who.Poss} setup, among everyone’s`) : 'The setups people work in',
      html`${meta} · <a href="${t.home === '/' ? '' : t.home}/tools">All tools</a>`)}
    <ol class="setups" data-setups>
      ${pinMine ? row(mineSetup, mineRank, { pinned: true }) : ''}
      ${list.map((s, i) => (pinMine && i === mineAt ? '' : row(s, i + 1, { hidden: i >= SETUPS_FIRST })))}
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
  const daily = t.lens === 'company' && share.groupDaily != null ? share.groupDaily : share.daily;
  const whose = t.lens === 'company' && share.groupDaily != null ? `of ${t.groupName}’s users` : 'of its users';
  return html`${daily != null ? html`<span><strong>${daily}%</strong><span>${whose} use it daily</span></span>` : ''}${own ? html`<span><strong>${FREQUENCY_WORD[own]}</strong><span>${t.who.subj === 'you' ? 'how often you use it' : 'how often they use it'}</span></span>` : ''}`;
}
const FREQUENCY_WORD = { daily: 'Daily', weekly: 'Weekly', occasionally: 'Now and then' };

function toolPopover(t, x, share) {
  const base = t.home === '/' ? '' : t.home;
  const company = t.lens === 'company';
  const yours = t.lens === 'you' && t.me.tools.has(x.name.toLowerCase());
  return html`<div class="tcard tool-pop" id="tp-${toolSlug(x.name)}" popover role="dialog" aria-labelledby="tp-${toolSlug(x.name)}-t">
    <div class="tcard-top"><span class="tool-id"><span class="tc big k-${x.category}" aria-hidden="true">${monogram(x.name)}</span><span><h3 id="tp-${toolSlug(x.name)}-t">${x.name}</h3><span class="muted small">${KIND_ONE[x.category] ?? 'Tool'}</span></span></span>
      <button type="button" class="x" popovertarget="tp-${toolSlug(x.name)}" popovertargetaction="hide" aria-label="Close">${raw(ICON.close)}</button></div>
    ${toolAbout(x.name) ? html`<p class="muted">${toolAbout(x.name)}</p>` : ''}
    <div class="figures">
      ${company ? html`<span><strong>${share.group ?? 0}%</strong><span>of ${t.groupName}</span></span>` : ''}
      <span><strong>${share.all}%</strong><span>${yours ? `of everyone, ${t.who.subj} too` : 'of everyone use it'}</span></span>
      ${dailyFigure(t, x.name, share)}
    </div>
    <div class="tcard-links"><a href="${base}/tools/${toolSlug(x.name)}">Tool details →</a><a class="muted" href="${base}/tools">All tools people use</a></div>
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
  const meta = company ? `Each month, ${t.groupName}’s share. Narrow bar: everyone.`
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
  const everyone = t.all[id];
  const mineNames = you ? t.me[id] : null;
  // Colours follow the main bar's names, so the narrow bar beside it matches.
  const color = (_, name) => (name === 'Other' || !main.names.includes(name) ? 'so' : `s${Math.min(STACK_COLORS - 1, main.names.indexOf(name))}`);
  const bar = (stack, m, cls) => html`<span class="mstack ${cls}">${stack.names.map((name, i) => ({ name, v: m.parts[i], i })).filter((p) => p.v > 0.4).map((p) => html`<span class="seg ht ${color(stack.names, p.name)}${mineNames && !mineNames.has(p.name) ? ' dim' : ''}" style="height:${p.v.toFixed(2)}%" tabindex="-1"><span class="tip">${m.label} · ${p.name} ${round(p.v)}%</span></span>`)}</span>`;
  const everyoneByKey = new Map(everyone.months.map((m) => [m.key, m]));
  return html`<figure class="stacks" data-stack="${id}"${raw(hidden ? ' hidden' : '')}>
    <div class="stack-cols" role="img" aria-label="${main.months.map((m) => `${m.label}: ${main.names.map((n, i) => `${n} ${round(m.parts[i])}%`).join(', ')}`).join('; ')}">
      ${main.months.map((m) => html`<div class="stack-col">
        ${you && t.me.months.has(m.key) ? html`<i class="answered" title="${`${t.who.Subj} answered in ${m.label}`}"></i>` : ''}
        <div class="stack-pair">
          ${m.n ? bar(main, m, '') : html`<span class="mstack empty"></span>`}
          ${company && everyoneByKey.get(m.key)?.n ? bar(everyone, everyoneByKey.get(m.key), 'narrow') : ''}
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
  const meta = company ? `Where ${t.groupName}’s ${plural(where.reduce((a, c) => a + c.count, 0) + elsewhere, 'answer')} came from.${elsewhere ? ` ${formatNumber(elsewhere)} more from countries with fewer than ${MIN_GROUP} people.` : ''}`
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

function joinSlide(t) {
  const again = t.again ?? '/contribute';
  const own = t.owner?.kind === 'u';
  const counts = (where) => html`<span class="counts-in">Counts in ${where.map((w) => html`<span class="in-tag ${w.cls}">${w.label}</span>`)}</span>`;
  return html`<section class="slide tslide tjoin" id="join" aria-label="7: Take part">
    <div class="join-inner">
      <h2>${own ? 'Run it again, or bring your company' : 'Add yours'}</h2>
      <p class="lede">About five minutes. ${own ? 'A new answer replaces the one on your page.' : 'Your assistant does the work, and nothing is sent without your yes.'}</p>
      <div class="join-cards">
        <a class="join-card" href="${again}"><strong>Just me</strong><span>${own ? 'Run the survey again' : 'Your own results, next to everyone’s'}</span>${counts([{ label: 'Everyone', cls: 'all' }])}</a>
        ${t.joinCompany
          ? html`<a class="join-card" href="${t.joinCompany}"><strong>With ${t.groupName}</strong><span>Add your answer to ${t.groupName}’s page</span>${counts([{ label: t.groupName, cls: 'co' }, { label: 'Everyone', cls: 'all' }])}</a>`
          : html`<a class="join-card" href="/contribute?for=company"><strong>With my company</strong><span>A page for your team, and a link for colleagues</span>${counts([{ label: 'Your company', cls: 'co' }, { label: 'Everyone', cls: 'all' }])}</a>`}
      </div>
      <p class="ask ht" tabindex="0">What does my assistant look at?<span class="tip wide">Its last 30 days with you, secrets masked. Which coding tools are installed and open, and how often you use each, by name only. The models that did the work. Never code, file names, paths or project names. It shows you the exact answer before anything is sent. <a href="/contribute.md">Read the prompt</a></span></p>
      ${t.owner?.invite ? html`<p class="muted small"><button type="button" class="linklike" data-copy="${t.owner.invite}">Copy an invitation link for a friend</button></p>` : ''}
      <p class="muted small foot-line">${t.owner?.edit ? html`<a href="${t.owner.edit}">Edit or delete ${t.owner.kind === 'c' ? 'this page' : 'your page'}</a> · ` : ''}<a href="/contribute.md">Read the prompt</a> · <a href="/privacy">Privacy</a> · ${MADE_BY}</p>
    </div>
  </section>`;
}

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
  const base = t.home === '/' ? '' : t.home;
  const company = t.lens === 'company';
  const you = t.lens === 'you';
  const share = shareLookup(t);
  const groups = TOOL_CATEGORIES.map((c) => ({ ...c, tools: t.all.tools.filter((x) => x.category === c.id) }))
    .filter((g) => g.tools.length)
    .map((g) => ({ ...g, tools: [...g.tools].sort((a, b) => (company ? (share(b.name).group ?? 0) - (share(a.name).group ?? 0) : b.share - a.share)) }));
  const line = (x) => {
    const s = share(x.name);
    return company ? `${s.group ?? 0}% · all ${s.all}%` : you && t.me.tools.has(x.name.toLowerCase()) ? `${t.who.subj === 'you' ? 'yours' : 'theirs'} · ${s.all}%` : `${s.all}% of people`;
  };
  return toolsFrame(t, {
    title: 'Tools',
    back: `${t.home}#setups`, backLabel: 'Setups',
    body: html`<div class="tools-head">
    <h1>${company ? `The tools ${t.groupName} works with` : you ? `${t.who.Poss} tools, among everyone’s` : 'Every tool people work with'}</h1>
    <p>${plural(t.all.tools.length, 'tool')} from ${plural(t.all.radar.total, 'answer')}${company ? `. ${t.groupName}’s share, then everyone’s.` : you ? `. ${t.who.Poss} are in full colour.` : '. Hover for what a tool is, select one for details.'}</p>
    <label class="find"><span class="sr-only">Find a tool</span>${raw(ICON.search)}<input type="search" placeholder="Find a tool" data-tool-filter></label>
  </div>
  <div class="tools-list" data-tools-list>
    ${groups.map((g) => html`<section class="tool-group" data-group>
      <h2>${g.label}<small data-count="${g.tools.length}">${plural(g.tools.length, 'tool')}</small></h2>
      <ul>${g.tools.map((x) => html`<li data-name="${x.name.toLowerCase()}"><a class="tool-tile ht${you && !t.me.tools.has(x.name.toLowerCase()) ? ' dim' : ''}" href="${base}/tools/${toolSlug(x.name)}">
        <span class="tc k-${x.category}" aria-hidden="true">${monogram(x.name)}</span>
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
  const base = t.home === '/' ? '' : t.home;
  const company = t.lens === 'company';
  const yours = t.lens === 'you' && t.me.tools.has(tool.name.toLowerCase());
  const series = (company && groupDetail ? groupDetail : detail).series;
  const top = Math.max(1, ...series.map((m) => m.share));
  const url = toolUrl(tool.name);
  return toolsFrame(t, {
    title: tool.name,
    back: `${base}/tools`, backLabel: 'All tools',
    body: html`<article class="tool-detail">
    <div class="tool-detail-head">
      <span class="tc huge k-${tool.category}" aria-hidden="true">${monogram(tool.name)}</span>
      <div>
        <p class="eyebrow">${KIND_ONE[tool.category] ?? 'Tool'}${yours ? ` · ${t.who.subj === 'you' ? 'one of yours' : 'one of theirs'}` : ''}</p>
        <h1>${tool.name}</h1>
        ${toolAbout(tool.name) ? html`<p class="lede">${toolAbout(tool.name)}</p>` : ''}
      </div>
    </div>
    <div class="figures big">
      ${company && groupDetail ? html`<span><strong>${groupDetail.share}%</strong><span>of ${t.groupName}</span></span>` : ''}
      <span><strong>${detail.share}%</strong><span>of everyone use it</span></span>
      ${dailyFigure(t, tool.name, shareLookup(t)(tool.name))}
    </div>
    <section aria-label="Share each month">
      <h2 class="label">Share each month${company ? ` · ${t.groupName}` : ''}</h2>
      <div class="month-cols">${series.map((m) => html`<span class="ht" tabindex="0"><i style="height:${Math.max(3, (m.share / top) * 100).toFixed(0)}%" class="k-${tool.category}"></i><b>${m.label}</b><span class="tip">${m.label}: ${m.n ? `${m.share}% of ${plural(m.n, 'answer')}` : NONE_SHOWN}</span></span>`)}</div>
    </section>
    ${detail.with.length ? html`<section>
      <h2 class="label">Most often used with</h2>
      <ul class="with-list">${detail.with.map((w) => html`<li><a class="ht" href="${base}/tools/${toolSlug(w.name)}"><span class="tc k-${w.category}" aria-hidden="true">${monogram(w.name)}</span><span><strong>${w.name}</strong><span class="muted small">${w.share}% of its users</span></span></a></li>`)}</ul>
    </section>` : ''}
    ${detail.uses.length ? html`<section><h2 class="label">What people use it for</h2><ul class="plain-list">${detail.uses.map((u) => html`<li>${u}</li>`)}</ul></section>` : ''}
    ${url ? html`<p><a class="quiet" href="${url}" target="_blank" rel="noopener noreferrer">${url.startsWith('https://duckduckgo.com/') ? 'Search the web' : 'Visit its site'} ↗<span class="sr-only"> (opens in a new tab)</span></a></p>` : ''}
  </article>
  ${prev ? html`<a class="tour-side prev" href="${base}/tools/${toolSlug(prev.name)}" aria-label="${`Previous tool: ${prev.name}`}">${raw(ICON.left)}<span class="tip">${prev.name}</span></a>` : ''}
  ${next ? html`<a class="tour-side next" href="${base}/tools/${toolSlug(next.name)}" aria-label="${`Next tool: ${next.name}`}">${raw(ICON.right)}<span class="tip">${next.name}</span></a>` : ''}`,
  });
}

export { CATEGORY };
