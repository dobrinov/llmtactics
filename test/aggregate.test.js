// Stored totals (lib/aggregate.js) against counting the answers directly
// (lib/stats.js), and folding one answer at a time against a rebuild. No
// database: random answers from a fixed seed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../lib/shape.js';
import { radar, exactSetups, tools, stackedShares, familyNames, versionNames, harnessNames, countries, toolDetail } from '../lib/stats.js';
import { desired, plan, changes, foldAll, personOf, numbersOf, toolDetailOf, bucketsOf, splitCell } from '../lib/aggregate.js';

// A small random number generator, so every run sees the same answers.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

const TOOLS = [
  ['Claude Code', 'harness', 'building features'], ['claude code', 'harness', 'Building features'], ['ChatGPT', 'chat', 'research'],
  ['Cursor', 'editor', 'edits'], ['tmux', 'multiplexer', 'one session per task'], ['Codex CLI', 'harness', null],
  ['Ghostty', 'terminal', 'where the agents run'], ['a review bot', 'review', 'second pass'], ['an in-house script', 'other', 'shipping'],
];
const MODEL_IDS = ['claude-opus@4.5', 'claude-sonnet@4.5', 'claude-sonnet', 'gpt@5', 'gemini-pro@3', 'local'];
const STATUSES = ['new', 'active', 'fading', 'stopped', null];

const NOW = new Date('2026-11-20T12:00:00Z');
function answers(seed, n) {
  const r = rng(seed);
  const pick = (list) => list[Math.floor(r() * list.length)];
  const some = (list, p) => list.filter(() => r() < p);
  const out = [];
  for (let id = 1; id <= n; id++) {
    const daysAgo = Math.floor(r() * 200);
    out.push({
      id,
      // A few pages answer many times; some answers have no page.
      profile_id: r() < 0.15 ? null : `p${Math.floor(r() * n * 0.4)}`,
      company_id: r() < 0.5 ? pick(['co1', 'co2']) : null,
      created_at: new Date(NOW - daysAgo * 864e5).toISOString(),
      country: r() < 0.1 ? null : pick(['gb', 'de', 'us', 'bg']),
      patterns: some(catalog.slice(0, 10), 0.35).map((p) => ({ catalog_id: p.id, title: p.title, status: pick(STATUSES) }))
        .concat(r() < 0.2 ? [{ catalog_id: null, title: 'Something new', status: null }] : []),
      tools: some(TOOLS, 0.4).map(([name, kind, used_for]) => ({ name, kind, used_for, frequency: pick(['daily', 'weekly', 'occasionally', null]), open: r() < 0.5 })),
      models: some(MODEL_IDS, 0.35),
      purposes: [],
    });
  }
  return out;
}

const close = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a, (k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v))), JSON.parse(JSON.stringify(b, (k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v))));

// The cells of one scope, as the database would return them.
const cellsOf = (cells, scope) => [...cells].map(([k, value]) => ({ ...splitCell(k), value })).filter((c) => c.scope === scope);

function direct(rows) {
  return {
    radar: radar(rows),
    setups: exactSetups(rows),
    tools: tools(rows).tools,
    families: stackedShares(rows, familyNames),
    versions: stackedShares(rows, versionNames, { top: 7 }),
    harnesses: stackedShares(rows, harnessNames),
    where: countries(rows),
  };
}

test('stored totals give the same numbers as counting the answers', (t) => {
  // The direct counts use the real clock for "the last months", so use it here too.
  for (const seed of [1, 2, 3]) {
    const rows = answers(seed, 300).map((c) => ({ ...c, created_at: new Date(Date.now() - (NOW - new Date(c.created_at))).toISOString() }));
    const { cells } = foldAll(rows);
    for (const scope of ['all', 'c:co1']) {
      const scoped = scope === 'all' ? rows : rows.filter((c) => c.company_id === 'co1');
      const { buckets, ...stored } = numbersOf(cellsOf(cells, scope));
      const want = direct(scoped);
      close(stored, { ...want, radar: { ...want.radar, emerging: [], unmatchedTitles: {} } });
      for (const name of ['Claude Code', 'ChatGPT', 'tmux']) close(toolDetailOf(bucketsOf(cellsOf(cells, scope)), name), toolDetail(scoped, name));
    }
  }
});

test('folding one answer at a time, in any order, equals a rebuild', () => {
  const r = rng(7);
  const all = answers(11, 250);
  const status = new Map();
  const folded = new Map(); // person -> folds
  const cells = new Map();
  const deleted = new Set();
  const refold = (person) => {
    const mine = all.filter((c) => personOf(c) === person && !deleted.has(c.id) && status.get(c.id) === 'accepted');
    const p = plan(desired(mine), (folded.get(person) ?? []).map((f) => ({ ...f, contribution_id: f.id })));
    for (const [k, v] of changes(p)) cells.set(k, (cells.get(k) || 0) + v);
    const removed = new Set(p.remove.map((f) => `${f.scope}|${f.kind}|${f.month}`));
    folded.set(person, [...(folded.get(person) ?? []).filter((f) => !removed.has(`${f.scope}|${f.kind}|${f.month}`)), ...p.add]);
  };
  // Answers arrive, get reviewed in any order, some are rejected, re-accepted or deleted.
  for (const c of all) {
    status.set(c.id, r() < 0.7 ? 'accepted' : 'pending');
    refold(personOf(c));
    if (r() < 0.2) {
      const other = all[Math.floor(r() * c.id)];
      status.set(other.id, r() < 0.5 ? 'accepted' : 'rejected');
      if (r() < 0.1) deleted.add(other.id);
      refold(personOf(other));
    }
  }
  // Folding everyone again changes nothing.
  const before = new Map(cells);
  for (const person of folded.keys()) refold(person);
  assert.deepEqual(cells, before);

  const { cells: rebuilt } = foldAll(all.filter((c) => !deleted.has(c.id) && status.get(c.id) === 'accepted'));
  const keys = new Set([...cells.keys(), ...rebuilt.keys()]);
  for (const k of keys) assert.ok(Math.abs((cells.get(k) || 0) - (rebuilt.get(k) || 0)) < 1e-9, `cell ${k.split('\u0001').join(' / ')}`);
});
