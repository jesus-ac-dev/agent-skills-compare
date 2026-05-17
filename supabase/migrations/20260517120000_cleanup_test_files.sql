-- Drop files_sources rows that are part of test infrastructure rather than
-- agentic artefacts. The original filter happily accepted *.test.ts under
-- cli/src/__tests__/ because they're "code in a public repo" — but a product's
-- own test suite teaches nothing about how to build agents/skills/workflows.
--
-- Patterns (matches src/github/fetchFiles.js):
--   * filename ends in .test.<ext> or .spec.<ext>
--   * path contains a /test|tests|__tests__|__test__|spec|e2e|cypress|playwright/ segment
--
-- analysis.file_source_id is ON DELETE CASCADE so analyses are removed automatically.
-- Idempotent.

DELETE FROM "public"."files_sources"
WHERE path ~* '\.(test|spec)\.[a-z0-9]+$'
   OR path ~ '(^|/)(__tests__|__test__|tests|test|spec|e2e|cypress|playwright)/';
