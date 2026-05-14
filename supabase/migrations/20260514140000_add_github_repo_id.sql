-- Identify repos by their stable GitHub numeric id rather than the URL.
-- Owners can rename / orgs can transfer ownership; the URL changes but the
-- repo's numeric id does not. Without a stable handle, the pipeline used to
-- create duplicate rows whenever GitHub returned a different canonical URL
-- (see the forrestchang → multica-ai case that triggered this fix).
--
-- Nullable + partial unique index so legacy rows (which don't yet have a
-- github_repo_id) can keep coexisting until processRepo backfills them on
-- the next touch.

ALTER TABLE "public"."repos"
  ADD COLUMN IF NOT EXISTS github_repo_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS repos_github_repo_id_uniq
  ON "public"."repos" (github_repo_id)
  WHERE github_repo_id IS NOT NULL;
