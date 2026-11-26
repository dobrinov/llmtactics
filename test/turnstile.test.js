import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTurnstile } from '../lib/turnstile.js';
import { render } from '../lib/html.js';

const answering = (reply, seen = []) => async (url, init) => {
  seen.push({ url, body: Object.fromEntries(init.body) });
  if (reply instanceof Error) throw reply;
  return { json: async () => reply };
};

test('off without both keys: no widget, every form passes', async () => {
  for (const keys of [{}, { siteKey: 'k' }, { secret: 's' }]) {
    const t = createTurnstile({ ...keys, fetch: () => assert.fail('no call') });
    assert.equal(t.on, false);
    assert.equal(t.widget(), '');
    assert.equal(await t.passed(undefined), true);
  }
});

test('on: the widget names the site key', () => {
  const t = createTurnstile({ siteKey: 'site"key', secret: 's' });
  const out = render(t.widget());
  assert.match(out, /class="cf-turnstile" data-sitekey="site&quot;key"/);
  assert.match(out, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/);
});

test('on: passes only when Cloudflare says so', async () => {
  const seen = [];
  const yes = createTurnstile({ siteKey: 'k', secret: 's', fetch: answering({ success: true }, seen) });
  assert.equal(await yes.passed('tok', '1.2.3.4'), true);
  assert.deepEqual(seen[0].body, { secret: 's', response: 'tok', remoteip: '1.2.3.4' });

  assert.equal(await createTurnstile({ siteKey: 'k', secret: 's', fetch: answering({ success: false }) }).passed('tok'), false);
  assert.equal(await createTurnstile({ siteKey: 'k', secret: 's', fetch: answering(new Error('down')) }).passed('tok'), false);
});

test('on: a missing or oversized token fails without asking Cloudflare', async () => {
  const t = createTurnstile({ siteKey: 'k', secret: 's', fetch: () => assert.fail('no call') });
  assert.equal(await t.passed(undefined), false);
  assert.equal(await t.passed(''), false);
  assert.equal(await t.passed('x'.repeat(2049)), false);
});
