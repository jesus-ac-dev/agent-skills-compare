-- Migration: Taxonomy redesign v3
-- - Move processing status from files_sources to repos
-- - Replace categories/sub_categories with classes (1:1) + domains/activities/tags (M2M)
-- - All lookup tables use BIGINT IDENTITY
-- - Adds UNIQUE(file_source_id) on analysis for idempotent re-runs

-- 1. repos: status state machine
ALTER TABLE "public"."repos"
    ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'done', 'failed')),
    ADD COLUMN IF NOT EXISTS "last_processed_at" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "error_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "last_error" TEXT;

CREATE INDEX IF NOT EXISTS idx_repos_status ON "public"."repos"(status);

-- 2. files_sources: drop redundant status
ALTER TABLE "public"."files_sources" DROP COLUMN IF EXISTS "status";

-- 3. Drop old taxonomy tables (cascades to analysis.sub_category_id and analysis.class_id FKs)
DROP TABLE IF EXISTS "public"."sub_categories" CASCADE;
DROP TABLE IF EXISTS "public"."categories" CASCADE;
DROP TABLE IF EXISTS "public"."classes" CASCADE;

-- 4. analysis: drop sub_category_id (cascade above already removed FK; column may still exist)
ALTER TABLE "public"."analysis" DROP COLUMN IF EXISTS "sub_category_id";
ALTER TABLE "public"."analysis" DROP COLUMN IF EXISTS "class_id";

-- 5. New lookup tables (BIGINT IDENTITY)
CREATE TABLE "public"."classes" (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE "public"."domains" (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE "public"."activities" (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_activities_lower_name ON "public"."activities"(LOWER(name));

CREATE TABLE "public"."tags" (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_tags_lower_name ON "public"."tags"(LOWER(name));

-- 6. analysis: add class_id (BIGINT, nullable for defensive fallback) + UNIQUE(file_source_id)
ALTER TABLE "public"."analysis"
    ADD COLUMN "class_id" BIGINT REFERENCES "public"."classes"(id) ON DELETE SET NULL;

ALTER TABLE "public"."analysis"
    ADD CONSTRAINT analysis_file_source_unique UNIQUE (file_source_id);

-- 7. M2M tables
CREATE TABLE "public"."analysis_domains" (
    analysis_id BIGINT NOT NULL REFERENCES "public"."analysis"(id) ON DELETE CASCADE,
    domain_id   BIGINT NOT NULL REFERENCES "public"."domains"(id)  ON DELETE CASCADE,
    PRIMARY KEY (analysis_id, domain_id)
);

CREATE TABLE "public"."analysis_activities" (
    analysis_id BIGINT NOT NULL REFERENCES "public"."analysis"(id)   ON DELETE CASCADE,
    activity_id BIGINT NOT NULL REFERENCES "public"."activities"(id) ON DELETE CASCADE,
    PRIMARY KEY (analysis_id, activity_id)
);

CREATE TABLE "public"."analysis_tags" (
    analysis_id BIGINT NOT NULL REFERENCES "public"."analysis"(id) ON DELETE CASCADE,
    tag_id      BIGINT NOT NULL REFERENCES "public"."tags"(id)     ON DELETE CASCADE,
    PRIMARY KEY (analysis_id, tag_id)
);

-- 8. Seed closed vocabularies
INSERT INTO "public"."classes" (name) VALUES
    ('skill'), ('subagent'), ('slash-command'), ('hook'), ('mcp-server'),
    ('plugin'), ('output-style'), ('settings-preset'), ('prompt-template'),
    ('tool-definition'), ('workflow'), ('framework'), ('eval-benchmark'),
    ('dataset'), ('guide')
ON CONFLICT (name) DO NOTHING;

INSERT INTO "public"."domains" (name) VALUES
    ('backend'), ('frontend'), ('mobile'), ('devops'), ('infrastructure'),
    ('database'), ('data-ai'), ('security'), ('blockchain'), ('iot'),
    ('gamedev'), ('scientific'), ('fintech'), ('business'), ('creative'),
    ('meta-agentic')
ON CONFLICT (name) DO NOTHING;

-- 9. Seed initial activities (open list — classifier may upsert more)
INSERT INTO "public"."activities" (name) VALUES
    ('code-review'), ('planning'), ('spec-writing'), ('debugging'),
    ('testing'), ('refactoring'), ('documentation'), ('security-audit'),
    ('performance-tuning'), ('data-analysis'), ('content-writing'),
    ('research'), ('automation'), ('prompt-engineering'), ('agent-building'),
    ('evaluation'), ('knowledge-mgmt'), ('productivity'), ('learning'),
    ('migration'), ('monitoring')
ON CONFLICT DO NOTHING;
