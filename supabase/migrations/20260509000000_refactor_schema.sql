-- Migration: Refactor Schema
-- Description: Unified files/sources, added lookup tables, and updated analysis schema.

-- 1. Add avatar_url to repos
ALTER TABLE "public"."repos" ADD COLUMN IF NOT EXISTS "avatar_url" TEXT;

-- 2. Create lookup tables
CREATE TABLE IF NOT EXISTS "public"."source_types" (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."file_types" (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."categories" (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."sub_categories" (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    category_id INTEGER REFERENCES "public"."categories"(id) ON DELETE CASCADE,
    UNIQUE(name, category_id)
);

CREATE TABLE IF NOT EXISTS "public"."classes" (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
);

-- 3. Drop old tables that will be replaced or removed
-- Note: Using CASCADE to handle dependencies
DROP TABLE IF EXISTS "public"."entities" CASCADE;
DROP TABLE IF EXISTS "public"."analysis" CASCADE;
DROP TABLE IF EXISTS "public"."files" CASCADE;
DROP TABLE IF EXISTS "public"."sources" CASCADE;

-- 4. Create unified files_sources table
CREATE TABLE "public"."files_sources" (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    repo_id BIGINT REFERENCES "public"."repos"(id) ON DELETE CASCADE,
    url TEXT UNIQUE NOT NULL,
    path TEXT,
    hash TEXT,
    source_type_id INTEGER REFERENCES "public"."source_types"(id),
    file_type_id INTEGER REFERENCES "public"."file_types"(id),
    status TEXT DEFAULT 'pending',
    last_checked TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Recreate analysis table with new schema
CREATE TABLE "public"."analysis" (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    file_source_id BIGINT REFERENCES "public"."files_sources"(id) ON DELETE CASCADE,
    summary TEXT,
    use_cases JSONB DEFAULT '[]'::jsonb,
    sub_category_id INTEGER REFERENCES "public"."sub_categories"(id),
    class_id INTEGER REFERENCES "public"."classes"(id),
    maturity TEXT,
    score FLOAT,
    model TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_files_sources_repo_id ON "public"."files_sources"(repo_id);
CREATE INDEX IF NOT EXISTS idx_analysis_file_source_id ON "public"."analysis"(file_source_id);

-- 7. Initial data population
INSERT INTO "public"."source_types" (name) VALUES
('github_repo'),
('github_file'),
('website')
ON CONFLICT (name) DO NOTHING;

INSERT INTO "public"."file_types" (name) VALUES
('markdown'),
('json'),
('yaml'),
('html'),
('text')
ON CONFLICT (name) DO NOTHING;

INSERT INTO "public"."categories" (name) VALUES
('Iot Engineer'),
('programming-languages'),
('security'),
('data-ai'),
('database'),
('devops')
ON CONFLICT (name) DO NOTHING;

INSERT INTO "public"."classes" (name) VALUES
('skills'),
('agents'),
('commands'),
('settings'),
('hooks'),
('mcps'),
('plugins'),
('agentic tools')
ON CONFLICT (name) DO NOTHING;
