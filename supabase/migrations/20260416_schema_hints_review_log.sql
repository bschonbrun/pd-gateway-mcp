-- Self-healing review loop: schema_hints + review_log
-- Enables the review-agent to store learned rules and audit trail

-- 1. Schema hints: dynamic rules injected into the SQL system prompt at runtime
CREATE TABLE IF NOT EXISTS schema_hints (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  domain        text NOT NULL CHECK (domain IN ('revenue', 'finance')),
  category      text NOT NULL CHECK (category IN ('join', 'scope', 'table_selection', 'formula', 'filter', 'other')),
  hint          text NOT NULL,
  source_log_id uuid,            -- which nl_query_log / expense_query_log triggered this
  auto_generated boolean DEFAULT true,
  verified      boolean DEFAULT false,  -- true = human-approved; false = auto, pending review
  use_count     integer DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS schema_hints_domain_idx
  ON schema_hints (domain, verified, created_at DESC);

CREATE INDEX IF NOT EXISTS schema_hints_use_count_idx
  ON schema_hints (domain, use_count DESC);

-- 2. Review log: audit trail of every root-cause diagnosis the review agent makes
CREATE TABLE IF NOT EXISTS review_log (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  log_id            uuid,              -- source expense_query_log / nl_query_log row
  domain            text NOT NULL,
  original_question text,
  generated_sql     text,
  user_correction   text,
  root_cause_type   text,             -- SCOPE_DRIFT, WRONG_TABLE, MISSING_JOIN, etc.
  diagnosis         text,             -- LLM explanation (one sentence)
  fixes_applied     jsonb DEFAULT '{}',
  reviewed          boolean DEFAULT false,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_log_domain_created_idx
  ON review_log (domain, created_at DESC);

CREATE INDEX IF NOT EXISTS review_log_unreviewed_idx
  ON review_log (reviewed, created_at DESC)
  WHERE NOT reviewed;
