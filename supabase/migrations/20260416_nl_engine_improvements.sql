-- nl-query engine v39 improvements
-- Run against your Supabase project (Dashboard → SQL Editor)

-- 1. Adaptive thresholds: track each user's historical correction rate
ALTER TABLE engine_mode
  ADD COLUMN IF NOT EXISTS correction_rate numeric DEFAULT 0 CHECK (correction_rate >= 0 AND correction_rate <= 1);

-- 2. Auto-researched definitions: track Perplexity confidence + timestamp
ALTER TABLE financial_definitions
  ADD COLUMN IF NOT EXISTS research_confidence numeric CHECK (research_confidence >= 0 AND research_confidence <= 1),
  ADD COLUMN IF NOT EXISTS researched_at timestamptz;

-- 3. Deduplicate golden examples: enforce unique question so merge-duplicates works correctly
-- Note: if duplicates already exist, run the cleanup query first
-- Cleanup (if needed): DELETE FROM nl_query_golden a USING nl_query_golden b WHERE a.id > b.id AND a.question = b.question;
ALTER TABLE nl_query_golden
  ADD CONSTRAINT nl_query_golden_question_unique UNIQUE (question);

-- 4. Active learning consensus flags
-- The consensus_flag feedback_type is written by the engine; add an index for reporting
CREATE INDEX IF NOT EXISTS nl_query_feedback_consensus_idx
  ON nl_query_feedback (feedback_type)
  WHERE feedback_type = 'consensus_flag';

-- 5. Index for faster per-user log lookups (used by updateCorrectionRate)
CREATE INDEX IF NOT EXISTS nl_query_log_user_created_idx
  ON nl_query_log (user_id, created_at DESC);
