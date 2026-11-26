// Storage: PostgreSQL through the `postgres` driver (no other dependencies).
import fs from 'node:fs';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { VERSION as TOTALS_VERSION, desired, plan, changes, foldAll, personOf, splitCell, cellKey } from './aggregate.js';

const SCHEMA = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
// Unbiased random ids from a 36-character alphabet.
export function randomCode(length) {
  let out = '';
  while (out.length < length) {
    for (const b of crypto.randomBytes(length * 2)) {
      if (b < 252 && out.length < length) out += ALPHABET[b % 36];
    }
  }
  return out;
}

// Unused prompts expire after two days.
export const WAIT_TTL_MS = 2 * 864e5;
const iso = (d) => (d instanceof Date ? d.toISOString() : d);

export async function openDb(url = process.env.DATABASE_URL || 'postgres://localhost/llmpatterns') {
  const sql = postgres(url, { max: 10, onnotice: () => {} });
  await sql.unsafe(SCHEMA);
  const store = makeStore(sql);
  // First start, or what an answer adds has changed: count everything again.
  const state = await store.totalsState();
  if (!state || state.version !== TOTALS_VERSION) await store.rebuildTotals();
  return store;
}

// Rebuilding takes this lock alone; folding one person shares it.
const TOTALS_LOCK = 4207;

function makeStore(sql) {
  // `preferred`: an id reserved earlier (see waits.reserved_id); used if it is still free.
  async function insertUnique(table, length, fields, preferred = null) {
    for (let i = 0; i < 5; i++) {
      const id = i === 0 && preferred ? preferred : randomCode(length);
      const [row] = await sql`INSERT INTO ${sql(table)} ${sql({ id, ...fields })} ON CONFLICT (id) DO NOTHING RETURNING *`;
      if (row) return row;
    }
    throw new Error('Could not create a unique id.');
  }

  // Attach patterns, tools and purposes to contribution rows.
  async function hydrate(rows, q = sql) {
    if (!rows.length) return [];
    const byId = new Map(rows.map((r) => [String(r.id), { ...r, id: Number(r.id), created_at: iso(r.created_at), patterns: [], tools: [], purposes: [], models: [] }]));
    const ids = rows.map((r) => r.id);
    const [patterns, tools, purposes, models] = await Promise.all([
      q`SELECT * FROM contribution_patterns WHERE contribution_id = ANY(${ids}) ORDER BY contribution_id, position`,
      q`SELECT * FROM contribution_tools WHERE contribution_id = ANY(${ids})`,
      q`SELECT * FROM contribution_purposes WHERE contribution_id = ANY(${ids})`,
      q`SELECT * FROM contribution_models WHERE contribution_id = ANY(${ids})`,
    ]);
    for (const p of patterns) byId.get(String(p.contribution_id)).patterns.push(p);
    for (const t of tools) byId.get(String(t.contribution_id)).tools.push(t);
    for (const u of purposes) byId.get(String(u.contribution_id)).purposes.push(u.purpose);
    for (const m of models) byId.get(String(m.contribution_id)).models.push(m.model);
    return [...byId.values()];
  }

  // ---------- stored totals (lib/aggregate.js) ----------

  // Adds up cell changes: Map(cellKey -> change).
  async function applyCells(tx, cells) {
    const rows = [...cells].map(([k, value]) => ({ ...splitCell(k), value }));
    for (let i = 0; i < rows.length; i += 5000) {
      await tx`INSERT INTO aggregates ${tx(rows.slice(i, i + 5000))}
        ON CONFLICT (scope, kind, month, metric, key) DO UPDATE SET value = aggregates.value + EXCLUDED.value`;
    }
    const scopes = [...new Set(rows.map((r) => r.scope))];
    if (scopes.length) await tx`DELETE FROM aggregates WHERE scope = ANY(${scopes}) AND abs(value) < 1e-9`;
  }

  // Brings one person's part of the totals up to date with their accepted answers.
  async function fold(tx, person) {
    await tx`SELECT pg_advisory_xact_lock_shared(${TOTALS_LOCK})`;
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`fold:${person}`}))`;
    const id = person.slice(2);
    const rows = person.startsWith('p:')
      ? await tx`SELECT * FROM contributions WHERE profile_id = ${id} AND status = 'accepted' ORDER BY id`
      : await tx`SELECT * FROM contributions WHERE id = ${id} AND profile_id IS NULL AND status = 'accepted'`;
    const have = await tx`SELECT * FROM folded WHERE person = ${person}`;
    const p = plan(desired(await hydrate(rows, tx)), have);
    if (!p.add.length && !p.remove.length) return;
    await applyCells(tx, changes(p));
    for (const f of p.remove) await tx`DELETE FROM folded WHERE person = ${person} AND scope = ${f.scope} AND kind = ${f.kind} AND month = ${f.month}`;
    if (p.add.length) {
      await tx`INSERT INTO folded ${tx(p.add.map((f) => ({ person, scope: f.scope, kind: f.kind, month: f.month, contribution_id: f.id, delta: tx.json(f.delta) })))}
        ON CONFLICT (person, scope, kind, month) DO UPDATE SET contribution_id = EXCLUDED.contribution_id, delta = EXCLUDED.delta`;
    }
    await tx`UPDATE aggregate_state SET folds = folds + 1, folded_at = now()`;
  }
  // The person an answer belongs to (null if it does not exist).
  const personFor = async (tx, id) => {
    const [c] = await tx`SELECT id, profile_id FROM contributions WHERE id = ${id}`;
    return c ? personOf(c) : null;
  };
  async function foldAnswer(tx, id, change) {
    const person = await personFor(tx, id);
    await change();
    if (person) await fold(tx, person);
  }

  return {
    sql,
    close: () => sql.end({ timeout: 5 }),

    // ---------- stored totals ----------
    totalsState: async () => (await sql`SELECT * FROM aggregate_state WHERE id = 1`)[0] ?? null,
    // The cells of one scope ('all' or 'c:<company id>').
    totals: (scope) => sql`SELECT kind, month, metric, key, value FROM aggregates WHERE scope = ${scope}`,
    // Counts everything again from the accepted answers.
    async rebuildTotals() {
      const started = Date.now();
      await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(${TOTALS_LOCK})`;
        const answers = await hydrate(await tx`SELECT * FROM contributions WHERE status = 'accepted' ORDER BY id`, tx);
        const { folded, cells } = foldAll(answers);
        await tx`DELETE FROM aggregates`;
        await tx`DELETE FROM folded`;
        await applyCells(tx, cells);
        const rows = folded.map((f) => ({ person: f.person, scope: f.scope, kind: f.kind, month: f.month, contribution_id: f.id, delta: tx.json(f.delta) }));
        for (let i = 0; i < rows.length; i += 5000) await tx`INSERT INTO folded ${tx(rows.slice(i, i + 5000))}`;
        await tx`INSERT INTO aggregate_state (id, version, rebuilt_at, rebuild_ms) VALUES (1, ${TOTALS_VERSION}, now(), ${Date.now() - started})
          ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, rebuilt_at = now(), rebuild_ms = ${Date.now() - started}`;
      });
    },
    // Compares the stored totals with counting everything again, without changing them.
    async checkTotals() {
      const answers = await hydrate(await sql`SELECT * FROM contributions WHERE status = 'accepted' ORDER BY id`);
      const { folded, cells } = foldAll(answers);
      const stored = new Map((await sql`SELECT * FROM aggregates`).map((r) => [cellKey(r.scope, r.kind, r.month, r.metric, r.key), Number(r.value)]));
      const keys = new Set([...cells.keys(), ...stored.keys()]);
      const differ = [...keys].filter((k) => Math.abs((cells.get(k) || 0) - (stored.get(k) || 0)) > 1e-6).map((k) => ({ ...splitCell(k), stored: stored.get(k) || 0, counted: cells.get(k) || 0 }));
      const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM folded`;
      return { answers: answers.length, people: new Set(answers.map(personOf)).size, cells: stored.size, folds: n, expectedFolds: folded.length, differ };
    },

    // ---------- profiles and companies ----------
    createProfile: ({ name = null, passwordHash = null, id = null } = {}) => insertUnique('profiles', 10, { name, password_hash: passwordHash }, id),
    profile: async (id) => (await sql`SELECT * FROM profiles WHERE id = ${String(id)}`)[0] ?? null,
    updateProfile: (id, fields) => sql`UPDATE profiles SET ${sql(fields)} WHERE id = ${id}`,
    deleteProfile: (id) => sql.begin(async (tx) => {
      await tx`DELETE FROM profiles WHERE id = ${id}`;
      await fold(tx, `p:${id}`);
    }),
    // The code of a profile's invitation link, made the first time it is asked for.
    async inviteCode(id) {
      const [row] = await sql`UPDATE profiles SET invite_code = COALESCE(invite_code, ${randomCode(12)}) WHERE id = ${id} RETURNING invite_code`;
      return row?.invite_code ?? null;
    },
    profileByInvite: async (code) => (typeof code === 'string' && /^[a-z0-9]{12}$/.test(code)
      ? (await sql`SELECT * FROM profiles WHERE invite_code = ${code}`)[0] ?? null : null),

    createCompany: ({ name = null, passwordHash = null } = {}) => insertUnique('companies', 8, { name, password_hash: passwordHash }),
    company: async (id) => (await sql`SELECT * FROM companies WHERE id = ${String(id)}`)[0] ?? null,
    updateCompany: (id, fields) => sql`UPDATE companies SET ${sql(fields)} WHERE id = ${id}`,
    // Its answers stay in everyone's numbers; its own totals go.
    deleteCompany: (id) => sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock_shared(${TOTALS_LOCK})`;
      await tx`DELETE FROM companies WHERE id = ${id}`;
      await tx`DELETE FROM folded WHERE scope = ${`c:${id}`}`;
      await tx`DELETE FROM aggregates WHERE scope = ${`c:${id}`}`;
    }),
    // The companies a profile has contributed to.
    companiesOf: (profileId) => sql`SELECT DISTINCT companies.* FROM companies
      JOIN contributions ON contributions.company_id = companies.id WHERE contributions.profile_id = ${profileId}`,

    // ---------- waiting for a submission ----------
    // For a new person, also reserves the address their page will get.
    async createWait({ profileId = null, companyId = null } = {}) {
      const token = randomCode(16);
      const reservedId = profileId ? null : randomCode(10);
      await sql`INSERT INTO waits (token, profile_id, company_id, reserved_id) VALUES (${token}, ${profileId}, ${companyId}, ${reservedId})`;
      return { token, reservedId };
    },
    // The newest unused prompt for a personal address: one reserved for a page
    // that does not exist yet, or one opened by a page's owner to run again.
    async openWaitFor(id) {
      const [w] = await sql`SELECT * FROM waits WHERE (reserved_id = ${id} OR profile_id = ${id}) AND contribution_id IS NULL
        AND created_at > now() - ${WAIT_TTL_MS / 1000} * interval '1 second' ORDER BY created_at DESC LIMIT 1`;
      return w ?? null;
    },
    async liveWait(token) {
      if (typeof token !== 'string' || !/^[a-z0-9]{16}$/.test(token)) return null;
      const [w] = await sql`SELECT * FROM waits WHERE token = ${token} AND created_at > now() - ${WAIT_TTL_MS / 1000} * interval '1 second'`;
      return w ?? null;
    },
    markFetched: (token) => sql`UPDATE waits SET fetched_at = now() WHERE token = ${token} AND fetched_at IS NULL`,
    // The first browser to ask after the answer arrived gets the owner cookie.
    async claimWait(token) {
      const r = await sql`UPDATE waits SET claimed = true WHERE token = ${token} AND claimed = false AND contribution_id IS NOT NULL`;
      return r.count === 1;
    },
    pruneWaits: () => sql`DELETE FROM waits WHERE contribution_id IS NULL AND created_at < now() - ${WAIT_TTL_MS / 1000} * interval '1 second'`,

    // ---------- contributions ----------
    // Everything in one transaction, including using up the wait token, so a
    // token can never produce two contributions.
    async addContribution(clean, { profileId = null, companyId = null, status = 'pending', flags = [], createdAt = null, waitToken = null } = {}) {
      return sql.begin(async (tx) => {
        const [row] = await tx`INSERT INTO contributions ${tx({
          created_at: createdAt ?? new Date(),
          profile_id: profileId,
          company_id: companyId,
          status,
          flags,
          payload: tx.json(clean),
          assistant: clean.assistant || null,
          role: clean.role,
          country: clean.country ?? null,
          history_basis: clean.history_basis || null,
          prompts_per_month: clean.prompts_per_month,
          months_using: clean.months_using,
          minutes_per_task: clean.minutes_per_task ?? null,
          prompts_per_task: clean.prompts_per_task ?? null,
          tokens_per_month: clean.tokens_per_month ?? null,
          lines_per_month: clean.lines_per_month ?? null,
          cost_per_month: clean.cost_per_month ?? null,
          context_per_request: clean.context_per_request ?? null,
          cost_reread: clean.cost_split?.reread ?? null,
          cost_loaded: clean.cost_split?.loaded ?? null,
          cost_written: clean.cost_split?.written ?? null,
          subagent_share: clean.subagent_share ?? null,
        })} RETURNING id`;
        const id = row.id;
        if (clean.patterns.length) {
          await tx`INSERT INTO contribution_patterns ${tx(clean.patterns.map((p, position) => ({
            contribution_id: id, position, catalog_id: p.catalog_id, title: p.title, summary: p.summary, when_used: p.when_used,
            problem_solved: p.problem_solved, quadrant: p.quadrant, frequency: p.frequency, status: p.status, cost: p.cost,
          })))}`;
        }
        if (clean.tools.length) await tx`INSERT INTO contribution_tools ${tx(clean.tools.map((t) => ({ contribution_id: id, name: t.name, kind: t.kind, used_for: t.used_for, frequency: t.frequency ?? null, open: t.open === true })))}`;
        if (clean.purposes.length) await tx`INSERT INTO contribution_purposes ${tx(clean.purposes.map((purpose) => ({ contribution_id: id, purpose })))}`;
        if (clean.models?.length) await tx`INSERT INTO contribution_models ${tx(clean.models.map((model) => ({ contribution_id: id, model })))}`;
        if (waitToken) {
          const r = await tx`UPDATE waits SET contribution_id = ${id}, profile_id = ${profileId} WHERE token = ${waitToken} AND contribution_id IS NULL`;
          if (r.count !== 1) throw Object.assign(new Error('This prompt has already been used.'), { status: 410 });
        }
        if (status === 'accepted') await fold(tx, personOf({ id, profile_id: profileId }));
        return Number(id);
      });
    },

    // Contributions in scope, with their patterns, tools and purposes.
    // { status: 'accepted' } for shared numbers; { profileId } for one person
    // (any status: it is their own data); { companyId, status }.
    async contributions({ companyId, profileId, status } = {}) {
      const rows = await sql`SELECT * FROM contributions WHERE true
        ${companyId ? sql`AND company_id = ${companyId}` : sql``}
        ${profileId ? sql`AND profile_id = ${profileId}` : sql``}
        ${status ? sql`AND status = ${status}` : sql``}
        ORDER BY id`;
      return hydrate(rows);
    },
    async contribution(id) {
      if (!/^\d{1,18}$/.test(String(id))) return null;
      const rows = await sql`SELECT * FROM contributions WHERE id = ${id}`;
      return (await hydrate(rows))[0] ?? null;
    },
    async counts() {
      const [r] = await sql`SELECT
        COUNT(DISTINCT COALESCE(profile_id, 'c' || id::text)) FILTER (WHERE status = 'accepted') AS people,
        COUNT(DISTINCT company_id) FILTER (WHERE status = 'accepted') AS companies
        FROM contributions`;
      return { people: Number(r.people), companies: Number(r.companies) };
    },

    // ---------- admin ----------
    async statusCounts() {
      const rows = await sql`SELECT status, COUNT(*)::int AS n FROM contributions GROUP BY status`;
      return Object.fromEntries(['pending', 'flagged', 'accepted', 'rejected'].map((s) => [s, rows.find((r) => r.status === s)?.n ?? 0]));
    },
    async listContributions({ status, limit = 50, offset = 0 } = {}) {
      const rows = await sql`SELECT c.id, c.created_at, c.status, c.flags, c.assistant, c.profile_id, c.company_id, c.analysed_at,
          c.analysis->>'verdict' AS verdict, c.analysis->>'reason' AS reason,
          (SELECT COUNT(*)::int FROM contribution_patterns p WHERE p.contribution_id = c.id) AS patterns,
          (SELECT COUNT(*)::int FROM contribution_tools t WHERE t.contribution_id = c.id) AS tools
        FROM contributions c WHERE true ${status ? sql`AND c.status = ${status}` : sql``}
        ORDER BY c.id DESC LIMIT ${limit} OFFSET ${offset}`;
      return rows.map((r) => ({ ...r, id: Number(r.id), created_at: iso(r.created_at) }));
    },
    // Contributions that still need an analysis run.
    async unanalysed(limit = 100) {
      const rows = await sql`SELECT * FROM contributions WHERE status IN ('pending', 'flagged') AND analysed_at IS NULL ORDER BY id LIMIT ${limit}`;
      return hydrate(rows);
    },
    // Writes an analysis: the new status, the catalog matches it chose, and the raw verdict.
    async applyAnalysis(id, { status, analysis, patterns }) {
      await sql.begin((tx) => foldAnswer(tx, id, async () => {
        await tx`UPDATE contributions SET status = ${status}, analysis = ${tx.json(analysis)}, analysed_at = now() WHERE id = ${id}`;
        for (const p of patterns) {
          await tx`UPDATE contribution_patterns SET catalog_id = ${p.catalog_id}, quadrant = ${p.quadrant}
            WHERE contribution_id = ${id} AND position = ${p.position}`;
        }
      }));
    },
    setStatus: (id, status) => sql.begin((tx) => foldAnswer(tx, id, () => tx`UPDATE contributions SET status = ${status}, reviewed_at = now() WHERE id = ${id}`)),
    deleteContribution: (id) => sql.begin((tx) => foldAnswer(tx, id, () => tx`DELETE FROM contributions WHERE id = ${id}`)),
    async deleteAllContributions() {
      await sql`DELETE FROM contributions`;
      await this.rebuildTotals();
    },
  };
}
