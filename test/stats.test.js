// Storage and statistics, against a real PostgreSQL database:
// TEST_DATABASE_URL, or postgres://localhost/llmpatterns_test. Its tables are emptied.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../lib/db.js';
import { cleanContribution, PROMPT_RANGES } from '../lib/shape.js';
import { tailRange, medianRange, radar, tools, experience, counted, percentile, ageWeight, exactSetups, stackedShares, familyNames, toolDetail, setupKey } from '../lib/stats.js';

const sub = (ids, extra = {}) => cleanContribution({
  assistant: 'Claude Code',
  patterns: ids.map((id) => ({ title: id, summary: 's', catalog_id: id })),
  tools: [{ name: 'Claude Code', kind: 'assistant' }],
  purposes: ['debugging'],
  experience: { prompts_per_month: '600-1k' },
  ...extra,
});

let store;
before(async () => { store = await openDb(process.env.TEST_DATABASE_URL || 'postgres://localhost/llmpatterns_test'); });
after(() => store.close());
beforeEach(() => store.sql`TRUNCATE profiles, companies, contributions, waits, aggregates, folded CASCADE`);

const add = (clean, opts = {}) => store.addContribution(clean, { status: 'accepted', ...opts });

test('a page counts once, with its latest answer', async () => {
  const me = await store.createProfile();
  await add(sub(['plan-before-code']), { profileId: me.id });
  await add(sub(['clean-slate']), { profileId: me.id });
  await add(sub(['clean-slate']));
  const all = await store.contributions({ status: 'accepted' });
  assert.equal(counted(all).length, 2);
  const r = radar(all);
  assert.equal(r.total, 2);
  assert.equal(r.patterns.find((p) => p.id === 'clean-slate').share, 100);
  assert.equal(r.patterns.find((p) => p.id === 'plan-before-code'), undefined);
});

test('only accepted contributions reach the shared numbers', async () => {
  await add(sub(['clean-slate']));
  await add(sub(['plan-before-code']), { status: 'pending' });
  await add(sub(['plan-before-code']), { status: 'flagged', flags: ['role-play'] });
  await add(sub(['plan-before-code']), { status: 'rejected' });
  const r = radar(await store.contributions({ status: 'accepted' }));
  assert.equal(r.total, 1);
  assert.deepEqual(r.patterns.map((p) => p.id), ['clean-slate']);
  assert.deepEqual(await store.statusCounts(), { pending: 1, flagged: 1, accepted: 1, rejected: 1 });
  assert.equal((await store.unanalysed()).length, 2);
});

test('shares, tools, purposes, models and experience', async () => {
  await add(sub(['plan-before-code', 'clean-slate'], { models: ['claude-opus'] }));
  await add(sub(['plan-before-code'], { experience: { prompts_per_month: '3k+' }, models: ['claude-opus@4.5', 'gpt'] }));
  await add(sub(['tests-as-proof'], { tools: [{ name: 'Cursor', kind: 'editor' }] }));
  await add(sub(['plan-before-code']));
  const all = await store.contributions({ status: 'accepted' });
  assert.equal(radar(all).patterns.find((p) => p.id === 'plan-before-code').share, 75);
  const t = tools(all);
  assert.equal(t.tools[0].name, 'Claude Code');
  assert.equal(t.tools[0].share, 75);
  assert.equal(t.purposes[0].share, 100);
  // Models are a share of the people who named any.
  assert.deepEqual(t.models.map((m) => [m.name, m.share]), [['Claude Opus', 50], ['Claude Opus 4.5', 50], ['GPT', 50]]);
  assert.equal(experience(all).prompts.median, 870); // 600 + (2 of 3 answers in 600–1k) × 400
  assert.equal(percentile(counted(all), PROMPT_RANGES, 'prompts_per_month', '3k+'), 88);
});

test('company scope', async () => {
  const co = await store.createCompany({ name: 'Acme' });
  for (let i = 0; i < 5; i++) await add(sub(['hands-on-git']), { companyId: co.id });
  for (let i = 0; i < 5; i++) await add(sub(['plan-before-code']));
  const here = radar(await store.contributions({ companyId: co.id, status: 'accepted' }));
  const all = radar(await store.contributions({ status: 'accepted' }));
  assert.equal(here.total, 5);
  assert.equal(here.patterns.find((p) => p.id === 'hands-on-git').share, 100);
  assert.equal(all.patterns.find((p) => p.id === 'hands-on-git').share, 50);
});

test('unmatched habits show as emerging once three people report them', async () => {
  const odd = () => cleanContribution({ patterns: [{ title: 'Voice Notes', summary: 's', quadrant: 'brief' }] });
  await add(odd());
  await add(odd());
  assert.equal(radar(await store.contributions({ status: 'accepted' })).emerging.length, 0);
  await add(odd());
  const r = radar(await store.contributions({ status: 'accepted' }));
  assert.equal(r.emerging[0].title, 'Voice Notes');
  assert.equal(r.emerging[0].count, 3);
});

test('a one-time code produces one contribution', async () => {
  const { token, reservedId } = await store.createWait();
  assert.equal((await store.openWaitFor(reservedId)).token, token);
  const me = await store.createProfile();
  await store.addContribution(sub(['clean-slate']), { profileId: me.id, waitToken: token });
  await assert.rejects(store.addContribution(sub(['clean-slate']), { profileId: me.id, waitToken: token }), /already been used/);
  assert.equal((await store.contributions({ profileId: me.id })).length, 1);
  assert.equal(await store.claimWait(token), true);
  assert.equal(await store.claimWait(token), false);
});

test('deleting a page deletes its contributions only', async () => {
  const me = await store.createProfile({ name: 'A' });
  await add(sub(['clean-slate']), { profileId: me.id });
  await add(sub(['clean-slate']));
  await store.deleteProfile(me.id);
  assert.equal((await store.contributions()).length, 1);
});

test('an analysis result is written to the contribution and its habits', async () => {
  const id = await store.addContribution(cleanContribution({ patterns: [{ title: 'Plans', summary: 's', quadrant: 'check' }] }));
  await store.applyAnalysis(id, { status: 'accepted', analysis: { verdict: 'accept', reason: 'ok', problems: [] }, patterns: [{ position: 0, catalog_id: 'plan-before-code', quadrant: 'steer' }] });
  const c = await store.contribution(id);
  assert.equal(c.status, 'accepted');
  assert.equal(c.patterns[0].catalog_id, 'plan-before-code');
  assert.equal(c.patterns[0].quadrant, 'steer');
  assert.equal(c.analysis.verdict, 'accept');
});

test('older answers count for less, and fade out unless someone answers again', async () => {
  const ago = (days) => new Date(Date.now() - days * 864e5);
  for (let i = 0; i < 4; i++) await add(sub(['blind-accept']), { createdAt: ago(200) });
  await add(sub(['clean-slate']), { createdAt: ago(330) });
  for (let i = 0; i < 2; i++) await add(sub(['plan-before-code']));
  let r = radar(await store.contributions({ status: 'accepted' }));
  // Everyone is a person in the numbers, but the shares lean on the fresh answers.
  assert.equal(r.total, 7);
  const share = (id) => r.patterns.find((p) => p.id === id)?.share;
  assert.ok(share('plan-before-code') > share('blind-accept'), 'two fresh answers outweigh four from half a year ago');
  assert.ok(share('blind-accept') > 0);
  // An answer from almost a year ago, that nobody repeated, has faded out.
  assert.equal(share('clean-slate'), undefined);
  // One fresh answer brings it back.
  await add(sub(['clean-slate']));
  r = radar(await store.contributions({ status: 'accepted' }));
  assert.ok(share('clean-slate') > 0);
});

test('the weight of an answer by its age in months', () => {
  const now = new Date('2026-11-26T00:00:00Z');
  assert.equal(ageWeight('2026-11', now), 1);
  assert.equal(ageWeight('2026-09', now), 1);
  assert.equal(ageWeight('2026-06', now), 0.5);
  assert.equal(ageWeight('2026-03', now), 0.25);
  assert.ok(ageWeight('2025-11', now) < 0.25);
});

test('token measurements: the cost split, the context and subagents, from those who measured', async () => {
  const measured = (reread, loaded, written, subagent_share, context_per_request) =>
    sub(['plan-before-code'], { efficiency: { cost_split: { reread, loaded, written }, subagent_share, context_per_request } });
  for (let i = 0; i < 4; i++) await add(measured(60, 30, 10, 0, '50k-100k'));
  await add(sub(['plan-before-code']));
  // Four people measured: too few to show.
  let e = experience(await store.contributions({ status: 'accepted' })).efficiency;
  assert.equal(e.split, null);
  assert.equal(e.subagents, null);

  await add(measured(70, 20, 10, 20, '100k-200k'));
  await add(measured(80, 15, 5, 40, '100k-200k'));
  e = experience(await store.contributions({ status: 'accepted' })).efficiency;
  assert.deepEqual(e.split, { answered: 6, reread: 65, loaded: 26, written: 9 });
  assert.deepEqual(e.subagents, { answered: 6, share: 33, median: 20 });
  assert.equal(e.context.answered, 6);
  assert.equal(e.context.median, 88000);
});

test('the 95th percentile from twenty answers, the 99th from a hundred; the last range is open', () => {
  const ids = [...Array(18).fill('100-300'), '1k-3k', '3k+'];
  assert.deepEqual(tailRange(PROMPT_RANGES, ids.slice(0, 19)), {});
  // The 19th of 20 answers ends the 1k-3k range. Twenty answers are too few for a 99th percentile.
  assert.deepEqual(tailRange(PROMPT_RANGES, ids), { p95: { value: 3000, open: false } });
  const hundred = [...Array(95).fill('100-300'), ...Array(5).fill('3k+')];
  assert.deepEqual(tailRange(PROMPT_RANGES, hundred), { p95: { value: 300, open: false }, p99: { value: 3000, open: true } });
  // An id that is in no range gives no percentile, not an error.
  assert.deepEqual(tailRange(PROMPT_RANGES, ['100-300', ...Array(19).fill('gone')]), { p95: null });
  // A median in the last range is that range's start, never above the percentiles.
  assert.equal(medianRange(PROMPT_RANGES, Array(20).fill('3k+')), 3000);
});

const withTools = (names, extra = {}) => sub(['clean-slate'], { tools: names.map((name) => ({ name, kind: 'other' })), ...extra });

test('whole setups: each person in exactly one, so the shares add up to 100%', async () => {
  await add(withTools(['Claude Code', 'tmux']));
  await add(withTools(['tmux', 'Claude Code', 'ChatGPT'])); // chat assistants are not part of a setup
  await add(withTools(['Cursor']));
  await add(withTools(['ChatGPT'])); // no coding tools at all
  const s = exactSetups(await store.contributions({ status: 'accepted' }));
  assert.equal(s.total, 4);
  assert.equal(s.none, 1);
  assert.deepEqual(s.setups.map((x) => [x.key, x.count]), [['claude code\ntmux', 2], ['cursor', 1]]);
  assert.equal(Math.round(s.setups.reduce((a, x) => a + x.share, 0) + (100 * s.none) / s.total), 100);
});

test('stacked shares: every month adds up to 100%, each person split over what they named', async () => {
  await add(sub(['clean-slate'], { models: ['claude-opus@4.5', 'gpt'] }));
  await add(sub(['clean-slate'], { models: ['claude-opus'] }));
  await add(sub(['clean-slate'], { models: [] }));
  const s = stackedShares(await store.contributions({ status: 'accepted' }), familyNames);
  const now = s.months.at(-1);
  assert.equal(now.n, 2); // the answer that named no model is left out
  assert.deepEqual(s.names, ['Claude Opus', 'GPT']);
  assert.deepEqual(now.parts.map(Math.round), [75, 25]);
});

test('a tool: its share, and the tools its users work with', async () => {
  await add(withTools(['tmux', 'Claude Code']));
  await add(withTools(['tmux', 'Cursor']));
  await add(withTools(['Cursor']));
  const d = toolDetail(await store.contributions({ status: 'accepted' }), 'TMUX');
  assert.equal(d.share, 67);
  assert.deepEqual(d.with.map((w) => [w.name, w.share]), [['Claude Code', 50], ['Cursor', 50]]);
  assert.equal(d.series.at(-1).share, 67);
});

test('stored totals follow every change to an answer, and match a fresh count', async () => {
  const { numbersOf } = await import('../lib/aggregate.js');
  const ok = async (what) => {
    const check = await store.checkTotals();
    assert.deepEqual(check.differ, [], what);
    assert.equal(check.folds, check.expectedFolds, what);
    // The headline counts, read from the totals, against counting the answers.
    const [direct] = await store.sql`SELECT
      COUNT(DISTINCT COALESCE(profile_id, 'c' || id::text)) FILTER (WHERE status = 'accepted')::int AS people,
      COUNT(DISTINCT company_id) FILTER (WHERE status = 'accepted')::int AS companies FROM contributions`;
    assert.deepEqual(await store.counts(), { people: direct.people, companies: direct.companies }, what);
    for (const { id } of await store.sql`SELECT id FROM companies`) {
      assert.equal(await store.companyPeople(id), counted(await store.contributions({ companyId: id, status: 'accepted' })).length, what);
    }
  };
  const me = await store.createProfile();
  const co = await store.createCompany({ name: 'Co' });
  const first = await add(sub(['plan-before-code']), { profileId: me.id, companyId: co.id });
  await ok('an accepted answer');
  const second = await add(sub(['clean-slate']), { profileId: me.id, status: 'pending' });
  await ok('a pending answer changes nothing');
  await store.setStatus(second, 'accepted');
  await ok('accepting it');
  let n = numbersOf(await store.totals('all'));
  assert.equal(n.radar.total, 1);
  assert.equal(n.radar.patterns[0].id, 'clean-slate');
  assert.equal(numbersOf(await store.totals(`c:${co.id}`)).radar.patterns[0].id, 'plan-before-code');
  await store.setStatus(second, 'rejected');
  await ok('rejecting it again');
  assert.equal(numbersOf(await store.totals('all')).radar.patterns[0].id, 'plan-before-code');
  await store.applyAnalysis(first, { status: 'accepted', analysis: {}, patterns: [{ position: 0, catalog_id: 'clean-slate', quadrant: 'q0' }] });
  await ok('matching a habit to another one');
  const loose = await add(sub(['clean-slate']));
  await store.deleteContribution(loose);
  await ok('deleting an answer without a page');
  await store.deleteCompany(co.id);
  await ok('deleting the company');
  assert.equal((await store.totals(`c:${co.id}`)).length, 0);
  await store.deleteProfile(me.id);
  await ok('deleting the page');
  assert.equal((await store.totals('all')).length, 0);
  await add(sub(['clean-slate']));
  await store.sql`UPDATE aggregates SET value = value + 1 WHERE metric = 'n' AND kind = 'l'`;
  assert.equal((await store.checkTotals()).differ.length, 1, 'a check notices totals that drifted');
  await store.rebuildTotals();
  await ok('a rebuild');
});

test('a setup is the working environment, without connectors or chat assistants', () => {
  const c = sub(['clean-slate'], { tools: [
    { name: 'Claude Code', kind: 'harness' }, { name: 'tmux', kind: 'multiplexer' }, { name: 'Ghostty', kind: 'terminal' },
    { name: 'Slack', kind: 'connector' }, { name: 'Meshy MCP', kind: 'connector' }, { name: 'ChatGPT', kind: 'chat' },
  ] });
  assert.deepEqual(setupKey(c).split('\n'), ['claude code', 'ghostty', 'tmux']);
});
