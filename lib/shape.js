// The vocabulary of a contribution: the fixed choices the survey asks for, the
// pattern catalog, and the function that turns an untrusted submission into a
// clean record.
import fs from 'node:fs';

export const QUADRANTS = [
  { id: 'brief', label: 'Brief', blurb: 'What you hand over before it starts' },
  { id: 'steer', label: 'Steer', blurb: 'How the work is split and directed' },
  { id: 'check', label: 'Check', blurb: 'How you decide to trust the result' },
  { id: 'delegate', label: 'Delegate', blurb: 'What you let it do on its own' },
];
export const FREQUENCIES = ['daily', 'weekly', 'occasionally'];
export const STATUSES = ['active', 'new', 'fading', 'stopped'];
export const COSTS = ['light', 'medium', 'heavy'];
// 'assistant', 'extension' and 'model' are what the survey asked for at first; older answers still carry them.
export const TOOL_KINDS = ['harness', 'chat', 'editor', 'terminal', 'multiplexer', 'review', 'connector', 'other', 'assistant', 'extension', 'model'];

// How the tools page groups tools. Known tools name their category in data/tools.json;
// anything else falls back on the kind the assistant reported.
export const TOOL_CATEGORIES = [
  { id: 'harness', label: 'Coding harnesses' },
  { id: 'chat', label: 'Chat assistants' },
  { id: 'editor', label: 'Editors and extensions' },
  { id: 'terminal', label: 'Terminals' },
  { id: 'multiplexer', label: 'Multiplexers and agent managers' },
  { id: 'review', label: 'Review tools' },
  { id: 'connector', label: 'Connectors and automation' },
  { id: 'other', label: 'Other' },
];
const CATEGORY_BY_KIND = { harness: 'harness', chat: 'chat', terminal: 'terminal', multiplexer: 'multiplexer', assistant: 'chat', model: 'chat', editor: 'editor', extension: 'editor', connector: 'connector', review: 'review', other: 'other' };

export const PURPOSES = [
  { id: 'writing-code', label: 'Writing code' },
  { id: 'debugging', label: 'Debugging' },
  { id: 'research', label: 'Research and learning' },
  { id: 'planning', label: 'Planning and specs' },
  { id: 'code-review', label: 'Code review' },
  { id: 'writing', label: 'Writing and docs' },
  { id: 'data', label: 'Data and analysis' },
  { id: 'design', label: 'Design and UI' },
  { id: 'operations', label: 'Operations and incidents' },
];

// Model families, as a fixed list: the survey sends ids, never free text. A
// version may follow the id after an @ ("claude-opus@4.5"): digits and dots,
// with at most one letter at the end ("4o"), so it cannot carry text either.
export const MODEL_VERSION = /^\d{1,2}(\.\d{1,2})?[a-z]?$/;
export const modelFamily = (m) => m.split('@')[0];
export const modelVersion = (m) => m.split('@')[1] ?? null;
export const MODELS = [
  { id: 'claude-fable', label: 'Claude Fable' },
  { id: 'claude-opus', label: 'Claude Opus' },
  { id: 'claude-sonnet', label: 'Claude Sonnet' },
  { id: 'claude-haiku', label: 'Claude Haiku' },
  { id: 'gpt', label: 'GPT' },
  { id: 'openai-reasoning', label: 'OpenAI o-series', named: (v) => `OpenAI o${v}` },
  { id: 'gemini-pro', label: 'Gemini Pro' },
  { id: 'gemini-flash', label: 'Gemini Flash' },
  { id: 'grok', label: 'Grok' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'qwen', label: 'Qwen' },
  { id: 'mistral', label: 'Mistral' },
  { id: 'llama', label: 'Llama' },
  { id: 'local', label: 'Other local or open models' },
  { id: 'other', label: 'Other hosted models' },
];

// Ranges, not exact numbers: an exact count is closer to identifying someone.
// Medians are interpolated within the range that holds the middle answer (lo to hi).
export const PROMPT_RANGES = [
  { id: '<100', label: 'under 100', mid: 50, lo: 0, hi: 100 },
  { id: '100-300', label: '100–300', mid: 200, lo: 100, hi: 300 },
  { id: '300-600', label: '300–600', mid: 450, lo: 300, hi: 600 },
  { id: '600-1k', label: '600–1k', mid: 800, lo: 600, hi: 1000 },
  { id: '1k-3k', label: '1k–3k', mid: 2000, lo: 1000, hi: 3000 },
  { id: '3k+', label: '3k+', mid: 4000, lo: 3000, hi: 6000 },
];
export const MONTH_RANGES = [
  { id: '<3', label: 'under 3', mid: 2, lo: 0, hi: 3 },
  { id: '3-6', label: '3–6', mid: 4.5, lo: 3, hi: 6 },
  { id: '6-12', label: '6–12', mid: 9, lo: 6, hi: 12 },
  { id: '12-24', label: '1–2 y', mid: 18, lo: 12, hi: 24 },
  { id: '24-36', label: '2–3 y', mid: 30, lo: 24, hi: 36 },
  { id: '36+', label: '3 y+', mid: 42, lo: 36, hi: 60 },
];
// Effort, also as ranges.
export const TASK_MINUTE_RANGES = [
  { id: '<5', label: 'under 5', lo: 0, hi: 5 },
  { id: '5-15', label: '5–15', lo: 5, hi: 15 },
  { id: '15-30', label: '15–30', lo: 15, hi: 30 },
  { id: '30-60', label: '30–60', lo: 30, hi: 60 },
  { id: '60-120', label: '1–2 h', lo: 60, hi: 120 },
  { id: '120+', label: '2 h+', lo: 120, hi: 240 },
];
export const TASK_PROMPT_RANGES = [
  { id: '1-2', label: '1–2', lo: 1, hi: 2 },
  { id: '3-5', label: '3–5', lo: 3, hi: 5 },
  { id: '6-10', label: '6–10', lo: 6, hi: 10 },
  { id: '11-20', label: '11–20', lo: 11, hi: 20 },
  { id: '20+', label: '20+', lo: 20, hi: 40 },
];
export const TOKEN_RANGES = [
  { id: '<10M', label: 'under 10M', lo: 0, hi: 10e6 },
  { id: '10M-100M', label: '10–100M', lo: 10e6, hi: 100e6 },
  { id: '100M-1B', label: '0.1–1B', lo: 100e6, hi: 1e9 },
  { id: '1B-10B', label: '1–10B', lo: 1e9, hi: 10e9 },
  { id: '10B+', label: '10B+', lo: 10e9, hi: 40e9 },
];
// What the model takes in on a typical request: the conversation so far, read
// again on every turn, plus whatever is new.
export const CONTEXT_RANGES = [
  { id: '<20k', label: 'under 20k', lo: 0, hi: 20e3 },
  { id: '20k-50k', label: '20–50k', lo: 20e3, hi: 50e3 },
  { id: '50k-100k', label: '50–100k', lo: 50e3, hi: 100e3 },
  { id: '100k-200k', label: '100–200k', lo: 100e3, hi: 200e3 },
  { id: '200k-500k', label: '200–500k', lo: 200e3, hi: 500e3 },
  { id: '500k+', label: '500k+', lo: 500e3, hi: 1e6 },
];
// What LLM use costs a month, in US dollars: subscriptions plus metered usage.
export const COST_RANGES = [
  { id: '<20', label: 'under $20', lo: 0, hi: 20 },
  { id: '20-100', label: '$20–100', lo: 20, hi: 100 },
  { id: '100-200', label: '$100–200', lo: 100, hi: 200 },
  { id: '200-500', label: '$200–500', lo: 200, hi: 500 },
  { id: '500-2k', label: '$500–2k', lo: 500, hi: 2000 },
  { id: '2k+', label: '$2k+', lo: 2000, hi: 6000 },
];
// Lines of code the assistant wrote that were kept, a month.
export const LINES_RANGES = [
  { id: '<1k', label: 'under 1k', lo: 0, hi: 1000 },
  { id: '1k-5k', label: '1–5k', lo: 1000, hi: 5000 },
  { id: '5k-20k', label: '5–20k', lo: 5000, hi: 20000 },
  { id: '20k-50k', label: '20–50k', lo: 20000, hi: 50000 },
  { id: '50k-200k', label: '50–200k', lo: 50000, hi: 200000 },
  { id: '200k+', label: '200k+', lo: 200000, hi: 500000 },
];

export const ROLES = [
  { id: 'backend', label: 'Backend developer' },
  { id: 'frontend', label: 'Frontend developer' },
  { id: 'fullstack', label: 'Full-stack developer' },
  { id: 'mobile', label: 'Mobile developer' },
  { id: 'data', label: 'Data and ML' },
  { id: 'devops', label: 'DevOps and platform' },
  { id: 'design', label: 'Design' },
  { id: 'product', label: 'Product' },
  { id: 'manager', label: 'Engineering manager' },
  { id: 'other', label: 'Other' },
];
// Role groups for the experience filter.
export const ROLE_GROUPS = [
  { id: 'all', label: 'Everyone', roles: null },
  { id: 'developers', label: 'Developers', roles: ['backend', 'frontend', 'fullstack', 'mobile', 'devops'] },
  { id: 'design', label: 'Designers', roles: ['design'] },
  { id: 'product', label: 'Product and managers', roles: ['product', 'manager'] },
  { id: 'data', label: 'Data', roles: ['data'] },
];

// Countries: every ISO code, with an outline for the map where there is one
// (data/world.json, built by scripts/build-map.js). The survey sends the code only.
export const WORLD = JSON.parse(fs.readFileSync(new URL('../data/world.json', import.meta.url), 'utf8'));
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
export const COUNTRIES = WORLD.countries.map((c) => ({ ...c, label: regionNames.of(c.id.toUpperCase()) ?? c.id.toUpperCase() }));
export const countryLabel = (id) => COUNTRIES.find((c) => c.id === id)?.label ?? 'Not given';

const CATALOG_URL = new URL('../data/catalog.json', import.meta.url);
export const catalog = JSON.parse(fs.readFileSync(CATALOG_URL, 'utf8')).patterns;
export const catalogById = new Map(catalog.map((p) => [p.id, p]));

export const labelOf = (list, id) => list.find((x) => x.id === id)?.label ?? id;

// ---------- cleaning a submission ----------

export class InputError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const CONTROL = /[\u0000-\u001f\u007f]/g;
const str = (v, max) => (typeof v === 'string' ? v.replace(CONTROL, ' ').trim().slice(0, max) : '');
const pick = (v, allowed) => {
  const s = str(v, 40).toLowerCase();
  return allowed.includes(s) ? s : '';
};
// Range ids contain capitals (10M-100M): match without case, return the id as listed.
const pickRange = (v, ranges) => ranges.find((r) => r.id.toLowerCase() === str(v, 20).toLowerCase())?.id ?? null;
const ids = (list) => list.map((x) => x.id);
// A whole percentage, or null. Numbers only: a string is not read as one.
const percent = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v) : null);
// Where the cost of the tokens goes, as three percentages that add up to 100
// (give or take rounding). Anything else is dropped whole.
function costSplit(v) {
  const s = v && typeof v === 'object' ? { reread: percent(v.reread), loaded: percent(v.loaded), written: percent(v.written) } : {};
  const sum = s.reread + s.loaded + s.written;
  return Object.values(s).length === 3 && !Object.values(s).includes(null) && sum >= 98 && sum <= 102 ? s : null;
}

// Things that should never be in a submission. The prompt asks the assistant to
// remove them; this is the server's second line.
const LEAKS = [
  /https?:\/\/\S+/gi,
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,
  /(?:~|\/Users|\/home|[A-Z]:\\)[^\s,;)]*/g,
  /\b(?:sk|pk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{10,}\b/g,
];
const scrub = (s) => LEAKS.reduce((acc, re) => acc.replace(re, '[removed]'), s);
const text = (v, max) => scrub(str(v, max));

// Known tools (data/tools.json): canonical names and the links shown for them.
const TOOLS_URL = new URL('../data/tools.json', import.meta.url);
const knownTools = JSON.parse(fs.readFileSync(TOOLS_URL, 'utf8')).tools;
const toolIndex = new Map();
for (const t of knownTools) for (const key of [t.name, ...t.aliases]) toolIndex.set(key.toLowerCase(), t);

export function toolName(raw) {
  const s = str(raw, 80);
  return toolIndex.get(s.toLowerCase())?.name ?? s;
}

// The link a tool name opens: its own site if known, otherwise a web search.
// Generic descriptions ("an in-house deploy script") get no link.
export function toolUrl(name) {
  const known = toolIndex.get(String(name).toLowerCase());
  if (known) return known.url;
  if (/^(a|an|the|our|my|some)\s/i.test(name) || /\[removed\]/.test(name)) return null;
  return `https://duckduckgo.com/?q=${encodeURIComponent(name)}`;
}

export function toolCategory(name, kind) {
  return toolIndex.get(String(name).toLowerCase())?.category ?? CATEGORY_BY_KIND[kind] ?? 'other';
}

// What the site says about a tool in its details: one sentence, if it is a known tool.
export function toolAbout(name) {
  return toolIndex.get(String(name).toLowerCase())?.about ?? '';
}

export function cleanContribution(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new InputError('Expected a JSON object.');
  }
  if (!Array.isArray(input.patterns)) throw new InputError('Expected a "patterns" array.');

  const patterns = input.patterns
    .filter((p) => p && typeof p === 'object')
    // Every known pattern (16 of them) and eight of the person's own, with room to spare.
    .slice(0, 32)
    .map((p) => {
      const match = str(p.catalog_id, 60).toLowerCase();
      const known = catalogById.get(match);
      return {
        catalog_id: known ? known.id : null,
        title: text(p.title, 80),
        summary: text(p.summary, 240),
        when_used: text(p.when_used, 240),
        problem_solved: text(p.problem_solved, 240),
        quadrant: known ? known.quadrant : pick(p.quadrant, ids(QUADRANTS)) || null,
        frequency: pick(p.frequency, FREQUENCIES) || null,
        status: pick(p.status, STATUSES) || 'active',
        cost: pick(p.cost, COSTS) || null,
      };
    })
    .filter((p) => p.title && p.summary);
  if (!patterns.length) throw new InputError('Each pattern needs a "title" and a "summary".');

  const tools = (Array.isArray(input.tools) ? input.tools : [])
    .filter((t) => t && typeof t === 'object')
    .slice(0, 15)
    .map((t) => ({
      name: scrub(toolName(t.name)),
      kind: pick(t.kind, TOOL_KINDS) || 'other',
      used_for: text(t.used_for, 160),
    }))
    .filter((t) => t.name && t.name !== '[removed]');

  const purposes = [...new Set((Array.isArray(input.purposes) ? input.purposes : []).map((p) => pick(p, ids(PURPOSES))))]
    .filter(Boolean);

  const model = (m) => {
    const [family, version] = str(m, 60).toLowerCase().split('@');
    const id = pick(family, ids(MODELS));
    return id && version && MODEL_VERSION.test(version) ? `${id}@${version}` : id;
  };
  const models = [...new Set((Array.isArray(input.models) ? input.models : []).slice(0, 30).map(model))]
    .filter(Boolean);

  const exp = input.experience && typeof input.experience === 'object' ? input.experience : {};
  const eff = input.efficiency && typeof input.efficiency === 'object' ? input.efficiency : {};
  return {
    assistant: toolName(input.assistant),
    role: pick(input.role, ids(ROLES)) || null,
    country: pick(input.country, ids(COUNTRIES)) || null,
    history_basis: text(input.history_basis, 240),
    prompts_per_month: pick(exp.prompts_per_month, ids(PROMPT_RANGES)) || null,
    months_using: pick(exp.months_using, ids(MONTH_RANGES)) || null,
    minutes_per_task: pick(eff.minutes_per_task, ids(TASK_MINUTE_RANGES)) || null,
    prompts_per_task: pick(eff.prompts_per_task, ids(TASK_PROMPT_RANGES)) || null,
    tokens_per_month: pickRange(eff.tokens_per_month, TOKEN_RANGES),
    lines_per_month: pickRange(eff.lines_per_month, LINES_RANGES),
    cost_per_month: pickRange(eff.cost_per_month, COST_RANGES),
    context_per_request: pickRange(eff.context_per_request, CONTEXT_RANGES),
    cost_split: costSplit(eff.cost_split),
    subagent_share: percent(eff.subagent_share),
    patterns,
    tools,
    purposes,
    models,
  };
}
