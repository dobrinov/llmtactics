// Stored totals: the numbers the tour shows, kept as sums that change one
// answer at a time, and that can always be rebuilt from the stored answers.
//
// A cell is (scope, kind, month, metric, key) -> value:
//   scope  'all', or 'c:<company id>' for a company's answers
//   kind   'm': each person's latest answer in that month (the charts over time)
//          'l': each person's latest answer of all, filed under its month (the
//               headline numbers: the last three months of these, or all of them)
//   metric what is counted, such as 'tool' with the key 'claude code'
//
// A person is a page ('p:<profile id>'), or one answer sent without a page
// ('c:<contribution id>'). For each person the table `folded` remembers which
// answers are in the totals, and what each added. Folding a person again
// compares that with what should be there now, takes out what no longer
// belongs and adds what is new. So accepting, rejecting, re-matching or
// deleting an answer all take the same path, and doing it twice changes nothing.
//
// Rebuilding folds every person from nothing. The tests check that folding
// answers one at a time, in any order, gives the same totals as a rebuild, and
// the same numbers as counting the answers directly (lib/stats.js).
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { catalog, MODELS } from './shape.js';
import { countryLabel } from './shape.js';
import {
  NO_COUNTRY, RECENT_MONTHS, MIN_RECENT, lastMonths, monthKey, toolKey, pct, pickTop, labelsFrom,
  devTools, setupTools, SETUP_SEP, familyNames, versionNames, harnessNames, firstOfEach, toolEntries, setupsFrom, stackFrom, detailFrom, topTexts,
} from './stats.js';

// Bump when what an answer adds changes: the server then rebuilds on start.
// The data it reads (tool categories, model names, the catalog) is part of the
// version too, so editing data/ rebuilds on the next start as well.
const SCHEME = 5;
const modelsText = JSON.stringify(MODELS, (k, v) => (typeof v === 'function' ? v.toString() : v));
export const VERSION = `${SCHEME}:${createHash('sha256').update(modelsText)
  .update(fs.readFileSync(new URL('../data/tools.json', import.meta.url)))
  .update(fs.readFileSync(new URL('../data/catalog.json', import.meta.url))).digest('hex').slice(0, 16)}`;

const SEP = '\u0001';

// What one answer adds to the totals: [metric, key, value] triples.
export function delta(c) {
  const out = new Map();
  const add = (metric, key, v = 1) => { const k = metric + SEP + key; out.set(k, (out.get(k) || 0) + v); };
  add('n', '');
  for (const id of new Set(c.patterns.map((p) => p.catalog_id).filter(Boolean))) add('pattern', id);
  for (const p of c.patterns) if (p.catalog_id) add('pstatus', `${p.catalog_id}\t${p.status ?? ''}`);
  const tools = firstOfEach(c.tools);
  for (const t of tools) {
    const key = toolKey(t.name);
    add('tool', key);
    add('toolname', `${key}\t${t.name}`);
    add('toolkind', `${key}\t${t.kind ?? ''}`);
    if (t.used_for) add('tooluse', `${key}\t${t.used_for.trim()}`);
    if (t.frequency) add('toolfreq', key);
    if (t.frequency === 'daily') add('tooldaily', key);
  }
  const dev = devTools(c);
  add('setup', [...setupTools(c).keys()].sort().join(SETUP_SEP));
  for (const [k, t] of dev) add('devtool', `${k}\t${t.name}\t${t.category}`);
  for (const t of tools) for (const k of dev.keys()) if (k !== toolKey(t.name)) add('with', `${toolKey(t.name)}\t${k}`);
  const shares = (metric, names) => {
    const list = [...new Set(names)];
    if (!list.length) return;
    add(`${metric}_n`, '');
    for (const name of list) add(metric, name, 1 / list.length);
  };
  shares('family', familyNames(c));
  shares('version', versionNames(c));
  shares('harness', harnessNames(c));
  add('country', c.country ?? NO_COUNTRY);
  return [...out].map(([k, v]) => { const i = k.indexOf(SEP); return [k.slice(0, i), k.slice(i + 1), v]; });
}

export const personOf = (c) => (c.profile_id != null ? `p:${c.profile_id}` : `c:${c.id}`);

// The folds one person should have: their accepted answers, oldest first.
// [{ scope, kind, month, id, delta }]
export function desired(answers) {
  if (!answers.length) return [];
  const scopes = new Map([['all', answers]]);
  for (const c of answers) if (c.company_id) {
    const s = `c:${c.company_id}`;
    if (!scopes.has(s)) scopes.set(s, []);
    scopes.get(s).push(c);
  }
  const out = [];
  for (const [scope, list] of scopes) {
    const sorted = [...list].sort((a, b) => a.id - b.id);
    const latest = sorted.at(-1);
    out.push({ scope, kind: 'l', month: monthKey(latest.created_at), id: latest.id, delta: delta(latest) });
    const inMonth = new Map();
    for (const c of sorted) inMonth.set(monthKey(c.created_at), c);
    for (const [month, c] of inMonth) out.push({ scope, kind: 'm', month, id: c.id, delta: delta(c) });
  }
  return out;
}

const slot = (f) => `${f.scope}|${f.kind}|${f.month}`;
const same = (a, b) => Number(a.id ?? a.contribution_id) === Number(b.id ?? b.contribution_id) && JSON.stringify(a.delta) === JSON.stringify(b.delta);

// What to take out and put in to go from the folds a person has to the ones
// they should have. `have`: rows of `folded` ({ scope, kind, month, contribution_id, delta }).
export function plan(want, have) {
  const wanted = new Map(want.map((f) => [slot(f), f]));
  const had = new Map(have.map((f) => [slot(f), f]));
  return {
    remove: have.filter((f) => !wanted.has(slot(f)) || !same(wanted.get(slot(f)), f)),
    add: want.filter((f) => !had.has(slot(f)) || !same(f, had.get(slot(f)))),
  };
}

// The cells a plan changes: Map(cellKey -> change), with no zero changes.
export const cellKey = (scope, kind, month, metric, key) => [scope, kind, month, metric, key].join(SEP);
export const splitCell = (k) => { const [scope, kind, month, metric, key] = k.split(SEP); return { scope, kind, month, metric, key }; };
export function changes({ add, remove }) {
  const out = new Map();
  const put = (f, sign) => {
    for (const [metric, key, v] of f.delta) {
      const k = cellKey(f.scope, f.kind, f.month, metric, key);
      out.set(k, (out.get(k) || 0) + sign * v);
    }
  };
  for (const f of remove) put(f, -1);
  for (const f of add) put(f, 1);
  for (const [k, v] of out) if (Math.abs(v) < 1e-12) out.delete(k);
  return out;
}

// Everything from nothing: the folds and the cells for a list of accepted answers.
export function foldAll(answers) {
  const people = new Map();
  for (const c of answers) {
    const p = personOf(c);
    if (!people.has(p)) people.set(p, []);
    people.get(p).push(c);
  }
  const folded = [];
  const cells = new Map();
  for (const [person, list] of people) {
    const want = desired(list);
    for (const f of want) folded.push({ person, ...f });
    for (const [k, v] of changes({ add: want, remove: [] })) cells.set(k, (cells.get(k) || 0) + v);
  }
  return { folded, cells };
}

// ---------- reading: the numbers the tour shows, from one scope's cells ----------

// A bucket: Map(metric -> Map(key -> value)).
function into(bucket, metric, key, value) {
  if (!bucket.has(metric)) bucket.set(metric, new Map());
  const m = bucket.get(metric);
  m.set(key, (m.get(key) || 0) + value);
}
const val = (b, metric, key = '') => b?.get(metric)?.get(key) || 0;
const entries = (b, metric) => [...(b?.get(metric) ?? new Map())].filter(([, v]) => Math.abs(v) > 1e-9);
// Keys of the form "<a>\t<b>" grouped by a: Map(a -> Map(b -> value)).
function byFirst(b, metric) {
  const out = new Map();
  for (const [k, v] of entries(b, metric)) {
    const i = k.indexOf('\t');
    const [a, rest] = [k.slice(0, i), k.slice(i + 1)];
    if (!out.has(a)) out.set(a, new Map());
    out.get(a).set(rest, v);
  }
  return out;
}

// cells: [{ kind, month, metric, key, value }] of one scope.
export function bucketsOf(cells, now = new Date()) {
  const latest = new Map();
  const monthly = new Map();
  for (const c of cells) {
    const target = c.kind === 'l' ? latest : monthly;
    if (!target.has(c.month)) target.set(c.month, new Map());
    into(target.get(c.month), c.metric, c.key, Number(c.value));
  }
  const merge = (months) => {
    const b = new Map();
    for (const m of months) for (const [metric, keys] of m) for (const [k, v] of keys) into(b, metric, k, v);
    return b;
  };
  const all = merge(latest.values());
  const recentKeys = lastMonths(RECENT_MONTHS, now).map((m) => m.key);
  const recent = merge(recentKeys.map((k) => latest.get(k)).filter(Boolean));
  const useRecent = Math.round(val(recent, 'n')) >= MIN_RECENT;
  const cur = useRecent ? recent : all;
  // The months the headline numbers (cur) are counted from.
  const curMonths = new Set(useRecent ? recentKeys : latest.keys());
  return { cur, all, monthly, now, curMonths };
}

const round = (v) => Math.round(v);

export function radarFrom({ cur, monthly, now }, { months = lastMonths(6, now) } = {}) {
  const total = round(val(cur, 'n'));
  const statuses = byFirst(cur, 'pstatus');
  const patterns = catalog.map((p) => {
    const count = round(val(cur, 'pattern', p.id));
    const tally = (s) => round(statuses.get(p.id)?.get(s) || 0);
    const n = [...(statuses.get(p.id)?.values() ?? [])].reduce((a, b) => a + round(b), 0);
    const half = n / 2;
    const status = !n ? 'active'
      : tally('stopped') + tally('fading') > half ? (tally('stopped') > tally('fading') ? 'stopped' : 'fading')
      : tally('new') > half ? 'new' : 'active';
    return {
      ...p,
      count,
      share: pct(count, total),
      status,
      trend: months.map((m) => {
        const b = monthly.get(m.key);
        return { label: m.label, share: pct(round(val(b, 'pattern', p.id)), round(val(b, 'n'))), n: round(val(b, 'n')) };
      }),
    };
  });
  return { total, patterns: patterns.filter((p) => p.count > 0), emerging: [], unmatchedTitles: new Map() };
}

const devLabels = (b) => labelsFrom(new Map([...byFirst(b, 'devtool')].map(([k, m]) => [k, m])));

export const setupsOf = ({ cur }) => setupsFrom(new Map(entries(cur, 'setup').map(([k, v]) => [k, round(v)])), round(val(cur, 'n')), devLabels(cur));

export function toolsOf({ cur, monthly, now }, { months = lastMonths(12, now) } = {}) {
  const total = round(val(cur, 'n'));
  const names = byFirst(cur, 'toolname');
  const kinds = byFirst(cur, 'toolkind');
  const uses = byFirst(cur, 'tooluse');
  const list = entries(cur, 'tool').map(([key, count]) => ({
    key,
    count: round(count),
    name: pickTop([...names.get(key)].map(([n, v]) => [n, round(v)])),
    kind: pickTop([...kinds.get(key)].map(([n, v]) => [n, round(v)])) || null,
    uses: topTexts([...(uses.get(key) ?? [])].map(([t, v]) => [t, round(v)]), 3),
    reported: round(val(cur, 'toolfreq', key)),
    daily: round(val(cur, 'tooldaily', key)),
  }));
  return toolEntries(list, total).map(({ key, ...e }) => ({
    ...e,
    series: months.map((m) => { const b = monthly.get(m.key); return { label: m.label, share: pct(round(val(b, 'tool', key)), round(val(b, 'n'))) }; }),
  }));
}

export function stackOf({ monthly, now }, metric, { months = lastMonths(6, now), top = 6 } = {}) {
  return stackFrom(months.map((m) => {
    const b = monthly.get(m.key);
    return { key: m.key, label: m.label, w: new Map(entries(b, metric)), n: round(val(b, `${metric}_n`)) };
  }), top);
}

export const countriesOf = ({ all }) => entries(all, 'country')
  .map(([id, count]) => ({ id, label: countryLabel(id), count: round(count) }))
  .sort((a, b) => (a.id === NO_COUNTRY) - (b.id === NO_COUNTRY) || b.count - a.count || a.label.localeCompare(b.label));

export function toolDetailOf({ cur, monthly, now }, name, { months = lastMonths(6, now) } = {}) {
  const key = toolKey(name);
  return detailFrom({
    total: round(val(cur, 'n')),
    count: round(val(cur, 'tool', key)),
    series: months.map((m) => { const b = monthly.get(m.key); return { label: m.label, n: round(val(b, 'n')), users: round(val(b, 'tool', key)) }; }),
    together: new Map([...(byFirst(cur, 'with').get(key) ?? [])].map(([k, v]) => [k, round(v)])),
    labels: devLabels(cur),
    uses: [...(byFirst(cur, 'tooluse').get(key) ?? [])].map(([t, v]) => [t, round(v)]),
  });
}

// Everything one lens of the tour shows. With `minGroup` (a company), a month
// or a country with fewer people than that is left out, so no breakdown can
// point at one colleague; `elsewhere` counts the people from countries left out.
// A month the headline numbers are counted from is also left out when the
// headline without it would be a group that small: everyone in that month is in
// the headline, so subtracting one from the other would show the rest.
export function numbersOf(cells, now = new Date(), { minGroup = 0 } = {}) {
  const b = bucketsOf(cells, now);
  if (minGroup) {
    const curN = round(val(b.cur, 'n'));
    const small = (n) => n > 0 && n < minGroup;
    b.monthly = new Map([...b.monthly].filter(([key, m]) => {
      const n = round(val(m, 'n'));
      return n >= minGroup && !(b.curMonths.has(key) && small(curN - n));
    }));
  }
  const where = countriesOf(b);
  const shown = where.filter((c) => c.count >= minGroup);
  return {
    radar: radarFrom(b),
    setups: setupsOf(b),
    tools: toolsOf(b),
    families: stackOf(b, 'family'),
    versions: stackOf(b, 'version', { top: 7 }),
    harnesses: stackOf(b, 'harness'),
    where: shown,
    elsewhere: where.reduce((a, c) => a + c.count, 0) - shown.reduce((a, c) => a + c.count, 0),
    buckets: b,
  };
}
