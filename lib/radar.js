// The radar: four tinted quadrants, four rings, one dot per pattern. Distance
// from the centre is the share of contributors, so ring borders fall exactly on
// 50%, 25% and 10% (Most, Many, Some, Few). Placement is the same as on the
// talk's slides.
import { QUADRANTS } from './shape.js';
import { esc } from './html.js';

const QUAD_SIGNS = [[-1, -1], [1, -1], [-1, 1], [1, 1]]; // brief, steer, check, delegate
export const RINGS = ['Most', 'Many', 'Some', 'Few'];

// Share (0–100) -> radius on a 300-unit radar.
export function shareRadius(share) {
  if (share >= 50) return 103 - ((share - 50) / 50) * 55;
  if (share >= 25) return 178 - ((share - 25) / 25) * 75;
  if (share >= 10) return 244 - ((share - 10) / 15) * 66;
  return 290 - (share / 10) * 46;
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// Adds x and y (percent of the radar box) to each item. Within a quadrant,
// items at similar distances get angles far apart so they do not overlap.
export function place(items) {
  for (let q = 0; q < 4; q++) {
    const group = items.filter((p) => p.q === q).sort((a, b) => a.radius - b.radius);
    const n = group.length;
    let step = Math.max(1, Math.round(n / 2));
    while (gcd(step, n) !== 1) step++;
    group.forEach((p, rank) => {
      const slot = (rank * step) % n;
      const lo = Math.asin(Math.min(1, 28 / p.radius));
      const hi = Math.PI / 2 - Math.asin(Math.min(1, 20 / p.radius));
      const angle = lo + ((slot + 0.5) * (hi - lo)) / n;
      p.x = (50 + (QUAD_SIGNS[q][0] * p.radius * Math.cos(angle)) / 6).toFixed(2);
      p.y = (50 + (QUAD_SIGNS[q][1] * p.radius * Math.sin(angle)) / 6).toFixed(2);
    });
  }
  return items;
}

// patterns: [{ id, title, quadrant, share, status }], numbered in the order given.
// options.mine: a Set of catalog ids to mark as the viewer's; others are greyed.
// options.compact: no numbers or ring labels (the home page preview).
// options.selected: the id that starts selected.
// options.numbers: a Map of id -> number, so a filtered radar keeps the full radar's numbers.
export function renderRadar(patterns, { mine = null, compact = false, selected = null, numbers = null, label = 'Radar of LLM usage patterns' } = {}) {
  const items = place(patterns.map((p, i) => ({
    ...p,
    n: numbers?.get(p.id) ?? i + 1,
    q: Math.max(0, QUADRANTS.findIndex((x) => x.id === p.quadrant)),
    radius: shareRadius(p.share),
  })));
  const dots = items.map((p) => {
    const classes = ['blip', `q${p.q}`];
    if (p.status === 'fading' || p.status === 'stopped') classes.push('hollow');
    if (mine) classes.push(mine.has(p.id) ? 'mine' : 'other');
    if (p.id === selected) classes.push('on');
    const who = mine?.has(p.id) ? ', one of yours' : '';
    const text = compact || (mine && !mine.has(p.id)) ? '' : p.n;
    const tag = compact ? 'span' : 'button';
    const attrs = compact
      ? 'aria-hidden="true"'
      : `type="button" data-id="${esc(p.id)}" aria-pressed="${p.id === selected}" aria-label="${esc(`${p.n}. ${p.title}, ${QUADRANTS[p.q].label}, ${p.share}% of contributors${who}`)}"`;
    const size = compact ? `--size:${14 + Math.round(p.share / 7)}px;` : '';
    return `<${tag} class="${classes.join(' ')}" style="left:${p.x}%;top:${p.y}%;${size}" ${attrs}>${text}</${tag}>`;
  });
  return `<div class="radar${compact ? ' compact' : ''}" role="group" aria-label="${esc(label)}">
  <div class="radar-disc" aria-hidden="true">
    <i class="qt q0"></i><i class="qt q1"></i><i class="qt q2"></i><i class="qt q3"></i>
    <i class="ring r1"></i><i class="ring r2"></i><i class="ring r3"></i>
    <i class="axis-v"></i><i class="axis-h"></i>
    ${compact ? '' : `<span class="ring-labels"><span style="left:60%">Most</span><span style="left:73.4%">Many</span><span style="left:85.2%">Some</span><span style="left:95.3%">Few</span></span>`}
  </div>
  ${QUADRANTS.map((q, i) => `<span class="quad-label q${i}" aria-hidden="true">${q.label}</span>`).join('')}
  <div class="radar-dots">${dots.join('')}</div>
</div>`;
}
