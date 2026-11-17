// Fills the database with invented contributions so the pages have something
// to show during development. Usage: npm run seed [-- --count 300] [-- --reset]
import { openDb } from '../lib/db.js';
import { cleanContribution, catalog, PURPOSES, PROMPT_RANGES, MONTH_RANGES, ROLES, TASK_MINUTE_RANGES, TASK_PROMPT_RANGES, TOKEN_RANGES, LINES_RANGES, COST_RANGES } from '../lib/shape.js';

const args = process.argv.slice(2);
const count = Number(args[args.indexOf('--count') + 1]) || 300;
const store = await openDb();
if (args.includes('--reset')) await store.deleteAllContributions();

// A fixed sequence so every run produces the same data.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const chance = (p) => rand() < p;
const pickOne = (list, weights) => {
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) if ((r -= weights[i]) < 0) return list[i];
  return list.at(-1);
};

const share = {
  'paste-the-evidence': 0.72, 'standing-instructions': 0.61, 'screenshot-as-brief': 0.34, 'numbered-punch-list': 0.18,
  'plan-before-code': 0.58, 'clean-slate': 0.35, 'options-then-pick': 0.27, 'parallel-agents': 0.12,
  'diff-review-gate': 0.49, 'tests-as-proof': 0.44, 'second-reviewer': 0.21, 'blind-accept': 0.06,
  'hands-on-git': 0.41, 'saved-prompts': 0.38, 'tool-bridge': 0.24, 'session-handoff': 0.09,
};
const status = { 'parallel-agents': 'new', 'second-reviewer': 'new', 'tool-bridge': 'new', 'numbered-punch-list': 'new', 'blind-accept': 'stopped', 'session-handoff': 'fading' };
// How heavy each habit tends to be: weights for light, medium, heavy.
const cost = { 'parallel-agents': [1, 2, 7], 'second-reviewer': [1, 4, 5], 'plan-before-code': [2, 5, 3], 'tests-as-proof': [2, 5, 3], 'numbered-punch-list': [3, 4, 3], 'paste-the-evidence': [6, 3, 1] };
const extras = [
  ['Comments From The Diff', 'check', 'Leaves review comments in a diff viewer and hands them back as one batch.'],
  ['Throwaway Prototype First', 'steer', 'Has the agent build a disposable version, deletes it, then specs the real one.'],
  ['Voice Notes As Brief', 'brief', 'Dictates a rambling brief and lets the assistant structure it.'],
];
const assistants = ['Claude Code', 'Cursor', 'ChatGPT', 'GitHub Copilot', 'Codex CLI', 'Gemini CLI'];
const toolPool = [
  ['Claude Code', 'assistant', 'building features end to end in the terminal', 0.58],
  ['ChatGPT', 'assistant', 'research, explanations, first drafts', 0.44],
  ['Cursor', 'editor', 'edits inside the file being looked at', 0.37],
  ['MCP connectors', 'connector', 'reading tickets, chat threads and error logs', 0.33],
  ['GitHub Copilot', 'extension', 'autocomplete while typing', 0.26],
  ['a review bot', 'review', 'a second pass on pull requests', 0.17],
  ['Codex CLI', 'assistant', 'long-running tasks in the background', 0.14],
  ['agent-browser', 'extension', 'letting the agent test its own UI', 0.12],
  ['Gemini', 'assistant', 'long documents and second opinions', 0.11],
  ['tmux', 'other', 'one session per task, side by side', 0.19],
  ['Diffity', 'review', 'reading and commenting on every diff', 0.13],
  ['cmux', 'other', 'many agents in parallel, with a ping when one needs you', 0.11],
  ['T3 Code', 'assistant', 'one window over several coding agents', 0.08],
  ['Windsurf', 'editor', 'edits with an agent in the editor', 0.05],
  ['an in-house deploy script', 'other', 'shipping after review', 0.04],
];
const purposeShare = [0.81, 0.64, 0.47, 0.41, 0.38, 0.35, 0.19, 0.14, 0.12];

const companies = [await store.createCompany({ name: 'Example Inc' }), await store.createCompany({ name: null })];
// Model families and how common each is at the start and the end of the year.
const modelPool = [['claude-opus', 0.25, 0.5], ['claude-sonnet', 0.6, 0.55], ['claude-haiku', 0.1, 0.2], ['claude-fable', 0, 0.25], ['gpt', 0.5, 0.4], ['openai-reasoning', 0.2, 0.1], ['gemini-pro', 0.15, 0.25], ['gemini-flash', 0.05, 0.12], ['local', 0.04, 0.08]];
const now = Date.now();

for (let i = 0; i < count; i++) {
  // More contributions recently, with a jump in the last two months.
  const daysAgo = Math.floor(Math.pow(rand(), 2.2) * 360);
  const createdAt = new Date(now - daysAgo * 864e5 - rand() * 864e5).toISOString();
  const grow = 1 - daysAgo / 720;
  const patterns = catalog.filter((p) => chance(share[p.id] * (status[p.id] === 'new' ? grow : 1))).map((p) => ({
    title: p.title, catalog_id: p.id, summary: p.summary,
    frequency: pickOne(['daily', 'weekly', 'occasionally'], [5, 3, 2]),
    status: status[p.id] && chance(0.7) ? status[p.id] : 'active',
    cost: pickOne(['light', 'medium', 'heavy'], cost[p.id] ?? [5, 4, 1]),
  }));
  if (chance(0.12)) {
    const [title, quadrant, summary] = extras[Math.floor(rand() * extras.length)];
    patterns.push({ title, quadrant, summary, catalog_id: null, status: 'new' });
  }
  if (!patterns.length) patterns.push({ title: 'Paste The Evidence', catalog_id: 'paste-the-evidence', summary: 'Pastes raw errors.' });
  const assistant = pickOne(assistants, [6, 2, 1.5, 1, 0.8, 0.5]);
  const tools = toolPool.filter(([name, , , s]) => name === assistant || chance(s)).map(([name, kind, used_for]) => ({ name, kind, used_for }));
  const role = pickOne(ROLES.map((r) => r.id), [31, 14, 22, 3, 9, 4, 8, 7, 6, 3]);
  const heavy = role === 'product' || role === 'manager' || role === 'design' ? 0 : 1;
  const raw = {
    assistant,
    role: chance(0.9) ? role : undefined,
    history_basis: 'seed data',
    experience: {
      prompts_per_month: pickOne(PROMPT_RANGES.map((r) => r.id), heavy ? [6, 14, 20, 22, 25, 13] : [18, 30, 25, 15, 9, 3]),
      months_using: pickOne(MONTH_RANGES.map((r) => r.id), [8, 14, 24, 31, 16, 7]),
    },
    // Tasks get shorter over the year; heavy users process more tokens.
    efficiency: {
      minutes_per_task: chance(0.85) ? pickOne(TASK_MINUTE_RANGES.map((r) => r.id), daysAgo > 180 ? [6, 18, 28, 26, 14, 8] : [14, 30, 27, 17, 8, 4]) : undefined,
      prompts_per_task: chance(0.85) ? pickOne(TASK_PROMPT_RANGES.map((r) => r.id), [8, 30, 34, 20, 8]) : undefined,
      tokens_per_month: chance(0.6) ? pickOne(TOKEN_RANGES.map((r) => r.id), heavy ? (daysAgo > 180 ? [14, 30, 34, 18, 4] : [6, 18, 34, 30, 12]) : [30, 36, 24, 8, 2]) : undefined,
      lines_per_month: heavy && chance(0.7) ? pickOne(LINES_RANGES.map((r) => r.id), daysAgo > 180 ? [20, 34, 28, 12, 5, 1] : [8, 24, 32, 20, 12, 4]) : undefined,
      cost_per_month: chance(0.65) ? pickOne(COST_RANGES.map((r) => r.id), daysAgo > 180 ? [22, 44, 18, 10, 5, 1] : [10, 34, 24, 18, 11, 3]) : undefined,
    },
    models: modelPool.filter(([, then, today]) => chance(today + (then - today) * (daysAgo / 360))).map(([id]) => id),
    purposes: PURPOSES.filter((_, k) => chance(purposeShare[k])).map((p) => p.id),
    patterns,
    tools,
  };
  const companyId = chance(0.08) ? companies[0].id : chance(0.01) ? companies[1].id : null;
  // Seed data counts straight away, as if it had been reviewed.
  const profile = await store.createProfile();
  await store.addContribution(cleanContribution(raw), { profileId: profile.id, companyId, createdAt: new Date(createdAt), status: 'accepted' });
}

console.log(`Added ${count} contributions. Company pages: ${companies.map((c) => `/c/${c.id}`).join(', ')}`);
await store.close();
