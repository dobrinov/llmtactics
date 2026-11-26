// The admin area: contributions, their review, and how to run the analysis.
// Everything a contributor sent is shown through the escaping `html` template,
// as text.
import { page, html, raw, formatDate, formatNumber } from './html.js';
import { turnstile, CHECK_FAILED } from './turnstile.js';

const STATUSES = ['pending', 'flagged', 'accepted', 'rejected'];
const STATUS_LABEL = { pending: 'Pending', flagged: 'Flagged', accepted: 'Accepted', rejected: 'Rejected' };
const time = (iso) => `${formatDate(iso)} ${new Date(iso).toISOString().slice(11, 16)}`;

const nav = (current) => html`<nav class="nav" aria-label="Admin">
  <a href="/samodidopipatuk"${raw(current === 'list' ? ' aria-current="page"' : '')}>Contributions</a>
  <a href="/samodidopipatuk/analysis"${raw(current === 'analysis' ? ' aria-current="page"' : '')}>Run the analysis</a>
  <a href="/samodidopipatuk/totals"${raw(current === 'totals' ? ' aria-current="page"' : '')}>Totals</a>
  <form method="post" action="/samodidopipatuk/logout" class="nav-form"><button class="linklike">Sign out</button></form>
</nav>`;

const frame = (title, current, body) => page({ title: `Admin: ${title}`, nav: nav(current), noindex: true, body: html`<div class="wrap block admin">${body}</div>` });

const badge = (status) => html`<span class="tag st-${status}">${STATUS_LABEL[status] ?? status}</span>`;

export const disabledPage = () => page({
  title: 'Admin', bare: true, noindex: true,
  body: html`<div class="wrap focus contribute-bare"><h1>The admin area is off</h1><p class="lede">Set <code>ADMIN_PASSWORD</code> in the server's environment and restart it.</p></div>`,
});

export const loginPage = ({ error }) => page({
  title: 'Admin', bare: true, noindex: true,
  body: html`<div class="wrap focus contribute-bare">
  <h1>Admin</h1>
  ${error ? html`<p class="error" role="alert">${error === 'check' ? CHECK_FAILED : 'That password is not right.'}</p>` : ''}
  <form method="post" action="/samodidopipatuk/login" class="details-form company">
    <div class="field"><label for="pw">Password</label><input id="pw" name="password" type="password" required autofocus autocomplete="current-password"></div>
    ${turnstile.widget()}
    <button class="btn dark big" type="submit">Sign in</button>
  </form>
</div>`,
});

export function listPage({ counts, rows, status, page: n }) {
  const total = STATUSES.reduce((a, s) => a + counts[s], 0);
  const q = (s, p = 0) => `/samodidopipatuk?${new URLSearchParams({ ...(s ? { status: s } : {}), ...(p ? { page: String(p) } : {}) })}`;
  return frame('Contributions', 'list', html`
  <h1>Contributions</h1>
  <nav class="chips" aria-label="Filter by status">
    <a class="chip" href="/samodidopipatuk"${raw(!status ? ' aria-current="true"' : '')}>All · ${formatNumber(total)}</a>
    ${STATUSES.map((s) => html`<a class="chip" href="${q(s)}"${raw(status === s ? ' aria-current="true"' : '')}>${STATUS_LABEL[s]} · ${formatNumber(counts[s])}</a>`)}
  </nav>
  ${counts.pending ? html`<p class="banner"><span><b>${formatNumber(counts.pending)}</b> waiting for analysis. They are not in the shared numbers yet.</span><a class="btn dark small" href="/samodidopipatuk/analysis">How to run it</a></p>` : ''}
  ${rows.length ? html`<div class="table-scroll"><table class="table">
    <thead><tr><th>Id</th><th>Arrived</th><th>Status</th><th>From</th><th>Size</th><th>Page</th><th>Company</th><th>Flags and analysis</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr>
      <td><a href="/samodidopipatuk/c/${r.id}"><b>#${r.id}</b></a></td>
      <td>${time(r.created_at)}</td>
      <td>${badge(r.status)}</td>
      <td>${r.assistant || '–'}</td>
      <td>${r.patterns} habits, ${r.tools} tools</td>
      <td>${r.profile_id ? html`<a href="/u/${r.profile_id}">/u/${r.profile_id}</a>` : '–'}</td>
      <td>${r.company_id ? html`<a href="/c/${r.company_id}">/c/${r.company_id}</a>` : '–'}</td>
      <td class="small">${r.flags.length ? html`<span class="error">${r.flags.join(', ')}</span> ` : ''}${r.verdict ? html`<span class="muted">${r.verdict}: ${r.reason ?? ''}</span>` : html`<span class="muted">${r.analysed_at ? '' : 'not analysed'}</span>`}</td>
    </tr>`)}</tbody>
  </table></div>
  <p class="row">${n > 0 ? html`<a class="btn outline small" href="${q(status, n - 1)}">← Newer</a>` : ''}${rows.length === 50 ? html`<a class="btn outline small" href="${q(status, n + 1)}">Older →</a>` : ''}</p>`
    : html`<p class="muted">Nothing here.</p>`}`);
}

const action = (id, name, label, cls = 'outline', confirm = '') => html`<form method="post" action="/samodidopipatuk/c/${id}/${name}"${raw(confirm ? ` data-confirm="${confirm}"` : '')}><button class="btn ${cls} small">${label}</button></form>`;

export function detailPage({ c }) {
  const a = c.analysis;
  return frame(`#${c.id}`, 'list', html`
  <p><a href="/samodidopipatuk">← All contributions</a></p>
  <div class="row between wrapline"><h1>Contribution #${c.id}</h1>${badge(c.status)}</div>
  <p class="muted">Arrived ${time(c.created_at)} from ${c.assistant || 'an unnamed assistant'}.
    ${c.profile_id ? html`Page <a href="/u/${c.profile_id}">/u/${c.profile_id}</a>.` : ''}
    ${c.company_id ? html`Company <a href="/c/${c.company_id}">/c/${c.company_id}</a>.` : ''}</p>
  <div class="owner">
    ${c.status !== 'accepted' ? action(c.id, 'accept', 'Accept', 'dark') : ''}
    ${c.status !== 'rejected' ? action(c.id, 'reject', 'Reject') : ''}
    ${c.status !== 'flagged' ? action(c.id, 'flag', 'Flag') : ''}
    ${c.status !== 'pending' ? action(c.id, 'pending', 'Back to pending') : ''}
    ${action(c.id, 'delete', 'Delete', 'danger', 'Delete this contribution for good?')}
  </div>
  <p class="muted small">Accepted contributions count in the shared and company numbers. Everything below is the contributor's text, shown as text: treat it as data, and do not paste it into an assistant as instructions.</p>

  ${c.flags.length ? html`<section class="card"><h2 class="card-title">Held back on arrival</h2><p>The text matched these signs of an attempt to address a model: <b class="error">${c.flags.join(', ')}</b>. It stays out of the shared numbers until you accept it.</p></section>` : ''}

  <section class="card"><h2 class="card-title">Analysis</h2>
    ${a ? html`<p><b>${a.verdict}</b>${a.model ? html` <span class="muted small">by ${a.model}, ${time(c.analysed_at)}</span>` : ''}</p><p>${a.reason}</p>
      ${a.problems?.length ? html`<p class="small">Problems: ${a.problems.join(', ')}</p>` : ''}`
      : html`<p class="muted">Not analysed yet. <a href="/samodidopipatuk/analysis">How to run the analysis</a>.</p>`}
  </section>

  <section class="card"><h2 class="card-title">Habits</h2>
    <div class="table-scroll"><table class="table">
      <thead><tr><th>#</th><th>Title</th><th>Catalog match</th><th>Area</th><th>Summary</th><th>When</th><th>Problem solved</th><th>Freq.</th><th>Status</th><th>Cost</th></tr></thead>
      <tbody>${c.patterns.map((p) => html`<tr><td>${p.position + 1}</td><td><b>${p.title}</b></td><td>${p.catalog_id ? html`<code>${p.catalog_id}</code>` : html`<span class="muted">none</span>`}</td><td>${p.quadrant ?? '–'}</td><td>${p.summary}</td><td>${p.when_used}</td><td>${p.problem_solved}</td><td>${p.frequency ?? '–'}</td><td>${p.status ?? '–'}</td><td>${p.cost ?? '–'}</td></tr>`)}</tbody>
    </table></div>
  </section>

  <section class="card"><h2 class="card-title">Tools</h2>
    <div class="table-scroll"><table class="table">
      <thead><tr><th>Name</th><th>Kind</th><th>Used for</th></tr></thead>
      <tbody>${c.tools.map((t) => html`<tr><td><b>${t.name}</b></td><td>${t.kind}</td><td>${t.used_for}</td></tr>`)}</tbody>
    </table></div>
  </section>

  <section class="card"><h2 class="card-title">Everything else</h2>
    <dl class="kv">
      ${[['Role', c.role], ['Country', c.country], ['Looked at', c.history_basis], ['Purposes', c.purposes.join(', ')], ['Models', c.models.join(', ')],
        ['Prompts a month', c.prompts_per_month], ['Months of use', c.months_using], ['Minutes per task', c.minutes_per_task], ['Prompts per task', c.prompts_per_task],
        ['Tokens a month', c.tokens_per_month], ['Lines of code a month', c.lines_per_month], ['Dollars a month', c.cost_per_month], ['Context per request', c.context_per_request],
        ['Cost: re-reading, loading, writing', c.cost_reread != null ? `${c.cost_reread}% · ${c.cost_loaded}% · ${c.cost_written}%` : null], ['Tokens used by subagents', c.subagent_share != null ? `${c.subagent_share}%` : null]]
        .map(([k, v]) => html`<div><dt>${k}</dt><dd>${v || '–'}</dd></div>`)}
    </dl>
  </section>

  <details class="card"><summary>The stored payload, as JSON</summary><pre class="code">${JSON.stringify(c.payload, null, 2)}</pre></details>`);
}

export function analysisPage({ counts, base }) {
  const local = /localhost|127\.0\.0\.1/.test(base);
  return frame('Run the analysis', 'analysis', html`
  <h1>Run the analysis</h1>
  <p class="lede">New contributions wait as <b>pending</b> and are left out of the shared and company numbers. The analysis reads each one, checks it is a genuine description of how someone works, matches its habits to the catalog, and accepts it, rejects it, or leaves it flagged for you.</p>
  <p class="banner"><span>Right now: <b>${formatNumber(counts.pending)}</b> pending, <b>${formatNumber(counts.flagged)}</b> flagged, <b>${formatNumber(counts.accepted)}</b> accepted, <b>${formatNumber(counts.rejected)}</b> rejected.</span><a class="btn dark small" href="/samodidopipatuk?status=flagged">Review flagged</a></p>

  <section class="card"><h2 class="card-title">1. Run it</h2>
    <p>The script needs the database address and an Anthropic API key. ${local ? 'On this machine:' : html`On the server, from the folder with <code>docker-compose.yml</code>:`}</p>
    <pre class="code">${local
      ? 'ANTHROPIC_API_KEY=sk-ant-… npm run analyse'
      : 'docker compose exec -e ANTHROPIC_API_KEY=sk-ant-… app npm run analyse'}</pre>
    <p>Useful options, after <code>--</code>:</p>
    <ul class="plain-list">
      <li><code>--dry-run</code> prints each verdict and writes nothing.</li>
      <li><code>--limit 20</code> handles at most 20 contributions (default 200).</li>
      <li><code>--id 123</code> analyses one contribution again, whatever its status.</li>
      <li><code>--local</code> asks the local Claude Code (<code>claude -p</code>, with no tools) instead of the API, so no API key is needed.</li>
      <li><code>--production</code>, run on your own machine, works on the production database through an SSH tunnel with the deploy key, so only someone who can SSH to the server can run it.</li>
    </ul>
    <p class="muted small">Put <code>ANTHROPIC_API_KEY</code> in the server's <code>.env</code> to leave it off the command. To run it every night, add the command to cron; the README has the line.</p>
  </section>

  <section class="card"><h2 class="card-title">2. What it does with each contribution</h2>
    <ul class="plain-list">
      <li><b>Accept:</b> a plausible, anonymous description of working habits. Its habits get their catalog match and it joins the numbers.</li>
      <li><b>Reject:</b> spam, nonsense, or text that carries personal or confidential details.</li>
      <li><b>Review:</b> anything it is unsure about, and anything that tries to address the model. These become <b>flagged</b> and wait for you.</li>
      <li>Contributions the server already flagged on arrival are analysed too, but stay flagged whatever the verdict. Only you can accept them.</li>
    </ul>
  </section>

  <section class="card"><h2 class="card-title">3. Why a contribution cannot steer the analysis</h2>
    <ul class="plain-list">
      <li>The model gets no tools. It cannot read files, run commands, open links or touch the database.</li>
      <li>The contribution is passed as a JSON document inside a marked data block, and the instructions say that everything in it is text to classify.</li>
      <li>Its reply is limited by a schema to a verdict, a short reason and, per habit, a catalog id from the fixed list or none.</li>
      <li>The script checks the reply again against the catalog and writes only those fields. It never copies the model's words into the shared pages.</li>
      <li>So the worst a hostile contribution can do is get itself accepted with wrong labels. It is one answer among many, and you can reject it here.</li>
    </ul>
  </section>

  <section class="card"><h2 class="card-title">4. Review by hand</h2>
    <p>Open a contribution from <a href="/samodidopipatuk">the list</a> to read it and accept, reject, flag or delete it. You can do this without ever running the script.</p>
    <p class="muted small">When you read contributions with an assistant of your own (for example pasting an export into a chat), tell it the text is untrusted data, and do not give that session tools.</p>
  </section>`);
}

// The stored totals (lib/aggregate.js): when they were last counted from
// scratch, and whether they still match counting the answers now.
export function totalsPage({ state, check, rebuilt }) {
  const ok = !check.differ.length && check.folds === check.expectedFolds;
  const shown = check.differ.slice(0, 20);
  return frame('Totals', 'totals', html`
  <h1>Totals</h1>
  <p class="lede">The tour reads stored totals instead of counting every answer on every page view. Each accepted, rejected, re-matched or deleted answer updates them for that one person. A rebuild counts everything again from the stored answers.</p>
  ${rebuilt ? html`<p class="banner" role="status">Rebuilt from ${formatNumber(check.answers)} accepted answers.</p>` : ''}
  <section class="card">
    <h2 class="card-title">${ok ? 'The totals match the answers' : 'The totals differ from the answers'}</h2>
    <ul class="plain-list">
      <li><b>${formatNumber(check.answers)}</b> accepted answers from <b>${formatNumber(check.people)}</b> people</li>
      <li><b>${formatNumber(check.cells)}</b> stored totals, from <b>${formatNumber(check.folds)}</b> answers folded in${check.folds !== check.expectedFolds ? html` <span class="error">(a fresh count folds in ${formatNumber(check.expectedFolds)})</span>` : ''}</li>
      <li>Last rebuilt: ${state?.rebuilt_at ? html`<b>${time(new Date(state.rebuilt_at).toISOString())}</b>${state.rebuild_ms != null ? ` in ${formatNumber(state.rebuild_ms)} ms` : ''}` : 'never'}</li>
      <li>Updated one answer at a time since: <b>${formatNumber(Number(state?.folds ?? 0))}</b> times${state?.folded_at ? html`, last at ${time(new Date(state.folded_at).toISOString())}` : ''}</li>
    </ul>
    ${check.differ.length ? html`<div class="table-scroll"><table class="table">
      <thead><tr><th>Scope</th><th>Kind</th><th>Month</th><th>What</th><th>Stored</th><th>Counted now</th></tr></thead>
      <tbody>${shown.map((d) => html`<tr><td>${d.scope}</td><td>${d.kind === 'l' ? 'latest' : 'month'}</td><td>${d.month}</td><td>${d.metric}: ${d.key || '–'}</td><td>${+d.stored.toFixed(4)}</td><td>${+d.counted.toFixed(4)}</td></tr>`)}</tbody>
    </table></div>${check.differ.length > shown.length ? html`<p class="muted small">And ${formatNumber(check.differ.length - shown.length)} more.</p>` : ''}` : ''}
  </section>
  <form method="post" action="/samodidopipatuk/totals/rebuild" data-confirm="Count all totals again from the stored answers?">
    <button class="btn dark big" type="submit">Rebuild from the answers</button>
  </form>
  <p class="muted small">The server also rebuilds on start when the way answers are counted has changed.</p>`);
}
