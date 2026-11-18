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

// The radar page: a dot or a list row opens that pattern in the drawer
// without a reload; Esc, the close button or the backdrop close it.
const root = document.querySelector('[data-radar]');
const dataEl = document.getElementById('radar-data');
if (root && dataEl) {
  const data = JSON.parse(dataEl.textContent);
  const order = root.dataset.order.split(' ');
  const drawer = root.querySelector('[data-drawer]');
  const scrim = root.querySelector('.scrim');
  const panel = drawer.querySelector('[data-detail]');
  const field = (name) => panel.querySelector(`[data-f="${name}"]`);
  let current = new URL(location.href).searchParams.get('p');
  let opener = null;

  const urlFor = (id) => {
    const url = new URL(location.href);
    if (id) url.searchParams.set('p', id);
    else url.searchParams.delete('p');
    return url;
  };

  function mark(id) {
    for (const b of root.querySelectorAll('.blip[data-id]')) {
      b.classList.toggle('on', b.dataset.id === id);
      b.setAttribute('aria-pressed', String(b.dataset.id === id));
    }
    for (const a of root.querySelectorAll('.pattern-list a')) {
      if (a.dataset.id === id) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    }
  }

  function open(id) {
    const d = data[id];
    if (!d) return;
    current = id;
    panel.className = `detail q${d.q}`;
    field('area').className = `badge q${d.q}`;
    for (const k of ['area', 'status', 'title', 'summary', 'when', 'problem']) field(k).textContent = d[k];
    field('n').textContent = `${d.n}.`;
    field('share').textContent = `${d.share}%`;
    field('from').textContent = d.trend[0].label;
    field('to').textContent = d.trend.at(-1).label;
    const top = Math.max(1, ...d.trend.map((t) => t.share));
    const bars = field('trend');
    bars.replaceChildren(...d.trend.map((t, i) => {
      const bar = document.createElement('i');
      bar.style.height = `${Math.max(3, (t.share / top) * 100).toFixed(0)}%`;
      if (i === d.trend.length - 1) bar.className = 'last';
      return bar;
    }));
    bars.setAttribute('aria-label', `Share per month: ${d.trend.map((t) => `${t.label} ${t.share}%`).join(', ')}`);
    const at = order.indexOf(id);
    for (const a of drawer.querySelectorAll('[data-step]')) {
      a.href = urlFor(order[(at + Number(a.dataset.step) + order.length) % order.length]).search;
    }
    mark(id);
    drawer.hidden = false;
    scrim.hidden = false;
    history.replaceState(null, '', urlFor(id));
    const title = drawer.querySelector('h2');
    title.tabIndex = -1;
    title.focus();
  }

  function close() {
    drawer.hidden = true;
    scrim.hidden = true;
    current = null;
    mark(null);
    history.replaceState(null, '', urlFor(null));
    opener?.focus();
  }

  root.addEventListener('click', (e) => {
    const target = e.target.closest('.blip[data-id], .pattern-list a[data-id]');
    if (target) {
      e.preventDefault();
      opener = target;
      return open(target.dataset.id);
    }
    if (e.target.closest('[data-close]')) {
      e.preventDefault();
      return close();
    }
    const stepper = e.target.closest('[data-step]');
    if (stepper && current) {
      e.preventDefault();
      open(order[(order.indexOf(current) + Number(stepper.dataset.step) + order.length) % order.length]);
    }
  });
  // While the drawer is open the keyboard belongs to it: Esc closes it, and the
  // arrow keys step through the habits instead of moving the slides underneath.
  document.addEventListener('keydown', (e) => {
    if (drawer.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') return close();
    const step = { ArrowRight: 1, PageDown: 1, ArrowLeft: -1, PageUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const at = order.indexOf(current);
    open(order[(at + step + order.length) % order.length]);
  });
}

// Contribute pages: wait for the submission, then go to the results.
const waitEl = document.querySelector('[data-wait]');
if (waitEl) {
  const text = waitEl.querySelector('[data-wait-text]');
  const started = Date.now();
  async function check() {
    if (Date.now() - started > 45 * 60_000) {
      text.textContent = 'Still waiting. Reload this page if your assistant sent it in another way.';
      return;
    }
    if (document.visibilityState === 'visible') {
      try {
        const r = await fetch(`/api/wait/${waitEl.dataset.wait}`, { cache: 'no-store' });
        const body = await r.json();
        if (body.status === 'done') {
          waitEl.classList.add('done');
          text.textContent = 'Your answer arrived. Opening your results…';
          setTimeout(() => location.assign(body.redirect), 600);
          return;
        }
        if (body.status === 'expired') {
          text.textContent = 'This prompt has expired. Reload the page for a new one.';
          return;
        }
      } catch { /* try again on the next tick */ }
    }
    setTimeout(check, 3000);
  }
  setTimeout(check, 3000);
}

// Home slides: dots, arrows, "next" buttons and the arrow keys move between slides.
const deck = document.querySelector('[data-deck]');
if (deck) {
  const slides = [...deck.querySelectorAll('.slide')];
  const dots = [...document.querySelectorAll('.deck-nav .dot')];
  const arrows = [...document.querySelectorAll('.deck-nav [data-step]')];
  let current = 0;

  const goTo = (i) => {
    const n = Math.max(0, Math.min(slides.length - 1, i));
    deck.scrollTo({ left: slides[n].offsetLeft, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  // A slide that was scrolled goes back to its top once it is left, so it
  // starts from the beginning the next time it is shown.
  const rewind = (slide) => {
    slide.scrollTop = 0;
    for (const el of slide.querySelectorAll('.tool-strip, .country-list, [data-scroll-list] ul')) el.scrollTo(0, 0);
  };
  function mark(i) {
    if (i !== current) rewind(slides[current]);
    current = i;
    dots.forEach((d, k) => (k === i ? d.setAttribute('aria-current', 'step') : d.removeAttribute('aria-current')));
    for (const a of arrows) {
      const target = i + Number(a.dataset.step);
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
    const step = e.target.closest('.deck-nav [data-step]');
    if (go && !deck.contains(go) && !go.closest('.deck-nav, .deck-start')) return;
    if (go) { e.preventDefault(); goTo(Number(go.dataset.goto)); }
    else if (step) { e.preventDefault(); goTo(current + Number(step.dataset.step)); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); goTo(current + 1); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goTo(current - 1); }
  });
  const start = slides.findIndex((s) => `#${s.id}` === location.hash);
  if (start > 0) deck.scrollTo({ left: slides[start].offsetLeft, behavior: 'instant' });
}

// Long lists on slides: arrow buttons scroll the list, and switch off at either end.
for (const box of document.querySelectorAll('[data-scroll-list]')) {
  const list = box.querySelector('ul');
  const [up, down] = box.querySelectorAll('[data-scroll]');
  const update = () => {
    up.disabled = list.scrollTop <= 2;
    down.disabled = list.scrollTop + list.clientHeight >= list.scrollHeight - 2;
    const hide = up.disabled && down.disabled;
    up.hidden = hide; down.hidden = hide;
  };
  for (const b of [up, down]) b.addEventListener('click', () => list.scrollBy({ top: Number(b.dataset.scroll) * list.clientHeight * 0.6 }));
  list.addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
  update();
}

// The optional name and password on a contribute page: saved with the one-time
// code as you type, so they are there when the assistant's answer arrives.
for (const form of document.querySelectorAll('[data-details-form]')) {
  const status = form.querySelector('[data-details-status]');
  let timer;
  const save = async () => {
    clearTimeout(timer);
    const password = form.elements.password.value;
    try {
      const r = await fetch(form.action, { method: 'POST', body: new URLSearchParams(new FormData(form)), credentials: 'same-origin' });
      const body = await r.json().catch(() => ({}));
      status.textContent = r.ok ? (form.elements.name.value.trim() || password ? 'Saved for your page' : '') : body.error || 'Could not save';
    } catch { status.textContent = 'Could not save'; }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  form.addEventListener('input', () => { status.textContent = ''; clearTimeout(timer); timer = setTimeout(save, 700); });
  form.addEventListener('change', save);
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

// Previous and Next inside a setup's details: swap one popover for the other.
// (Left to the browser, a popover opened from inside another stacks on top of it.)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.setup-pop .drawer-nav [popovertarget]');
  if (!btn) return;
  e.preventDefault();
  btn.closest('.setup-pop').hidePopover();
  document.getElementById(btn.getAttribute('popovertarget'))?.showPopover();
});
