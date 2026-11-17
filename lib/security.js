// Passwords, signed cookies and the injection screen. Node's crypto only.
import crypto from 'node:crypto';

// ---------- passwords (scrypt) ----------

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password).normalize('NFKC'), salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof password !== 'string') return false;
  const [scheme, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64url');
  const actual = crypto.scryptSync(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(actual, expected);
}

// Constant-time comparison of two strings of any length.
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------- signed cookies ----------

export function createSigner(secret) {
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === 'production') throw new Error('Set SESSION_SECRET to at least 32 random characters.');
    secret = crypto.randomBytes(32).toString('hex');
    console.warn('SESSION_SECRET is not set: using a random one, so access cookies reset on every restart.');
  }
  const mac = (s) => crypto.createHmac('sha256', secret).update(s).digest('base64url');
  return {
    // A value that proves the server issued it: "<payload>.<mac>".
    sign: (payload) => `${payload}.${mac(payload)}`,
    verify(value) {
      if (typeof value !== 'string') return null;
      const i = value.lastIndexOf('.');
      if (i < 1) return null;
      const payload = value.slice(0, i);
      return safeEqual(value.slice(i + 1), mac(payload)) ? payload : null;
    },
  };
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore a malformed cookie */ }
  }
  return out;
}

export function cookie(name, value, { maxAge, secure, path = '/' } = {}) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    'HttpOnly',
    'SameSite=Lax',
    maxAge != null ? `Max-Age=${maxAge}` : '',
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

// ---------- the injection screen ----------

// Submissions come from someone's assistant and are untrusted text. They are
// only ever stored, shown escaped, and read as data during analysis; nothing
// in them is followed. This screen is an extra tripwire: text that looks like
// it is addressing a model, or carrying commands or encoded blobs, is flagged
// so it never reaches shared numbers without a person looking at it first.
const SIGNS = [
  ['ignore-instructions', /\b(ignore|disregard|forget|override|bypass)\b[^.]{0,40}\b(previous|prior|above|earlier|all|any|your|the)\b[^.]{0,30}\b(instructions?|prompts?|rules|directions|guidelines|context)\b/i],
  ['new-instructions', /\b(new|updated|real|actual|hidden|secret)\s+(instructions?|system\s+prompt|directives?|task)\b/i],
  ['system-prompt', /\b(system|developer)\s*(prompt|message|instructions?)\b/i],
  ['role-play', /\byou\s+(are|will\s+be|must\s+act\s+as|are\s+now)\s+(now\s+)?(an?\s+)?(ai|assistant|model|llm|chatbot|claude|gpt|chatgpt|gemini|dan|admin|administrator|system)\b/i],
  ['role-marker', /(^|\n|\s)(system|assistant|user|human)\s*:\s/i],
  ['chat-markup', /<\|[^|]{0,30}\|>|<\/?(system|assistant|user|instructions?|prompt|im_start|im_end|tool_call|function_call)\b[^>]*>|\[\/?(INST|SYS)\]|###\s*(instruction|system)/i],
  ['template', /\{\{[^}]{0,60}\}\}|\$\{[^}]{0,60}\}/],
  ['jailbreak', /\b(jailbreak|do\s+anything\s+now|developer\s+mode|god\s+mode|prompt\s+injection)\b/i],
  ['tool-call', /\b(call|invoke|run|execute|use)\s+(the\s+)?(tool|function|command|shell|bash|terminal)\b/i],
  ['shell', /(\brm\s+-rf\b|\bcurl\s+-|\bwget\s+http|\bsudo\s|\bchmod\s|\beval\(|\bexec\(|\|\s*(sh|bash)\b)/i],
  ['classify-me', /\b(mark|classify|label|rate|score|set|treat)\s+(this|it|me|the)\s+(\w+\s+){0,2}(as\s+|to\s+)?(accepted|approved|valid|safe|trusted|accept)\b/i],
  ['encoded-blob', /[A-Za-z0-9+/=_-]{60,}/],
  ['zero-width', /[​-‏‪-‮⁠-⁤﻿]/],
];

// Every free-text field of a cleaned contribution.
export function freeText(clean) {
  return [
    clean.assistant, clean.history_basis,
    ...clean.patterns.flatMap((p) => [p.title, p.summary, p.when_used, p.problem_solved]),
    ...clean.tools.flatMap((t) => [t.name, t.used_for]),
  ].filter(Boolean);
}

// Names of the signs found in the text (empty when it looks clean).
export function injectionSigns(texts) {
  const found = new Set();
  for (const t of texts) for (const [name, re] of SIGNS) if (re.test(t)) found.add(name);
  return [...found];
}
