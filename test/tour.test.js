import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolSlug } from '../lib/tour.js';

test('tool addresses: readable for ASCII names, distinct for others', () => {
  assert.equal(toolSlug('Claude Code'), 'claude-code');
  assert.equal(toolSlug('agent-browser'), 'agent-browser');
  assert.notEqual(toolSlug('C'), toolSlug('C++'));
  assert.match(toolSlug('Terminal.app'), /^terminal-app-[a-z0-9]+$/);
  for (const long of ['x'.repeat(200), `${'é'.repeat(3)}${'a'.repeat(90)}`, `${'word '.repeat(30)}é`]) assert.match(toolSlug(long), /^[a-z0-9-]{1,80}$/);
  const others = ['Редактор', '编辑器', 'Vim Ü', 'vim'].map(toolSlug);
  assert.equal(new Set(others).size, others.length);
  for (const s of others) assert.match(s, /^[a-z0-9-]{1,80}$/);
  assert.equal(toolSlug('Редактор'), toolSlug('редактор'));
});

test('story words: every tactic has some, and every link in them points at something real', async () => {
  const fs = await import('node:fs');
  const { catalogById } = await import('../lib/shape.js');
  const stories = JSON.parse(fs.readFileSync(new URL('../data/stories.json', import.meta.url), 'utf8'));
  const tools = new Set(JSON.parse(fs.readFileSync(new URL('../data/tools.json', import.meta.url), 'utf8')).tools.map((x) => x.name.toLowerCase()));
  for (const id of catalogById.keys()) assert.ok(stories.tactics[id]?.pitch, `no story for ${id}`);
  for (const [id, s] of Object.entries(stories.tactics)) {
    assert.ok(catalogById.has(id), `story for unknown tactic ${id}`);
    assert.equal(s.how.length, 3, `${id}: three steps`);
    for (const p of s.pairs ?? []) assert.ok(catalogById.has(p) && p !== id, `${id} pairs with ${p}`);
    for (const t of s.tools ?? []) assert.ok(tools.has(t.toLowerCase()), `${id} names unknown tool ${t}`);
  }
  for (const [name, s] of Object.entries(stories.tools)) {
    assert.ok(tools.has(name), `story for unknown tool ${name}`);
    assert.ok(s.pitch);
    for (const p of s.tactics ?? []) assert.ok(catalogById.has(p), `${name} names unknown tactic ${p}`);
  }
});
