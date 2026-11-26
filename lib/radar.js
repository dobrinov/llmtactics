// The radar: four tinted quadrants, four rings, one dot per pattern. Distance
// from the centre is the share of contributors, so ring borders fall exactly on
// 50%, 25% and 10% (Most, Many, Some, Few). Placement is the same as on the
// talk's slides.

const QUAD_SIGNS = [[-1, -1], [1, -1], [-1, 1], [1, 1]]; // brief, steer, check, delegate

// Share (0–100) -> radius on a 300-unit radar.
export function shareRadius(share) {
  if (share >= 50) return 103 - ((share - 50) / 50) * 55;
  if (share >= 25) return 178 - ((share - 25) / 25) * 75;
  if (share >= 10) return 244 - ((share - 10) / 15) * 66;
  return 290 - (share / 10) * 46;
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// The ring a radius falls in, as [inner, outer] radius: a dot may move within
// its ring to make room, and never into another one.
const BANDS = [[0, 103], [103, 178], [178, 244], [244, 292]];
const bandOf = (r) => BANDS.find(([, out]) => r <= out) ?? BANDS[BANDS.length - 1];

// Adds x, y (percent of the radar box) and scale to each item. Within a
// quadrant, items at similar distances get angles far apart. `item.size`
// (optional, in radar units: the radius is 300) is the dot's diameter: where
// dots that size would overlap, a dot moves along its ring, then in or out
// within its ring, to the nearest free spot. When a quadrant holds more dots
// than fit, its dots all shrink a step at a time until they do (or reach
// half size); `scale` is the factor to draw them at.
const SCALES = [1, 0.9, 0.8, 0.7, 0.6, 0.5];

export function place(items) {
  const placed = [];
  const free = (x, y, s) => placed.every((o) => Math.hypot(o.ux - x, o.uy - y) >= (o.s + s) / 2 + 3);
  for (let q = 0; q < 4; q++) {
    const [sx, sy] = QUAD_SIGNS[q];
    const group = items.filter((p) => p.q === q).sort((a, b) => a.radius - b.radius);
    const n = group.length;
    let step = Math.max(1, Math.round(n / 2));
    while (gcd(step, n) !== 1) step++;
    const before = placed.length;
    for (const scale of SCALES) {
      placed.length = before;
      const fits = group.every((p, rank) => {
        const s = (p.size ?? 0) * scale;
        // Angles from the horizontal axis that keep the dot off both axes (and the ring labels).
        const range = (r) => [Math.asin(Math.min(1, Math.max(28, s / 2 + 8) / r)), Math.PI / 2 - Math.asin(Math.min(1, Math.max(20, s / 2 + 8) / r))];
        const slot = ((rank * step) % n + 0.5) / n;
        const at = (r, a) => ({ ux: sx * r * Math.cos(a), uy: sy * r * Math.sin(a) });
        const [lo, hi] = range(p.radius);
        let spot = at(p.radius, lo + slot * (hi - lo));
        let ok = !s || free(spot.ux, spot.uy, s);
        if (!ok) {
          // Nearest free spot: the same radius first, then a step in or out at a time.
          const [inner, outer] = bandOf(p.radius);
          const radii = [p.radius];
          for (let d = 4; d < 300; d += 4) {
            if (p.radius + d <= outer) radii.push(p.radius + d);
            if (p.radius - d >= Math.max(inner, s / 2 + 20)) radii.push(p.radius - d);
          }
          search: for (const r of radii) {
            const [a0, a1] = range(r);
            if (a1 <= a0) continue;
            const want = a0 + slot * (a1 - a0);
            const angles = Array.from({ length: 49 }, (_, i) => a0 + (i / 48) * (a1 - a0)).sort((a, b) => Math.abs(a - want) - Math.abs(b - want));
            for (const a of angles) {
              const c = at(r, a);
              if (free(c.ux, c.uy, s)) { spot = c; ok = true; break search; }
            }
          }
        }
        placed.push({ ...spot, s });
        p.x = (50 + spot.ux / 6).toFixed(2);
        p.y = (50 + spot.uy / 6).toFixed(2);
        p.scale = scale;
        // At the smallest scale every dot is kept, overlapping where it must.
        return ok || scale === SCALES[SCALES.length - 1];
      });
      if (fits) break;
    }
  }
  return items;
}
