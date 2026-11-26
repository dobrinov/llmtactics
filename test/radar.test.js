import { test } from 'node:test';
import assert from 'node:assert/strict';
import { place, shareRadius } from '../lib/radar.js';

const overlaps = (items) => {
  let n = 0;
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const [a, b] = [items[i], items[j]];
    if (Math.hypot((a.x - b.x) * 6, (a.y - b.y) * 6) < (a.size * a.scale + b.size * b.scale) / 2) n++;
  }
  return n;
};

// Ten tactics a quadrant, all done by most people: they crowd the inner ring.
const crowd = (per) => Array.from({ length: per * 4 }, (_, i) => {
  const share = 55 + ((i * 37) % 45);
  return { q: i % 4, radius: shareRadius(share), size: ((16 + Math.round(share / 6)) * 600) / 560 };
});

test('the radar keeps dots full size while they fit', () => {
  const items = place(crowd(4));
  assert.ok(items.every((p) => p.scale === 1));
  assert.equal(overlaps(items), 0);
});

test('a crowded quadrant shrinks its dots instead of stacking them', () => {
  const items = place(crowd(10));
  assert.ok(items.some((p) => p.scale < 1));
  assert.equal(overlaps(items), 0);
});
