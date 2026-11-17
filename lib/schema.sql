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
