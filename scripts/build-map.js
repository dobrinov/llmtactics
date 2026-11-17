// Builds data/world.json: every ISO country code, and an SVG outline for the
// ones large enough to draw. Run once; the result is committed.
//
//   node scripts/build-map.js countries-110m.json slim-2.json
//
// Inputs (public data):
//   countries-110m.json  https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json  (Natural Earth, 1:110m)
//   slim-2.json          https://github.com/lukes/ISO-3166-Countries-with-Regional-Codes  (ISO 3166-1 codes)
import fs from 'node:fs';

const [topoFile, isoFile] = process.argv.slice(2);
const topo = JSON.parse(fs.readFileSync(topoFile, 'utf8'));
const iso = JSON.parse(fs.readFileSync(isoFile, 'utf8'));
const alpha2 = new Map(iso.map((c) => [c['country-code'], c['alpha-2'].toLowerCase()]));
// Areas Natural Earth draws on their own without an ISO number.
const UNNUMBERED = { Kosovo: 'xk', 'N. Cyprus': 'cy', Somaliland: 'so' };

// Plain latitude and longitude on a 1000-wide canvas, without Antarctica.
const WIDTH = 1000, NORTH = 84, SOUTH = -58;
const HEIGHT = Math.round(((NORTH - SOUTH) / 360) * WIDTH);
const project = ([lon, lat]) => [((lon + 180) / 360) * WIDTH, ((NORTH - Math.max(SOUTH, Math.min(NORTH, lat))) / 360) * WIDTH];

// TopoJSON arcs are delta-encoded integer points; decode them once.
const { scale, translate } = topo.transform;
const arcs = topo.arcs.map((arc) => {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => { x += dx; y += dy; return project([x * scale[0] + translate[0], y * scale[1] + translate[1]]); });
});
const ring = (indexes) => {
  const points = [];
  for (const i of indexes) {
    const arc = i < 0 ? [...arcs[~i]].reverse() : arcs[i];
    points.push(...(points.length ? arc.slice(1) : arc));
  }
  // A shape that crosses the date line jumps from one edge of the map to the
  // other. Undo the jump so the outline stays in one piece, then draw it twice,
  // one map-width apart: the canvas edge cuts each copy where it should.
  let shift = 0;
  const flat = points.map(([x, y], i) => {
    if (i) {
      const step = x - points[i - 1][0];
      if (step > WIDTH / 2) shift -= WIDTH;
      else if (step < -WIDTH / 2) shift += WIDTH;
    }
    return [x + shift, y];
  });
  const n = (v) => String(Math.round(v * 10) / 10);
  const draw = (dx) => `M${flat.map(([x, y]) => `${n(x + dx)},${n(y)}`).join('L')}Z`;
  const xs = flat.map(([x]) => x);
  if (Math.max(...xs) > WIDTH) return draw(0) + draw(-WIDTH);
  if (Math.min(...xs) < 0) return draw(0) + draw(WIDTH);
  return draw(0);
};
const path = (g) => (g.type === 'Polygon' ? g.arcs : g.arcs.flat()).map(ring).join('');

const shapes = new Map();
for (const g of topo.objects.countries.geometries) {
  const id = g.id != null ? alpha2.get(String(g.id).padStart(3, '0')) : UNNUMBERED[g.properties.name];
  if (!id || id === 'aq') continue;
  shapes.set(id, (shapes.get(id) ?? '') + path(g));
}

const codes = [...new Set([...iso.map((c) => c['alpha-2'].toLowerCase()), 'xk'])].filter((c) => c !== 'aq').sort();
const out = { width: WIDTH, height: HEIGHT, countries: codes.map((id) => (shapes.has(id) ? { id, d: shapes.get(id) } : { id })) };
fs.writeFileSync(new URL('../data/world.json', import.meta.url), JSON.stringify(out));
console.log(`${codes.length} countries, ${shapes.size} with an outline, ${HEIGHT} high`);
