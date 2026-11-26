// Cloudflare Turnstile: a check that a person, not a script, sends the forms
// people fill in (starting a company page, a page's password, the editor's
// code, the admin sign-in). Assistants' submissions are not checked: they
// carry a one-time code instead.
//
// Off unless both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are set, so
// development and tests need neither.
import { html } from './html.js';

export const ORIGIN = 'https://challenges.cloudflare.com';
const VERIFY_URL = `${ORIGIN}/turnstile/v0/siteverify`;

export function createTurnstile({ siteKey = '', secret = '', fetch: fetchFn = globalThis.fetch, timeoutMs = 5000 } = {}) {
  const on = Boolean(siteKey && secret);
  return {
    on,
    // The widget, inside a form: it adds a hidden `cf-turnstile-response` field.
    widget: () => (on ? html`<div class="cf-turnstile" data-sitekey="${siteKey}" data-theme="auto"></div>
<script src="${ORIGIN}/turnstile/v0/api.js" async defer></script>` : ''),
    // Whether a form's token passes. Fails closed: when Cloudflare cannot be
    // reached, the form is refused and the person can try again.
    async passed(token, ip) {
      if (!on) return true;
      if (typeof token !== 'string' || !token || token.length > 2048) return false;
      const body = new URLSearchParams({ secret, response: token });
      if (ip) body.set('remoteip', ip);
      try {
        const r = await fetchFn(VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(timeoutMs) });
        const d = await r.json();
        return d?.success === true;
      } catch {
        return false;
      }
    },
  };
}

export const turnstile = createTurnstile({ siteKey: process.env.TURNSTILE_SITE_KEY, secret: process.env.TURNSTILE_SECRET_KEY });

// What a form says when the check did not pass.
export const CHECK_FAILED = 'The check that you are a person did not go through. Please try again.';
