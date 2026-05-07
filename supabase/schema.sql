-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: repos
CREATE TABLE IF NOT EXISTS repos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    repo_url TEXT UNIQUE NOT NULL,
    stars INTEGER DEFAULT 0,
    last_commit TIMESTAMPTZ,
    tags JSONB DEFAULT '[]'::jsonb,
    score FLOAT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: sources
CREATE TABLE IF NOT EXISTS sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    url TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL, -- 'github_repo', 'github_file', 'website'
    repo_id UUID REFERENCES repos(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending', -- 'pending', 'processed', 'error'
    last_checked TIMESTAMPTZ,
    hash TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: files
CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id UUID REFERENCES sources(id) ON DELETE CASCADE,
    repo_id UUID REFERENCES repos(id) ON DELETE CASCADE,
    path TEXT,
    content TEXT,
    hash TEXT,
    type TEXT, -- 'markdown', 'json', 'yaml', 'html'
    extracted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: analysis
CREATE TABLE IF NOT EXISTS analysis (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_id UUID REFERENCES files(id) ON DELETE CASCADE,
    summary TEXT,
    use_cases JSONB DEFAULT '[]'::jsonb,
    entities JSONB DEFAULT '[]'::jsonb,
    maturity TEXT, -- 'experimental', 'stable', 'abandoned'
    score FLOAT,
    model TEXT, -- e.g., 'gemini-2.0-pro'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: entities
CREATE TABLE IF NOT EXISTS entities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_id UUID REFERENCES files(id) ON DELETE CASCADE,
    type TEXT, -- 'agent', 'skill', 'workflow', 'tool', 'architecture'
    name TEXT NOT NULL,
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sources_url ON sources(url);
CREATE INDEX IF NOT EXISTS idx_sources_repo_id ON sources(repo_id);
CREATE INDEX IF NOT EXISTS idx_files_repo_id ON files(repo_id);
CREATE INDEX IF NOT EXISTS idx_files_source_id ON files(source_id);
CREATE INDEX IF NOT EXISTS idx_analysis_file_id ON analysis(file_id);
CREATE INDEX IF NOT EXISTS idx_entities_file_id ON entities(file_id);
