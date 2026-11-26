// Small enhancements; every page works without this file.

// Copy buttons: <button data-copy="text">
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset.copy);
    const label = btn.textContent;
    btn.textContent = 'Copied';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = label; btn.classList.remove('copied'); }, 1600);
  } catch {
    window.prompt('Copy this:', btn.dataset.copy);
  }
});

// Forms that need a second thought: <form data-confirm="...">
document.addEventListener('submit', (e) => {
  const msg = e.target.dataset?.confirm;
  if (msg && !window.confirm(msg)) e.preventDefault();
});

// Contribute pages: follow the one-time code. "fetched": the assistant has the
// prompt and is at work; "done": its answer arrived. On a step page
// ([data-flow="me"]) these move the steps on; elsewhere a line of text says so.
const flowPage = document.querySelector('[data-flow="me"]');
let flowAt = 1;
let flowReached = 1;
function flowGo(n) {
  if (!flowPage) return;
  flowReached = Math.max(flowReached, n);
  flowAt = n;
  for (const s of flowPage.querySelectorAll('[data-flow-step]')) s.hidden = Number(s.dataset.flowStep) !== n;
  for (const d of flowPage.querySelectorAll('[data-flow-dot]')) {
    const i = Number(d.dataset.flowDot);
    d.classList.toggle('on', i === n);
    d.classList.toggle('done', i < n || (i <= flowReached && i !== n));
    d.disabled = i > flowReached || flowReached === 4;
    if (i === n) d.setAttribute('aria-current', 'step'); else d.removeAttribute('aria-current');
  }
  flowPage.querySelector(`[data-flow-step="${n}"] h1`)?.focus({ preventScroll: true });
}
if (flowPage) {
  for (const el of flowPage.querySelectorAll('[data-js]')) el.hidden = false;
  for (const h of flowPage.querySelectorAll('[data-flow-step] h1')) h.tabIndex = -1;
  flowPage.addEventListener('click', (e) => {
    const b = e.target.closest('[data-flow-go], [data-flow-dot]');
    if (b && !b.disabled) flowGo(Number(b.dataset.flowGo || b.dataset.flowDot));
  });
}

const waitEl = document.querySelector('[data-wait]');
if (waitEl) {
  const text = document.querySelector('[data-wait-text]');
  const say = (msg) => { if (text) text.textContent = msg; };
  const started = Date.now();
  function arrived(body) {
    if (!flowPage) {
      say('Your answer arrived. ');
      const a = document.createElement('a');
      a.href = body.redirect;
      a.textContent = 'See your results';
      text?.append(a);
      return;
    }
    const results = flowPage.querySelector('[data-flow-results]');
    if (results && body.redirect) results.href = `${body.redirect}#tactics`;
    const edit = flowPage.querySelector('[data-flow-edit]');
    if (edit && body.page) { edit.href = `${body.page}/edit`; edit.hidden = false; }
    if (body.code) {
      flowPage.querySelector('[data-flow-code]').textContent = body.code;
      flowPage.querySelector('[data-flow-code-copy]').dataset.copy = body.code;
      flowPage.querySelector('[data-flow-keep]').hidden = false;
    }
    say('');
    flowGo(4);
  }
  // The answer can take up to an hour, and the code lasts two days: keep
  // checking, less often after a while. Reloading would make a new code, so
  // the page never asks for that while the answer may be on its way.
  async function check() {
    const waited = Date.now() - started;
    if (waited > 60 * 60_000) say('Still waiting. A long history takes a while; the link your assistant gives you at the end opens your results too.');
    if (document.visibilityState === 'visible') {
      try {
        const r = await fetch(`/api/wait/${waitEl.dataset.wait}`, { cache: 'no-store' });
        const body = await r.json();
        if (body.status === 'done') return arrived(body);
        if (body.status === 'fetched' && flowAt < 2) flowGo(2);
        if (body.status === 'expired') {
          say('This line has expired. Reload the page for a new one.');
          return;
        }
      } catch { /* try again on the next tick */ }
    }
    setTimeout(check, waited > 15 * 60_000 ? 15_000 : 3000);
  }
  setTimeout(check, 3000);
}

// Home slides: dots, arrows, "next" buttons and the arrow keys move between slides.
const deck = document.querySelector('[data-deck]');
if (deck) {
  const slides = [...deck.querySelectorAll('.slide')];
  const dots = [...document.querySelectorAll('[data-deck-dot]')];
  const arrows = [...document.querySelectorAll('[data-deck-step]')];
  const stepOf = (a) => Number(a.dataset.deckStep);
  // The tour's top bar names the slide, and the lens links open the same slide.
  const where = document.querySelector('[data-where]');
  const lensLinks = [...document.querySelectorAll('[data-lens-link]')];
  // No Take part link while the Take part slide is showing.
  const joinLink = document.querySelector('.tour-join');
  const names = dots.map((d) => d.querySelector('.tip')?.textContent ?? '');
  let current = 0;

  const goTo = (i) => {
    const n = Math.max(0, Math.min(slides.length - 1, i));
    deck.scrollTo({ left: slides[n].offsetLeft, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  // A slide that was scrolled goes back to its top once it is left, so it
  // starts from the beginning the next time it is shown.
  const rewind = (slide) => {
    slide.scrollTop = 0;
  };
  function mark(i) {
    if (i !== current) rewind(slides[current]);
    current = i;
    dots.forEach((d, k) => (k === i ? d.setAttribute('aria-current', 'step') : d.removeAttribute('aria-current')));
    joinLink?.classList.toggle('here', slides[i].id === 'join');
    if (where) where.textContent = `${String(i + 1).padStart(2, '0')} · ${names[i]}`;
    for (const a of lensLinks) a.href = `${a.getAttribute('href').split('#')[0]}${i ? `#${slides[i].id}` : ''}`;
    for (const a of arrows) {
      const target = i + stepOf(a);
      const off = target < 0 || target >= slides.length;
      a.setAttribute('aria-disabled', String(off));
      if (!off) a.href = `#${slides[target].id}`;
    }
    document.body.dataset.slide = String(i);
    history.replaceState(null, '', i ? `#${slides[i].id}` : location.pathname);
  }

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) mark(slides.indexOf(e.target));
  }, { root: deck, threshold: 0.6 });
  slides.forEach((s) => io.observe(s));

  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    const step = e.target.closest('[data-deck-step]');
    if (go && !deck.contains(go) && !go.closest('.tour-bar')) return;
    if (go) { e.preventDefault(); goTo(Number(go.dataset.goto)); }
    else if (step) { e.preventDefault(); goTo(current + stepOf(step)); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    // An open details card keeps the keyboard: Esc closes it, and the arrow keys
    // step to the previous or next habit when the card has those buttons. Past
    // the last habit (or before the first) the keys leave the slide, as they do
    // without a card, so the slides after the radar are not hidden behind it.
    let card = null;
    try { card = document.querySelector('.tcard:popover-open'); } catch { /* no :popover-open support */ }
    if (card) {
      const dir = { ArrowRight: 1, PageDown: 1, ArrowLeft: -1, PageUp: -1 }[e.key];
      const to = dir && card.querySelector(`[data-card-step="${dir}"]`);
      if (to && to.hasAttribute('data-card-wrap')) { e.preventDefault(); card.hidePopover(); goTo(current + dir); }
      else if (to) { e.preventDefault(); to.click(); }
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); goTo(current + 1); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goTo(current - 1); }
  });
  const start = slides.findIndex((s) => `#${s.id}` === location.hash);
  if (start > 0) deck.scrollTo({ left: slides[start].offsetLeft, behavior: 'instant' });
}

// The world map: a country's name and its number of people follow the pointer.
for (const map of document.querySelectorAll('[data-map]')) {
  const tip = map.parentElement.querySelector('[data-map-tip]');
  const [name, note] = tip.children;
  const hide = () => { tip.hidden = true; };
  map.addEventListener('pointermove', (e) => {
    const c = e.target.closest('[data-tip]');
    if (!c) return hide();
    name.textContent = c.dataset.tip;
    note.textContent = c.dataset.tipNote;
    tip.hidden = false;
    tip.style.left = `${Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, e.clientX + 14))}px`;
    tip.style.top = `${Math.max(8, e.clientY - tip.offsetHeight - 12)}px`;
  });
  map.addEventListener('pointerleave', hide);
}

// ---------- the tour ----------

// The radar's quadrant names filter it: one quadrant at a time, again to show all.
for (const radar of document.querySelectorAll('[data-tradar]')) {
  radar.addEventListener('click', (e) => {
    const q = e.target.closest('[data-quad]');
    if (!q) return;
    const on = radar.dataset.only === q.dataset.quad;
    if (on) delete radar.dataset.only; else radar.dataset.only = q.dataset.quad;
    for (const b of radar.querySelectorAll('[data-quad]')) b.setAttribute('aria-pressed', String(!on && b === q));
  });
}

// A button that shows or hides the element it controls: <button data-toggle aria-controls="id">.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-toggle]');
  if (!btn) return;
  const target = document.getElementById(btn.getAttribute('aria-controls'));
  if (!target) return;
  target.hidden = !target.hidden;
  btn.setAttribute('aria-expanded', String(!target.hidden));
});

// Setups: Show more opens the next rarer setups, and the last row counts what is left.
for (const list of document.querySelectorAll('[data-setups]')) {
  const other = list.querySelector('[data-other]');
  if (!other) continue;
  const steps = JSON.parse(other.dataset.steps);
  const rows = [...list.querySelectorAll('[data-more]')];
  const more = other.querySelector('[data-more-btn]');
  const less = other.querySelector('[data-less-btn]');
  let at = 0;
  const show = (k) => {
    at = Math.max(0, Math.min(steps.length - 1, k));
    let open = 0;
    for (let i = 0; i < at; i++) open += steps[i].more;
    rows.forEach((r, i) => { r.hidden = i >= open; });
    const s = steps[at];
    other.querySelector('[data-other-label]').firstChild.textContent = s.label;
    other.querySelector('[data-other-share]').textContent = `${s.share}%`;
    other.querySelector('[data-other-bar]').style.width = `${s.w}%`;
    other.hidden = !s.label && !s.share;
    more.hidden = !s.more;
    more.textContent = `Show ${s.more} more`;
    less.hidden = at === 0;
  };
  more.addEventListener('click', () => show(at + 1));
  less.addEventListener('click', () => { show(0); list.scrollTo({ top: 0 }); });
}

// Models: switch between families and versions.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-stack-view]');
  if (!btn) return;
  const slide = btn.closest('section');
  for (const b of slide.querySelectorAll('[data-stack-view]')) b.setAttribute('aria-pressed', String(b === btn));
  for (const f of slide.querySelectorAll('[data-stack]')) f.hidden = f.dataset.stack !== btn.dataset.stackView;
});

// All tools: the search box keeps the tools whose name contains what is typed.
for (const input of document.querySelectorAll('[data-tool-filter]')) {
  const list = document.querySelector('[data-tools-list]');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    let any = false;
    for (const group of list.querySelectorAll('[data-group]')) {
      const items = [...group.querySelectorAll('li[data-name]')];
      let n = 0;
      for (const li of items) { li.hidden = Boolean(q) && !li.dataset.name.includes(q); if (!li.hidden) n++; }
      group.hidden = n === 0;
      const count = group.querySelector('[data-count]');
      count.textContent = q ? `${n} of ${items.length}` : `${items.length} ${items.length === 1 ? 'tool' : 'tools'}`;
      any ||= n > 0;
    }
    list.querySelector('[data-no-match]').hidden = any;
  });
}

// Habit cards on the radar: Previous and Next swap one card for the other (a
// button inside an open popover would open the next one on top of it), and the
// dot of the open card stays marked.
document.addEventListener('click', (e) => {
  const step = e.target.closest('[data-card-to]');
  const from = step?.closest('.tcard');
  const to = step && document.getElementById(step.dataset.cardTo);
  if (!from || !to) return;
  from.hidePopover();
  to.showPopover();
  to.querySelector(`[data-card-step="${step.dataset.cardStep}"]`)?.focus();
});
for (const card of document.querySelectorAll('.tcard[id^="h-"]')) {
  card.addEventListener('toggle', (e) => {
    for (const dot of document.querySelectorAll(`.hdot[popovertarget="${card.id}"]`)) dot.classList.toggle('on', e.newState === 'open');
  });
}

// The radar slide opens with its first habit selected (on a person's page, their
// first one), and closes the card when the slide is left.
const habits = document.getElementById('tactics');
if (habits && document.querySelector('[data-deck]')) {
  const cards = [...habits.querySelectorAll('.tcard[id^="h-"]')];
  const first = cards.find((c) => habits.querySelector(`.hdot.mine[popovertarget="${c.id}"]`)) ?? cards[0];
  const isOpen = (c) => { try { return c.matches(':popover-open'); } catch { return false; } };
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) { if (first && !cards.some(isOpen)) first.showPopover(); }
    else for (const c of cards) if (isOpen(c)) c.hidePopover();
  }, { threshold: 0.6 }).observe(habits);
}
