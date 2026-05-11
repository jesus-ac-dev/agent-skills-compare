-- Migration: Fix M2M upsert path
-- The previous migration created UNIQUE expression indexes on (LOWER(name)) for
-- `activities` and `tags`. Postgres ON CONFLICT requires either a UNIQUE column
-- constraint or a constraint name — it cannot infer an expression index from
-- a column reference. As a result, supabase-js upsert calls with
-- `onConflict: 'name'` were failing silently and the M2M tables stayed empty.
--
-- Fix: replace the expression indexes with column-level UNIQUE constraints.
-- Case-insensitive uniqueness is preserved because the upsert helper
-- (src/db/lookups.js#upsertOpenId) lower-cases the value before insert.

DROP INDEX IF EXISTS idx_activities_lower_name;
DROP INDEX IF EXISTS idx_tags_lower_name;

ALTER TABLE "public"."activities"
    ADD CONSTRAINT activities_name_unique UNIQUE (name);

ALTER TABLE "public"."tags"
    ADD CONSTRAINT tags_name_unique UNIQUE (name);
