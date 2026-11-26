// Turns stored contributions into the numbers the pages show. Everything is
// computed in memory from the rows in scope; at the sizes this site expects
// (thousands of contributions) that is fast and keeps the logic in one place.
import { catalog, catalogById, MODELS, modelFamily, modelVersion, PURPOSES, PROMPT_RANGES, MONTH_RANGES, ROLES, ROLE_GROUPS, TASK_MINUTE_RANGES, TASK_PROMPT_RANGES, TOKEN_RANGES, LINES_RANGES, COST_RANGES, CONTEXT_RANGES, toolCategory, countryLabel } from './shape.js';

// Below this many contributors a company page shows no results, so nobody can
// be picked out.
export const MIN_GROUP = 5;

export const pct = (n, total) => (total ? Math.round((100 * n) / total) : 0);
export const monthKey = (iso) => iso.slice(0, 7);

// A person (one /u/ page) who contributes again replaces their earlier answer;
// contributions without a page each count once.
export function counted(contribs) {
  const latest = new Map();
  for (const c of contribs) if (c.profile_id != null) latest.set(c.profile_id, c.id);
  return contribs.filter((c) => c.profile_id == null || latest.get(c.profile_id) === c.id);
}

// The site shows current habits, so the headline numbers (shares, medians,
// setups) count only answers from the last RECENT_MONTHS calendar months, this
// one included. The charts over time still show every month. A group with too
// few recent answers to be meaningful (a small company page, a young site)
// falls back to everyone. Whole months, so stored totals (lib/aggregate.js)
// can give the same numbers.
export const RECENT_MONTHS = 3;
export const MIN_RECENT = 20;
export function current(contribs, now = new Date()) {
  const rows = counted(contribs);
  const keys = new Set(lastMonths(RECENT_MONTHS, now).map((m) => m.key));
  const recent = rows.filter((c) => keys.has(monthKey(c.created_at)));
  return recent.length >= MIN_RECENT ? recent : rows;
}

// The most common of several spellings or kinds ([value, count] pairs); a tie
// goes to the one first in alphabetical order, so the answer never depends on
// the order answers arrived in.
export const byCount = (a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]));
export const pickTop = (pairs) => [...pairs].sort(byCount)[0]?.[0];

// The texts said most often ([text, count] pairs), compared without case. Each
// is shown in its most common spelling.
export function topTexts(pairs, n) {
  const groups = new Map();
  for (const [text, count] of pairs) {
    const key = text.trim().toLowerCase();
    const g = groups.get(key) ?? { spellings: new Map(), count: 0 };
    g.count += count;
    g.spellings.set(text.trim(), (g.spellings.get(text.trim()) || 0) + count);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => [pickTop(g.spellings), g.count]).sort(byCount).slice(0, n).map(([text]) => text);
}

// How each coding tool is shown in a setup: its most common name and kind
// among the people who use it. Keys are lower case.
export function devToolLabels(rows) {
  const seen = new Map();
  for (const c of rows) for (const [k, t] of devTools(c)) {
    const m = seen.get(k) ?? new Map();
    const label = `${t.name}\t${t.category}`;
    m.set(label, (m.get(label) || 0) + 1);
    seen.set(k, m);
  }
  return labelsFrom(seen);
}
export const labelsFrom = (seen) => new Map([...seen].map(([k, m]) => {
  const [name, category] = pickTop(m).split('\t');
  return [k, { name, category }];
}));

// The last `n` calendar months, oldest first, as { key: '2026-11', label: 'Nov' }.
export function lastMonths(n = 12, end = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
    out.push({
      key: d.toISOString().slice(0, 7),
      label: d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }),
    });
  }
  return out;
}

// Contributions grouped by the month they were sent, each person once per month.
function byMonth(contribs, months) {
  const groups = new Map(months.map((m) => [m.key, []]));
  for (const c of contribs) groups.get(monthKey(c.created_at))?.push(c);
  return months.map((m) => ({ ...m, items: counted(groups.get(m.key)) }));
}

const hasPattern = (c, id) => c.patterns.some((p) => p.catalog_id === id);
export const toolKey = (name) => name.toLowerCase();

// A quantile of exact values, by nearest rank.
function quantileOf(values, q) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(s.length * q) - 1)];
}
const medianOf = (values) => quantileOf(values, 0.5);

// A quantile of answers given as ranges, assuming answers spread evenly within
// each range (the usual grouped-data quantile), rounded to two significant
// digits. The last range has no upper end, so a quantile that lands in it is
// "that range's start, or more": `open`.
function quantileRange(ranges, ids, q) {
  const n = ids.length;
  if (!n) return null;
  let before = 0;
  for (const r of ranges) {
    const inRange = ids.filter((id) => id === r.id).length;
    if (before + inRange >= n * q && inRange) {
      if (r === ranges.at(-1)) return { value: r.lo, open: true };
      const v = r.lo + ((n * q - before) / inRange) * (r.hi - r.lo);
      const digits = Math.max(0, Math.floor(Math.log10(Math.max(1, v))) - 1);
      return { value: Math.round(v / 10 ** digits) * 10 ** digits, open: false };
    }
    before += inRange;
  }
  return null;
}

export const medianRange = (ranges, ids) => quantileRange(ranges, ids, 0.5)?.value ?? null;

// The 95th and 99th percentile, shown next to a median once enough people
// answered for them to be more than the top answer: 20 and 100.
const MIN_FOR_P95 = 20;
const MIN_FOR_P99 = 100;
const tail = (n, at) => ({ ...(n >= MIN_FOR_P95 && { p95: at(0.95) }), ...(n >= MIN_FOR_P99 && { p99: at(0.99) }) });
export const tailRange = (ranges, ids) => tail(ids.length, (q) => quantileRange(ranges, ids, q));
const tailOf = (values) => tail(values.length, (q) => ({ value: quantileOf(values, q), open: false }));

// ---------- countries ----------

// People who gave no country are grouped under this id.
export const NO_COUNTRY = 'zz';
// How many people contributed from each country, most first.
export function countries(contribs) {
  const tally = new Map();
  for (const c of counted(contribs)) tally.set(c.country ?? NO_COUNTRY, (tally.get(c.country ?? NO_COUNTRY) || 0) + 1);
  return [...tally.entries()]
    .map(([id, count]) => ({ id, label: countryLabel(id), count }))
    .sort((a, b) => (a.id === NO_COUNTRY) - (b.id === NO_COUNTRY) || b.count - a.count || a.label.localeCompare(b.label));
}

// ---------- radar ----------

export function radar(contribs, { months = lastMonths(6) } = {}) {
  const rows = current(contribs);
  const total = rows.length;
  const monthly = byMonth(contribs, months);
  const patterns = catalog.map((p) => {
    const using = rows.filter((c) => hasPattern(c, p.id));
    const statuses = using.flatMap((c) => c.patterns.filter((x) => x.catalog_id === p.id).map((x) => x.status));
    const tally = (s) => statuses.filter((x) => x === s).length;
    const half = statuses.length / 2;
    const status = !statuses.length ? 'active'
      : tally('stopped') + tally('fading') > half ? (tally('stopped') > tally('fading') ? 'stopped' : 'fading')
      : tally('new') > half ? 'new' : 'active';
    return {
      ...p,
      count: using.length,
      share: pct(using.length, total),
      status,
      trend: monthly.map((m) => ({ label: m.label, share: pct(m.items.filter((c) => hasPattern(c, p.id)).length, m.items.length), n: m.items.length })),
    };
  });

  // Habits that matched nothing in the catalog, grouped by title.
  const unmatched = new Map();
  for (const c of rows) {
    for (const p of c.patterns) {
      if (p.catalog_id) continue;
      const key = p.title.toLowerCase();
      const entry = unmatched.get(key) ?? { title: p.title, summary: p.summary, count: 0 };
      entry.count++;
      unmatched.set(key, entry);
    }
  }
  return {
    total,
    patterns: patterns.filter((p) => p.count > 0),
    emerging: [...unmatched.values()].filter((u) => u.count >= 3).sort((a, b) => b.count - a.count).slice(0, 12),
    unmatchedTitles: unmatched,
  };
}

// ---------- tools and purposes ----------

// Popular setups: sets of 2 to 4 dev tools that people use together (chat assistants and
// one-off tools left out). A setup counts everyone whose tools include all of it. Only
// the largest version of a combination is kept unless a smaller one is clearly more common.
export function setups(contribs, { limit = 12, minPeople = 5 } = {}) {
  const rows = current(contribs);
  const total = rows.length;
  const people = rows.map((c) => {
    const names = new Map();
    for (const t of c.tools) {
      const cat = toolCategory(t.name, t.kind);
      if (cat === 'chat' || cat === 'terminal' || cat === 'other') continue;
      names.set(toolKey(t.name), { name: t.name, category: cat });
    }
    return names;
  });
  const counts = new Map();
  for (const names of people) {
    const keys = [...names.keys()].sort().slice(0, 8);
    for (const combo of subsets(keys, 2, 4)) {
      const id = combo.join('|');
      const e = counts.get(id) ?? { keys: combo, count: 0 };
      e.count++;
      counts.set(id, e);
    }
  }
  const min = Math.max(minPeople, Math.ceil(total * 0.03));
  const frequent = [...counts.values()].filter((e) => e.count >= min);
  const isSub = (a, b) => a.length < b.length && a.every((k) => b.includes(k));
  // A setup is three or four tools; pairs only fill in when there are too few of those.
  // Pick the most common first, skipping any that only add one tool to a setup already shown.
  const ranked = [...frequent].sort((a, b) => (b.keys.length >= 3) - (a.keys.length >= 3) || b.count - a.count);
  const kept = [];
  for (const e of ranked) {
    if (kept.length === limit) break;
    if (kept.some((k) => isSub(k.keys, e.keys) || isSub(e.keys, k.keys) || overlap(k.keys, e.keys) >= Math.min(k.keys.length, e.keys.length))) continue;
    kept.push(e);
  }
  kept.sort((a, b) => b.count - a.count);
  const nameOf = new Map();
  for (const names of people) for (const [k, v] of names) if (!nameOf.has(k)) nameOf.set(k, v);
  return {
    total,
    setups: kept.map((e) => {
      const users = people.filter((names) => e.keys.every((k) => names.has(k)));
      const extra = new Map();
      for (const names of users) for (const k of names.keys()) if (!e.keys.includes(k)) extra.set(k, (extra.get(k) || 0) + 1);
      const [addKey, addCount] = [...extra].sort((a, b) => b[1] - a[1])[0] ?? [];
      const tools = e.keys.map((k) => nameOf.get(k)).sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
      return {
        tools,
        count: e.count,
        share: pct(e.count, total),
        // The tool most often added to this setup, when at least a third of its users have it.
        alsoUsed: addKey && addCount >= users.length / 3 ? { name: nameOf.get(addKey).name, share: pct(addCount, users.length) } : null,
      };
    }),
  };
}

// A person's tools, each name once (the first time it is given).
export function firstOfEach(list) {
  const seen = new Set();
  return list.filter((t) => { const k = toolKey(t.name); if (seen.has(k)) return false; seen.add(k); return true; });
}

// A tool's daily share shows once this many of its users said how often they use it.
export const MIN_FREQUENCY = 5;

// Tools as the pages list them, most used first: e has key, name, kind, count,
// uses, and how many of its users said how often (reported) and said daily.
export const toolEntries = (entries, total) => entries
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  .map((e) => ({
    key: e.key,
    name: e.name,
    kind: e.kind,
    category: toolCategory(e.name, e.kind),
    share: pct(e.count, total),
    note: e.uses[0] ?? '',
    // The most common things people said they use it for, up to three.
    uses: e.uses,
    // Of the people who said how often they use it, the share who use it daily.
    daily: e.reported >= MIN_FREQUENCY ? pct(e.daily, e.reported) : null,
  }));

const overlap = (a, b) => a.filter((k) => b.includes(k)).length;
const CATEGORY_ORDER = ['harness', 'editor', 'terminal', 'multiplexer', 'review', 'connector'];

function subsets(items, min, max) {
  const out = [];
  const walk = (start, acc) => {
    if (acc.length >= min) out.push([...acc]);
    if (acc.length === max) return;
    for (let i = start; i < items.length; i++) { acc.push(items[i]); walk(i + 1, acc); acc.pop(); }
  };
  walk(0, []);
  return out;
}

const topUses = (uses, n) => topTexts(uses.map((u) => [u, 1]), n);

export function tools(contribs, { months = lastMonths(12), top = Infinity } = {}) {
  const rows = current(contribs);
  const total = rows.length;
  const monthly = byMonth(contribs, months);

  const names = new Map(); // key -> { name, kind, users, uses }
  for (const c of rows) {
    for (const t of firstOfEach(c.tools)) {
      const key = toolKey(t.name);
      const e = names.get(key) ?? { key, names: new Map(), kinds: new Map(), count: 0, uses: [], reported: 0, daily: 0 };
      e.count++;
      if (t.frequency) e.reported++;
      if (t.frequency === 'daily') e.daily++;
      e.names.set(t.name, (e.names.get(t.name) || 0) + 1);
      e.kinds.set(t.kind ?? '', (e.kinds.get(t.kind ?? '') || 0) + 1);
      if (t.used_for) e.uses.push(t.used_for);
      names.set(key, e);
    }
  }
  const usesTool = (c, key) => c.tools.some((t) => toolKey(t.name) === key);
  const toolList = toolEntries([...names.values()].map((e) => ({ ...e, name: pickTop(e.names), kind: pickTop(e.kinds) || null, uses: topUses(e.uses, 3) })), total)
    .slice(0, top)
    .map((e) => ({ ...e, series: monthly.map((m) => ({ label: m.label, share: pct(m.items.filter((c) => usesTool(c, e.key)).length, m.items.length) })) }))
    .map(({ key, series, ...e }) => ({ ...e, series }));

  const purposeList = PURPOSES.map((p) => {
    const n = rows.filter((c) => c.purposes.includes(p.id)).length;
    return {
      name: p.label,
      kind: 'Purpose',
      share: pct(n, total),
      series: monthly.map((m) => ({ label: m.label, share: pct(m.items.filter((c) => c.purposes.includes(p.id)).length, m.items.length) })),
    };
  }).filter((p) => p.share > 0).sort((a, b) => b.share - a.share);

  const withModels = rows.filter((c) => c.models?.length);
  // One entry per model and version people named ("claude-opus@4.5"), most
  // used first. An answer that gave a family without a version counts under
  // the family alone.
  const modelList = [...new Set(rows.flatMap((c) => c.models ?? []).concat(monthly.flatMap((m) => m.items.flatMap((c) => c.models ?? []))))]
    .map((id) => {
      const family = MODELS.find((x) => x.id === modelFamily(id));
      const version = modelVersion(id);
      if (!family) return null;
      return {
        name: !version ? family.label : family.named ? family.named(version) : `${family.label} ${version}`,
        kind: version ? 'Model' : 'Version not given',
        share: pct(withModels.filter((c) => c.models.includes(id)).length, withModels.length),
        series: monthly.map((m) => { const of = m.items.filter((c) => c.models?.length); return { label: m.label, share: pct(of.filter((c) => c.models.includes(id)).length, of.length) }; }),
      };
    })
    .filter((x) => x && x.share > 0)
    .sort((a, b) => b.share - a.share || a.name.localeCompare(b.name, 'en', { numeric: true }));

  // Contributions per month, stacked by the assistant that sent them.
  const assistantTotals = new Map();
  for (const m of monthly) for (const c of m.items) {
    const a = c.assistant || 'Other';
    assistantTotals.set(a, (assistantTotals.get(a) || 0) + 1);
  }
  const stackNames = [...assistantTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n]) => n);
  const stacks = [...stackNames, 'Other'];
  const perMonth = monthly.map((m) => {
    const counts = stacks.map(() => 0);
    for (const c of m.items) {
      const i = stackNames.indexOf(c.assistant || 'Other');
      counts[i >= 0 ? i : stacks.length - 1]++;
    }
    return { label: m.label, total: m.items.length, counts };
  });

  const perPerson = medianOf(rows.map((c) => c.tools.length).filter(Boolean));
  return { total, tools: toolList, purposes: purposeList, models: modelList, stacks, perMonth, perPerson };
}

// ---------- experience ----------

function distribution(rows, ranges, field) {
  const answered = rows.filter((c) => c[field]);
  return {
    answered: answered.length,
    bins: ranges.map((r) => ({ ...r, share: pct(answered.filter((c) => c[field] === r.id).length, answered.length) })),
    median: medianRange(ranges, answered.map((c) => c[field])),
    open: quantileRange(ranges, answered.map((c) => c[field]), 0.5)?.open ?? false,
    ...tailRange(ranges, answered.map((c) => c[field])),
  };
}

export function experience(contribs, { group = 'all', months = lastMonths(12) } = {}) {
  const roleGroup = ROLE_GROUPS.find((g) => g.id === group) ?? ROLE_GROUPS[0];
  const inGroup = (c) => !roleGroup.roles || roleGroup.roles.includes(c.role);
  const rows = current(contribs);
  const monthly = byMonth(contribs.filter(inGroup), months);
  const withRole = rows.filter((c) => c.role);
  return {
    total: rows.length,
    group: roleGroup,
    prompts: distribution(rows, PROMPT_RANGES, 'prompts_per_month'),
    months: distribution(rows, MONTH_RANGES, 'months_using'),
    overTime: monthly.map((m) => ({ label: m.label, n: m.items.length, median: medianRange(PROMPT_RANGES, m.items.map((c) => c.prompts_per_month).filter(Boolean)) })),
    efficiency: efficiency(rows, monthly),
    roles: ROLES.map((r) => {
      const of = withRole.filter((c) => c.role === r.id);
      return { ...r, share: pct(of.length, withRole.length), median: medianRange(PROMPT_RANGES, of.map((c) => c.prompts_per_month).filter(Boolean)) };
    }).filter((r) => r.share > 0).sort((a, b) => b.share - a.share),
  };
}

// How long tasks take and what they cost, and which habits people call heavy.
function efficiency(rows, monthly) {
  const usersOf = new Map();
  for (const c of rows) {
    for (const p of new Map(c.patterns.filter((x) => x.catalog_id).map((x) => [x.catalog_id, x])).values()) {
      const e = usersOf.get(p.catalog_id) ?? { rated: 0, heavy: 0 };
      if (p.cost) e.rated++;
      if (p.cost === 'heavy') e.heavy++;
      usersOf.set(p.catalog_id, e);
    }
  }
  return {
    minutes: distribution(rows, TASK_MINUTE_RANGES, 'minutes_per_task'),
    prompts: distribution(rows, TASK_PROMPT_RANGES, 'prompts_per_task'),
    tokens: distribution(rows, TOKEN_RANGES, 'tokens_per_month'),
    lines: distribution(rows, LINES_RANGES, 'lines_per_month'),
    cost: distribution(rows, COST_RANGES, 'cost_per_month'),
    context: distribution(rows, CONTEXT_RANGES, 'context_per_request'),
    split: costSplit(rows),
    subagents: subagents(rows),
    costOverTime: monthly.map((m) => ({ label: m.label, median: medianRange(COST_RANGES, m.items.map((c) => c.cost_per_month).filter(Boolean)) })),
    tokensOverTime: monthly.map((m) => ({ label: m.label, median: medianRange(TOKEN_RANGES, m.items.map((c) => c.tokens_per_month).filter(Boolean)) })),
    linesOverTime: monthly.map((m) => ({ label: m.label, median: medianRange(LINES_RANGES, m.items.map((c) => c.lines_per_month).filter(Boolean)) })),
    minutesOverTime: monthly.map((m) => ({ label: m.label, median: medianRange(TASK_MINUTE_RANGES, m.items.map((c) => c.minutes_per_task).filter(Boolean)) })),
    // Only habits at least 5 people rated, so one person's view is not a percentage.
    heavy: [...usersOf.entries()]
      .filter(([, e]) => e.rated >= 5)
      .map(([id, e]) => ({ id, title: catalogById.get(id)?.title ?? id, share: pct(e.heavy, e.rated) }))
      .sort((a, b) => b.share - a.share)
      .slice(0, 8),
  };
}

// Where the cost of the tokens goes, averaged over the people whose assistant
// measured it: reading the conversation again, loading new material, writing.
const MIN_MEASURED = 5;
function costSplit(rows) {
  const of = rows.filter((c) => c.cost_reread != null && c.cost_loaded != null && c.cost_written != null);
  if (of.length < MIN_MEASURED) return null;
  const mean = (field) => of.reduce((sum, c) => sum + c[field], 0) / of.length;
  const reread = Math.round(mean('cost_reread'));
  const loaded = Math.round(mean('cost_loaded'));
  return { answered: of.length, reread, loaded, written: 100 - reread - loaded };
}

// How much of the work subagents do: the share of people who hand them at
// least a twentieth of their tokens, and the median share among those people.
function subagents(rows) {
  const of = rows.filter((c) => c.subagent_share != null);
  if (of.length < MIN_MEASURED) return null;
  const using = of.filter((c) => c.subagent_share >= 5);
  return { answered: of.length, share: pct(using.length, of.length), median: medianOf(using.map((c) => c.subagent_share)), ...tailOf(using.map((c) => c.subagent_share)) };
}

// Where one answer sits among everyone's: the share of people in a lower range.
export function percentile(rows, ranges, field, value) {
  const order = ranges.map((r) => r.id);
  const answered = rows.filter((c) => c[field]);
  const at = order.indexOf(value);
  if (at < 0 || !answered.length) return null;
  const below = answered.filter((c) => order.indexOf(c[field]) < at).length;
  const same = answered.filter((c) => c[field] === value).length;
  return pct(below + same / 2, answered.length);
}

// ---------- the tour: whole setups, stacked shares, one tool ----------

// The tools a person works with, as they count for setups: every tool except
// chat assistants and ones that could not be sorted. Keys are lower case.
export function devTools(c) {
  const names = new Map();
  for (const t of c.tools) {
    const category = toolCategory(t.name, t.kind);
    if (category === 'chat' || category === 'other') continue;
    names.set(toolKey(t.name), { name: t.name, category });
  }
  return names;
}
// The tools that make up a person's setup: the environment they work in (coding
// agent, editor, terminal, multiplexer, review tool). Connectors are left out:
// with them, almost no two people would share a setup.
export function setupTools(c) {
  return new Map([...devTools(c)].filter(([, t]) => t.category !== 'connector'));
}
// Tool names can hold '|' but never control characters (lib/shape.js strips them).
export const SETUP_SEP = '\n';
export const setupKey = (c) => [...setupTools(c).keys()].sort().join(SETUP_SEP);

// Every person's whole setup: the exact set of tools they work with. Each
// person has one, so the shares of all setups add up to 100%. People who named
// no coding tools are counted in `none`.
export function exactSetups(contribs) {
  const rows = current(contribs);
  const counts = new Map();
  for (const c of rows) counts.set(setupKey(c), (counts.get(setupKey(c)) || 0) + 1);
  return setupsFrom(counts, rows.length, devToolLabels(rows));
}
// counts: setup key -> people ('' for no coding tools); labels: devToolLabels.
export function setupsFrom(counts, total, labels) {
  const setups = [...counts].filter(([key]) => key)
    .map(([key, count]) => ({
      key,
      tools: key.split(SETUP_SEP).map((k) => labels.get(k) ?? { name: k, category: 'other' }).sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.name.localeCompare(b.name)),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.tools.length - b.tools.length || a.key.localeCompare(b.key))
    .map((e) => ({ ...e, share: (100 * e.count) / (total || 1) }));
  return { total, none: counts.get('') || 0, setups };
}

// Shares that stack to 100% each month: every person counts once, split evenly
// over the names `pick` gives for them (their model families, say). The `top`
// names overall get their own colour; the rest are "Other".
export function stackedShares(contribs, pick, { months = lastMonths(6), top = 6 } = {}) {
  const monthly = byMonth(contribs, months);
  const weightOf = (items) => {
    const w = new Map();
    let n = 0;
    for (const c of items) {
      const names = [...new Set(pick(c))];
      if (!names.length) continue;
      n++;
      for (const name of names) w.set(name, (w.get(name) || 0) + 1 / names.length);
    }
    return { w, n };
  };
  return stackFrom(monthly.map((m) => ({ ...m, ...weightOf(m.items) })), top);
}
// perMonth: [{ key, label, w: Map(name -> people), n }].
export function stackFrom(perMonth, top) {
  const overall = new Map();
  for (const m of perMonth) for (const [k, v] of m.w) overall.set(k, (overall.get(k) || 0) + v);
  const named = [...overall.entries()].sort(byWeight).map(([name]) => name);
  const names = named.length > top + 1 ? [...named.slice(0, top), 'Other'] : named;
  return {
    names,
    months: perMonth.map(({ key, label, w, n }) => {
      const parts = names.map((name) => (name === 'Other' ? [...w.entries()].filter(([k]) => !names.includes(k)).reduce((s, [, v]) => s + v, 0) : w.get(name) || 0));
      return { key, label, n, parts: parts.map((v) => (n ? (100 * v) / n : 0)) };
    }),
  };
}
// Weights that differ only by rounding count as equal, so the order is the same
// whether they were added up at once or one answer at a time.
const byWeight = (a, b) => (Math.abs(b[1] - a[1]) > 1e-9 ? b[1] - a[1] : String(a[0]).localeCompare(String(b[0])));

// A model as people named it: its family, or family and version.
export function modelName(id) {
  const family = MODELS.find((x) => x.id === modelFamily(id));
  if (!family) return null;
  const version = modelVersion(id);
  return !version ? family.label : family.named ? family.named(version) : `${family.label} ${version}`;
}
export const familyNames = (c) => (c.models ?? []).map((m) => MODELS.find((x) => x.id === modelFamily(m))?.label).filter(Boolean);
export const versionNames = (c) => (c.models ?? []).map(modelName).filter(Boolean);
export const harnessNames = (c) => c.tools.filter((t) => toolCategory(t.name, t.kind) === 'harness').map((t) => t.name);

// One tool: how many people use it, month by month, and what they use it with.
export function toolDetail(contribs, name, { months = lastMonths(6) } = {}) {
  const key = toolKey(name);
  const rows = current(contribs);
  const uses = (c) => c.tools.some((t) => toolKey(t.name) === key);
  const users = rows.filter(uses);
  const together = new Map();
  for (const c of users) for (const k of devTools(c).keys()) if (k !== key) together.set(k, (together.get(k) || 0) + 1);
  return detailFrom({
    total: rows.length,
    count: users.length,
    series: byMonth(contribs, months).map((m) => ({ label: m.label, n: m.items.length, users: m.items.filter(uses).length })),
    together,
    labels: devToolLabels(rows),
    uses: users.flatMap((c) => firstOfEach(c.tools).filter((t) => toolKey(t.name) === key && t.used_for).map((t) => [t.used_for, 1])),
  });
}
// together: tool key -> people who use both; uses: [text, count] pairs.
export const detailFrom = ({ total, count, series, together, labels, uses }) => ({
  total,
  count,
  share: pct(count, total),
  series: series.map((m) => ({ label: m.label, n: m.n, share: pct(m.users, m.n) })),
  with: [...together].sort(byCount).slice(0, 5).map(([k, n]) => ({ ...labels.get(k), n, share: pct(n, count) })),
  uses: topTexts(uses, 3),
});

// How a group differs from everyone: catalog patterns sorted by the difference in share.
export function compare(groupRadar, allRadar) {
  const all = new Map(allRadar.patterns.map((p) => [p.id, p.share]));
  return groupRadar.patterns
    .map((p) => ({ id: p.id, title: p.title, here: p.share, everywhere: all.get(p.id) ?? 0, diff: p.share - (all.get(p.id) ?? 0) }))
    .sort((a, b) => b.diff - a.diff);
}
