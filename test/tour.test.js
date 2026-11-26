import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolSlug } from '../lib/tour.js';

test('tool addresses: readable for ASCII names, distinct for others', () => {
  assert.equal(toolSlug('Claude Code'), 'claude-code');
  assert.equal(toolSlug('Terminal.app'), 'terminal-app');
  const others = ['Редактор', '编辑器', 'Vim Ü', 'vim'].map(toolSlug);
  assert.equal(new Set(others).size, others.length);
  for (const s of others) assert.match(s, /^[a-z0-9-]{1,80}$/);
  assert.equal(toolSlug('Редактор'), toolSlug('редактор'));
});
