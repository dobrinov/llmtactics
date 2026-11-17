// The pages. Each function returns a full HTML document.
import { page, html, raw, histogram, meter, copyBox, formatNumber, formatDate, SITE } from './html.js';
import { renderRadar } from './radar.js';
import { QUADRANTS, PROMPT_RANGES, MONTH_RANGES, labelOf, toolUrl, toolAbout, TOOL_CATEGORIES, WORLD, COUNTRIES } from './shape.js';
import { MIN_GROUP, NO_COUNTRY, RECENT_MONTHS } from './stats.js';

const STATUS_TEXT = { active: 'Still in use', new: 'New in the last two months', fading: 'Fading', stopped: 'Mostly given up' };
const quadLabel = (id) => QUADRANTS.find((q) => q.id === id)?.label ?? 'Unsorted';
const quadIndex = (id) => Math.max(0, QUADRANTS.findIndex((q) => q.id === id));
const promptLine = (url) => `Fetch ${url} and follow the instructions in it.`;
// A tool's name, linking to its site in a new tab when there is one.
const toolLink = (name) => {
  const url = toolUrl(name);
  return url ? html`<a class="out" href="${url}" target="_blank" rel="noopener noreferrer">${name}<span aria-hidden="true"> ↗</span><span class="sr-only"> (opens in a new tab)</span></a>` : name;
};
// A company's name is optional: a page without one shows as "This company".
export const companyLabel = (c) => c.name || 'This company';

// The slide navigation: with `startLabel`, the first slide shows one big button
// to the second; otherwise (and from the second slide on) the dark bar with
// arrows and one dot per slide.
const deckNav = (slides, startLabel) => html`
${startLabel ? html`<a class="deck-start btn dark big" href="#${slides[1].id}" data-goto="1">${startLabel} ${raw(ARROW)}</a>` : ''}
<nav class="deck-nav${startLabel ? '' : ' always'}" aria-label="Slides">
  <a class="arrow" href="#${slides[0].id}" data-step="-1" aria-label="Previous slide">${raw(CHEVRON_LEFT)}</a>
  ${slides.map((sl, i) => html`<a class="dot" href="#${sl.id}" data-goto="${i}" aria-label="Slide ${i + 1}: ${sl.name}"${raw(i === 0 ? ' aria-current="step"' : '')}><span></span></a>`)}
  <a class="arrow" href="#${slides[Math.min(1, slides.length - 1)].id}" data-step="1" aria-label="Next slide">${raw(CHEVRON_RIGHT)}</a>
</nav>`;

const slideLabeller = (slides) => (id) => `Slide ${slides.findIndex((x) => x.id === id) + 1} of ${slides.length}: ${slides.find((x) => x.id === id).name}`;

// The two ways to take part, as two large buttons. `again` is the address of
// "for you" when the visitor already has a page of their own.
const choice = (again = '/contribute') => html`<div class="choice">
      <a class="q0" href="${again}"><strong>For you →</strong><span>Your own habits next to everyone's, on a page of your own. About five minutes, no account.</span></a>
      <a class="q1" href="/contribute?for=company"><strong>For your company →</strong><span>A page for your team's results, and a link to send to colleagues.</span></a>
    </div>`;
const SMALL_PRINT = html`<p class="muted small">Nothing is sent without your yes. No code, names, paths or credentials, ever. <a href="/contribute.md">Read the prompt</a> · <a href="/privacy">Privacy</a></p>`;

const plural = (n, one, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`;
const compact = (v) => (v >= 1e9 ? `${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}B` : v >= 1e6 ? `${Math.round(v / 1e6)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(v));

// Patterns sorted the way the radar numbers them: by quadrant, then most common first.
export const radarOrder = (patterns) =>
  [...patterns].sort((a, b) => quadIndex(a.quadrant) - quadIndex(b.quadrant) || b.share - a.share);

// ---------- home: the whole presentation ----------

// One deck: what the site is, then everyone's numbers slide by slide, then the
// invitation to take part. Slides without data are left out.
export function homePage({ counts, radar, tools, setups, exp, area, selectedId, where = [] }) {
  if (!radar.total) return emptyHome();
  // Addresses on this page keep the radar's area filter.
  const here = ({ a = area, p = null } = {}, hash = '') => {
    const q = new URLSearchParams();
    if (a) q.set('area', a);
    if (p) q.set('p', p);
    return `/${q.size ? `?${q}` : ''}${hash}`;
  };
  const mapped = where.filter((c) => c.id !== NO_COUNTRY);
  const e = exp.efficiency;
  const ordered = radarOrder(radar.patterns);
  const visible = area ? ordered.filter((p) => p.quadrant === area) : ordered;
  const byShare = [...visible].sort((a, b) => b.share - a.share);
  const selected = visible.find((p) => p.id === selectedId) ?? null;
  const numbered = new Map(ordered.map((p, i) => [p.id, i + 1]));
  const data = Object.fromEntries(ordered.map((p) => [p.id, {
    n: numbered.get(p.id), title: p.title, area: quadLabel(p.quadrant), q: quadIndex(p.quadrant), share: p.share,
    status: STATUS_TEXT[p.status], summary: p.summary, when: p.when, problem: p.problem, trend: p.trend,
  }]));
  const query = (id) => here({ p: id }, '#radar');
  const at = selected ? byShare.findIndex((p) => p.id === selected.id) : -1;
  const step = (d) => byShare[(at + d + byShare.length) % byShare.length]?.id;
  const closeHref = here({}, '#radar');
  const chips = [{ id: '', label: 'All areas' }, ...QUADRANTS].map((q, i) => html`<a class="chip${raw(i ? ` q${i - 1}` : '')}" href="${here({ a: q.id }, '#radar')}"${raw((area || '') === q.id ? ' aria-current="true"' : '')}>${q.label}</a>`);

  const groups = TOOL_CATEGORIES.map((c) => ({ ...c, tools: tools.tools.map((t, i) => ({ ...t, i })).filter((t) => t.category === c.id) }))
    .filter((g) => g.tools.length)
    .sort((a, b) => b.tools[0].share - a.tools[0].share);

  // Volume and cost: the median of each month's contributors.
  const has = (x) => x.series.some((m) => m.median);
  const overTime = [
    { title: 'Prompts a month', series: exp.overTime, median: exp.prompts.median, cls: 'q0', fmt: formatNumber },
    { title: 'Lines of code a month', series: e.linesOverTime, median: e.lines.median, cls: 'q2', fmt: compact },
  ].filter(has);
  const costOverTime = [
    { title: 'Dollars a month', series: e.costOverTime, median: e.cost.median, cls: 'q1', fmt: (v) => `$${formatNumber(v)}` },
    { title: 'Tokens a month', series: e.tokensOverTime, median: e.tokens.median, cls: 'q3', fmt: compact },
  ].filter(has);
  const trendCards = (list) => html`<div class="cards ${list.length === 1 ? 'one' : 'two'}">${list.map((x) => html`<section class="card">
      <h3 class="card-title">${x.title}</h3>
      <p><strong class="stat">${x.median ? x.fmt(x.median) : '–'}</strong> <span class="muted small">median now</span></p>
      ${histogram({ bars: x.series.map((m, i) => ({ label: m.label, value: m.median, display: m.median ? x.fmt(m.median) : '', highlight: i === x.series.length - 1 })), className: `${x.cls} dense`, label: `${x.title}, median per month: ${x.series.map((m) => `${m.label} ${m.median ? x.fmt(m.median) : 'no data'}`).join(', ')}` })}
    </section>`)}</div>`;
  const taskStats = [
    e.minutes.median && { value: e.minutes.median, label: 'minutes per task', note: 'median, first prompt to last', q: 2 },
    e.prompts.median && { value: e.prompts.median, label: 'prompts per task', note: 'median', q: 0 },
    exp.months.median && { value: exp.months.median, label: 'months of use', note: 'median, for work', q: 3 },
  ].filter(Boolean);

  const slides = [
    { id: 'start', name: 'Start' },
    ...(mapped.length ? [{ id: 'map', name: 'Where they are' }] : []),
    { id: 'radar', name: 'The radar' },
    { id: 'tools', name: 'Tools' },
    ...(setups.setups.length ? [{ id: 'environments', name: 'Development environments' }] : []),
    { id: 'tools-over-time', name: 'Tools over time' },
    ...(tools.models.length ? [{ id: 'models', name: 'Models over time' }] : []),
    ...(overTime.length ? [{ id: 'volume', name: 'Prompts and lines of code over time' }] : []),
    ...(costOverTime.length ? [{ id: 'spend', name: 'Cost over time' }] : []),
    ...(tools.purposes.length ? [{ id: 'purposes', name: 'What it is used for' }] : []),
    ...(taskStats.length ? [{ id: 'tasks', name: 'Time per task' }] : []),
    ...(e.heavy.length ? [{ id: 'cost', name: 'Which habits cost the most' }] : []),
    ...(exp.roles.length ? [{ id: 'people', name: 'Who is contributing' }] : []),
    ...(radar.emerging.length ? [{ id: 'emerging', name: 'Not on the radar yet' }] : []),
    { id: 'join', name: 'Take part' },
  ];
  const sl = slideLabeller(slides);
  return page({
    deck: true,
    body: html`
<div class="deck" data-deck data-radar data-order="${byShare.map((p) => p.id).join(' ')}">
  <section class="slide" id="start" aria-label="${sl('start')}">
    <div class="slide-text">
      ${counts.people >= 100 && counts.companies >= 1 ? html`<p class="eyebrow">${formatNumber(counts.people)} people · ${formatNumber(counts.companies)} ${counts.companies === 1 ? 'company' : 'companies'}${mapped.length > 1 ? ` · ${mapped.length} countries` : ''}</p>` : ''}
      <h1 class="giant">See how people around the world use LLMs</h1>
      <p class="lede">Their own assistants read their history, named the habits they found, and sent them here without anything that identifies anyone. This is what came back.</p>
      <p class="muted">The numbers show how people work now: they count answers from the last ${RECENT_MONTHS} months. The charts over time go back a year.</p>
    </div>
    <div class="slide-visual" aria-hidden="true">${raw(renderRadar(ordered, { compact: true }))}</div>
  </section>

  ${mapped.length ? worldSlide(sl('map'), mapped) : ''}

  <section class="slide radar-slide centered" id="radar" aria-label="${sl('radar')}">
    <h2 class="sr-only">The radar</h2>
    <nav class="chips radar-filter" aria-label="Filter by area">${chips}</nav>
    <div class="radar-visual">${raw(renderRadar(visible, { selected: selected?.id, numbers: numbered }))}</div>
    <div class="legend-row small radar-legend">
      <span><span class="dot solid"></span>Still in use</span>
      <span><span class="dot hollow"></span>Fading or given up</span>
      <span>Closer to the centre: more people do it</span>
    </div>
  </section>

  <section class="slide column top" id="tools" aria-label="${sl('tools')}">
    <header class="slide-head">
      <p class="eyebrow q1">${plural(tools.total, 'person', 'people')}</p>
      <h2>Tools</h2>
      <p class="muted">By kind, most used first. ${tools.perPerson ? `${tools.perPerson} per person, the median.` : ''} Select one for details.</p>
    </header>
    ${groups.map((g) => html`<section class="tool-row" aria-labelledby="cat-${g.id}">
      <h3 class="label" id="cat-${g.id}">${g.label} <span class="muted">· ${g.tools.length}</span></h3>
      <ul class="tool-strip">${g.tools.map((t) => html`<li><button type="button" class="tool-card" popovertarget="tool-${t.i}" aria-haspopup="dialog">
        <span class="name">${t.name}</span>
        <span class="share">${t.share}%</span>
        ${meter(t.share, 'q1')}
      </button></li>`)}</ul>
    </section>`)}
    ${tools.tools.map((t, i) => toolPopover(t, `tool-${i}`))}
  </section>

  ${setups.setups.length ? environmentsSlide(sl('environments'), setups.setups, tools.tools) : ''}

  <section class="slide column" id="tools-over-time" aria-label="${sl('tools-over-time')}">
    <div><p class="eyebrow q1">Tools over time</p><h2 class="big-title">Which tools are growing</h2><p class="lede">Each bar is one month, as a share of that month's contributors.</p></div>
    ${sparkCards(tools.tools, 'tool')}
  </section>

  ${tools.models.length ? html`<section class="slide column" id="models" aria-label="${sl('models')}">
    <div><p class="eyebrow q3">Models over time</p><h2 class="big-title">Which models do the work</h2><p class="lede">Model families in real use, as a share of each month's contributors who named any.</p></div>
    ${sparkCards(tools.models, 'model')}
  </section>` : ''}

  ${overTime.length ? html`<section class="slide column" id="volume" aria-label="${sl('volume')}">
    <div><p class="eyebrow q0">Volume over time</p><h2 class="big-title">Prompts and lines of code</h2><p class="lede">The median contributor of each month. Assistants count these in their own history and send only a range.</p></div>
    ${trendCards(overTime)}
  </section>` : ''}

  ${costOverTime.length ? html`<section class="slide column" id="spend" aria-label="${sl('spend')}">
    <div><p class="eyebrow q1">Cost over time</p><h2 class="big-title">What it costs, in dollars and tokens</h2><p class="lede">The median contributor of each month: subscriptions plus metered usage, and tokens processed including context read again on every turn.</p></div>
    ${trendCards(costOverTime)}
  </section>` : ''}

  ${tools.purposes.length ? html`<section class="slide column" id="purposes" aria-label="${sl('purposes')}">
    <div><p class="eyebrow q2">Purpose</p><h2 class="big-title">What they use it for</h2><p class="lede">Each bar is one month, as a share of that month's contributors.</p></div>
    ${sparkCards(tools.purposes, 'purpose')}
  </section>` : ''}

  ${taskStats.length ? html`<section class="slide column" id="tasks" aria-label="${sl('tasks')}">
    <div><p class="eyebrow q3">Effort</p><h2 class="big-title">How long a task takes</h2><p class="lede">A task is one piece of work, from its first prompt to the last one about it.</p></div>
    <div class="big-stats">${taskStats.map((x) => html`<div class="card"><span class="figure q${x.q}">${x.value}</span><strong>${x.label}</strong><span class="muted small">${x.note}</span></div>`)}</div>
    ${e.minutesOverTime.some((m) => m.median) ? html`<div class="card"><h3 class="card-title">Median minutes per task, over time</h3>
    ${histogram({ bars: e.minutesOverTime.map((m, i) => ({ label: m.label, value: m.median, highlight: i === e.minutesOverTime.length - 1 })), className: 'q3', label: `Median minutes per task: ${e.minutesOverTime.map((m) => `${m.label} ${m.median ?? 'no data'}`).join(', ')}` })}</div>` : ''}
  </section>` : ''}

  ${e.heavy.length ? html`<section class="slide column" id="cost" aria-label="${sl('cost')}">
    <div><p class="eyebrow q3">Cost</p><h2 class="big-title">Which habits cost the most</h2><p class="lede">Of the people who use each habit and rated it, the share who say a typical use is heavy compared with their ordinary prompts.</p></div>
    <ul class="big-bars compact">${e.heavy.map((h) => html`<li><span class="name">${h.title}</span>${meter(h.share, 'q3 fat')}<span class="pct">${h.share}%</span></li>`)}</ul>
  </section>` : ''}

  ${exp.roles.length ? html`<section class="slide column" id="people" aria-label="${sl('people')}">
    <div><p class="eyebrow q2">People</p><h2 class="big-title">Who is contributing</h2><p class="lede">Share of contributors by role, with each group's median prompts a month.</p></div>
    <ul class="big-bars compact with-note">${exp.roles.map((r) => html`<li><span class="name">${r.label}</span>${meter(r.share, 'q2 fat')}<span class="pct">${r.share}%</span><span class="muted small">${r.median ? `${formatNumber(r.median)} a month` : '–'}</span></li>`)}</ul>
  </section>` : ''}

  ${radar.emerging.length ? html`<section class="slide column" id="emerging" aria-label="${sl('emerging')}">
    <div><p class="eyebrow">Emerging</p><h2 class="big-title">Not on the radar yet</h2><p class="lede">Habits several people reported that don't match a known pattern. They join the radar once they are added to the catalog.</p></div>
    <ul class="cards three plain">${radar.emerging.map((x) => html`<li class="card"><strong>${x.title}</strong><span class="muted">${x.summary}</span><span class="label">${plural(x.count, 'person', 'people')}</span></li>`)}</ul>
  </section>` : ''}

  <section class="slide column" id="join" aria-label="${sl('join')}">
    <h2 class="giant">Want this for you, or for your company?</h2>
    ${choice()}
    ${SMALL_PRINT}
  </section>

  <a class="scrim" href="${closeHref}" tabindex="-1" aria-hidden="true" data-close${raw(selected ? '' : ' hidden')}></a>
  <aside class="drawer" role="dialog" aria-labelledby="drawer-title" data-drawer${raw(selected ? '' : ' hidden')}>
    ${detailPanel(data[(selected ?? byShare[0]).id], {
      close: closeHref,
      prev: selected ? query(step(-1)) : '#radar',
      next: selected ? query(step(1)) : '#radar',
    })}
  </aside>
  <script type="application/json" id="radar-data">${raw(JSON.stringify(data).replace(/</g, '\\u003c'))}</script>
</div>
${deckNav(slides, 'See what they do')}`,
  });
}

// The world map: countries with contributors are coloured. Hovering one
// shows its name and how many people took part from there (site.js).
function worldSlide(label, mapped) {
  const byId = new Map(mapped.map((c) => [c.id, c]));
  const people = (c) => plural(c.count, 'person', 'people');
  return html`<section class="slide column top world-slide" id="map" aria-label="${label}">
    <header class="slide-head">
      <p class="eyebrow q0">Where they are</p>
      <h2>${plural(mapped.length, 'country', 'countries')}</h2>
      <p class="muted">Every country someone has contributed from. Hover one for its name.</p>
    </header>
    <svg class="world" viewBox="0 0 ${WORLD.width} ${WORLD.height}" role="img" aria-label="${`World map. Contributors come from: ${mapped.map((c) => `${c.label} (${c.count})`).join(', ')}`}" data-map>
      ${COUNTRIES.filter((c) => c.d && !byId.has(c.id)).map((c) => html`<path d="${c.d}"/>`)}
      ${COUNTRIES.filter((c) => c.d && byId.has(c.id)).map((c) => html`<path class="on" d="${c.d}" data-tip="${c.label}" data-tip-note="${people(byId.get(c.id))}"/>`)}
    </svg>
    <div class="map-tip" role="tooltip" hidden data-map-tip><b></b><span></span></div>
  </section>`;
}

// Before the first reviewed contribution: the introduction and the invitation only.
function emptyHome() {
  const slides = [{ id: 'start', name: 'Start' }, { id: 'join', name: 'Take part' }];
  return page({
    deck: true,
    body: html`
<div class="deck" data-deck>
  <section class="slide" id="start" aria-label="Slide 1 of 2: Start">
    <div class="slide-text">
      <h1 class="giant">See how people around the world use LLMs</h1>
      <p class="lede">Assistants read their own history with the people they work for, name the habits they find, and send them here without anything that identifies anyone. Nothing has been reviewed and counted yet: yours could be the first.</p>
    </div>
    <div class="slide-visual" aria-hidden="true">${raw(renderRadar([], { compact: true }))}</div>
  </section>
  <section class="slide column" id="join" aria-label="Slide 2 of 2: Take part">
    <h2 class="giant">Start with you, or with your company</h2>
    ${choice()}
    ${SMALL_PRINT}
  </section>
</div>
${deckNav(slides, 'Take part')}`,
  });
}

function detailPanel(d, links) {
  const top = Math.max(1, ...d.trend.map((t) => t.share));
  return html`<div class="detail q${d.q}" aria-live="polite" data-detail>
  <div class="row between">
    <div class="row wrapline"><span class="badge q${d.q}" data-f="area">${d.area}</span><span class="label" data-f="status">${d.status}</span></div>
    <a class="icon-btn" href="${links.close}" data-close aria-label="Close details">${raw(CLOSE)}</a>
  </div>
  <h2 id="drawer-title"><span class="muted" data-f="n">${d.n}.</span> <span data-f="title">${d.title}</span></h2>
  <p class="big" data-f="summary">${d.summary}</p>
  <div><div class="stat" data-f="share">${d.share}%</div><div class="muted small">of contributors do this</div></div>
  <div class="trend">
    <div class="trend-bars" role="img" data-f="trend" aria-label="${`Share per month: ${d.trend.map((t) => `${t.label} ${t.share}%`).join(', ')}`}">
      ${d.trend.map((t, i) => html`<i style="height:${Math.max(3, (t.share / top) * 100).toFixed(0)}%"${raw(i === d.trend.length - 1 ? ' class="last"' : '')}></i>`)}
    </div>
    <div class="trend-labels small muted"><span data-f="from">${d.trend[0].label}</span><span>Share each month</span><span data-f="to">${d.trend.at(-1).label}</span></div>
  </div>
  <dl>
    <div><dt>When people reach for it</dt><dd data-f="when">${d.when}</dd></div>
    <div><dt>What goes wrong without it</dt><dd data-f="problem">${d.problem}</dd></div>
  </dl>
  <div class="drawer-nav">
    <a class="btn outline small" href="${links.prev}" data-step="-1">← Previous</a>
    <a class="btn dark small" href="${links.next}" data-step="1">Next →</a>
  </div>
</div>`;
}

// Two letters for a tool's circle: the initials of its first two words, or the
// first two letters of a one-word name ("Claude Code" CC, "tmux" tm).
const initials = (name) => {
  const words = name.split(/[\s-]+/).filter((w) => w && !/^(a|an|the|our|my)$/i.test(w));
  if (!words.length) return '?';
  return words.length > 1 ? (words[0][0] + words[1][0]).toUpperCase() : words[0].slice(0, 2);
};

// Development environments: one compact row per setup. Its tools are
// overlapping circles coloured by kind (hover or focus one for its name), and
// selecting the row opens a popover with the details.
function environmentsSlide(label, list, allTools) {
  const top = Math.max(1, ...list.map((x) => x.share));
  const known = new Map(allTools.map((t) => [t.name.toLowerCase(), t]));
  const kinds = TOOL_CATEGORIES.filter((c) => list.some((x) => x.tools.some((t) => t.category === c.id)));
  const circle = (t, tip) => html`<span class="setup-dot k-${t.category}"${raw(tip ? '' : ' aria-hidden="true"')}>${initials(t.name)}${tip ? html`<span class="tip" role="tooltip"><b>${t.name}</b><span>${CATEGORY_LABEL[t.category]}</span></span>` : ''}</span>`;
  return html`<section class="slide column top" id="environments" aria-label="${label}">
    <header class="slide-head row between wrapline">
      <div>
        <p class="eyebrow q1">Development environments</p>
        <h2>Tools people use together</h2>
        <p class="muted">Most common first. Hover a circle for the tool's name; select a setup for its details. Chat assistants are left out.</p>
      </div>
      <ul class="kind-legend" aria-label="Kinds of tool">${kinds.map((k) => html`<li><span class="sw k-${k.id}" aria-hidden="true"></span>${CATEGORY_LABEL[k.id]}</li>`)}</ul>
    </header>
    <ol class="setup-rows">${list.map((x, i) => html`<li>
      <button type="button" class="setup-row" popovertarget="setup-${i}" aria-haspopup="dialog" aria-label="${`Setup ${i + 1}: ${x.tools.map((t) => t.name).join(', ')}. ${x.share}% use all of them together.`}">
        <span class="rank">${i + 1}</span>
        <span class="setup-stack">${x.tools.map((t) => circle(t, true))}</span>
        <strong class="share">${x.share}%</strong>
        ${meter((x.share / top) * 100, 'q1')}
      </button>
    </li>`)}</ol>
    ${list.map((x, i) => html`<div class="tool-pop setup-pop" id="setup-${i}" popover role="dialog" aria-labelledby="setup-${i}-title">
      <div class="row between">
        <span class="label" id="setup-${i}-title">Setup ${i + 1} of ${list.length}</span>
        <button type="button" class="icon-btn" popovertarget="setup-${i}" popovertargetaction="hide" aria-label="Close">${raw(CLOSE)}</button>
      </div>
      <div class="row wrapline"><strong class="figure">${x.share}%</strong><span class="muted">of everyone use ${x.tools.length === 2 ? 'both' : `all ${x.tools.length}`} together<br>${plural(x.count, 'person', 'people')}</span></div>
      <ul class="setup-detail">${x.tools.map((t) => {
        const k = known.get(t.name.toLowerCase());
        return html`<li>${circle(t, false)}<span class="who"><b>${toolLink(t.name)}</b><span class="muted small">${CATEGORY_LABEL[t.category]}${k?.uses?.[0] ? ` · ${k.uses[0]}` : ''}</span></span>${k ? html`<span class="muted small of">${k.share}%<br>of everyone</span>` : ''}</li>`;
      })}</ul>
      ${x.alsoUsed ? html`<p><b>Often with:</b> ${x.alsoUsed.share}% of them also use ${x.alsoUsed.name}.</p>` : ''}
      ${list.length > 1 ? html`<div class="drawer-nav">
        <button type="button" class="btn outline small" popovertarget="setup-${(i - 1 + list.length) % list.length}">← Previous</button>
        <button type="button" class="btn dark small" popovertarget="setup-${(i + 1) % list.length}">Next →</button>
      </div>` : ''}
    </div>`)}
  </section>`;
}

// A tool's details, opened from its card (native popover: Esc or a click outside closes it).
function toolPopover(t, id) {
  const url = toolUrl(t.name);
  const about = toolAbout(t.name);
  const top = Math.max(1, ...t.series.map((x) => x.share));
  const first = t.series.find((x) => x.share > 0);
  return html`<div class="tool-pop" id="${id}" popover role="dialog" aria-labelledby="${id}-title">
  <div class="row between">
    <span class="label">${t.kind}</span>
    <button type="button" class="icon-btn" popovertarget="${id}" popovertargetaction="hide" aria-label="Close">${raw(CLOSE)}</button>
  </div>
  <h3 id="${id}-title">${t.name}</h3>
  ${about ? html`<p>${about}</p>` : ''}
  <div class="row wrapline"><strong class="stat">${t.share}%</strong><span class="muted small">of contributors name it${first && first.label !== t.series.at(-1).label ? `, ${first.share}% in ${first.label}` : ''}</span></div>
  <div class="spark q1" role="img" aria-label="${`Share per month: ${t.series.map((x) => `${x.label} ${x.share}%`).join(', ')}`}">
    ${t.series.map((x, j) => html`<i style="height:${Math.max(3, (x.share / top) * 100).toFixed(0)}%"${raw(j === t.series.length - 1 ? ' class="last"' : '')}></i>`)}
  </div>
  ${t.uses?.length ? html`<div><span class="label">What people use it for</span><ul class="plain-list">${t.uses.map((u) => html`<li>${u}</li>`)}</ul></div>` : ''}
  ${url ? html`<a class="btn dark" href="${url}" target="_blank" rel="noopener noreferrer">${url.startsWith('https://duckduckgo.com/') ? 'Search the web' : 'Visit the site'} ↗<span class="sr-only"> (opens in a new tab)</span></a>` : ''}
</div>`;
}

const CATEGORY_LABEL = { harness: 'Coding harness', chat: 'Chat assistant', editor: 'Editor', multiplexer: 'Multiplexer', review: 'Review', connector: 'Connector', other: 'Other' };

// One card per tool or purpose: its share now and a bar per month.
const sparkCards = (cards, view) => html`<div class="cards multiples">
    ${cards.map((c) => html`<article class="card">
      <div class="row between"><h3>${view === 'tool' ? toolLink(c.name) : c.name}</h3><span class="label">${c.kind}</span></div>
      <strong class="stat">${c.share}%</strong>
      <div class="spark ${view === 'purpose' ? 'q1' : view === 'model' ? 'q3' : 'q0'}" role="img" aria-label="${`${c.name}, share per month: ${c.series.map((x) => `${x.label} ${x.share}%`).join(', ')}`}">
        ${c.series.map((x, i) => html`<i style="height:${Math.max(2, x.share)}%"${raw(i === c.series.length - 1 ? ' class="last"' : '')}></i>`)}
      </div>
      ${c.note ? html`<p class="muted small">Used for: ${c.note}</p>` : ''}
    </article>`)}
  </div>`;

// ---------- contribute ----------

// The prompt to copy, and a live line that waits for the answer and then moves
// the page to the results (site.js polls /api/wait/<token>).
const promptAndWait = (url, token) => html`<div class="prompt-wait">
  ${copyBox(promptLine(url), 'Copy', 'big')}
  <p class="waiting" role="status" data-wait="${token}"><span class="pulse" aria-hidden="true"></span><span data-wait-text>Waiting for your assistant. Keep this tab open.</span></p>
</div>`;

// An optional name and password for the page the answer creates. Saved with
// the one-time code as you type (site.js); never sent to the assistant.
const detailsForm = (token) => html`<form class="details-form" method="post" action="/api/wait/${token}/details" data-details-form>
  <div class="field"><label for="dname">Your name <span class="muted">(optional)</span></label>
    <input id="dname" name="name" type="text" maxlength="60" autocomplete="name" placeholder="The first slide of your page"></div>
  <div class="field"><label for="dpass">Password <span class="muted">(optional)</span></label>
    <input id="dpass" name="password" type="password" minlength="8" maxlength="200" autocomplete="new-password" placeholder="Leave empty: anyone with the link can view"></div>
  <span class="small muted" data-details-status aria-live="polite"></span>
</form>`;

// What the site is, for someone who arrives on a contribute page from a link
// a colleague sent, with the way to the presentation everyone can see.
const ABOUT = html`<p class="about"><b>${SITE}</b> shows how people really work with LLMs: the habits, tools and models they use, and what it costs them. It is built from what their own assistants report, with nothing that identifies anyone. <a href="/">See the presentation ${raw('<span aria-hidden="true">→</span>')}</a></p>`;

export function contributePage({ mode, base, token, promptId = null, profile = null, error = null }) {
  const isCompany = mode === 'company';
  return page({
    title: 'Contribute',
    bare: true,
    noindex: true,
    body: html`
<div class="wrap focus contribute-bare">
  ${ABOUT}
  <h1>${isCompany ? 'Start a page for your company' : 'Paste this into your assistant'}</h1>
  <p class="lede">${isCompany
    ? 'You get a link for your team’s results, and a contribute link to send to colleagues. Results appear once five people have taken part.'
    : 'It reads its own history with you, shows you what it found, and sends it after your yes. This page moves to your results when it arrives.'}</p>
  ${profile ? html`<p class="muted">Your new answer replaces the earlier one on <a href="/u/${profile.id}">your page</a>.</p>` : html`<nav class="segmented" aria-label="Who is this for">
    <a href="/contribute"${raw(!isCompany ? ' aria-current="page"' : '')}>For yourself</a>
    <a href="/contribute?for=company" class="clay"${raw(isCompany ? ' aria-current="page"' : '')}>For your company</a>
  </nav>`}
  ${error ? html`<p class="error" role="alert">${error}</p>` : ''}
  ${isCompany
    ? html`<form method="post" action="/companies" class="details-form company">
        <div class="field"><label for="cname">Company name <span class="muted">(optional)</span></label>
          <input id="cname" name="name" type="text" maxlength="80" placeholder="The first slide of the page" autocomplete="organization"></div>
        <div class="field"><label for="cpass">Password <span class="muted">(optional)</span></label>
          <input id="cpass" name="password" type="password" minlength="8" maxlength="200" autocomplete="new-password" placeholder="Leave empty: anyone with the link can view"></div>
        <button class="btn clay big" type="submit">Create the page</button>
      </form>
      <p class="muted small">With a password, colleagues need it to open the page and to contribute. Without one, the link itself is the key: it is long and random, and not listed anywhere.</p>`
    : html`${profile ? '' : detailsForm(token)}${promptAndWait(`${base}/u/${promptId}/contribute.md`, token)}
      <p class="muted small">Works in Claude Code, Cursor, Codex CLI, ChatGPT and similar. Nothing is sent without your yes. <a href="/contribute.md">Read the prompt</a> · <a href="/privacy">Privacy</a></p>`}
</div>`,
  });
}

// ---------- company ----------

export function companyPage({ company, base, radar, compared, tools, exp, weeks }) {
  const enough = radar.total >= MIN_GROUP;
  const label = companyLabel(company);
  // Not enough people yet: one centred screen, no slide navigation, and the
  // one thing to do (add your habits) where the navigation would be.
  if (!enough) {
    return page({
      title: label,
      deck: true,
      noindex: true,
      body: html`
<div class="deck" data-deck>
  <section class="slide column centered-text" id="progress" aria-label="${label}: taking part so far">
    ${company.name ? html`<h1 class="big-title">${company.name}</h1>` : html`<h1 class="sr-only">How people in this company use LLMs</h1>`}
    <p class="eyebrow clay">Taking part so far</p>
    <p class="giant">${radar.total} of ${MIN_GROUP}</p>
    <p class="lede">The radar, tools and experience appear once ${MIN_GROUP} people have taken part and their answers have been reviewed, so nobody can be picked out.</p>
    <div class="progress big" role="progressbar" aria-valuemin="0" aria-valuemax="${MIN_GROUP}" aria-valuenow="${radar.total}"><span style="width:${(radar.total / MIN_GROUP) * 100}%"></span></div>
    <p class="muted small"><button type="button" class="linklike" data-copy="${base}/c/${company.id}/contribute">Copy the link for colleagues</button>${company.password_hash ? ' · They need this page’s password to open it or to contribute.' : ''}</p>
  </section>
</div>
<a class="deck-start btn clay big" href="/c/${company.id}/contribute">Add your habits ${raw(ARROW)}</a>`,
    });
  }
  const more = compared.filter((x) => x.diff > 0).slice(0, 4);
  const less = compared.filter((x) => x.diff < 0).reverse().slice(0, 3);
  const slides = [
    // The first slide is the company's name, when it has one.
    ...(company.name ? [{ id: 'company', name: label }] : []),
    { id: 'habits', name: 'Habits' }, { id: 'tools', name: 'Tools' }, { id: 'effort', name: 'Experience and effort' }, { id: 'activity', name: 'Activity' },
    { id: 'join', name: 'Add your habits' },
  ];
  const sl = slideLabeller(slides);
  const at = (id) => slides.findIndex((x) => x.id === id);
  const next = (id, text) => html`<a class="btn dark big" href="#${slides[at(id) + 1].id}" data-goto="${at(id) + 1}">${text} ${raw(ARROW)}</a>`;
  const vs = (all, unit = '') => html`<span class="muted small">everyone: ${all == null ? '–' : `${formatNumber(all)}${unit}`}</span>`;
  return page({
    title: label,
    deck: true,
    noindex: true,
    body: html`
<div class="deck" data-deck>
  ${company.name ? html`<section class="slide column centered-text" id="company" aria-label="${sl('company')}">
    <h1 class="giant">${company.name}</h1>
    <p class="lede">How people in “${company.name}” use LLMs</p>
  </section>` : html`<h1 class="sr-only">How people in this company use LLMs</h1>`}

  <section class="slide" id="habits" aria-label="${sl('habits')}">
    <a class="slide-visual" href="/#radar" aria-label="Open everyone's radar">${raw(renderRadar(radarOrder(radar.patterns), { compact: true, label: `${label} radar` }))}</a>
    <div class="slide-text">
      <p class="eyebrow q0">Habits · ${plural(radar.total, 'person', 'people')}</p>
      <h2 class="big-title">What sets this team apart</h2>
      <div class="diff-cols">
        ${diffList('More common here than everywhere', more.slice(0, 3), 'up')}
        ${diffList('Less common here', less, 'down')}
      </div>
      ${next('habits', 'Next: tools')}
    </div>
  </section>

  <section class="slide" id="tools" aria-label="${sl('tools')}">
    <div class="slide-text narrow-col">
      <p class="eyebrow q1">Tools</p>
      <h2 class="big-title">What this team works with</h2>
      <div class="legend-row"><span><span class="sw clay"></span>Here</span><span><span class="sw grey thin"></span>Everyone</span></div>
      ${next('tools', 'Next: how much')}
    </div>
    <ul class="big-bars">${tools.map((t) => html`<li><span class="name">${toolLink(t.name)}</span><span class="pair">${meter(t.here, 'q1 fat')}${meter(t.everywhere, 'grey thin')}</span><span class="pct">${t.here}%</span></li>`)}</ul>
  </section>

  <section class="slide column" id="effort" aria-label="${sl('effort')}">
    <div><p class="eyebrow q2">Experience and effort</p><h2 class="big-title">How much, and how fast</h2></div>
    <div class="big-stats">
      <div class="card"><span class="figure q0">${exp.here.median ? formatNumber(exp.here.median) : '–'}</span><strong>prompts a month</strong>${vs(exp.everywhere.median)}</div>
      <div class="card"><span class="figure q3">${exp.monthsHere.median ?? '–'}</span><strong>months of use</strong>${vs(exp.monthsEverywhere.median)}</div>
      <div class="card"><span class="figure q2">${exp.minutesHere.median ?? '–'}</span><strong>minutes per task</strong>${vs(exp.minutesEverywhere.median)}</div>
    </div>
    <div class="card">${pairedHistogram(exp.here.bins, exp.everywhere.bins)}</div>
    <div class="actions">${next('effort', 'Next: activity')}</div>
  </section>

  <section class="slide column" id="activity" aria-label="${sl('activity')}">
    <div><p class="eyebrow clay">Activity</p><h2 class="big-title">Contributions per week</h2></div>
    <div class="card">${histogram({ bars: weeks.map((w) => ({ label: w.label, value: w.count })), className: 'q1', label: `Contributions per week: ${weeks.map((w) => `${w.label} ${w.count}`).join(', ')}` })}</div>
    <div class="actions">${next('activity', 'Add yours')}</div>
  </section>

  <section class="slide column" id="join" aria-label="${sl('join')}">
    <h2 class="giant">Your habits are missing from this page</h2>
    <div class="prompt-wait">
      <p class="lede">Every colleague who takes part makes these numbers more honest. It takes about five minutes: open the contribute page, paste its line into your assistant (Claude Code, Cursor, Codex CLI, ChatGPT or similar), and reply <b>yes</b> when it shows what it will send.</p>
      <div class="actions"><a class="btn clay big" href="/c/${company.id}/contribute">Add my habits ${raw(ARROW)}</a><button type="button" class="btn outline big" data-copy="${base}/c/${company.id}/contribute">Copy the link for colleagues</button></div>
    </div>
    <p class="muted small">Only totals are shown, and only once ${MIN_GROUP} people have taken part. ${company.password_hash ? 'Colleagues need this page’s password to open it or to contribute.' : 'Anyone with this link can see this page.'} Nothing about your code, projects or clients is sent. <a href="/">${SITE}</a></p>
  </section>
</div>
${deckNav(slides)}`,
  });
}

const diffList = (title, list, dir) => (list.length ? html`<section>
  <h3 class="label">${title}</h3>
  <ul class="diff-list">${list.map((x) => html`<li class="card"><span><strong>${x.title}</strong><span class="muted small">${x.here}% here · ${x.everywhere}% everywhere</span></span><b class="${dir}">${x.diff > 0 ? '+' : '−'}${Math.abs(x.diff)}</b></li>`)}</ul>
</section>` : '');

function pairedHistogram(here, all) {
  const top = Math.max(1, ...here.map((b) => b.share), ...all.map((b) => b.share));
  return html`<figure class="hist paired">
  <div class="hist-bars" role="img" aria-label="${`Share in each range, here versus everyone: ${here.map((b, i) => `${b.label} ${b.share}% vs ${all[i].share}%`).join('; ')}`}">
    ${here.map((b, i) => html`<div class="hist-col"><i class="a" style="height:${((b.share / top) * 88).toFixed(1)}%"></i><i class="b" style="height:${((all[i].share / top) * 88).toFixed(1)}%"></i></div>`)}
  </div>
  <div class="hist-labels" aria-hidden="true">${here.map((b) => html`<span>${b.label}</span>`)}</div>
  <div class="legend-row small"><span><span class="sw clay"></span>This company</span><span><span class="sw grey"></span>Everyone</span></div>
</figure>`;
}

// One centred screen, like a company page that is still collecting answers:
// the line to paste, and "Copy the line" where the slide navigation would be.
export function companyContributePage({ company, base, total, created }) {
  const enough = total >= MIN_GROUP;
  const line = promptLine(`${base}/c/${company.id}/contribute.md`);
  return page({
    title: `Contribute to ${companyLabel(company)}`,
    deck: true,
    noindex: true,
    body: html`
<div class="deck" data-deck>
  <section class="slide column centered-text" id="paste" aria-label="Paste the prompt">
    ${ABOUT}
    <p class="eyebrow clay">${company.name || 'Your company'}</p>
    <h1 class="big-title">Add your habits</h1>
    <p class="lede">Paste this line into your assistant: Claude Code, Cursor, Codex CLI, ChatGPT or similar. It reads its own history with you, shows you what it found, and sends it after your yes.</p>
    <div class="prompt big centered"><code>${line}</code></div>
    <p class="muted">Afterwards your assistant opens your own results page, or gives you the link to it. Your company sees totals only, never which answers are yours. <a href="/contribute.md">Read the prompt</a></p>
    <p class="muted small"><b>${total}</b> of ${MIN_GROUP} counted so far. ${enough ? html`<a href="/c/${company.id}">See the results</a>` : html`<a href="/c/${company.id}">The company page</a>`}${created ? html` · <button type="button" class="linklike" data-copy="${base}/c/${company.id}/contribute">Copy this page’s link for colleagues</button>${company.password_hash ? ' (they also need the password you set)' : ''}` : ''}</p>
  </section>
</div>
<button type="button" class="deck-start btn clay big" data-copy="${line}">Copy the line</button>`,
  });
}

// ---------- a person's page ----------

const REVIEW_NOTE = {
  pending: 'This answer is waiting for review. It shows here already, and joins the shared numbers once it has been reviewed.',
  flagged: 'This answer is being looked at by a person before it joins the shared numbers.',
  rejected: 'This answer was not added to the shared numbers. It still shows here.',
};

export function profilePage({ profile, latest, history, radarAll, compareWith, companies, isOwner, toolShares, promptPercentile, promptBins, unique }) {
  const again = isOwner ? `/u/${profile.id}/contribute` : '/contribute';
  const lastSlide = (label) => html`<section class="slide column" id="join" aria-label="${label}">
    <h2 class="giant">${isOwner ? 'Run it again, or bring your company' : 'Want this for you, or for your company?'}</h2>
    ${choice(again)}
    ${companies.length ? html`<p class="muted">Company pages this page has contributed to: ${companies.map((c, i) => html`${i ? ', ' : ''}<a href="/c/${c.id}">${companyLabel(c)}</a>`)}</p>` : ''}
    <p class="muted small"><a href="/">${SITE}</a> · <a href="/#radar">Everyone's radar</a></p>
  </section>`;
  const nameSlide = (label) => (profile.name ? html`<section class="slide column centered-text" id="name" aria-label="${label}">
    <h1 class="giant">${profile.name}</h1>
    <p class="lede">How ${profile.name} works with LLMs</p>
  </section>` : html`<h1 class="sr-only">How one person works with LLMs</h1>`);

  if (!latest) {
    const slides = [...(profile.name ? [{ id: 'name', name: profile.name }] : []), { id: 'join', name: 'Take part' }];
    const sl = slideLabeller(slides);
    return page({
      title: profile.name || 'Results', deck: true, noindex: true,
      body: html`<div class="deck" data-deck>${nameSlide(profile.name ? sl('name') : '')}${lastSlide(sl('join'))}</div>${deckNav(slides)}`,
    });
  }

  const mineIds = new Set(latest.patterns.map((p) => p.catalog_id).filter(Boolean));
  const shares = new Map((compareWith?.radar ?? radarAll).patterns.map((p) => [p.id, p.share]));
  const ordered = radarOrder(radarAll.patterns);
  const numbered = new Map(ordered.map((p, i) => [p.id, i + 1]));
  const mine = latest.patterns.filter((p) => p.catalog_id).map((p) => ({ ...p, share: shares.get(p.catalog_id) ?? 0 })).sort((a, b) => a.share - b.share);
  const tag = (s) => (s < 20 ? ['Rare', 'rare'] : s >= 50 ? ['Common', 'common'] : ['Shared', 'shared']);
  const where = compareWith ? `at ${companyLabel(compareWith.company)}` : 'of everyone';
  const slides = [
    ...(profile.name ? [{ id: 'name', name: profile.name }] : []),
    { id: 'you', name: 'On the radar' },
    ...(mine.length ? [{ id: 'habits', name: 'Habits' }] : []),
    ...(unique.length ? [{ id: 'only-you', name: 'Not on the radar' }] : []),
    { id: 'tools', name: 'Tools and prompts' },
    { id: 'join', name: 'Take part' },
  ];
  const sl = slideLabeller(slides);
  return page({
    title: profile.name || 'Results',
    deck: true,
    noindex: true,
    body: html`
<div class="deck" data-deck>
  ${nameSlide(profile.name ? sl('name') : '')}

  <section class="slide radar-slide" id="you" aria-label="${sl('you')}">
    <div class="slide-text narrow-col">
      <p class="eyebrow q0"><a href="/">${SITE}</a> · /u/${profile.id}</p>
      <h2 class="big-title">${mine.length === 1 ? 'One habit' : `${mine.length} habits`} on everyone's radar</h2>
      <p class="lede">From the answer sent on ${formatDate(latest.created_at)}${latest.assistant ? ` by ${latest.assistant}` : ''}.${history.length > 1 ? ` It replaced ${plural(history.length - 1, 'earlier answer')}.` : ''}</p>
      <div class="legend-row small"><span><span class="dot mine"></span>This page</span><span><span class="dot other"></span>Other people</span></div>
      ${REVIEW_NOTE[latest.status] ? html`<div class="banner"><span>${REVIEW_NOTE[latest.status]}</span></div>` : ''}
    </div>
    <div class="radar-visual">${raw(renderRadar(ordered, { mine: mineIds, label: 'Everyone’s radar with this page’s habits marked' }))}</div>
  </section>

  ${mine.length ? html`<section class="slide column" id="habits" aria-label="${sl('habits')}">
    <div class="row between wrapline">
      <div><p class="eyebrow q0">Habits</p><h2 class="big-title">How common each one is</h2></div>
      ${companies.length ? html`<nav class="segmented" aria-label="Compare with">
        <a href="/u/${profile.id}#habits"${raw(!compareWith ? ' aria-current="true"' : '')}>Everyone</a>
        ${companies.map((c) => html`<a href="/u/${profile.id}?vs=${c.id}#habits"${raw(compareWith?.company.id === c.id ? ' aria-current="true"' : '')}>${companyLabel(c)}</a>`)}
      </nav>` : ''}
    </div>
    ${compareWith && !compareWith.enough ? html`<p class="muted">${companyLabel(compareWith.company)} has fewer than ${MIN_GROUP} counted contributors, so its shares are hidden.</p>` : ''}
    <ul class="mine-list grid">${mine.map((p) => {
      const [t, cls] = tag(p.share);
      const hidden = compareWith && !compareWith.enough;
      return html`<li class="card"><span class="num q${quadIndex(p.quadrant)}">${numbered.get(p.catalog_id) ?? ''}</span><span><strong>${p.title}</strong><span class="muted small">${quadLabel(p.quadrant)}${hidden ? '' : ` · ${p.share}% ${where} do this too`}</span></span>${hidden ? '' : html`<span class="tag ${cls}">${t}</span>`}</li>`;
    })}</ul>
  </section>` : ''}

  ${unique.length ? html`<section class="slide column" id="only-you" aria-label="${sl('only-you')}">
    <div><p class="eyebrow q3">Not on the radar</p><h2 class="big-title">Habits nobody else has reported yet</h2><p class="lede">These sit outside the radar until someone else's assistant finds them too.</p></div>
    <div class="cards two">${unique.map((p) => html`<div class="card"><h3 class="card-title">${p.title}</h3><p class="muted">${p.summary}</p></div>`)}</div>
  </section>` : ''}

  <section class="slide column" id="tools" aria-label="${sl('tools')}">
    <div><p class="eyebrow q1">Tools and prompts</p><h2 class="big-title">What the work is done with, and how much</h2></div>
    <div class="cards two">
      <section class="card">
        <h3 class="card-title">Tools</h3>
        <p class="muted">Bar: share of everyone who uses the same tool.</p>
        <ul class="bars">${toolShares.map((t) => html`<li><span><b>${toolLink(t.name)}</b><span class="muted small">${t.used_for}</span></span>${meter(t.share, 'q0')}<span class="small muted">${t.share}%</span></li>`)}</ul>
      </section>
      <section class="card">
        <h3 class="card-title">Prompts a month</h3>
        ${latest.prompts_per_month
          ? html`<p class="muted"><b>${labelOf(PROMPT_RANGES, latest.prompts_per_month)}</b>${promptPercentile != null ? html`, more than about <b>${promptPercentile}%</b> of contributors` : ''}.</p>
            ${histogram({ bars: promptBins.map((b) => ({ label: b.label, value: b.share, highlight: b.id === latest.prompts_per_month })), unit: '%', className: 'q2', label: `Everyone's prompts a month; this page's range, ${labelOf(PROMPT_RANGES, latest.prompts_per_month)}, is highlighted` })}
            <p class="muted small">Highlighted: this page's range.${latest.months_using ? ` Using LLMs for work: ${labelOf(MONTH_RANGES, latest.months_using)} months.` : ''}</p>`
          : html`<p class="muted">The assistant didn't send this. Running the survey again can add it.</p>`}
      </section>
    </div>
  </section>

  ${lastSlide(sl('join'))}
</div>
${deckNav(slides)}`,
  });
}

// ---------- small pages ----------

// The password form in front of a protected page.
export function unlockPage({ kind, id, error }) {
  return page({
    title: 'Password needed',
    bare: true,
    noindex: true,
    body: html`<div class="wrap focus contribute-bare">
  <h1>This page is protected</h1>
  <p class="lede">${kind === 'c' ? 'Ask the colleague who sent you this link for the password.' : 'Enter the password its owner set.'}</p>
  ${error ? html`<p class="error" role="alert">That password is not right.</p>` : ''}
  <form method="post" action="/${kind}/${id}/unlock" class="details-form company">
    <div class="field"><label for="pw">Password</label><input id="pw" name="password" type="password" required autofocus autocomplete="current-password"></div>
    <button class="btn dark big" type="submit">Open the page</button>
  </form>
  <p class="muted small"><a href="/">${SITE}</a></p>
</div>`,
  });
}

export function privacyPage() {
  return page({
    title: 'Privacy',
    body: html`<div class="wrap narrow block prose">
  <h1>Privacy</h1>
  <p>Contributions describe how people work with assistants, never what they work on. The <a href="/contribute.md">prompt</a> tells the assistant to remove names, code, paths, URLs and anything that looks like a secret, and to show you the exact payload before it sends anything. The server removes URLs, emails, file paths and token-like strings again on arrival.</p>
  <h2>No accounts</h2>
  <p>There is no sign-up. Each answer gets a page with a long random address (/u/…), and company pages work the same way (/c/…). The browser that created a page is remembered with a cookie, so it can open the page without its password and run the survey again. That cookie is the only one the site sets.</p>
  <h2>What is stored</h2>
  <ul><li>Each contribution: the habits, tools, purposes, role and experience ranges it contains, and when it arrived.</li><li>The optional name and password of a page. Passwords are stored only as a salted hash.</li><li>If it came through a company page: that page's code.</li></ul>
  <h2>Who can see what</h2>
  <ul><li>The shared pages show totals and shares only, from answers that have been reviewed.</li><li>A company page shows totals only once ${MIN_GROUP} people have contributed, to people with its link (and its password, if it has one).</li><li>A personal page shows one person's answer to people with its link (and its password, if it has one).</li></ul>
  <h2>How answers are handled</h2>
  <p>What an assistant sends is treated as text to count, never as instructions. It is checked against a fixed list of fields and values, and reviewed before it is added to the shared numbers.</p>
  <h2>Deleting</h2>
  <p>Ask the site’s operator to delete your page, giving its address. That removes the page and every answer on it.</p>
</div>`,
  });
}

export const notFoundPage = () => page({
  title: 'Not found',
  body: html`<div class="wrap narrow block center"><h1>Not found</h1><p class="lede">There is nothing at this address. Personal and company links stop working when their owner deletes the page.</p><a class="btn dark" href="/">Go home</a></div>`,
});

// ---------- icons ----------
const ARROW = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const CHEVRON_LEFT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
const CHEVRON_RIGHT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const CLOSE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
