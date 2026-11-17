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
| `/` | The presentation: introduction, radar, habits, tools, development environments, tools over time, models over time, prompts and lines of code over time, cost over time (dollars and tokens), purposes, time per task, costly habits, roles, emerging habits, and the invitation to take part |
| `/contribute` | One line to paste, with an optional name and password for the page it creates. `?for=company` creates a company page instead |
| `/u/<id>` | One person's results. First slide: their name, if they gave one. Last slide: run again, or start a company page |
| `/c/<id>` | A company's results. First slide: its name, if it has one. Last slide: asks colleagues to contribute. Results appear at 5 counted people |
| `/c/<id>/contribute` | The company's contribute page, to send to colleagues |
| `/admin` | Contributions, review, and how to run the analysis |
| `/contribute.md` | The prompt assistants read (`survey/contribute.md`, filled in per request) |

There is no sign-up. The browser that created a page holds a signed cookie that
lets it rename, protect or delete the page. A page with a password asks for it;
for a personal page the password also restores ownership on another device.

## How a contribution flows

1. A contribute page creates a one-time code (table `waits`) and shows
   `Fetch <base>/contribute.md?t=<code> and follow the instructions in it.`
2. The assistant posts JSON to `/api/contributions?t=<code>`. The code works
   once and expires after two days.
3. `lib/shape.js` keeps only known fields and listed values, caps lengths, and
   removes URLs, emails, paths and token-like strings. `lib/security.js` then
   screens the remaining free text for signs of prompt injection.
4. The contribution is stored as `pending` (or `flagged`, if the screen found
   something). The person's own page shows it at once.
5. The analysis (`npm run analyse`) or the admin accepts it. Only `accepted`
   contributions count in the shared and company numbers.

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
```

Needs `ANTHROPIC_API_KEY`. The model is `claude-opus-5-5`; set `ANALYSIS_MODEL`
to change it. `/admin/analysis` has the same instructions with the live counts.

## Deploying on Hetzner

One small cloud server (CX22 is enough) with Docker:

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
# backup
docker compose exec -T db pg_dump -U llmtactics llmtactics | gzip > backup-$(date +%F).sql.gz
```

## Code

| File | What |
| --- | --- |
| `server.js` | Routes, access rules, the submission endpoint, rate limits |
| `lib/db.js`, `lib/schema.sql` | PostgreSQL schema and queries |
| `lib/shape.js` | Allowed values, the catalog, cleaning a submission |
| `lib/security.js` | Password hashing, signed cookies, the injection screen |
| `lib/analysis.js`, `scripts/analyse.js` | The analysis prompt, schema, checks and runner |
| `lib/stats.js` | Radar shares, tools, models, setups, experience, cost |
| `lib/views.js`, `lib/admin-views.js`, `lib/html.js`, `lib/radar.js` | Pages and charts |
| `data/catalog.json`, `data/tools.json` | Known patterns and tools |
