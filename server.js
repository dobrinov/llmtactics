// llmtactics.com: one small Node server. Dependencies: `postgres` (the driver).
import http from 'node:http';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './lib/db.js';
import { cleanContribution, catalog, PURPOSES, PROMPT_RANGES, MONTH_RANGES, ROLES, QUADRANTS, TASK_MINUTE_RANGES, TASK_PROMPT_RANGES, TOKEN_RANGES, LINES_RANGES, COST_RANGES, CONTEXT_RANGES, MODELS } from './lib/shape.js';
import { radar, tools, setups, experience, counted, current, percentile, compare, countries, MIN_GROUP } from './lib/stats.js';
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

const TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
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
function surveyText(req, wait, promptPath = '/contribute.md') {
  const base = baseUrl(req);
  const destination = !wait ? 'the shared radar'
    : wait.company_id ? 'a company page, the shared radar and the user\'s own results page'
      : 'the shared radar and the user\'s own results page';
  return SURVEY
    .replaceAll('{{SITE}}', SITE)
    .replaceAll('{{DESTINATION}}', destination)
    .replaceAll('{{NOTICE}}', wait ? '' : `\n> **This copy is for reading only.** To take part, open ${base}/contribute and paste the line it shows: it carries a one-time code the submission needs. If you are an assistant and were asked to follow this copy, do not start: tell your user to open that page.\n`)
    .replaceAll('{{BASE_URL}}', base)
    .replaceAll('{{PROMPT_URL}}', `${base}${promptPath}`)
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

const accepted = () => store.contributions({ status: 'accepted' });

function weeksOf(contribs, since) {
  const monday = (d) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x; };
  const first = Math.min(Date.parse(since), ...contribs.map((c) => Date.parse(c.created_at)));
  const start = monday(new Date(first));
  const weeks = [];
  for (let w = monday(new Date()); (w >= start || weeks.length < 8) && weeks.length < 12; w = new Date(w.getTime() - 7 * 864e5)) weeks.unshift(w);
  return weeks.map((w) => {
    const end = w.getTime() + 7 * 864e5;
    return {
      label: w.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      count: contribs.filter((c) => { const t = Date.parse(c.created_at); return t >= w.getTime() && t < end; }).length,
    };
  });
}

function toolShareMap(rows) {
  const map = new Map();
  for (const c of rows) for (const key of new Set(c.tools.map((t) => t.name.toLowerCase()))) map.set(key, (map.get(key) || 0) + 1);
  return (name) => (rows.length ? Math.round((100 * (map.get(name.toLowerCase()) || 0)) / rows.length) : 0);
}

async function companyData(req, company, acc) {
  const [all, mine] = await Promise.all([accepted(), store.contributions({ companyId: company.id, status: 'accepted' })]);
  const here = radar(mine);
  const everywhere = radar(all);
  const allShare = toolShareMap(current(all));
  const expHere = experience(mine);
  const expAll = experience(all);
  return {
    company,
    base: baseUrl(req),
    radar: here,
    compared: compare(here, everywhere),
    tools: tools(mine, { top: 7 }).tools.map((t) => ({ name: t.name, here: t.share, everywhere: allShare(t.name) })),
    exp: { here: expHere.prompts, everywhere: expAll.prompts, minutesHere: expHere.efficiency.minutes, minutesEverywhere: expAll.efficiency.minutes, monthsHere: expHere.months, monthsEverywhere: expAll.months },
    weeks: weeksOf(mine, new Date(company.created_at).toISOString()),
    isOwner: acc.owner,
  };
}

async function profileData(req, profile, url, acc) {
  const [history, all, companies] = await Promise.all([store.contributions({ profileId: profile.id }), accepted(), store.companiesOf(profile.id)]);
  const latest = history.at(-1) ?? null;
  const radarAll = radar(all);
  const base = { profile, latest, history, radarAll, companies, isOwner: acc.owner, base: baseUrl(req) };
  if (!latest) return base;
  const vs = companies.find((c) => c.id === url.searchParams.get('vs'));
  let compareWith = null;
  if (vs) {
    const r = radar(await store.contributions({ companyId: vs.id, status: 'accepted' }));
    compareWith = { company: vs, radar: r, enough: r.total >= MIN_GROUP };
  }
  const rows = current(all);
  const share = toolShareMap(rows);
  return {
    ...base, compareWith,
    toolShares: latest.tools.map((t) => ({ name: t.name, used_for: t.used_for, share: share(t.name) })),
    promptPercentile: latest.prompts_per_month ? percentile(rows, PROMPT_RANGES, 'prompts_per_month', latest.prompts_per_month) : null,
    promptBins: experience(all).prompts.bins,
    unique: latest.patterns.filter((p) => !p.catalog_id && (radarAll.unmatchedTitles.get(p.title.toLowerCase())?.count ?? 0) <= 1),
  };
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

setInterval(() => store.pruneWaits().catch(() => {}), 3600_000).unref();

// Where a finished wait leads. The first browser that asks gets the owner grant
// for the new page; anyone else is sent to the page itself (which may ask for its password).
async function resolveWait(req, w) {
  if (!w.contribution_id) return { status: 'waiting' };
  const to = `/u/${w.profile_id}${w.company_id ? `?vs=${w.company_id}` : ''}`;
  if (grantsOf(req).includes(`ou:${w.profile_id}`)) return { status: 'done', redirect: to };
  if (await store.claimWait(w.token)) {
    // A new page gets its editor's code now, for the browser that owns it.
    const profile = await store.profile(w.profile_id);
    const issued = profile && !profile.editor_code_hash ? await issueCode('u', profile.id) : null;
    return { status: 'done', redirect: to, grant: [`ou:${w.profile_id}`, ...(issued ? [issued.entry] : [])] };
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
    return json(res, 200, { status: r.status, redirect: r.redirect }, r.grant ? { 'Set-Cookie': grantCookie(req, r.grant) } : {});
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
  if (personalMd) return md(surveyText(req, await store.openWaitFor(personalMd[1]), p));
  const companyMd = m(/^\/c\/([a-z0-9]{8})\/contribute\.md$/);
  if (companyMd) {
    const company = await store.company(companyMd[1]);
    if (!company) return send(res, 404, 'This company page does not exist (any more).', 'text/plain');
    if (limited(req, 'prompt', 30)) return send(res, 429, 'Too many requests', 'text/plain');
    // Every fetch gets its own one-time code: one colleague, one answer.
    const { token } = await store.createWait({ companyId: company.id });
    return md(surveyText(req, await store.liveWait(token), p));
  }

  // The whole presentation: introduction, everyone's numbers, the invitation.
  if (p === '/') {
    const all = await accepted();
    const area = QUADRANTS.some((q) => q.id === url.searchParams.get('area')) ? url.searchParams.get('area') : '';
    return html(res, views.homePage({
      counts: await store.counts(), radar: radar(all), tools: tools(all), setups: setups(all), exp: experience(all),
      area, selectedId: url.searchParams.get('p'), where: countries(all),
    }));
  }
  if (p === '/contribute') {
    if (limited(req, 'prompt', 30)) return send(res, 429, 'Too many requests', 'text/plain');
    const mode = url.searchParams.get('for') === 'company' ? 'company' : 'me';
    const wait = mode === 'me' ? await store.createWait() : null;
    // An invitation link names its sender, and nothing else about them.
    const inviter = mode === 'me' ? await store.profileByInvite(url.searchParams.get('from')) : null;
    return privateHtml(res, views.contributePage({ mode, base: baseUrl(req), token: wait?.token, promptId: wait?.reservedId, error: url.searchParams.get('error'), inviter: inviter ? { name: inviter.name } : null }));
  }

  // A person's page.
  const prof = m(/^\/u\/([a-z0-9]{10})(\/contribute|\/export\.json|\/edit)?$/);
  if (prof) {
    const profile = await store.profile(prof[1]);
    if (!profile) return html(res, views.notFoundPage(), 404);
    const acc = access(req, 'u', profile);
    if (!acc.viewer) return privateHtml(res, views.unlockPage({ kind: 'u', id: profile.id, error: url.searchParams.get('error') }));
    if (prof[2] === '/edit') return editPage(req, res, url, 'u', profile, acc);
    if (prof[2] === '/contribute') {
      if (!acc.owner) return redirect(res, `/u/${profile.id}`);
      const { token } = await store.createWait({ profileId: profile.id });
      return privateHtml(res, views.contributePage({ mode: 'me', base: baseUrl(req), token, promptId: profile.id, profile }));
    }
    if (prof[2] === '/export.json') {
      if (!acc.owner) return redirect(res, `/u/${profile.id}`);
      const contributions = (await store.contributions({ profileId: profile.id })).map(({ payload, ...c }) => c);
      return json(res, 200, { page: `/u/${profile.id}`, name: profile.name, created_at: profile.created_at, contributions }, { 'Content-Disposition': `attachment; filename="${SITE}-${profile.id}.json"` });
    }
    return privateHtml(res, views.profilePage({ ...(await profileData(req, profile, url, acc)), code: acc.owner ? shownCode(req, 'u', profile.id) : null, invite: acc.owner ? await inviteLink(req, profile.id) : null }));
  }

  // A company's page and its contribute page.
  const comp = m(/^\/c\/([a-z0-9]{8})(\/contribute|\/edit)?$/);
  if (comp) {
    const company = await store.company(comp[1]);
    if (!company) return html(res, views.notFoundPage(), 404);
    const acc = access(req, 'c', company);
    if (!acc.viewer) return privateHtml(res, views.unlockPage({ kind: 'c', id: company.id, error: url.searchParams.get('error') }));
    if (comp[2] === '/edit') return editPage(req, res, url, 'c', company, acc);
    if (comp[2]) {
      if (limited(req, 'prompt', 30)) return send(res, 429, 'Too many requests', 'text/plain');
      const total = counted(await store.contributions({ companyId: company.id, status: 'accepted' })).length;
      return privateHtml(res, views.companyContributePage({ company, base: baseUrl(req), total, created: url.searchParams.has('created') && acc.owner, code: acc.owner ? shownCode(req, 'c', company.id) : null }));
    }
    return privateHtml(res, views.companyPage(await companyData(req, company, acc)));
  }

  // The link an assistant opens after submitting.
  const waitPage = m(/^\/w\/([a-z0-9]{16})$/);
  if (waitPage) {
    const w = await store.liveWait(waitPage[1]);
    if (!w) return redirect(res, '/');
    const r = await resolveWait(req, w);
    if (r.status === 'waiting') return redirect(res, '/contribute');
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

  // The optional name and password typed on a contribute page while it waits.
  const details = m(/^\/api\/wait\/([a-z0-9]{16})\/details$/);
  if (details) {
    const w = await store.liveWait(details[1]);
    if (!w || w.contribution_id || w.profile_id) return json(res, 404, { ok: false });
    const form = await readForm(req);
    let passwordHash;
    try { passwordHash = newPassword(form.password); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
    await store.setWaitDetails(w.token, { name: cleanName(form.name, 60), passwordHash });
    return json(res, 200, { ok: true });
  }

  if (p === '/companies') {
    if (limited(req, 'company', 10, 3600_000)) return send(res, 429, 'Too many company pages from this address. Try again later.', 'text/plain');
    const form = await readForm(req);
    let passwordHash;
    try { passwordHash = newPassword(form.password); } catch (e) { return redirect(res, `/contribute?for=company&error=${encodeURIComponent(e.message)}`); }
    const company = await store.createCompany({ name: cleanName(form.name, 80), passwordHash });
    const issued = await issueCode('c', company.id);
    return redirect(res, `/c/${company.id}/contribute?created`, { 'Set-Cookie': grantCookie(req, [`oc:${company.id}`, issued.entry]) });
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
