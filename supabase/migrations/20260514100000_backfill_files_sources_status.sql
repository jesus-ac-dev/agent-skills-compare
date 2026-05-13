-- Backfill files_sources.status for rows that existed before the column
-- was re-added in 20260513130000. The ADD COLUMN ... DEFAULT 'pending'
-- gave every pre-existing row 'pending', even ones whose analysis was
-- written months ago. This migration distinguishes:
--   - files with an analysis row → 'completed' (the classifier finished
--     them; status was just never set because the column didn't exist).
--   - files without an analysis row → left as 'pending' (genuinely
--     unprocessed; will be picked up next time the pipeline runs the
--     parent repo).
--
-- Idempotent: only touches rows still on the default 'pending'.
-- Safe to re-run.

UPDATE "public"."files_sources" fs
SET status = 'completed'
WHERE fs.status = 'pending'
  AND EXISTS (
    SELECT 1
    FROM "public"."analysis" a
    WHERE a.file_source_id = fs.id
  );
