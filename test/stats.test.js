// Storage and statistics, against a real PostgreSQL database:
// TEST_DATABASE_URL, or postgres://localhost/llmpatterns_test. Its tables are emptied.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../lib/db.js';
import { cleanContribution, PROMPT_RANGES } from '../lib/shape.js';
import { radar, tools, experience, counted, percentile, compare } from '../lib/stats.js';

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
beforeEach(() => store.sql`TRUNCATE profiles, companies, contributions, waits CASCADE`);

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
  await add(sub(['plan-before-code'], { experience: { prompts_per_month: '3k+' }, models: ['claude-opus', 'gpt'] }));
  await add(sub(['tests-as-proof'], { tools: [{ name: 'Cursor', kind: 'editor' }] }));
  await add(sub(['plan-before-code']));
  const all = await store.contributions({ status: 'accepted' });
  assert.equal(radar(all).patterns.find((p) => p.id === 'plan-before-code').share, 75);
  const t = tools(all);
  assert.equal(t.tools[0].name, 'Claude Code');
  assert.equal(t.tools[0].share, 75);
  assert.equal(t.purposes[0].share, 100);
  // Models are a share of the people who named any.
  assert.deepEqual(t.models.map((m) => [m.name, m.share]), [['Claude Opus', 100], ['GPT', 50]]);
  assert.equal(experience(all).prompts.median, 870); // 600 + (2 of 3 answers in 600–1k) × 400
  assert.equal(percentile(counted(all), PROMPT_RANGES, 'prompts_per_month', '3k+'), 88);
});

test('company scope and comparison', async () => {
  const co = await store.createCompany({ name: 'Acme' });
  for (let i = 0; i < 5; i++) await add(sub(['hands-on-git']), { companyId: co.id });
  for (let i = 0; i < 5; i++) await add(sub(['plan-before-code']));
  const here = radar(await store.contributions({ companyId: co.id, status: 'accepted' }));
  const all = radar(await store.contributions({ status: 'accepted' }));
  assert.equal(here.total, 5);
  assert.deepEqual(compare(here, all)[0], { id: 'hands-on-git', title: 'Hands On Git', here: 100, everywhere: 50, diff: 50 });
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

test('headline numbers count recent answers, unless there are too few of them', async () => {
  const old = new Date(Date.now() - 300 * 864e5);
  for (let i = 0; i < 30; i++) await add(sub(['blind-accept']), { createdAt: old });
  for (let i = 0; i < 10; i++) await add(sub(['plan-before-code']));
  // Only 10 recent answers: everyone counts.
  let r = radar(await store.contributions({ status: 'accepted' }));
  assert.equal(r.total, 40);
  for (let i = 0; i < 10; i++) await add(sub(['plan-before-code']));
  // 20 recent answers: the old ones no longer shape the shares.
  r = radar(await store.contributions({ status: 'accepted' }));
  assert.equal(r.total, 20);
  assert.deepEqual(r.patterns.map((p) => [p.id, p.share]), [['plan-before-code', 100]]);
});
