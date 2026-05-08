-- Table: repos
CREATE TABLE IF NOT EXISTS "public"."repos" (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL,
    repo_url TEXT UNIQUE NOT NULL,
    stars INTEGER DEFAULT 0,
    last_commit TIMESTAMPTZ,
    tags JSONB DEFAULT '[]'::jsonb,
    score FLOAT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: sources
CREATE TABLE IF NOT EXISTS "public"."sources" (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    url TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL, -- 'github_repo', 'github_file', 'website'
    repo_id BIGINT REFERENCES "public"."repos"(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending', -- 'pending', 'processed', 'error'
    last_checked TIMESTAMPTZ,
    hash TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: files
CREATE TABLE IF NOT EXISTS "public"."files" (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id BIGINT REFERENCES "public"."sources"(id) ON DELETE CASCADE,
    repo_id BIGINT REFERENCES "public"."repos"(id) ON DELETE CASCADE,
    path TEXT,
    content TEXT,
    hash TEXT,
    type TEXT, -- 'markdown', 'json', 'yaml', 'html'
    extracted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: analysis
CREATE TABLE IF NOT EXISTS "public"."analysis" (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    file_id BIGINT REFERENCES "public"."files"(id) ON DELETE CASCADE,
    summary TEXT,
    use_cases JSONB DEFAULT '[]'::jsonb,
    entities JSONB DEFAULT '[]'::jsonb,
    maturity TEXT, -- 'experimental', 'stable', 'abandoned'
    score FLOAT,
    model TEXT, -- e.g., 'gemini-2.0-pro'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: entities
CREATE TABLE IF NOT EXISTS "public"."entities" (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    file_id BIGINT REFERENCES "public"."files"(id) ON DELETE CASCADE,
    type TEXT, -- 'agent', 'skill', 'workflow', 'tool', 'architecture'
    name TEXT NOT NULL,
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sources_url ON "public"."sources"(url);
CREATE INDEX IF NOT EXISTS idx_sources_repo_id ON "public"."sources"(repo_id);
CREATE INDEX IF NOT EXISTS idx_files_repo_id ON "public"."files"(repo_id);
CREATE INDEX IF NOT EXISTS idx_files_source_id ON "public"."files"(source_id);
CREATE INDEX IF NOT EXISTS idx_analysis_file_id ON "public"."analysis"(file_id);
CREATE INDEX IF NOT EXISTS idx_entities_file_id ON "public"."entities"(file_id);
