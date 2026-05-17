-- Drop files_sources rows whose path has no file extension. These are almost
-- always symlink-style git blobs (e.g. .codex/skills/<name> pointing to
-- ../../engineering/skills/<name>) — they contain a single path string and the
-- LLM correctly classifies them as low-score "pointer file" noise. We were
-- burning a real classification call per row for zero value.
--
-- After this migration, the new isAgenticRelevant filter in src/github/fetchFiles.js
-- prevents the same paths from being re-fetched on subsequent runs.
--
-- analysis.file_source_id is ON DELETE CASCADE so analyses are removed automatically.
-- Idempotent: the WHERE clause is a no-op once these rows are gone.

DELETE FROM "public"."files_sources"
WHERE path !~ '\.[a-zA-Z0-9]+$';
