// Analyses pending contributions so they can join the shared numbers.
//
//   npm run analyse                  every pending (and unanalysed flagged) contribution, up to 200
//   npm run analyse -- --dry-run     print the verdicts, write nothing
//   npm run analyse -- --limit 20
//   npm run analyse -- --id 123      one contribution again, whatever its status
//
// Needs DATABASE_URL and ANTHROPIC_API_KEY. A contribution is untrusted text:
// the model gets no tools, the text travels as a JSON document in a marked data
// block, the reply is limited by a schema, and lib/analysis.js checks it again
// before anything is written.
import Anthropic from '@anthropic-ai/sdk';
import { openDb } from '../lib/db.js';
import { SYSTEM, SCHEMA, userMessage, decide } from '../lib/analysis.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const dryRun = flag('--dry-run');
const limit = Number(value('--limit')) || 200;
const MODEL = process.env.ANALYSIS_MODEL || 'claude-opus-5-5';

const client = new Anthropic();
const store = await openDb();

async function classify(c) {
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
if (value('--id')) {
  const one = await store.contribution(value('--id'));
  todo = one ? [one] : [];
} else {
  todo = await store.unanalysed(limit);
}
console.log(`${todo.length} to analyse with ${MODEL}${dryRun ? ' (dry run)' : ''}`);

const tally = { accepted: 0, rejected: 0, flagged: 0, failed: 0 };
for (const c of todo) {
  try {
    const result = decide(c, await classify(c));
    result.analysis.model = MODEL;
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
    } else if (/authentication method/i.test(e.message)) {
      console.error('No API key found. Set ANTHROPIC_API_KEY and run again.');
      break;
    } else {
      console.error(`#${c.id}  failed: ${e.message}. It stays pending.`);
    }
  }
}
console.log(`Done: ${tally.accepted} accepted, ${tally.rejected} rejected, ${tally.flagged} flagged for review, ${tally.failed} failed.`);
await store.close();
process.exit(tally.failed ? 1 : 0);
