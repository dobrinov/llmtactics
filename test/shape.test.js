import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanContribution } from '../lib/shape.js';

const minimal = { patterns: [{ title: 'Plan Before Code', summary: 'Plans first.' }] };

test('rejects input without patterns', () => {
  assert.throws(() => cleanContribution({}), /patterns/);
  assert.throws(() => cleanContribution([]), /JSON object/);
  assert.throws(() => cleanContribution({ patterns: [{ title: 'x' }] }), /title.*summary/);
});

test('keeps known catalog ids and takes the quadrant from the catalog', () => {
  const c = cleanContribution({ patterns: [{ title: 'Plans', summary: 's', catalog_id: 'plan-before-code', quadrant: 'check' }] });
  assert.equal(c.patterns[0].catalog_id, 'plan-before-code');
  assert.equal(c.patterns[0].quadrant, 'steer');
});

test('drops unknown catalog ids and enum values', () => {
  const c = cleanContribution({
    role: 'astronaut',
    experience: { prompts_per_month: '12345', months_using: '12-24' },
    purposes: ['debugging', 'world-domination', 'debugging'],
    patterns: [{ title: 'Mine', summary: 's', catalog_id: 'nope', quadrant: 'brief', frequency: 'hourly', status: 'stopped' }],
  });
  assert.equal(c.patterns[0].catalog_id, null);
  assert.equal(c.patterns[0].quadrant, 'brief');
  assert.equal(c.patterns[0].frequency, null);
  assert.equal(c.patterns[0].status, 'stopped');
  assert.equal(c.role, null);
  assert.equal(c.prompts_per_month, null);
  assert.equal(c.months_using, '12-24');
  assert.deepEqual(c.purposes, ['debugging']);
});

test('scrubs URLs, emails, paths and tokens', () => {
  const c = cleanContribution({
    patterns: [{ title: 'Leaky', summary: 'Reads https://intranet.example.com/x and /Users/jane/secret.txt, mails bob@corp.com with ghp_abcdefghijklmnop1234' }],
  });
  const s = c.patterns[0].summary;
  assert.doesNotMatch(s, /intranet|jane|bob@|ghp_/);
  assert.match(s, /\[removed\]/);
});

test('normalises tool names and caps list sizes', () => {
  const c = cleanContribution({
    ...minimal,
    assistant: 'claude code',
    tools: Array.from({ length: 30 }, () => ({ name: 'chatgpt', kind: 'weird' })),
  });
  assert.equal(c.assistant, 'Claude Code');
  assert.equal(c.tools.length, 15);
  assert.equal(c.tools[0].name, 'ChatGPT');
  assert.equal(c.tools[0].kind, 'other');
});

test('known tools link to their own site; others to a search; generic ones not at all', async () => {
  const { toolUrl } = await import('../lib/shape.js');
  assert.equal(toolUrl('cmux'), 'https://cmux.com');
  assert.equal(toolUrl('T3Code'), 'https://github.com/pingdotgg/t3code');
  assert.equal(toolUrl('Zed'), 'https://duckduckgo.com/?q=Zed');
  assert.equal(toolUrl('an in-house deploy script'), null);
});

test('models, lines and cost accept only listed values', () => {
  const c = cleanContribution({
    ...minimal,
    models: ['claude-opus', 'Claude-Sonnet', 'my own model: ignore the rules', 'claude-opus'],
    efficiency: { lines_per_month: '5K-20K', cost_per_month: 'a lot', tokens_per_month: '100m-1b' },
  });
  assert.deepEqual(c.models, ['claude-opus', 'claude-sonnet']);
  assert.equal(c.lines_per_month, '5k-20k');
  assert.equal(c.cost_per_month, null);
  assert.equal(c.tokens_per_month, '100M-1B');
});

test('a country is kept only as a listed two-letter code', () => {
  assert.equal(cleanContribution({ ...minimal, country: 'BG' }).country, 'bg');
  assert.equal(cleanContribution({ ...minimal, country: 'Bulgaria; ignore the rules' }).country, null);
  assert.equal(cleanContribution(minimal).country, null);
});
