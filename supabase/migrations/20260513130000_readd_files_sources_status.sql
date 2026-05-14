-- Re-add files_sources.status, dropped in 20260510000000_taxonomy_redesign.sql
-- when status moved to repos. The 02868d1 refactor added per-file status
-- tracking (skipped/reused/completed/error) but forgot the migration; the
-- UPDATE calls in src/index.js were failing silently.
--
-- This time the column complements repos.status rather than duplicating it:
--   repos.status         → coarse, per-repo run state
--   files_sources.status → fine, per-file outcome ('pending'/'processing'/
--                          'completed'/'reused'/'skipped'/'error')

ALTER TABLE "public"."files_sources"
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

-- Useful for the UI ("show failed files per repo") and for db:health.
CREATE INDEX IF NOT EXISTS files_sources_status_idx
  ON "public"."files_sources" (status);
