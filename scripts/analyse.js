// Analyses pending contributions so they can join the shared numbers.
//
//   npm run analyse                  every pending (and unanalysed flagged) contribution, up to 200
//   npm run analyse -- --dry-run     print the verdicts, write nothing
//   npm run analyse -- --limit 20
//   npm run analyse -- --id 123      one contribution again, whatever its status
//   npm run analyse -- --local       ask the local Claude Code (`claude -p`) instead of the API
//   npm run analyse -- --production  work on the production database, through SSH
//   npm run analyse -- --logos-only  only look for tool logos, analyse nothing
//   npm run analyse -- --all-logos   look for every tool's logo again, found ones too
//   npm run analyse -- --no-logos    analyse only
//
// After the contributions, it looks for a logo for each tool named in answers
// that are not rejected (lib/logos.js): from Simple Icons, or from the tool's
// own site. Tools with none keep their two letters on the site. A search that
// found nothing is tried again after 30 days.
//
// --production reaches the server's database through an SSH tunnel with the
// deploy key (scripts/production-db.js), so only someone who can SSH to the
// server can run it. It creates no tables and rebuilds nothing there, and it
// stops if this checkout counts answers differently from the server
// (aggregate VERSION), since folding with other rules would corrupt the totals.
//
// Needs DATABASE_URL, and ANTHROPIC_API_KEY unless --local is given; --local
// uses whatever account Claude Code is signed in with. It runs Claude Code with
// no tools, no MCP servers, no skills and no settings, so the model sees only
// the same system prompt and submission the API call sends. A contribution is
// untrusted text: the model gets no tools, the text travels as a JSON document in a marked data
// block, the reply is limited by a schema, and lib/analysis.js checks it again
// before anything is written.
import { spawn } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';
import { openDb } from '../lib/db.js';
import { VERSION as TOTALS_VERSION } from '../lib/aggregate.js';
import { openProductionTunnel } from './production-db.js';
import { SYSTEM, SCHEMA, userMessage, decide } from '../lib/analysis.js';
import { loadSimpleIcons, findLogo } from '../lib/logos.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const dryRun = flag('--dry-run');
const local = flag('--local');
const production = flag('--production');
const limit = Number(value('--limit')) || 200;
const logosOnly = flag('--logos-only');
const logos = !flag('--no-logos');
const allLogos = flag('--all-logos');
const MODEL = process.env.ANALYSIS_MODEL || 'claude-opus-5-5';

const client = local || logosOnly ? null : new Anthropic();
let tunnel = null;
let store;
if (production) {
  try { tunnel = await openProductionTunnel(); } catch (e) { console.error(e.message); process.exit(1); }
  store = await openDb(tunnel.url, { setup: false });
  const state = await store.totalsState();
  if (state?.version !== TOTALS_VERSION) {
    console.error(`Production counts answers as ${state?.version ?? '(nothing yet)'}, this checkout as ${TOTALS_VERSION}.`);
    console.error('Deploy this code first (deploy/ship.sh), or check out the deployed commit, then run again.');
    await store.close();
    tunnel.close();
    process.exit(1);
  }
} else {
  store = await openDb();
}

// The same request through the local Claude Code. Its reply, held to the
// schema, comes back as structured_output.
function classifyLocal(c) {
  const argv = ['-p', '--model', MODEL, '--tools', '', '--strict-mcp-config', '--disable-slash-commands',
    '--setting-sources', '', '--no-session-persistence', '--system-prompt', SYSTEM,
    '--json-schema', JSON.stringify(SCHEMA), '--output-format', 'json'];
  return new Promise((resolve, reject) => {
    const child = spawn('claude', argv, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      let reply;
      try { reply = JSON.parse(out); } catch { return reject(new Error(`claude exited ${code}: ${(err || out).trim().slice(0, 300)}`)); }
      if (reply.is_error || !reply.structured_output) {
        return resolve({ verdict: 'review', reason: `No usable answer (${reply.subtype ?? 'error'}).`, problems: [], patterns: [] });
      }
      resolve(reply.structured_output);
    });
    child.stdin.end(userMessage(c));
  });
}

async function classify(c) {
  if (local) return classifyLocal(c);
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    // If the model declines a submission, the API retries it on a fallback model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{ role: 'user', content: userMessage(c) }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
  });
  // A refusal or a cut-off reply is not an answer: leave it for a person.
  if (response.stop_reason !== 'end_turn') return { verdict: 'review', reason: `No usable answer (${response.stop_reason}).`, problems: [], patterns: [] };
  const text = response.content.find((b) => b.type === 'text')?.text ?? '';
  try { return JSON.parse(text); } catch { return { verdict: 'review', reason: 'The answer was not valid JSON.', problems: [], patterns: [] }; }
}

let todo;
if (logosOnly) {
  todo = [];
} else if (value('--id')) {
  const one = await store.contribution(value('--id'));
  todo = one ? [one] : [];
} else {
  todo = await store.unanalysed(limit);
}
if (!logosOnly) console.log(`${todo.length} to analyse with ${MODEL}${local ? ' through the local Claude Code' : ''}${production ? ', on PRODUCTION' : ''}${dryRun ? ' (dry run)' : ''}`);

const tally = { accepted: 0, rejected: 0, flagged: 0, failed: 0 };
for (const c of todo) {
  try {
    const result = decide(c, await classify(c));
    result.analysis.model = local ? `${MODEL} (local)` : MODEL;
    tally[result.status]++;
    const matched = result.patterns.filter((p) => p.catalog_id).length;
    console.log(`#${c.id}  ${result.status.padEnd(8)}  ${matched}/${result.patterns.length} matched  ${result.analysis.reason}`);
    if (!dryRun) await store.applyAnalysis(c.id, result);
  } catch (e) {
    tally.failed++;
    if (e instanceof Anthropic.AuthenticationError) {
      console.error('The API key was not accepted. Set ANTHROPIC_API_KEY and run again.');
      break;
    } else if (e instanceof Anthropic.RateLimitError) {
      console.error(`#${c.id}  rate limited; waiting 30 seconds. It stays pending for the next run.`);
      await new Promise((r) => setTimeout(r, 30_000));
    } else if (e instanceof Anthropic.APIError) {
      console.error(`#${c.id}  API error ${e.status ?? ''}: ${e.message}. It stays pending.`);
    } else if (e.code === 'ENOENT') {
      console.error('The claude command was not found. Install Claude Code or run without --local.');
      break;
    } else if (/authentication method/i.test(e.message)) {
      console.error('No API key found. Set ANTHROPIC_API_KEY and run again.');
      break;
    } else {
      console.error(`#${c.id}  failed: ${e.message}. It stays pending.`);
    }
  }
}
if (!logosOnly) console.log(`Done: ${tally.accepted} accepted, ${tally.rejected} rejected, ${tally.flagged} flagged for review, ${tally.failed} failed.`);

// ---------- tool logos ----------
if (logos) await findLogos();

async function findLogos() {
  let names;
  try {
    names = await store.logosToFind({ all: allLogos });
  } catch (e) {
    // 42P01: no such table. The server creates it on start, so this database runs older code.
    if (e.code === '42P01') return console.error('Logos: this database has no tool_logos table yet. Deploy this code first, then run again with --logos-only.');
    throw e;
  }
  if (!names.length) return console.log('Logos: none to look for.');
  let icons = null;
  try { icons = await loadSimpleIcons(); } catch (e) { console.error(`Logos: Simple Icons could not be read (${e.message}); only tools' own sites are tried.`); }
  let found = 0;
  for (const name of names) {
    const logo = await findLogo(name, { icons });
    if (logo) found++;
    console.log(`logo  ${name.padEnd(28)}  ${logo ? `${logo.source} (${Math.ceil(logo.body.length / 1024)} KB)` : 'none, keeps its letters'}`);
    if (!dryRun) await store.saveLogo(name, logo);
  }
  console.log(`Logos: ${found} of ${names.length} found${dryRun ? ' (dry run, nothing saved)' : ''}.`);
}
await store.close();
tunnel?.close();
process.exit(tally.failed ? 1 : 0);
