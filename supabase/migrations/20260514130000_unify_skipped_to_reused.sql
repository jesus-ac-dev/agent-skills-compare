-- Unify per-file status enums: 'skipped' (URL+hash matched an existing
-- analysis → no LLM call) and 'reused' (intra-run content-hash dedup →
-- copied another file's analysis) were semantically identical: both meant
-- "this file has an analysis, the LLM was not invoked". The UI users found
-- this distinction confusing — a file appearing under "skipped" did not
-- mean it was ignored; it actually had a complete analysis.
--
-- Going forward only 'reused' is emitted (see src/index.js bulk update).
-- This migration backfills existing 'skipped' rows that have an analysis.
-- Any 'skipped' rows without an analysis are left as-is (suggests a future
-- "explicitly ignored" semantics, not currently produced by the pipeline).

UPDATE "public"."files_sources" fs
SET status = 'reused'
WHERE fs.status = 'skipped'
  AND EXISTS (
    SELECT 1 FROM "public"."analysis" a WHERE a.file_source_id = fs.id
  );
