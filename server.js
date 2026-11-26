// llmtactics.com: one small Node server. Dependencies: `postgres` (the driver).
import http from 'node:http';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './lib/db.js';
import { cleanContribution, catalog, PURPOSES, PROMPT_RANGES, MONTH_RANGES, ROLES, TASK_MINUTE_RANGES, TASK_PROMPT_RANGES, TOKEN_RANGES, LINES_RANGES, COST_RANGES, CONTEXT_RANGES, MODELS } from './lib/shape.js';
import { counted, MIN_GROUP, NO_COUNTRY, familyNames, versionNames, harnessNames, setupKey, setupTools } from './lib/stats.js';
import { tourPage, toolsIndexPage, toolPage, toolSlug, whoFor } from './lib/tour.js';
import * as flow from './lib/flow.js';
import { numbersOf, toolDetailOf, delta } from './lib/aggregate.js';
import { monthKey } from './lib/stats.js';
import { hashPassword, verifyPassword, createSigner, parseCookies, cookie, injectionSigns, freeText, safeEqual, newEditorCode, hashEditorCode, verifyEditorCode } from './lib/security.js';
import * as views from './lib/views.js';
import * as admin from './lib/admin-views.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4400);
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const SITE = process.env.SITE_NAME || 'llmtactics.com';
const SECURE = PUBLIC_URL.startsWith('https://');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const MAX_BODY = 32 * 1024;

const store = await openDb();
const signer = createSigner(process.env.SESSION_SECRET);
// The prompt carries the script that does the counting (survey/measure.py).
const MEASURE = await fsp.readFile(path.join(ROOT, 'survey', 'measure.py'), 'utf8');
const SURVEY = (await fsp.readFile(path.join(ROOT, 'survey', 'contribute.md'), 'utf8')).replace('{{MEASURE}}', () => MEASURE.trimEnd());

// ---------- plumbing ----------

function baseUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  return `http://${req.headers.host || `localhost:${PORT}`}`;
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  ...(SECURE ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
};

function send(res, status, body, type = 'text/html; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS, ...headers });
  res.end(body);
}
const json = (res, status, data, headers = {}) => send(res, status, JSON.stringify(data), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store', ...headers });
const redirect = (res, to, headers = {}) => { res.writeHead(303, { Location: to, ...SECURITY_HEADERS, ...headers }); res.end(); };
const html = (res, body, status = 200, headers = {}) => send(res, status, body, undefined, headers);
const privateHtml = (res, body, headers = {}) => html(res, body, 200, { 'Cache-Control': 'no-store', ...headers });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Body too large.'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
const readForm = async (req) => Object.fromEntries(new URLSearchParams(await readBody(req)));

// The client address: behind the bundled Caddy proxy, the last X-Forwarded-For entry.
const clientIp = (req) => (process.env.TRUST_PROXY ? req.headers['x-forwarded-for']?.split(',').at(-1)?.trim() : null) || req.socket.remoteAddress;

// A small fixed-window limit per address and bucket.
const hits = new Map();
function limited(req, bucket, max, windowMs = 60_000) {
  const key = `${bucket}:${clientIp(req)}`;
  const t = Date.now();
  const h = hits.get(key);
  if (!h || t - h.start > windowMs) { hits.set(key, { start: t, n: 1 }); return 0; }
  h.n++;
  return h.n > max ? Math.ceil((h.start + windowMs - t) / 1000) : 0;
}
setInterval(() => { const t = Date.now(); for (const [k, h] of hits) if (t - h.start > 3600_000) hits.delete(k); }, 60_000).unref();

// Form posts must come from this site.
function sameOrigin(req) {
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return false;
  try { return new URL(origin).host === new URL(baseUrl(req)).host; } catch { return false; }
}

const TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
async function serveStatic(res, rel) {
  const dir = path.join(ROOT, 'public');
  const file = path.resolve(dir, rel);
  if (!file.startsWith(dir + path.sep)) return send(res, 404, 'Not found', 'text/plain');
  try {
    send(res, 200, await fsp.readFile(file), TYPES[path.extname(file)] || 'application/octet-stream', { 'Cache-Control': 'public, max-age=3600' });
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
}

const cleanName = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁤﻿<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || null;
const newPassword = (v) => {
  const s = String(v ?? '');
  if (!s) return null;
  if (s.length > 200) throw Object.assign(new Error('A password can have at most 200 characters.'), { status: 400 });
  return hashPassword(s);
};

// ---------- access: owner and viewer grants in one signed cookie ----------
//
// "ou:<id>" owns profile <id>, "oc:<id>" owns company <id>; "vu:<id>:<fp>" and
// "vc:<id>:<fp>" may view a password-protected page, where <fp> is a
// fingerprint of the password hash, so changing the password locks everyone
// else out again.
//
// "k:<kind>:<id>:<code>:<until>" is an editor's code that was just made for
// the page, kept for a few minutes so the browser that made it can be shown
// it (the server itself keeps only its hash).

const fingerprint = (hash) => (hash ? crypto.createHash('sha256').update(hash).digest('base64url').slice(0, 12) : '');
const MAX_GRANTS = 60;

function grantsOf(req) {
  const raw = signer.verify(parseCookies(req.headers.cookie).access);
  if (!raw) return [];
  try { const list = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')); return Array.isArray(list) ? list.filter((g) => typeof g === 'string') : []; } catch { return []; }
}
const SHOW_CODE_MS = 15 * 60_000;
const freshCode = (g) => !g.startsWith('k:') || Number(g.split(':')[4]) > Date.now();
function grantCookie(req, add = [], remove = () => false) {
  const list = [...new Set([...grantsOf(req).filter((g) => freshCode(g) && !remove(g)), ...add])].slice(-MAX_GRANTS);
  return cookie('access', signer.sign(Buffer.from(JSON.stringify(list)).toString('base64url')), { maxAge: 365 * 864e2, secure: SECURE });
}

function isAdmin(req) {
  if (!ADMIN_PASSWORD) return false;
  const v = signer.verify(parseCookies(req.headers.cookie).admin);
  if (!v) return false;
  const [tag, expires, fp] = v.split(':');
  return tag === 'admin' && Number(expires) > Date.now() && safeEqual(fp, fingerprint(hashOfAdmin));
}
const hashOfAdmin = ADMIN_PASSWORD ? `admin:${ADMIN_PASSWORD}` : '';

// Makes a new editor's code for a page (the old one stops working) and returns
// it with the cookie entry that lets this browser be shown it for a while.
async function issueCode(kind, id) {
  const code = newEditorCode();
  await (kind === 'u' ? store.updateProfile(id, { editor_code_hash: hashEditorCode(code) }) : store.updateCompany(id, { editor_code_hash: hashEditorCode(code) }));
  return { code, entry: `k:${kind}:${id}:${code}:${Date.now() + SHOW_CODE_MS}` };
}
const sameCodeOf = (kind, id) => (g) => g.startsWith(`k:${kind}:${id}:`);
// The code this browser was just given for a page, while it may still be shown.
function shownCode(req, kind, id) {
  const g = grantsOf(req).filter((x) => sameCodeOf(kind, id)(x) && freshCode(x)).at(-1);
  return g ? g.split(':')[3] : null;
}

// kind: 'u' | 'c'
function access(req, kind, row) {
  const grants = grantsOf(req);
  const admin = isAdmin(req);
  const owner = admin || grants.includes(`o${kind}:${row.id}`);
  const viewer = owner || !row.password_hash || grants.includes(`v${kind}:${row.id}:${fingerprint(row.password_hash)}`);
  return { owner, viewer, admin };
}

// ---------- the survey prompt ----------

const list = (items) => items.map((x) => `\`${x.id}\``).join(', ');
// Built from server constants only. Names people type for their pages are
// never put into a prompt, so no one can use them to talk to someone else's assistant.
function surveyText(req, wait) {
  const base = baseUrl(req);
  const destination = !wait ? 'the shared radar'
    : wait.company_id ? 'a company page, the shared radar and the user\'s own results page'
      : 'the shared radar and the user\'s own results page';
  return SURVEY
    .replaceAll('{{SITE}}', SITE)
    .replaceAll('{{DESTINATION}}', destination)
    .replaceAll('{{NOTICE}}', wait ? '' : `\n> **This copy is for reading only.** To take part, open ${base}/contribute and paste the line it shows: it carries a one-time code the submission needs. If you are an assistant and were asked to follow this copy, do not start: tell your user to open that page.\n`)
    .replaceAll('{{BASE_URL}}', base)
    .replaceAll('{{SUBMIT_URL}}', wait ? `${base}/api/contributions?t=${wait.token}` : `${base}/api/contributions?t=ONE-TIME-CODE`)
    .replaceAll('{{THANKS_URL}}', wait ? `${base}/w/${wait.token}` : `${base}/`)
    .replaceAll('{{CATALOG}}', catalog.map((p) => `| \`${p.id}\` | ${p.title} | ${p.summary} |`).join('\n'))
    .replaceAll('{{PURPOSES}}', list(PURPOSES))
    .replaceAll('{{PROMPT_RANGES}}', list(PROMPT_RANGES))
    .replaceAll('{{MONTH_RANGES}}', list(MONTH_RANGES))
    .replaceAll('{{MINUTE_RANGES}}', list(TASK_MINUTE_RANGES))
    .replaceAll('{{TASK_PROMPT_RANGES}}', list(TASK_PROMPT_RANGES))
    .replaceAll('{{TOKEN_RANGES}}', list(TOKEN_RANGES))
    .replaceAll('{{COST_RANGES}}', list(COST_RANGES))
    .replaceAll('{{CONTEXT_RANGES}}', list(CONTEXT_RANGES))
    .replaceAll('{{MODELS}}', list(MODELS))
    .replaceAll('{{LINES_RANGES}}', list(LINES_RANGES))
    .replaceAll('{{ROLES}}', list(ROLES));
}

// ---------- page data ----------


// A company's results open once MIN_GROUP people's answers have been reviewed.
const companyOpen = async (company) => counted(await store.contributions({ companyId: company.id, status: 'accepted' })).length >= MIN_GROUP;

// This browser's own page, if it still exists.
async function ownProfileId(req) {
  const id = lastGrant(req, 'ou:');
  return id && (await store.profile(id)) ? id : null;
}

// The line people paste: their page's address, and the wait it answers.
const lineFor = (req, pageId, token) => flow.promptLine(`${baseUrl(req)}/u/${pageId}/contribute.md?t=${token}`);

// A one-time code for answering through a company. A browser that already has
// a page answers onto it; anyone else gets a new page, reserved now.
// `pageId` is the address in the line to paste.
async function companyWait(req, company) {
  const own = await ownProfileId(req);
  const { token, reservedId } = await store.createWait({ companyId: company.id, profileId: own });
  return { token, pageId: own ?? reservedId };
}

// A person's page before its first answer.
async function profileData(req, profile, acc) {
  return { profile, companies: await store.companiesOf(profile.id), isOwner: acc.owner };
}

// The page where a page is renamed, protected or deleted. Without the owner
// grant it asks for the editor's code first.
const inviteLink = async (req, profileId) => `${baseUrl(req)}/contribute?from=${await store.inviteCode(profileId)}`;
async function editPage(req, res, url, kind, row, acc) {
  const error = url.searchParams.get('error');
  if (!acc.owner) return privateHtml(res, views.editGatePage({ kind, row, error: Boolean(error) }));
  return privateHtml(res, views.editPage({
    kind, row, code: shownCode(req, kind, row.id), saved: url.searchParams.has('saved'),
    error: error && error !== 'wrong' ? error.slice(0, 200) : null,
    invite: kind === 'u' ? await inviteLink(req, row.id) : null,
  }));
}

// ---------- the tour ----------

const groupName = (company) => company.name || 'This company';
const lastGrant = (req, prefix) => grantsOf(req).filter((g) => g.startsWith(prefix)).map((g) => g.slice(prefix.length)).at(-1);

// The lenses this browser can switch between. Everyone, always; "You" once
// this browser owns a page of its own (the signed cookie remembers it); a
// company once that page has answered through a company, or the browser
// started a company page. The page being looked at is always one of them.
async function lensesFor(req, { profile = null, company = null, who = null }) {
  const ownId = lastGrant(req, 'ou:');
  const you = profile ?? (ownId ? await store.profile(ownId) : null);
  let co = company ?? (you ? (await store.companiesOf(you.id))[0] : null) ?? null;
  if (!co) { const id = lastGrant(req, 'oc:'); co = id ? await store.company(id) : null; }
  return [
    { id: 'everyone', label: 'Everyone', href: '/' },
    ...(co ? [{ id: 'company', label: groupName(co), href: `/c/${co.id}` }] : []),
    ...(you ? [{ id: 'you', label: profile && who ? who.lens : 'You', href: `/u/${you.id}` }] : []),
  ];
}

// The data for the tour and the tool pages under one lens. For a person, null
// when their page has no answer yet.
async function tourData(req, { profile = null, company = null, acc = null }) {
  const lens = profile ? 'you' : company ? 'company' : 'everyone';
  // Everyone's numbers, and a company's, come from the stored totals (lib/aggregate.js).
  const t = { lens, home: '/', all: numbersOf(await store.totals('all')), counts: await store.counts(), group: null, me: null, owner: null, profile };
  t.counts.countries = t.all.where.filter((c) => c.id !== NO_COUNTRY).length;
  if (company) {
    Object.assign(t, { group: numbersOf(await store.totals(`c:${company.id}`), new Date(), { minGroup: MIN_GROUP }), groupName: groupName(company), home: `/c/${company.id}`, joinCompany: `/c/${company.id}/contribute` });
    if (acc?.owner) t.owner = { kind: 'c', edit: `/c/${company.id}/edit` };
  }
  if (profile) {
    const history = await store.contributions({ profileId: profile.id });
    const latest = history.at(-1);
    if (!latest) return null;
    // An answer waiting for review is not in the stored totals yet. On the
    // person's own page it shows already: counted into this page's numbers only,
    // unless an earlier answer of theirs is in the totals (it would count twice).
    if (!history.some((c) => c.status === 'accepted')) {
      const own = (kind) => delta(latest).map(([metric, key, value]) => ({ kind, month: monthKey(latest.created_at), metric, key, value }));
      t.all = numbersOf([...(await store.totals('all')), ...own('l'), ...own('m')]);
    }
    t.who = whoFor(profile, acc?.owner);
    t.home = `/u/${profile.id}`;
    t.me = {
      patterns: new Set(latest.patterns.map((p) => p.catalog_id).filter(Boolean)),
      setupKey: setupKey(latest),
      setupSize: setupTools(latest).size,
      setupTools: [...setupTools(latest).values()],
      tools: new Set(latest.tools.map((x) => x.name.toLowerCase())),
      // How often they said they use each tool (daily, weekly, occasionally), where they said.
      toolFrequency: new Map(latest.tools.filter((x) => x.frequency).map((x) => [x.name.toLowerCase(), x.frequency])),
      families: new Set(familyNames(latest)),
      versions: new Set(versionNames(latest)),
      harnesses: new Set(harnessNames(latest)),
      months: new Set(history.map((c) => c.created_at.slice(0, 7))),
      country: latest.country,
    };
    if (acc?.owner) {
      t.again = `/u/${profile.id}/contribute`;
      t.owner = { kind: 'u', edit: `/u/${profile.id}/edit`, code: shownCode(req, 'u', profile.id), invite: await inviteLink(req, profile.id), review: views.REVIEW_NOTE[latest.status] ?? null };
    }
  }
  t.lenses = await lensesFor(req, { profile, company, who: t.who });
  // A browser with a page of its own runs the survey again onto it.
  const own = profile ? null : t.lenses.find((l) => l.id === 'you');
  if (own) t.again = `${own.href}/contribute`;
  return t;
}

// /tools and /tools/<slug> under a lens (`at` is '' or '/u/<id>' or '/c/<id>').
function toolsRoute(res, t, slug) {
  t.suffix = slug ? `/tools/${slug}` : '/tools';
  const send = privateHtml;
  if (!slug) return send(res, toolsIndexPage(t));
  const at = t.all.tools.findIndex((x) => toolSlug(x.name) === slug);
  if (at < 0) return html(res, views.notFoundPage(), 404);
  const tool = t.all.tools[at];
  const list = t.all.tools;
  return send(res, toolPage(t, {
    tool,
    detail: toolDetailOf(t.all.buckets, tool.name),
    groupDetail: t.group ? toolDetailOf(t.group.buckets, tool.name) : null,
    prev: list.length > 1 ? list[(at - 1 + list.length) % list.length] : null,
    next: list.length > 1 ? list[(at + 1) % list.length] : null,
  }));
}

setInterval(() => store.pruneWaits().catch(() => {}), 3600_000).unref();

// Where a finished wait leads. The first browser that asks gets the owner grant
// for the new page; anyone else is sent to the page itself (which may ask for its password).
// `fetched`: the assistant has fetched the prompt and is at work. `code`: the
// new page's editor's code, for the browser that is given the page.
async function resolveWait(req, w) {
  if (!w.contribution_id) return { status: w.fetched_at ? 'fetched' : 'waiting' };
  const to = `/u/${w.profile_id}`;
  if (grantsOf(req).includes(`ou:${w.profile_id}`)) return { status: 'done', redirect: to };
  if (await store.claimWait(w.token)) {
    // A new page gets its editor's code now, for the browser that owns it.
    const profile = await store.profile(w.profile_id);
    const issued = profile && !profile.editor_code_hash ? await issueCode('u', profile.id) : null;
    return { status: 'done', redirect: to, code: issued?.code, grant: [`ou:${w.profile_id}`, ...(issued ? [issued.entry] : [])] };
  }
  return { status: 'done', redirect: to };
}

// ---------- the submission endpoint, called by assistants ----------

async function submit(req, res, url) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Use POST.' }, { Allow: 'POST' });
  const retry = limited(req, 'submit', 10);
  if (retry) return json(res, 429, { ok: false, error: 'Too many submissions. Try again shortly.' }, { 'Retry-After': String(retry) });
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    return json(res, 415, { ok: false, error: 'Send the JSON with Content-Type: application/json.' });
  }
  const wait = await store.liveWait(url.searchParams.get('t'));
  if (!wait) return json(res, 400, { ok: false, error: `This prompt has no valid one-time code, or it expired. Open ${baseUrl(req)}/contribute for a new line.` });
  if (wait.contribution_id) return json(res, 410, { ok: false, error: 'This prompt has already been used. Open the contribute page for a new one.' });

  let clean;
  try {
    clean = cleanContribution(JSON.parse(await readBody(req)));
  } catch (e) {
    return json(res, e.status || 400, { ok: false, error: e instanceof SyntaxError ? 'Body is not valid JSON.' : e.message });
  }
  // Text that looks like it addresses a model is held for a person to review.
  const flags = injectionSigns(freeText(clean));
  let profileId = wait.profile_id;
  let created = null;
  if (!profileId) {
    created = await store.createProfile({ name: wait.name, passwordHash: wait.password_hash, id: wait.reserved_id });
    profileId = created.id;
  }
  try {
    await store.addContribution(clean, { profileId, companyId: wait.company_id, status: flags.length ? 'flagged' : 'pending', flags, waitToken: wait.token });
  } catch (e) {
    if (created) await store.deleteProfile(created.id);
    if (e.status === 410) return json(res, 410, { ok: false, error: e.message });
    throw e;
  }
  return json(res, 201, {
    ok: true,
    message: 'Thank you! Your answer arrived. It joins the shared numbers once it has been reviewed.',
    results: `${baseUrl(req)}/w/${wait.token}`,
  });
}

// ---------- routes ----------

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const m = (re) => p.match(re);

  if (p === '/api/contributions') return submit(req, res, url);

  const waitApi = m(/^\/api\/wait\/([a-z0-9]{16})$/);
  if (waitApi && req.method === 'GET') {
    const w = await store.liveWait(waitApi[1]);
    if (!w) return json(res, 404, { status: 'expired' });
    const r = await resolveWait(req, w);
    return json(res, 200, { status: r.status, redirect: r.redirect, page: r.redirect, code: r.code }, r.grant ? { 'Set-Cookie': grantCookie(req, r.grant) } : {});
  }

  if (req.method === 'POST') return post(req, res, url, p, m);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');

  if (p.startsWith('/static/')) return serveStatic(res, p.slice('/static/'.length));
  if (p === '/favicon.ico') return serveStatic(res, 'favicon.svg');
  if (p === '/healthz') return json(res, 200, { ok: true });

  // The prompt, read by assistants. The one-time code decides where the answer goes.
  // /contribute.md is the copy for reading. The ones people paste are
  // /u/<id>/contribute.md (the address their own page will have) and
  // /c/<id>/contribute.md (a company page). The one-time code for the
  // submission travels inside the prompt, not in the line people paste.
  const md = (text) => send(res, 200, text, 'text/markdown; charset=utf-8', { 'Cache-Control': 'no-store' });
  if (p === '/contribute.md') {
    const w = await store.liveWait(url.searchParams.get('t'));
    return md(surveyText(req, w && !w.contribution_id ? w : null));
  }
  const personalMd = m(/^\/u\/([a-z0-9]{10})\/contribute\.md$/);
  if (personalMd) {
    // The line names its own wait, so two open lines for one page (Just me,
    // and a company) never take each other's answers. Lines without one
    // fall back to the page's newest unused wait.
    const named = url.searchParams.has('t') ? await store.liveWait(url.searchParams.get('t')) : null;
    const w = named ? (!named.contribution_id && [named.reserved_id, named.profile_id].includes(personalMd[1]) ? named : null)
      : await store.openWaitFor(personalMd[1]);
    if (w) await store.markFetched(w.token);
    return md(surveyText(req, w));
  }
  const companyMd = m(/^\/c\/([a-z0-9]{8})\/contribute\.md$/);
  if (companyMd) {
    const company = await store.company(companyMd[1]);
    if (!company) return send(res, 404, 'This company page does not exist (any more).', 'text/plain');
    if (limited(req, 'prompt', 30)) return send(res, 429, 'Too many requests', 'text/plain');
    // Every fetch gets its own one-time code: one colleague, one answer.
    const { token } = await store.createWait({ companyId: company.id });
    return md(surveyText(req, await store.liveWait(token)));
  }

  // The whole presentation: introduction, everyone's numbers, the invitation.
  // The tour and the tool pages depend on this browser's cookie (its lenses), so they are never cached.
  if (p === '/') return privateHtml(res, tourPage(await tourData(req, {})));
  const toolsAt = m(/^\/tools(?:\/([a-z0-9-]{1,80}))?$/);
  if (toolsAt) return toolsRoute(res, await tourData(req, {}), toolsAt[1]);
  if (p === '/contribute') {
    if (url.searchParams.get('for') === 'company') return privateHtml(res, flow.companyStartPage({ error: url.searchParams.get('error') }));
    if (limited(req, 'prompt', 30)) return send(res, 429, 'Too many requests', 'text/plain');
    const { token, reservedId } = await store.createWait();
    // An invitation link names its sender, and nothing else about them.
    const inviter = await store.profileByInvite(url.searchParams.get('from'));
    return privateHtml(res, flow.joinMePage({ token, line: lineFor(req, reservedId, token), inviter: inviter ? { name: inviter.name } : null }));
  }

  // A person's page.
  const prof = m(/^\/u\/([a-z0-9]{10})(\/contribute|\/export\.json|\/edit|\/tools(?:\/([a-z0-9-]{1,80}))?)?$/);
  if (prof) {
    const profile = await store.profile(prof[1]);
    if (!profile) return html(res, views.notFoundPage(), 404);
    const acc = access(req, 'u', profile);
    if (!acc.viewer) return privateHtml(res, views.unlockPage({ kind: 'u', id: profile.id, error: url.searchParams.get('error') }));
    if (prof[2] === '/edit') return editPage(req, res, url, 'u', profile, acc);
    if (prof[2] === '/contribute') {
      if (!acc.owner) return redirect(res, `/u/${profile.id}`);
      const { token } = await store.createWait({ profileId: profile.id });
      return privateHtml(res, flow.joinMePage({ token, line: lineFor(req, profile.id, token), profile }));
    }
    if (prof[2] === '/export.json') {
      if (!acc.owner) return redirect(res, `/u/${profile.id}`);
      const contributions = (await store.contributions({ profileId: profile.id })).map(({ payload, ...c }) => c);
      return json(res, 200, { page: `/u/${profile.id}`, name: profile.name, created_at: profile.created_at, contributions }, { 'Content-Disposition': `attachment; filename="${SITE}-${profile.id}.json"` });
    }
    const t = await tourData(req, { profile, acc });
    if (prof[2]?.startsWith('/tools')) return t ? toolsRoute(res, t, prof[3]) : redirect(res, `/u/${profile.id}`);
    // A page with an answer is the tour through its lens; one without, an invitation to answer.
    if (t) return privateHtml(res, tourPage(t));
    return privateHtml(res, views.profilePage({ ...(await profileData(req, profile, acc)), code: acc.owner ? shownCode(req, 'u', profile.id) : null, invite: acc.owner ? await inviteLink(req, profile.id) : null }));
  }

  // A company's page, its contribute page (for colleagues) and its invite page (for the person who started it).
  const comp = m(/^\/c\/([a-z0-9]{8})(\/contribute|\/invite|\/edit|\/tools(?:\/([a-z0-9-]{1,80}))?)?$/);
  if (comp) {
    const company = await store.company(comp[1]);
    if (!company) return html(res, views.notFoundPage(), 404);
    const acc = access(req, 'c', company);
    if (!acc.viewer) return privateHtml(res, views.unlockPage({ kind: 'c', id: company.id, error: url.searchParams.get('error') }));
    if (comp[2] === '/edit') return editPage(req, res, url, 'c', company, acc);
    if (comp[2] === '/contribute' || comp[2] === '/invite') {
      if (comp[2] === '/invite' && !acc.owner) return redirect(res, `/c/${company.id}/contribute`);
      if (limited(req, 'prompt', 30)) return send(res, 429, 'Too many requests', 'text/plain');
      if (comp[2] === '/invite' && await companyOpen(company)) return privateHtml(res, flow.companyOpenPage({ company, own: await ownProfileId(req) }));
      const wait = await companyWait(req, company);
      const props = { company, token: wait.token, line: lineFor(req, wait.pageId, wait.token) };
      if (comp[2] === '/invite') return privateHtml(res, flow.companyInvitePage({ ...props, base: baseUrl(req), code: shownCode(req, 'c', company.id) }));
      return privateHtml(res, flow.joinMePage(props));
    }
    // Before 5 people have answered, the page shows how many have; then the tour through its lens.
    if (!(await companyOpen(company))) {
      if (comp[2]) return redirect(res, `/c/${company.id}`);
      const own = new Set(grantsOf(req).filter((g) => g.startsWith('ou:')).map((g) => g.slice(3)));
      // One seat per person, as companyOpen counts them: accepted once any of their answers is.
      const people = new Map();
      for (const c of await store.contributions({ companyId: company.id })) {
        if (c.status === 'rejected') continue;
        const key = c.profile_id ?? `c${c.id}`;
        const seat = people.get(key) ?? { status: 'review', mine: own.has(c.profile_id) };
        if (c.status === 'accepted') seat.status = 'accepted';
        people.set(key, seat);
      }
      const seats = [...people.values()];
      return privateHtml(res, flow.companyProgressPage({ company, base: baseUrl(req), seats, owner: acc.owner }));
    }
    const t = await tourData(req, { company, acc });
    return comp[2] ? toolsRoute(res, t, comp[3]) : privateHtml(res, tourPage(t));
  }

  // The link an assistant opens after submitting.
  const waitPage = m(/^\/w\/([a-z0-9]{16})$/);
  if (waitPage) {
    const w = await store.liveWait(waitPage[1]);
    if (!w) return redirect(res, '/');
    const r = await resolveWait(req, w);
    if (r.status !== 'done') return redirect(res, '/contribute');
    return redirect(res, r.redirect, r.grant ? { 'Set-Cookie': grantCookie(req, r.grant) } : {});
  }
  if (p === '/privacy') return html(res, views.privacyPage());

  // ---------- admin ----------
  if (p === '/admin' || p.startsWith('/admin/')) {
    if (!ADMIN_PASSWORD) return privateHtml(res, admin.disabledPage());
    if (p === '/admin/login') return privateHtml(res, admin.loginPage({ error: url.searchParams.get('error') }));
    if (!isAdmin(req)) return redirect(res, '/admin/login');
    if (p === '/admin') {
      const status = ['pending', 'flagged', 'accepted', 'rejected'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : null;
      const page = Math.max(0, Number(url.searchParams.get('page')) || 0);
      const [counts, rows] = await Promise.all([store.statusCounts(), store.listContributions({ status, offset: page * 50 })]);
      return privateHtml(res, admin.listPage({ counts, rows, status, page }));
    }
    if (p === '/admin/analysis') return privateHtml(res, admin.analysisPage({ counts: await store.statusCounts(), base: baseUrl(req) }));
    if (p === '/admin/totals') {
      const [state, check] = await Promise.all([store.totalsState(), store.checkTotals()]);
      return privateHtml(res, admin.totalsPage({ state, check, rebuilt: url.searchParams.has('rebuilt') }));
    }
    const one = m(/^\/admin\/c\/(\d{1,18})$/);
    if (one) {
      const c = await store.contribution(one[1]);
      return c ? privateHtml(res, admin.detailPage({ c })) : html(res, views.notFoundPage(), 404);
    }
  }

  html(res, views.notFoundPage(), 404);
}

async function post(req, res, url, p, m) {
  if (!sameOrigin(req)) return send(res, 403, 'Forbidden', 'text/plain');
  if (limited(req, 'form', 30)) return send(res, 429, 'Too many requests', 'text/plain');

  if (p === '/companies') {
    if (limited(req, 'company', 10, 3600_000)) return send(res, 429, 'Too many company pages from this address. Try again later.', 'text/plain');
    // A password can be added later, on the page's edit page.
    const form = await readForm(req);
    const company = await store.createCompany({ name: cleanName(form.name, 80), passwordHash: null });
    const issued = await issueCode('c', company.id);
    return redirect(res, `/c/${company.id}/invite`, { 'Set-Cookie': grantCookie(req, [`oc:${company.id}`, issued.entry]) });
  }

  // Unlocking a password-protected page.
  const unlock = m(/^\/(u|c)\/([a-z0-9]{8,10})\/unlock$/);
  if (unlock) {
    const [, kind, id] = unlock;
    if (limited(req, `unlock:${kind}:${id}`, 8, 15 * 60_000)) return send(res, 429, 'Too many attempts. Try again in 15 minutes.', 'text/plain');
    const row = kind === 'u' ? await store.profile(id) : await store.company(id);
    if (!row) return html(res, views.notFoundPage(), 404);
    const form = await readForm(req);
    if (!row.password_hash) return redirect(res, `/${kind}/${id}`);
    if (!verifyPassword(String(form.password || ''), row.password_hash)) return redirect(res, `/${kind}/${id}?error=wrong`);
    // The password only opens the page. Editing it takes the editor's code.
    return redirect(res, `/${kind}/${id}`, { 'Set-Cookie': grantCookie(req, [`v${kind}:${id}:${fingerprint(row.password_hash)}`]) });
  }

  // The editor's code makes this browser an owner of the page.
  const editUnlock = m(/^\/(u|c)\/([a-z0-9]{8,10})\/edit\/unlock$/);
  if (editUnlock) {
    const [, kind, id] = editUnlock;
    if (limited(req, `edit:${kind}:${id}`, 8, 15 * 60_000)) return send(res, 429, 'Too many attempts. Try again in 15 minutes.', 'text/plain');
    const row = kind === 'u' ? await store.profile(id) : await store.company(id);
    if (!row) return html(res, views.notFoundPage(), 404);
    const form = await readForm(req);
    if (!verifyEditorCode(form.code, row.editor_code_hash)) return redirect(res, `/${kind}/${id}/edit?error=wrong`);
    return redirect(res, `/${kind}/${id}/edit`, { 'Set-Cookie': grantCookie(req, [`o${kind}:${id}`]) });
  }

  // Owner actions on a page.
  const owned = m(/^\/(u|c)\/([a-z0-9]{8,10})\/(settings|delete|forget|code)$/);
  if (owned) {
    const [, kind, id, action] = owned;
    const row = kind === 'u' ? await store.profile(id) : await store.company(id);
    if (!row) return html(res, views.notFoundPage(), 404);
    if (action === 'forget') return redirect(res, '/', { 'Set-Cookie': grantCookie(req, [], (g) => g.split(':')[1] === id || g.split(':')[2] === id) });
    if (!access(req, kind, row).owner) return send(res, 403, 'Only the person who started this page can change it.', 'text/plain');
    const update = kind === 'u' ? (f) => store.updateProfile(id, f) : (f) => store.updateCompany(id, f);
    if (action === 'code') {
      const issued = await issueCode(kind, id);
      return redirect(res, `/${kind}/${id}/edit?code=new`, { 'Set-Cookie': grantCookie(req, [issued.entry], sameCodeOf(kind, id)) });
    }
    if (action === 'delete') {
      await (kind === 'u' ? store.deleteProfile(id) : store.deleteCompany(id));
      return redirect(res, '/', { 'Set-Cookie': grantCookie(req, [], (g) => g.split(':')[1] === id || g.split(':')[2] === id) });
    }
    const form = await readForm(req);
    const fields = {};
    if ('name' in form) fields.name = cleanName(form.name, kind === 'u' ? 60 : 80);
    let grant = [];
    if (form.remove_password === 'on') fields.password_hash = null;
    else if (form.password) {
      try { fields.password_hash = newPassword(form.password); } catch (e) { return redirect(res, `/${kind}/${id}/edit?error=${encodeURIComponent(e.message)}`); }
      grant = [`v${kind}:${id}:${fingerprint(fields.password_hash)}`];
    }
    if (Object.keys(fields).length) await update(fields);
    return redirect(res, `/${kind}/${id}/edit?saved`, grant.length ? { 'Set-Cookie': grantCookie(req, grant) } : {});
  }

  // ---------- admin ----------
  if (p === '/admin/login') {
    if (!ADMIN_PASSWORD) return send(res, 404, 'Not found', 'text/plain');
    if (limited(req, 'admin-login', 5, 15 * 60_000)) return send(res, 429, 'Too many attempts. Try again in 15 minutes.', 'text/plain');
    const form = await readForm(req);
    if (!safeEqual(String(form.password || ''), ADMIN_PASSWORD)) return redirect(res, '/admin/login?error=1');
    const value = signer.sign(`admin:${Date.now() + 12 * 3600_000}:${fingerprint(hashOfAdmin)}`);
    return redirect(res, '/admin', { 'Set-Cookie': cookie('admin', value, { maxAge: 12 * 3600, secure: SECURE }) });
  }
  if (p === '/admin/logout') return redirect(res, '/', { 'Set-Cookie': cookie('admin', '', { maxAge: 0, secure: SECURE }) });
  if (p.startsWith('/admin/')) {
    if (!isAdmin(req)) return send(res, 403, 'Forbidden', 'text/plain');
    if (p === '/admin/totals/rebuild') {
      await store.rebuildTotals();
      return redirect(res, '/admin/totals?rebuilt');
    }
    const act = m(/^\/admin\/c\/(\d{1,18})\/(accept|reject|flag|pending|delete)$/);
    if (act) {
      const [, id, action] = act;
      if (action === 'delete') { await store.deleteContribution(id); return redirect(res, '/admin'); }
      await store.setStatus(id, { accept: 'accepted', reject: 'rejected', flag: 'flagged', pending: 'pending' }[action]);
      return redirect(res, `/admin/c/${id}`);
    }
  }

  return html(res, views.notFoundPage(), 404);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (!e.status) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, e.status ? e.message : 'Server error', 'text/plain');
  });
});
server.listen(PORT, () => {
  const base = PUBLIC_URL || `http://localhost:${PORT}`;
  console.log(`${SITE}  ${base}${ADMIN_PASSWORD ? `\nadmin            ${base}/admin` : '\nadmin            disabled (set ADMIN_PASSWORD)'}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => store.close().then(() => process.exit(0))));
