// llmtactics.com: one small Node server. Dependencies: `postgres` (the driver).
import http from 'node:http';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './lib/db.js';
import { cleanContribution, catalog, PURPOSES, PROMPT_RANGES, MONTH_RANGES, ROLES, TASK_MINUTE_RANGES, TASK_PROMPT_RANGES, TOKEN_RANGES, LINES_RANGES, COST_RANGES, CONTEXT_RANGES, MODELS } from './lib/shape.js';
import { MIN_GROUP, NO_COUNTRY, familyNames, versionNames, harnessNames, setupKey, setupTools } from './lib/stats.js';
import { tourPage, toolsIndexPage, toolPage, toolSlug, whoFor } from './lib/tour.js';
import * as flow from './lib/flow.js';
import { numbersOf, toolDetailOf, delta } from './lib/aggregate.js';
import { monthKey } from './lib/stats.js';
import { hashPassword, verifyPassword, createSigner, parseCookies, cookie, injectionSigns, freeText, safeEqual, newEditorCode, hashEditorCode, verifyEditorCode } from './lib/security.js';
import * as views from './lib/views.js';
import * as admin from './lib/admin-views.js';
import { companyName } from './lib/html.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4400);
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const SITE = process.env.SITE_NAME || 'llmtactics.com';
const SECURE = PUBLIC_URL.startsWith('https://');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const MAX_BODY = 32 * 1024;

// In production, refuse to start without what the site needs: without
// PUBLIC_URL the pasted prompt would point at whatever Host a request names.
if (process.env.NODE_ENV === 'production') {
  const missing = [];
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!PUBLIC_URL.startsWith('https://')) missing.push('PUBLIC_URL (https://…)');
  if (ADMIN_PASSWORD && ADMIN_PASSWORD.length < 12) missing.push('ADMIN_PASSWORD of at least 12 characters, or none to switch the admin area off');
  if (missing.length) { console.error(`Set ${missing.join('; ')}.`); process.exit(1); }
}

const store = await openDb();
const signer = createSigner(process.env.SESSION_SECRET);
// The script that does the counting is served on its own (/llm-survey.py), so the
// prompt stays short enough for an assistant's fetch tool to return it whole.
const MEASURE = await fsp.readFile(path.join(ROOT, 'survey', 'measure.py'), 'utf8');
const SURVEY = await fsp.readFile(path.join(ROOT, 'survey', 'contribute.md'), 'utf8');

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
    const tooLarge = () => Object.assign(new Error(`The body is larger than ${MAX_BODY / 1024} KB.`), { status: 413 });
    // Too large: answer at once, and let the rest of the body drain unread, so
    // the client gets the error instead of a dropped connection.
    if (Number(req.headers['content-length']) > MAX_BODY) { req.resume(); return reject(tooLarge()); }
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { chunks.length = 0; reject(tooLarge()); } else chunks.push(c);
    });
    req.on('end', () => { if (size <= MAX_BODY) resolve(Buffer.concat(chunks).toString('utf8')); });
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
// Limits on guessing: only wrong attempts count, so colleagues behind one
// address who know the password are never locked out. Seconds to wait, or 0.
function guessesLeft(req, bucket, max, windowMs) {
  const h = hits.get(`${bucket}:${clientIp(req)}`);
  if (!h || Date.now() - h.start > windowMs) return 0;
  return h.n >= max ? Math.ceil((h.start + windowMs - Date.now()) / 1000) : 0;
}
const wrongGuess = (req, bucket, windowMs) => limited(req, bucket, Infinity, windowMs);
const tooMany = (res, retry) => send(res, 429, `Too many attempts. Try again in ${Math.max(1, Math.ceil(retry / 60))} minute${retry > 60 ? 's' : ''}.`, 'text/plain; charset=utf-8', { 'Retry-After': String(retry) });
const tooManyRequests = (res, retry) => send(res, 429, 'Too many requests. Try again in a minute.', 'text/plain; charset=utf-8', { 'Retry-After': String(retry) });
// Where a password or code form sends the person back to: a path of the same page only.
const backTo = (next, kind, id, fallback) => (typeof next === 'string' && new RegExp(`^/${kind}/${id}(/(edit|contribute|invite|tools(/[a-z0-9-]{1,80})?))?$`).test(next) ? next : fallback);

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

// The new-page waits this browser opened (its last few), so only it can claim
// the page when the answer arrives. Kept apart from the grants, so they never
// push an owner grant out.
const WAITS_KEPT = 5;
function waitsOf(req) {
  const raw = signer.verify(parseCookies(req.headers.cookie).waits);
  return raw ? raw.split('.').filter((t) => /^[a-z0-9]{16}$/.test(t)) : [];
}
const waitCookie = (req, token) => cookie('waits', signer.sign([...waitsOf(req).filter((t) => t !== token), token].slice(-WAITS_KEPT).join('.')), { maxAge: 7 * 864e2, secure: SECURE });

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
const companyOpen = async (company) => (await store.companyPeople(company.id)) >= MIN_GROUP;

// This browser's own page, if it still exists.
async function ownProfileId(req) {
  const id = lastGrant(req, 'ou:');
  return id && (await store.profile(id)) ? id : null;
}

// The line people paste: the prompt, with the one-time code of the wait it answers.
const lineFor = (req, token) => flow.promptLine(`${baseUrl(req)}/contribute.md?t=${token}`);

// A one-time code for answering through a company. A browser that already has
// a page answers onto it; anyone else gets a new page, reserved now.
async function companyWait(req, company) {
  const own = await ownProfileId(req);
  const { token } = await store.createWait({ companyId: company.id, profileId: own, browser: true });
  return { token, headers: own ? {} : { 'Set-Cookie': waitCookie(req, token) } };
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
    ...(co ? [{ id: 'company', label: companyName(co), href: `/c/${co.id}` }] : []),
    ...(you ? [{ id: 'you', label: profile && who ? who.lens : 'You', href: `/u/${you.id}` }] : []),
  ];
}

// The data for the tour and the tool pages under one lens. For a person, null
// when their page has no answer yet.
async function tourData(req, { profile = null, company = null, acc = null }) {
  const lens = profile ? 'you' : company ? 'company' : 'everyone';
  // Everyone's numbers, and a company's, come from the stored totals (lib/aggregate.js).
  // The queries do not depend on each other, so they run together.
  const [allCells, counts, groupCells, history] = await Promise.all([
    store.totals('all'), store.counts(),
    company ? store.totals(`c:${company.id}`) : null,
    profile ? store.contributions({ profileId: profile.id }) : null,
  ]);
  const t = { lens, home: '/', all: numbersOf(allCells), counts, group: null, me: null, owner: null, profile };
  t.counts.countries = t.all.where.filter((c) => c.id !== NO_COUNTRY).length;
  if (company) {
    Object.assign(t, { group: numbersOf(groupCells, new Date(), { minGroup: MIN_GROUP }), groupName: companyName(company), home: `/c/${company.id}`, joinCompany: `/c/${company.id}/contribute` });
    if (acc?.owner) t.owner = { kind: 'c', edit: `/c/${company.id}/edit` };
  }
  if (profile) {
    const latest = history.at(-1);
    if (!latest) return null;
    // An answer waiting for review is not in the stored totals yet. On the
    // person's own page it shows already: counted into this page's numbers only,
    // unless an earlier answer of theirs is in the totals (it would count twice).
    // A rejected or flagged answer is never counted, here either. Only its
    // owner sees it counted in: anyone else with the link sees the shared numbers.
    const countIn = acc?.owner && latest.status === 'pending' && !history.some((c) => c.status === 'accepted');
    if (countIn) {
      const own = (kind) => delta(latest).map(([metric, key, value]) => ({ kind, month: monthKey(latest.created_at), metric, key, value }));
      t.all = numbersOf([...allCells, ...own('l'), ...own('m')]);
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
      // Whether their latest answer is in the numbers this page shows.
      counted: latest.status === 'accepted' || countIn,
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
  // Whether this browser has answered already, onto a page of its own: then
  // the tour offers to run it again rather than to take part.
  t.tookPart = profile ? Boolean(acc?.owner) : own ? (await store.contributions({ profileId: own.href.slice(3) })).length > 0 : false;
  return t;
}

// /tools and /tools/<slug> under a lens (`at` is '' or '/u/<id>' or '/c/<id>').
// Every tool a page of this lens can link to, as { name, category }.
const linkedTools = (t) => [
  ...(t.group?.tools ?? []),
  ...[t.all, t.group].filter(Boolean).flatMap((n) => n.setups.setups.flatMap((x) => x.tools)),
  ...(t.me?.setupTools ?? []),
];
function toolsRoute(res, t, slug) {
  t.suffix = slug ? `/tools/${slug}` : '/tools';
  const send = privateHtml;
  if (!slug) return send(res, toolsIndexPage(t));
  const list = t.all.tools;
  const at = list.findIndex((x) => toolSlug(x.name) === slug);
  // The tour also links to tools outside everyone's current list: in a
  // company's or a person's setup, or only in older answers.
  const tool = at >= 0 ? list[at] : linkedTools(t).find((x) => toolSlug(x.name) === slug);
  if (!tool) return html(res, views.notFoundPage(), 404);
  return send(res, toolPage(t, {
    tool,
    detail: toolDetailOf(t.all.buckets, tool.name),
    groupDetail: t.group ? toolDetailOf(t.group.buckets, tool.name) : null,
    prev: at >= 0 && list.length > 1 ? list[(at - 1 + list.length) % list.length] : null,
    next: at >= 0 && list.length > 1 ? list[(at + 1) % list.length] : null,
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
  // Only an answer that made a new page hands out ownership (a run again
  // already has its owner), and only to the browser that opened its line:
  // the code in a pasted line must not let anyone else take the page.
  const mayClaim = Boolean(w.reserved_id) && (!w.claim_needs_grant || waitsOf(req).includes(w.token));
  if (mayClaim && await store.claimWait(w.token)) {
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
    // Only waits made before the waiting page stopped asking for a name and
    // password carry them (two days at most); new ones leave both empty.
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
  // The line people paste is /contribute.md?t=<code>; without a live code it
  // is the copy for reading. /u/<id>/contribute.md?t=<code> is what lines
  // used to look like and still works. /c/<id>/contribute.md (a company page)
  // makes a new code on every fetch. The code goes into the prompt's submit URL.
  const md = (text) => send(res, 200, text, 'text/markdown; charset=utf-8', { 'Cache-Control': 'no-store' });
  if (p === '/llm-survey.py') return send(res, 200, MEASURE, 'text/plain; charset=utf-8', { 'Cache-Control': 'no-store' });
  if (p === '/contribute.md') {
    const live = await store.liveWait(url.searchParams.get('t'));
    const w = live && !live.contribution_id ? live : null;
    if (w) await store.markFetched(w.token);
    return md(surveyText(req, w));
  }
  const personalMd = m(/^\/u\/([a-z0-9]{10})\/contribute\.md$/);
  if (personalMd) {
    // The line names its own wait, so two open lines for one page (Just me,
    // and a company) never take each other's answers. A named wait that is
    // used or expired gives the copy for reading, never another wait. Lines
    // from before codes were in them fall back to the page's newest unused wait.
    let w;
    if (url.searchParams.has('t')) {
      const named = await store.liveWait(url.searchParams.get('t'));
      w = named && !named.contribution_id && [named.reserved_id, named.profile_id].includes(personalMd[1]) ? named : null;
    } else w = await store.openWaitFor(personalMd[1]);
    if (w) await store.markFetched(w.token);
    return md(surveyText(req, w));
  }
  const companyMd = m(/^\/c\/([a-z0-9]{8})\/contribute\.md$/);
  if (companyMd) {
    const company = await store.company(companyMd[1]);
    if (!company) return send(res, 404, 'This company page does not exist (any more).', 'text/plain');
    // A company with a password hands out codes only behind it, in the browser.
    if (company.password_hash) return send(res, 403, `This company page has a password. Open ${baseUrl(req)}/c/${company.id}/contribute in a browser, enter the password, and paste the line it shows.`, 'text/plain');
    { const retry = limited(req, 'prompt', 30); if (retry) return tooManyRequests(res, retry); }
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
    // A browser that already has a page runs it again there, rather than starting a second one.
    const own = await ownProfileId(req);
    if (own) return redirect(res, `/u/${own}/contribute`);
    { const retry = limited(req, 'prompt', 30); if (retry) return tooManyRequests(res, retry); }
    const { token } = await store.createWait({ browser: true });
    // An invitation link names its sender, and nothing else about them.
    const inviter = await store.profileByInvite(url.searchParams.get('from'));
    return privateHtml(res, flow.joinMePage({ token, line: lineFor(req, token), inviter: inviter ? { name: inviter.name } : null }), { 'Set-Cookie': waitCookie(req, token) });
  }

  // A person's page.
  const prof = m(/^\/u\/([a-z0-9]{10})(\/contribute|\/export\.json|\/edit|\/tools(?:\/([a-z0-9-]{1,80}))?)?$/);
  if (prof) {
    const profile = await store.profile(prof[1]);
    if (!profile) return html(res, views.notFoundPage(), 404);
    const acc = access(req, 'u', profile);
    if (!acc.viewer) return privateHtml(res, views.unlockPage({ kind: 'u', id: profile.id, error: url.searchParams.get('error'), next: p }));
    if (prof[2] === '/edit') return editPage(req, res, url, 'u', profile, acc);
    if (prof[2] === '/contribute') {
      if (!acc.owner) return redirect(res, `/u/${profile.id}`);
      const { token } = await store.createWait({ profileId: profile.id });
      return privateHtml(res, flow.joinMePage({ token, line: lineFor(req, token), profile }));
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
    if (!acc.viewer) return privateHtml(res, views.unlockPage({ kind: 'c', id: company.id, error: url.searchParams.get('error'), next: p }));
    if (comp[2] === '/edit') return editPage(req, res, url, 'c', company, acc);
    if (comp[2] === '/contribute' || comp[2] === '/invite') {
      if (comp[2] === '/invite' && !acc.owner) return redirect(res, `/c/${company.id}/contribute`);
      { const retry = limited(req, 'prompt', 30); if (retry) return tooManyRequests(res, retry); }
      if (comp[2] === '/invite' && await companyOpen(company)) return privateHtml(res, flow.companyOpenPage({ company, own: await ownProfileId(req) }));
      const wait = await companyWait(req, company);
      const props = { company, token: wait.token, line: lineFor(req, wait.token) };
      if (comp[2] === '/invite') return privateHtml(res, flow.companyInvitePage({ ...props, base: baseUrl(req), code: shownCode(req, 'c', company.id) }), wait.headers);
      return privateHtml(res, flow.joinMePage(props), wait.headers);
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
  { const retry = limited(req, 'form', 30); if (retry) return tooManyRequests(res, retry); }

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
    const bucket = `unlock:${kind}:${id}`;
    const wait = guessesLeft(req, bucket, 8, 15 * 60_000);
    if (wait) return tooMany(res, wait);
    const row = kind === 'u' ? await store.profile(id) : await store.company(id);
    if (!row) return html(res, views.notFoundPage(), 404);
    const form = await readForm(req);
    const next = backTo(form.next, kind, id, `/${kind}/${id}`);
    if (!row.password_hash) return redirect(res, next);
    if (!verifyPassword(String(form.password || ''), row.password_hash)) {
      wrongGuess(req, bucket, 15 * 60_000);
      return redirect(res, `${next}?error=wrong`);
    }
    // The password only opens the page. Editing it takes the editor's code.
    return redirect(res, next, { 'Set-Cookie': grantCookie(req, [`v${kind}:${id}:${fingerprint(row.password_hash)}`]) });
  }

  // The editor's code makes this browser an owner of the page.
  const editUnlock = m(/^\/(u|c)\/([a-z0-9]{8,10})\/edit\/unlock$/);
  if (editUnlock) {
    const [, kind, id] = editUnlock;
    const bucket = `edit:${kind}:${id}`;
    const wait = guessesLeft(req, bucket, 8, 15 * 60_000);
    if (wait) return tooMany(res, wait);
    const row = kind === 'u' ? await store.profile(id) : await store.company(id);
    if (!row) return html(res, views.notFoundPage(), 404);
    const form = await readForm(req);
    if (!verifyEditorCode(form.code, row.editor_code_hash)) {
      wrongGuess(req, bucket, 15 * 60_000);
      return redirect(res, `/${kind}/${id}/edit?error=wrong`);
    }
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
    const wait = guessesLeft(req, 'admin-login', 5, 15 * 60_000);
    if (wait) return tooMany(res, wait);
    const form = await readForm(req);
    if (!safeEqual(String(form.password || ''), ADMIN_PASSWORD)) {
      wrongGuess(req, 'admin-login', 15 * 60_000);
      return redirect(res, '/admin/login?error=1');
    }
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
// Stop taking requests, let the ones in progress finish, then close the
// database. Connections still open after 5 seconds are cut.
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  server.close(() => store.close().then(() => process.exit(0)));
  setTimeout(() => server.closeAllConnections(), 5000).unref();
});
