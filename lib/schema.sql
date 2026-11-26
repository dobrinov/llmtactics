-- Applied on every start; every statement is safe to run again.

-- A person's results page, /u/<id>. No account: whoever created it holds an
-- owner cookie, and an optional password lets them (or anyone they tell) in.
CREATE TABLE IF NOT EXISTS profiles (
  id text PRIMARY KEY,
  name text,
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A company page, /c/<id>. Same rules as a profile.
CREATE TABLE IF NOT EXISTS companies (
  id text PRIMARY KEY,
  name text,
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The editor's code of a page, as a SHA-256: whoever holds the code can edit
-- or delete the page from any browser. Empty for pages older than the codes.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS editor_code_hash text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS editor_code_hash text;

-- The code in a person's invitation link, /contribute?from=<code>: it names
-- the inviter on the page a friend opens without giving away /u/<id>.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS invite_code text;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_invite_code ON profiles(invite_code);

-- One contribution as it arrived (already cleaned against the schema in
-- lib/shape.js). status: pending -> accepted | rejected, or flagged for a
-- person to look at. Only accepted ones count towards shared numbers.
CREATE TABLE IF NOT EXISTS contributions (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  profile_id text REFERENCES profiles(id) ON DELETE CASCADE,
  company_id text REFERENCES companies(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'flagged')),
  flags text[] NOT NULL DEFAULT '{}',
  payload jsonb NOT NULL,
  analysis jsonb,
  analysed_at timestamptz,
  reviewed_at timestamptz,
  assistant text,
  role text,
  history_basis text,
  prompts_per_month text,
  months_using text,
  minutes_per_task text,
  prompts_per_task text,
  tokens_per_month text,
  lines_per_month text,
  cost_per_month text
);
-- Added after the first release.
ALTER TABLE contributions ADD COLUMN IF NOT EXISTS country text;
-- Measured from token records: what a typical request takes in (a range), where
-- the cost of the tokens goes (three percentages), and the share of tokens
-- that subagents used.
ALTER TABLE contributions ADD COLUMN IF NOT EXISTS context_per_request text;
ALTER TABLE contributions ADD COLUMN IF NOT EXISTS cost_reread smallint;
ALTER TABLE contributions ADD COLUMN IF NOT EXISTS cost_loaded smallint;
ALTER TABLE contributions ADD COLUMN IF NOT EXISTS cost_written smallint;
ALTER TABLE contributions ADD COLUMN IF NOT EXISTS subagent_share smallint;

CREATE INDEX IF NOT EXISTS contributions_profile ON contributions(profile_id);
CREATE INDEX IF NOT EXISTS contributions_company ON contributions(company_id);
CREATE INDEX IF NOT EXISTS contributions_status ON contributions(status);

CREATE TABLE IF NOT EXISTS contribution_patterns (
  contribution_id bigint NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  position int NOT NULL,
  catalog_id text,
  title text NOT NULL,
  summary text,
  when_used text,
  problem_solved text,
  quadrant text,
  frequency text,
  status text,
  cost text,
  PRIMARY KEY (contribution_id, position)
);

CREATE TABLE IF NOT EXISTS contribution_tools (
  contribution_id bigint NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text,
  used_for text
);
CREATE INDEX IF NOT EXISTS tools_contribution ON contribution_tools(contribution_id);
-- How often the person used the tool in the 30 days (daily, weekly,
-- occasionally), and whether it was running when they answered.
ALTER TABLE contribution_tools ADD COLUMN IF NOT EXISTS frequency text;
ALTER TABLE contribution_tools ADD COLUMN IF NOT EXISTS open boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS contribution_purposes (
  contribution_id bigint NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  purpose text NOT NULL
);
CREATE INDEX IF NOT EXISTS purposes_contribution ON contribution_purposes(contribution_id);

CREATE TABLE IF NOT EXISTS contribution_models (
  contribution_id bigint NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  model text NOT NULL
);
CREATE INDEX IF NOT EXISTS models_contribution ON contribution_models(contribution_id);

-- One per prompt shown on a contribute page. The prompt carries the token;
-- the submission must name it (once), and the waiting page then moves on.
-- name and password_hash are what the person typed while waiting; they go to
-- the profile created when the answer arrives.
CREATE TABLE IF NOT EXISTS waits (
  token text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  profile_id text REFERENCES profiles(id) ON DELETE CASCADE,
  company_id text REFERENCES companies(id) ON DELETE CASCADE,
  name text,
  password_hash text,
  contribution_id bigint REFERENCES contributions(id) ON DELETE SET NULL,
  claimed boolean NOT NULL DEFAULT false
);

-- The address the answer's page will get, chosen when the prompt is shown,
-- so the prompt can be fetched from /u/<id>/contribute.md before the page exists.
ALTER TABLE waits ADD COLUMN IF NOT EXISTS reserved_id text;
CREATE INDEX IF NOT EXISTS waits_reserved ON waits(reserved_id);

-- When an assistant first fetched the prompt, so the contribute page can show
-- that it is at work.
ALTER TABLE waits ADD COLUMN IF NOT EXISTS fetched_at timestamptz;

-- Stored totals (lib/aggregate.js): sums the tour reads instead of counting
-- every answer on every page view. Rebuilt from contributions at any time.
CREATE TABLE IF NOT EXISTS aggregates (
  scope text NOT NULL,
  kind text NOT NULL,
  month text NOT NULL,
  metric text NOT NULL,
  key text NOT NULL,
  value double precision NOT NULL,
  PRIMARY KEY (scope, kind, month, metric, key)
);
-- Which answer of each person is in the totals, and what it added.
-- person: 'p:<profile id>', or 'c:<contribution id>' for an answer without a page.
CREATE TABLE IF NOT EXISTS folded (
  person text NOT NULL,
  scope text NOT NULL,
  kind text NOT NULL,
  month text NOT NULL,
  contribution_id bigint NOT NULL,
  delta jsonb NOT NULL,
  PRIMARY KEY (person, scope, kind, month)
);
CREATE INDEX IF NOT EXISTS folded_scope ON folded(scope);
CREATE TABLE IF NOT EXISTS aggregate_state (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version int NOT NULL,
  rebuilt_at timestamptz,
  rebuild_ms int,
  folded_at timestamptz,
  folds bigint NOT NULL DEFAULT 0
);
-- The version names the data it was counted with too (lib/aggregate.js).
ALTER TABLE aggregate_state ALTER COLUMN version TYPE text;
