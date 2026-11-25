// Turns stored contributions into the numbers the pages show. Everything is
// computed in memory from the rows in scope; at the sizes this site expects
// (thousands of contributions) that is fast and keeps the logic in one place.
import { catalog, catalogById, MODELS, modelFamily, modelVersion, PURPOSES, PROMPT_RANGES, MONTH_RANGES, ROLES, ROLE_GROUPS, TASK_MINUTE_RANGES, TASK_PROMPT_RANGES, TOKEN_RANGES, LINES_RANGES, COST_RANGES, CONTEXT_RANGES, toolCategory, countryLabel } from './shape.js';

// Below this many contributors a company page shows no results, so nobody can
// be picked out.
export const MIN_GROUP = 5;

const pct = (n, total) => (total ? Math.round((100 * n) / total) : 0);
const monthKey = (iso) => iso.slice(0, 7);

// A person (one /u/ page) who contributes again replaces their earlier answer;
// contributions without a page each count once.
export function counted(contribs) {
  const latest = new Map();
  for (const c of contribs) if (c.profile_id != null) latest.set(c.profile_id, c.id);
  return contribs.filter((c) => c.profile_id == null || latest.get(c.profile_id) === c.id);
}

// The site shows current habits, so the headline numbers (shares, medians,
// setups) count only answers from the last RECENT_MONTHS months. The charts
// over time still show every month. A group with too few recent answers to
// be meaningful (a small company page, a young site) falls back to everyone.
export const RECENT_MONTHS = 3;
const MIN_RECENT = 20;
export function current(contribs, now = new Date()) {
  const rows = counted(contribs);
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - RECENT_MONTHS);
  const recent = rows.filter((c) => new Date(c.created_at) >= cutoff);
  return recent.length >= MIN_RECENT ? recent : rows;
}

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
const toolKey = (name) => name.toLowerCase();

function medianOf(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

// A quantile of answers given as ranges, assuming answers spread evenly within
// each range (the usual grouped-data quantile). Rounded to two significant digits.
function quantileRange(ranges, ids, q) {
  const n = ids.length;
  if (!n) return null;
  let before = 0;
  for (const r of ranges) {
    const inRange = ids.filter((id) => id === r.id).length;
    if (before + inRange >= n * q && inRange) {
      const v = r.lo + ((n * q - before) / inRange) * (r.hi - r.lo);
      const digits = Math.max(0, Math.floor(Math.log10(Math.max(1, v))) - 1);
      return { value: Math.round(v / 10 ** digits) * 10 ** digits, range: r };
    }
    before += inRange;
  }
  return null;
}

export const medianRange = (ranges, ids) => quantileRange(ranges, ids, 0.5)?.value ?? null;

// The 95th and 99th percentile, shown next to a median once enough people
// answered for them to mean something. The last range has no upper end, so a
// percentile that lands in it is "that range's start, or more" (`open`).
const MIN_FOR_TAIL = 20;
export function tailRange(ranges, ids) {
  if (ids.length < MIN_FOR_TAIL) return {};
  const at = (q) => {
    const found = quantileRange(ranges, ids, q);
    return found.range === ranges.at(-1) ? { value: found.range.lo, open: true } : { value: found.value, open: false };
  };
  return { p95: at(0.95), p99: at(0.99) };
}

function tailOf(values) {
  if (values.length < MIN_FOR_TAIL) return {};
  const s = [...values].sort((a, b) => a - b);
  const at = (q) => ({ value: s[Math.min(s.length - 1, Math.ceil(s.length * q) - 1)], open: false });
  return { p95: at(0.95), p99: at(0.99) };
}

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

const overlap = (a, b) => a.filter((k) => b.includes(k)).length;
const CATEGORY_ORDER = ['harness', 'editor', 'multiplexer', 'review', 'connector'];

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

function topUses(uses, n) {
  const counts = new Map();
  for (const u of uses) {
    const key = u.trim().toLowerCase();
    const e = counts.get(key) ?? { text: u.trim(), count: 0 };
    e.count++;
    counts.set(key, e);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, n).map((e) => e.text);
}

export function tools(contribs, { months = lastMonths(12), top = Infinity } = {}) {
  const rows = current(contribs);
  const total = rows.length;
  const monthly = byMonth(contribs, months);

  const names = new Map(); // key -> { name, kind, users, uses }
  for (const c of rows) {
    const seen = new Set();
    for (const t of c.tools) {
      const key = toolKey(t.name);
      if (seen.has(key)) continue;
      seen.add(key);
      const e = names.get(key) ?? { key, name: t.name, kinds: {}, count: 0, uses: [] };
      e.count++;
      e.kinds[t.kind] = (e.kinds[t.kind] || 0) + 1;
      if (t.used_for) e.uses.push(t.used_for);
      names.set(key, e);
    }
  }
  const usesTool = (c, key) => c.tools.some((t) => toolKey(t.name) === key);
  const toolList = [...names.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, top)
    .map((e) => ({
      name: e.name,
      kind: Object.entries(e.kinds).sort((a, b) => b[1] - a[1])[0][0],
      category: toolCategory(e.name, Object.entries(e.kinds).sort((a, b) => b[1] - a[1])[0][0]),
      share: pct(e.count, total),
      note: e.uses[0] ?? '',
      // The most common things people said they use it for, up to three.
      uses: topUses(e.uses, 3),
      series: monthly.map((m) => ({ label: m.label, share: pct(m.items.filter((c) => usesTool(c, e.key)).length, m.items.length) })),
    }));

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

// How a group differs from everyone: catalog patterns sorted by the difference in share.
export function compare(groupRadar, allRadar) {
  const all = new Map(allRadar.patterns.map((p) => [p.id, p.share]));
  return groupRadar.patterns
    .map((p) => ({ id: p.id, title: p.title, here: p.share, everywhere: all.get(p.id) ?? 0, diff: p.share - (all.get(p.id) ?? 0) }))
    .sort((a, b) => b.diff - a.diff);
}
