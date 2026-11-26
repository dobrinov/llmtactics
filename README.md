# llmtactics.com

A website that reads like a presentation of how people work with LLMs. People
paste one line into their assistant; it reads its own history with them, names
their habits, shows them the exact JSON, and sends it here after a "yes".

Node (no framework), server-rendered HTML, a little vanilla JS, PostgreSQL.
Two dependencies: `postgres` (the driver) and `@anthropic-ai/sdk` (only for the
analysis script).

```sh
createdb llmpatterns && createdb llmpatterns_test
cp .env.example .env      # set SESSION_SECRET and ADMIN_PASSWORD
npm install
npm run seed              # optional: 300 invented, already accepted contributions
npm run dev               # http://localhost:4400
npm test                  # needs the llmpatterns_test database
```

## Pages

| URL | What |
| --- | --- |
| `/` | The tour, seven slides: intro, tactics (the radar), setups, models over time, coding agents over time, where answers came from, and taking part |
| `/tools`, `/tools/<tool>` | Every tool people named, by kind, and one tool's page: its share, six months of it, and what people use it with. Opened from the Setups slide |
| `/contribute` | Just me: one line to paste, then a step at a time as the assistant fetches the prompt and its answer arrives. `?for=company` starts a company page: name it, invite colleagues, reach 5 people |
| `/u/<id>` | The tour through one person's lens: their habits, setup and models among everyone's. `/u/<id>/tools` likewise |
| `/c/<id>` | The tour through a company's lens, next to everyone. Until 5 people's answers have been reviewed: how many have answered. `/c/<id>/tools` likewise |
| `/c/<id>/contribute` | The page to send to colleagues: the Just me steps, with the answer counting for the company too |
| `/c/<id>/invite` | For the person who started the page: the link for colleagues and their own line; once 5 have answered, that the results are open |
| `/samodidopipatuk` | Contributions, review, and how to run the analysis. `/samodidopipatuk/totals`: whether the stored totals match the answers, and a rebuild |
| `/contribute.md?t=<code>`, `/c/<id>/contribute.md` | The prompt assistants read (`survey/contribute.md`, filled in per request). Without a live code, `/contribute.md` is a copy for reading. `/u/<id>/contribute.md?t=<code>`, the older form of the line, still works |

There is no sign-up. The browser that created a page holds a signed cookie that
lets it rename, protect or delete the page at `/u/<id>/edit` or `/c/<id>/edit`.
Each new page also gets an editor's code, shown once to that browser: typing it
on the edit page gives any other browser the same rights. Only its hash is
stored; the owner can swap it for a new one. A page with a password asks for
it, but the password only opens the page.

## How a contribution flows

1. A contribute page shows one line to paste:
   - for yourself, `Fetch <base>/contribute.md?t=<code> and follow the instructions in it.`
     `<code>` is the one-time code of this line. It knows which page the
     answer goes to, so two open lines for one page never take each other's
     answers.
     A company's contribute page shows the same kind of line, with the company
     on the one-time code. Lines of the older form
     `<base>/u/<id>/contribute.md?t=<code>` still work, and so does
     `<base>/c/<id>/contribute.md`, where each fetch gets its own code.
2. The prompt served at that address carries a one-time code (table `waits`)
   in its submit URL, `/api/contributions?t=<code>`. The code works once and
   expires after two days. The contribute page follows the code: it moves to
   "looking around" when the prompt is fetched (`waits.fetched_at`) and to the
   results when the answer arrives, when the browser gets the new page.
3. `lib/shape.js` keeps only known fields and listed values, caps lengths, and
   removes URLs, emails, paths and token-like strings. `lib/security.js` then
   screens the remaining free text for signs of prompt injection.
4. The contribution is stored as `pending` (or `flagged`, if the screen found
   something). The person's own page shows it at once.
5. The analysis (`npm run analyse`) or the admin accepts it. Only `accepted`
   contributions count in the shared and company numbers.
6. Every change to an answer (accepted, rejected, re-matched, deleted) updates
   the stored totals for that one person, in the same transaction (tables
   `aggregates` and `folded`). The tour reads only these totals. They can be
   rebuilt from the answers at any time on `/samodidopipatuk/totals`, and are rebuilt on
   start when the way answers are counted changes (`VERSION` in
   `lib/aggregate.js`).

## What the survey measures

Every answer describes the person's **last 30 days**, not their whole
history: people change tools and ways of working within months, and Claude
Code deletes transcripts after about 30 days anyway. The charts over time
come from answers arriving month after month, not from anyone's old history.

Within the 30 days the assistant counts instead of sampling. The prompt
points to a script, `survey/measure.py` (served at `/llm-survey.py`, so the
prompt stays short enough for a fetch tool to return whole), that
Claude Code, Codex, Gemini CLI or OpenCode downloads into the temporary folder and reads before running it, the one file the survey writes,
and deletes at the end. It has four uses:

- `measure` reads every transcript, including the subagents' (which a
  `projects/*/*.jsonl` glob misses), counts each model reply once (a reply
  is written on several lines and copied into resumed sessions), and prints
  only totals, medians and model names. It reads Codex's sessions too
  (`~/.codex/sessions`, or `CODEX_HOME`): a reply there is the `token_count`
  event after it, once per running total, since forked sessions copy them.
  And Gemini CLI's (`~/.gemini/tmp/*/chats`): a project folder named by the
  hash of its path is matched against the paths the other tools name, and
  when folders are skipped, one it cannot match is skipped too. And
  OpenCode's (`~/.local/share/opencode/storage`): a request is each
  `step-finish` part, and text OpenCode adds to a prompt is left out;
- `read N` prints a page of the prompts the user typed, with links, emails,
  paths, hosts, numbers and anything that looks like a secret masked, so
  that the assistant reads every prompt without reading a password. A
  password with nothing around it that marks it as one still shows;
- `count` takes one regular expression per habit and prints the sessions
  and days that match, and from them whether the habit is reported, its
  frequency, whether it is new, and its cost: what the typical prompt of
  that habit costs to answer, next to the person's typical prompt. The
  assistant reports those as printed.
- `tools` checks a fixed list of coding agents, editors, terminals,
  multiplexers and chat apps: whether each is installed, running now, and on
  how many of the 30 days it was used, from the first word of each shell
  history line, the dates of the tools' own session files, and the terminal
  the assistant runs in. From that it prints the frequency to report
  (`daily`, `weekly`, `occasionally`), and the model named in each coding
  agent's settings. It prints names from its list, numbers and model ids,
  nothing else. Each tool in an answer then carries `frequency` and `open`,
  and the tool pages show the share of a tool's users who use it daily (from
  5 answers that say how often).

Sessions that ran the survey itself are left out of `read` and `count`.

From `measure` come the
prompts, tokens and lines a month, the median session, and three token
measurements: what a typical request takes in (`context_per_request`), where
the cost of the tokens goes (`cost_split`: re-reading, loading, writing) and
the share subagents use (`subagent_share`). Other assistants are told to
count the same things by the same rules, or to leave the token fields out.

Habits need evidence: three separate sessions in the 30 days, or
configuration that enforces them. Every known tactic that qualifies as a habit is
reported, so that answers can be compared, plus at most eight of the person's
own, the ones that say most about how the person works. The assistant asks twice: before it reads anything (where the person can
name project folders to skip, passed as `LLM_SURVEY_SKIP`, or decline the
shell-history and process checks), and before it sends. In between it asks nothing:
what it cannot find (role, cost, editor, terminal) it shows as `?` in the
one confirmation message. A habit is `active` or `new`; the
survey no longer asks for habits people gave up, or for how long they have
used LLMs (the server still accepts both from older prompts).

## Untrusted text

A contribution is text from an unknown party, and is never followed as instructions:

- The prompt served to assistants is built from server constants only. Names
  people type for their pages are never put into it.
- The submission endpoint needs a valid one-time code, a JSON body of at most
  32 KB, and is rate limited per address.
- Most fields accept only listed values (ranges, roles, purposes, model
  families). Free text is limited to habit titles and descriptions and tool names.
- Pages escape everything by default (`lib/html.js`), with a strict
  Content-Security-Policy.
- The analysis gives the model no tools, passes the contribution as a JSON
  document in a marked data block, limits the reply with a JSON schema, and
  checks it again in `lib/analysis.js`. Only a status and catalog ids are written.
- Contributions flagged on arrival are never accepted automatically.

## Analysis

```sh
npm run analyse                 # pending contributions, up to 200
npm run analyse -- --dry-run    # print verdicts, write nothing
npm run analyse -- --id 123     # one contribution again
npm run analyse -- --local      # through the local Claude Code (claude -p), no API key
npm run analyse -- --local --production   # production database, over SSH with the deploy key
```

Needs `ANTHROPIC_API_KEY`. The model is `claude-opus-5-5`; set `ANALYSIS_MODEL`
to change it. `/samodidopipatuk/analysis` has the same instructions with the live counts.

## Deploying

llmtactics.com runs on a shared Hetzner host next to other apps: one Caddy and
one Postgres 17 serve all of them, and a nightly job there backs up every
database (`/opt/infra/README.md` on the server). The files for that host are in
`deploy/host/`. Deploy the last commit from this machine:

```sh
deploy/ship.sh            # or deploy/ship.sh <sha> to roll back
ssh root@89.167.69.250 docker logs -f llmtactics-web
```

### On a server of its own

`docker-compose.yml` runs everything on one small server (CX22 is enough):
PostgreSQL, the app, Caddy for HTTPS and a nightly dump.

```sh
# on the server, once
curl -fsSL https://get.docker.com | sh
git clone <this repo> /opt/llmtactics && cd /opt/llmtactics
cp .env.example .env            # DOMAIN, POSTGRES_PASSWORD, SESSION_SECRET, ADMIN_PASSWORD
docker compose up -d --build
```

Point the domain's `A` (and `AAAA`) records for `llmtactics.com` and `www` at the
server first: Caddy requests the HTTPS certificate on start. Open ports 80 and
443 in the Hetzner firewall; nothing else needs to be reachable.

```sh
# update
git pull && docker compose up -d --build
# analysis, by hand or nightly from cron
docker compose exec app npm run analyse
0 3 * * * cd /opt/llmtactics && docker compose exec -T app npm run analyse >> /var/log/llmtactics-analyse.log 2>&1
# logs
docker compose logs -f app
```

The app refuses to start without `PUBLIC_URL` (compose sets it from `DOMAIN`),
`SESSION_SECRET` of 32 characters or more, or with an `ADMIN_PASSWORD` shorter
than 12. On first start it creates the tables and counts the totals; later
starts count again only when the catalog, tools or models list changed.

The `backup` service writes one dump a day to `./backups/<day of month>.sql.gz`,
so the last month is kept. They sit on the same disk as the database: copy them
off the server (Hetzner Storage Box, S3, or `rsync` to another machine) too.

```sh
# restore a dump
gunzip -c backups/14.sql.gz | docker compose exec -T db psql -U llmtactics llmtactics
```

## Code

| File | What |
| --- | --- |
| `server.js` | Routes, access rules, the submission endpoint, rate limits |
| `lib/db.js`, `lib/schema.sql` | PostgreSQL schema and queries |
| `lib/shape.js` | Allowed values, the catalog, cleaning a submission |
| `lib/security.js` | Password hashing, signed cookies, the injection screen |
| `lib/analysis.js`, `scripts/analyse.js` | The analysis prompt, schema, checks and runner |
| `lib/stats.js` | Radar shares, tools, models, setups, experience, cost, counted from the answers |
| `lib/aggregate.js` | The stored totals the tour reads: what one answer adds, folding one person at a time, rebuilding, and reading the numbers back |
| `lib/tour.js` | The tour and the tool pages, under the World, company and You lenses |
| `lib/flow.js` | Taking part, one screen per step: Just me, and With my company |
| `lib/views.js`, `lib/admin-views.js`, `lib/html.js`, `lib/radar.js` | Other pages, and the radar's placement |
| `data/catalog.json`, `data/tools.json` | Known tactics and tools |
