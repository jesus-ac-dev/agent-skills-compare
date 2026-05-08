# Schema & Taxonomia v3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move repo lifecycle status into `repos`, replace single-axis taxonomy with classes (1:1) + domains/activities/tags (M2M), and force Gemini to return a structured payload that populates summary, classification, and use_cases in a single call.

**Architecture:** New SQL migration (`20260510000000_taxonomy_redesign.sql`) drops old single-axis lookups and `files_sources.status`, adds status columns to `repos`, creates new lookup + M2M tables (all BIGINT IDENTITY). Pipeline gains a state machine on `repos` and a multi-step persistence flow per file. Gemini client gains structured-output support; classifier loads closed vocabularies from DB at runtime to build the JSON schema.

**Tech Stack:** Node.js (ESM), Supabase JS client v2, `@google/generative-ai` v0.21, vitest, Postgres (Supabase), Supabase CLI for migrations.

**Reference spec:** [docs/superpowers/specs/2026-05-09-schema-taxonomy-redesign-design.md](../specs/2026-05-09-schema-taxonomy-redesign-design.md)

---

## File Structure

**Created:**

- `supabase/migrations/20260510000000_taxonomy_redesign.sql` — schema migration
- `src/db/lookups.js` — lookup helpers (resolve closed-list IDs, upsert open-list IDs, load vocabulary for Gemini schema)
- `tests/lookups.test.js` — unit tests for lookups module (mocked supabase)
- `tests/classify-schema.test.js` — unit tests for the classifier JSON schema builder

**Modified:**

- `src/analysis/geminiClient.js` — accept `responseSchema` + `responseMimeType` options; when schema is provided, skip the regex JSON extraction
- `src/analysis/classifyProject.js` — build `responseSchema` from DB vocabulary, merge use_cases into the same call, return full payload
- `src/index.js` — status state machine on `repos`, drop `status` from `files_sources` upsert, persist multi-axis classification

**Removed:**

- `src/analysis/extractUseCases.js` — merged into classifyProject (single Gemini call per file)

---

## Task 1: Migration SQL

**Files:**

- Create: `supabase/migrations/20260510000000_taxonomy_redesign.sql`

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Apply migration locally**

Run: `npm run db:reset`
Expected: Supabase resets, applies all migrations including the new one. No errors.

If `db:reset` is too destructive for the user's local data, alternative: `npm run db:push` which applies pending migrations only.

- [ ] **Step 3: Verify schema in DB**

Run: `npx supabase db diff --schema public` (should report no diff — schema matches migrations).
Or manually check with `psql` / Supabase Studio that:

- `repos` has `status`, `last_processed_at`, `error_count`, `last_error`
- `files_sources` has no `status` column
- `categories` and `sub_categories` are gone
- `classes`, `domains`, `activities`, `tags` exist with BIGINT ids
- `analysis_domains`, `analysis_activities`, `analysis_tags` exist
- Seeds are populated (classes: 15 rows, domains: 16, activities: 21)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260510000000_taxonomy_redesign.sql
git commit -m "feat(db): taxonomy redesign — status on repos, multi-axis taxonomy"
```

---

## Task 2: Lookups helper module

**Files:**

- Create: `src/db/lookups.js`
- Create: `tests/lookups.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/lookups.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSupabase = {
  from: vi.fn()
}

vi.mock('../src/db/supabaseClient.js', () => ({
  supabase: mockSupabase
}))

const { resolveClosedId, upsertOpenId, loadClosedVocabulary } = await import('../src/db/lookups.js')

function chainable(result) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result)
  }
  return chain
}

beforeEach(() => {
  mockSupabase.from.mockReset()
})

describe('resolveClosedId', () => {
  it('returns the id when name matches (case-insensitive)', async () => {
    mockSupabase.from.mockReturnValue(chainable({ data: { id: 7 }, error: null }))
    const id = await resolveClosedId('classes', 'Skill')
    expect(id).toBe(7)
    expect(mockSupabase.from).toHaveBeenCalledWith('classes')
  })

  it('returns null when name not found', async () => {
    mockSupabase.from.mockReturnValue(chainable({ data: null, error: null }))
    const id = await resolveClosedId('classes', 'nonexistent')
    expect(id).toBeNull()
  })

  it('returns null when name is empty', async () => {
    const id = await resolveClosedId('classes', '')
    expect(id).toBeNull()
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })
})

describe('upsertOpenId', () => {
  it('upserts and returns the id', async () => {
    const chain = chainable({ data: { id: 42 }, error: null })
    mockSupabase.from.mockReturnValue(chain)
    const id = await upsertOpenId('tags', 'Python')
    expect(id).toBe(42)
    expect(chain.upsert).toHaveBeenCalledWith({ name: 'python' }, { onConflict: 'name' })
  })

  it('returns null when name is empty', async () => {
    const id = await upsertOpenId('tags', '   ')
    expect(id).toBeNull()
  })
})

describe('loadClosedVocabulary', () => {
  it('returns sorted name lists for classes and domains', async () => {
    const callMap = new Map([
      ['classes', { data: [{ name: 'skill' }, { name: 'agent' }], error: null }],
      ['domains', { data: [{ name: 'backend' }, { name: 'data-ai' }], error: null }]
    ])
    mockSupabase.from.mockImplementation((table) => {
      const chain = {
        select: vi.fn().mockResolvedValue(callMap.get(table))
      }
      return chain
    })

    const vocab = await loadClosedVocabulary()
    expect(vocab.classes).toEqual(['agent', 'skill'])
    expect(vocab.domains).toEqual(['backend', 'data-ai'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest --run tests/lookups.test.js`
Expected: FAIL — module not found at `src/db/lookups.js`.

- [ ] **Step 3: Implement the lookups module**

```js
// src/db/lookups.js
import { supabase } from './supabaseClient.js'
import logger from '../utils/logger.js'

/**
 * Resolves a name to its id in a closed-vocabulary lookup table.
 * Case-insensitive match. Returns null on empty input or miss.
 */
export async function resolveClosedId(table, name) {
  if (!name || !String(name).trim()) return null
  const { data, error } = await supabase
    .from(table)
    .select('id')
    .ilike('name', String(name).trim())
    .maybeSingle()

  if (error) {
    logger.debug(`resolveClosedId(${table}, ${name}) error: ${error.message}`)
    return null
  }
  return data?.id ?? null
}

/**
 * Upserts a name (lower-cased) into an open-vocabulary lookup table.
 * Returns the id of the existing or newly inserted row, or null on empty input.
 */
export async function upsertOpenId(table, name) {
  if (!name || !String(name).trim()) return null
  const normalised = String(name).trim().toLowerCase()

  const { data, error } = await supabase
    .from(table)
    .upsert({ name: normalised }, { onConflict: 'name' })
    .select('id')
    .single()

  if (error) {
    logger.debug(`upsertOpenId(${table}, ${name}) error: ${error.message}`)
    return null
  }
  return data?.id ?? null
}

/**
 * Loads closed vocabularies (classes, domains) from the DB.
 * Used to construct the Gemini responseSchema enums at runtime.
 */
export async function loadClosedVocabulary() {
  const [classes, domains] = await Promise.all([
    supabase.from('classes').select('name'),
    supabase.from('domains').select('name')
  ])

  return {
    classes: (classes.data ?? []).map((r) => r.name).sort(),
    domains: (domains.data ?? []).map((r) => r.name).sort()
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest --run tests/lookups.test.js`
Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/db/lookups.js tests/lookups.test.js
git commit -m "feat(db): add lookups helper for closed/open taxonomy resolution"
```

---

## Task 3: Gemini client — structured output support

**Files:**

- Modify: `src/analysis/geminiClient.js`

- [ ] **Step 1: Replace `analyzeContent` with structured-output-aware version**

Replace the entire body of [src/analysis/geminiClient.js:59-80](../../../src/analysis/geminiClient.js#L59-L80) (the `analyzeContent` function) and supporting code so that:

- A new option object `{ schema, temperature }` can be passed.
- When `schema` is provided, the model is invoked with `generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature }`. The response is parsed as strict JSON (no regex extraction).
- When `schema` is not provided, behaviour stays as today (regex extract).

Full updated file:

````js
import { GoogleGenerativeAI } from '@google/generative-ai'
import dotenv from 'dotenv'
import logger from '../utils/logger.js'

dotenv.config()

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'
const MAX_RETRIES = Number(process.env.GEMINI_MAX_RETRIES ?? 3)
const DEFAULT_RETRY_DELAY_MS = 30_000
const MAX_RETRY_DELAY_MS = 120_000

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function isRateLimitError(error) {
  const status = error?.status ?? error?.response?.status
  if (status === 429) return true
  return /\b429\b|too many requests|quota/i.test(error?.message ?? '')
}

function parseRetryDelayMs(error, attempt) {
  const message = error?.message ?? ''
  const jsonMatch = message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i)
  if (jsonMatch) return Math.min(Math.ceil(Number(jsonMatch[1]) * 1000), MAX_RETRY_DELAY_MS)
  const textMatch = message.match(/retry in\s+(\d+(?:\.\d+)?)\s*s/i)
  if (textMatch) return Math.min(Math.ceil(Number(textMatch[1]) * 1000), MAX_RETRY_DELAY_MS)
  const backoff = DEFAULT_RETRY_DELAY_MS * 2 ** (attempt - 1)
  return Math.min(backoff, MAX_RETRY_DELAY_MS)
}

function buildModel({ schema, temperature }) {
  const generationConfig = {}
  if (typeof temperature === 'number') generationConfig.temperature = temperature
  if (schema) {
    generationConfig.responseMimeType = 'application/json'
    generationConfig.responseSchema = schema
  }
  return genAI.getGenerativeModel({
    model: MODEL_NAME,
    ...(Object.keys(generationConfig).length ? { generationConfig } : {})
  })
}

async function generateWithRetry(model, prompt, content) {
  let attempt = 0
  while (true) {
    attempt++
    try {
      return await model.generateContent([prompt, content])
    } catch (error) {
      if (!isRateLimitError(error) || attempt > MAX_RETRIES) throw error
      const waitMs = parseRetryDelayMs(error, attempt)
      logger.warn(
        `Gemini rate-limited (attempt ${attempt}/${MAX_RETRIES}). Waiting ${Math.round(waitMs / 1000)}s before retry.`
      )
      await sleep(waitMs)
    }
  }
}

/**
 * Analyzes content with Gemini.
 *
 * @param {string} content - File content to analyze.
 * @param {string} prompt  - Instruction prompt.
 * @param {object} [options]
 * @param {object} [options.schema]      - JSON schema for structured output. When set,
 *                                         the response is parsed strictly as JSON.
 * @param {number} [options.temperature] - Sampling temperature (0–1).
 * @returns {Promise<object>}
 */
export async function analyzeContent(content, prompt, options = {}) {
  const model = buildModel(options)
  logger.info(
    `Analyzing content with Gemini (${MODEL_NAME})${options.schema ? ' [structured]' : ''}…`
  )

  const result = await generateWithRetry(model, prompt, content)
  const text = result.response.text()

  if (options.schema) {
    return JSON.parse(text)
  }

  // Fallback: legacy regex JSON extraction
  try {
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/{[\s\S]*}/)
    if (jsonMatch) return JSON.parse(jsonMatch[1] || jsonMatch[0])
    return { text }
  } catch {
    logger.warn('Failed to parse JSON from Gemini response, returning raw text.')
    return { text }
  }
}
````

- [ ] **Step 2: Run existing tests to make sure nothing broke**

Run: `npx vitest --run`
Expected: All tests pass (lookups + hash). No tests for geminiClient — exercised manually in Task 6.

- [ ] **Step 3: Commit**

```bash
git add src/analysis/geminiClient.js
git commit -m "feat(gemini): add structured-output support via responseSchema"
```

---

## Task 4: Classifier — single structured call

**Files:**

- Modify: `src/analysis/classifyProject.js`
- Create: `tests/classify-schema.test.js`
- Delete: `src/analysis/extractUseCases.js`

- [ ] **Step 1: Write the failing test for the schema builder**

```js
// tests/classify-schema.test.js
import { describe, it, expect } from 'vitest'
import { buildClassifyResponseSchema } from '../src/analysis/classifyProject.js'

describe('buildClassifyResponseSchema', () => {
  it('produces a schema with closed enums for class and domains', () => {
    const schema = buildClassifyResponseSchema({
      classes: ['skill', 'agent'],
      domains: ['backend', 'data-ai']
    })
    expect(schema.type).toBe('object')
    expect(schema.required).toEqual(
      expect.arrayContaining([
        'summary',
        'maturity',
        'score',
        'class',
        'domains',
        'activities',
        'tags',
        'use_cases'
      ])
    )
    expect(schema.properties.class.enum).toEqual(['skill', 'agent'])
    expect(schema.properties.domains.items.enum).toEqual(['backend', 'data-ai'])
    expect(schema.properties.summary.minLength).toBeGreaterThanOrEqual(80)
    expect(schema.properties.maturity.enum).toEqual(['experimental', 'stable', 'abandoned'])
    expect(schema.properties.use_cases.items.required).toEqual(['title', 'description'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run tests/classify-schema.test.js`
Expected: FAIL — `buildClassifyResponseSchema` is not exported.

- [ ] **Step 3: Rewrite classifyProject.js**

```js
// src/analysis/classifyProject.js
import { analyzeContent } from './geminiClient.js'
import { loadClosedVocabulary } from '../db/lookups.js'

const SYSTEM_PROMPT = `You analyze a single file from a public repository that may contain AI agent skills,
sub-agents, MCP servers, plugins, prompts, hooks, or related artifacts. You must classify it
and produce structured JSON that matches the schema enforced by responseSchema.

Strict rules:
- "summary": ONE specific paragraph (≥ 80 chars). Mention concrete things THIS file does — names of
  tools, commands, hooks, or notable behaviors. NEVER write boilerplate like
  "This file describes a skill for..." or "This is a configuration file." Be concrete.
- "class": Pick exactly ONE artifact type from the enum.
- "domains": Pick 1+ subject-area domains from the enum.
- "activities": 1+ short kebab-case verbs/use-actions (e.g. "code-review", "planning"). Free text.
- "tags": 0+ free-form keywords (languages, frameworks, models, libraries: "python", "react", "claude-code").
- "use_cases": 1+ {title, description} pairs describing realistic ways this file would be used.
- "maturity": one of experimental/stable/abandoned.
- "score": 0–10 quality + relevance.

Return ONLY the JSON object that satisfies the schema.`

export function buildClassifyResponseSchema({ classes, domains }) {
  return {
    type: 'object',
    required: [
      'summary',
      'maturity',
      'score',
      'class',
      'domains',
      'activities',
      'tags',
      'use_cases'
    ],
    properties: {
      summary: { type: 'string', minLength: 80 },
      maturity: { type: 'string', enum: ['experimental', 'stable', 'abandoned'] },
      score: { type: 'number', minimum: 0, maximum: 10 },
      class: { type: 'string', enum: classes },
      domains: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', enum: domains }
      },
      activities: {
        type: 'array',
        minItems: 1,
        items: { type: 'string' }
      },
      tags: {
        type: 'array',
        items: { type: 'string' }
      },
      use_cases: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['title', 'description'],
          properties: {
            title: { type: 'string' },
            description: { type: 'string' }
          }
        }
      }
    }
  }
}

/**
 * Classifies a file with one structured Gemini call.
 * Returns the full payload (summary, maturity, score, class, domains[], activities[], tags[], use_cases[]).
 */
export async function classifyProject(content) {
  const vocab = await loadClosedVocabulary()
  const schema = buildClassifyResponseSchema(vocab)
  return await analyzeContent(content, SYSTEM_PROMPT, {
    schema,
    temperature: 0.4
  })
}
```

- [ ] **Step 4: Run schema test**

Run: `npx vitest --run tests/classify-schema.test.js`
Expected: PASS.

- [ ] **Step 5: Delete the now-merged use-case extractor**

```bash
git rm src/analysis/extractUseCases.js
```

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/analysis/classifyProject.js tests/classify-schema.test.js
git commit -m "feat(classifier): single structured Gemini call with multi-axis schema"
```

---

## Task 5: Pipeline — status state machine + multi-axis persistence

**Files:**

- Modify: `src/index.js`

- [ ] **Step 1: Replace the file with the new pipeline**

```js
// src/index.js
import { searchRepos } from './github/searchRepos.js'
import { listFilesRecursive, filterRelevantFiles, fetchFile } from './github/fetchFiles.js'
import { classifyProject } from './analysis/classifyProject.js'
import { generateHash } from './utils/hash.js'
import logger from './utils/logger.js'
import { supabase } from './db/supabaseClient.js'
import { resolveClosedId, upsertOpenId } from './db/lookups.js'

async function setRepoStatus(repoId, patch) {
  const { error } = await supabase.from('repos').update(patch).eq('id', repoId)
  if (error) logger.error(`Failed to update repo ${repoId} status:`, error.message)
}

async function recordFileError(repoId, message) {
  const { error } = await supabase.rpc('increment_repo_error', {
    p_repo_id: repoId,
    p_msg: message
  })
  // Fallback if the RPC doesn't exist: read-modify-write
  if (error) {
    const { data } = await supabase.from('repos').select('error_count').eq('id', repoId).single()
    const next = (data?.error_count ?? 0) + 1
    await supabase.from('repos').update({ error_count: next, last_error: message }).eq('id', repoId)
  }
}

async function persistClassification(fileSourceId, payload) {
  const {
    summary,
    maturity,
    score,
    class: className,
    domains = [],
    activities = [],
    tags = [],
    use_cases = []
  } = payload

  const classId = await resolveClosedId('classes', className)

  // Upsert analysis (one row per file_source_id)
  const { data: analysisRow, error: analysisErr } = await supabase
    .from('analysis')
    .upsert(
      {
        file_source_id: fileSourceId,
        summary,
        use_cases,
        class_id: classId,
        maturity,
        score,
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'
      },
      { onConflict: 'file_source_id' }
    )
    .select('id')
    .single()

  if (analysisErr) throw new Error(`analysis upsert: ${analysisErr.message}`)
  const analysisId = analysisRow.id

  // Wipe previous M2M before re-inserting (idempotent on re-runs)
  await Promise.all([
    supabase.from('analysis_domains').delete().eq('analysis_id', analysisId),
    supabase.from('analysis_activities').delete().eq('analysis_id', analysisId),
    supabase.from('analysis_tags').delete().eq('analysis_id', analysisId)
  ])

  // Domains (closed list — skip unknown)
  for (const domain of domains) {
    const id = await resolveClosedId('domains', domain)
    if (id) {
      await supabase.from('analysis_domains').insert({ analysis_id: analysisId, domain_id: id })
    } else {
      logger.warn(`Unknown domain from classifier: ${domain}`)
    }
  }

  // Activities (semi-open — upsert)
  for (const activity of activities) {
    const id = await upsertOpenId('activities', activity)
    if (id) {
      await supabase
        .from('analysis_activities')
        .insert({ analysis_id: analysisId, activity_id: id })
    }
  }

  // Tags (open — upsert)
  for (const tag of tags) {
    const id = await upsertOpenId('tags', tag)
    if (id) {
      await supabase.from('analysis_tags').insert({ analysis_id: analysisId, tag_id: id })
    }
  }
}

async function processRepo(repo) {
  logger.info(`Processing repository: ${repo.full_name}`)

  // Upsert repo
  const { data: dbRepo, error: repoError } = await supabase
    .from('repos')
    .upsert(
      {
        name: repo.name,
        repo_url: repo.html_url,
        avatar_url: repo.owner.avatar_url,
        stars: repo.stargazers_count,
        last_commit: repo.pushed_at
      },
      { onConflict: 'repo_url' }
    )
    .select('id')
    .single()

  if (repoError) {
    logger.error(`Error saving repo ${repo.full_name}:`, repoError.message)
    return
  }
  const repoId = dbRepo.id

  // Reset state at the start of each run
  await setRepoStatus(repoId, {
    status: 'processing',
    error_count: 0,
    last_error: null
  })

  // List files (catastrophic failure here → repo failed)
  let allFiles
  try {
    allFiles = await listFilesRecursive(repo.owner.login, repo.name)
  } catch (e) {
    logger.error(`Failed to list files for ${repo.full_name}: ${e.message}`)
    await setRepoStatus(repoId, {
      status: 'failed',
      last_error: e.message,
      last_processed_at: new Date().toISOString()
    })
    return
  }

  const relevantFiles = filterRelevantFiles(allFiles)
  logger.info(`Found ${relevantFiles.length} relevant files in ${repo.full_name}.`)

  const sourceTypeId = await resolveClosedId('source_types', 'github_file')
  const branch = repo.default_branch || 'main'

  for (const filePath of relevantFiles) {
    try {
      logger.info(`Processing file: ${filePath}`)
      const content = await fetchFile(repo.owner.login, repo.name, filePath)
      if (!content) continue

      const fileTypeId = await resolveClosedId(
        'file_types',
        filePath.endsWith('.md') ? 'markdown' : 'text'
      )

      const { data: fileSource, error: fsError } = await supabase
        .from('files_sources')
        .upsert(
          {
            repo_id: repoId,
            url: `${repo.html_url}/blob/${branch}/${filePath}`,
            path: filePath,
            hash: generateHash(content),
            source_type_id: sourceTypeId,
            file_type_id: fileTypeId,
            last_checked: new Date().toISOString()
          },
          { onConflict: 'url' }
        )
        .select('id')
        .single()

      if (fsError) throw new Error(`files_sources upsert: ${fsError.message}`)

      const classification = await classifyProject(content)
      await persistClassification(fileSource.id, classification)
    } catch (err) {
      logger.error(`File failed (${filePath}): ${err.message}`)
      await recordFileError(repoId, `${filePath}: ${err.message}`)
    }
  }

  await setRepoStatus(repoId, {
    status: 'done',
    last_processed_at: new Date().toISOString()
  })
}

async function main() {
  const query = process.argv[2] || 'agent skills'
  logger.info(`Starting pipeline for query: "${query}"`)
  try {
    const repos = await searchRepos(query)
    logger.info(`Found ${repos.length} repositories.`)
    for (const repo of repos) {
      await processRepo(repo)
    }
    logger.info('Pipeline completed successfully.')
  } catch (error) {
    logger.error('Pipeline failed:', error.message)
  }
}

main()
```

- [ ] **Step 2: Run lint + tests**

Run: `npm run lint && npm test`
Expected: lint clean (or only pre-existing warnings), all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/index.js
git commit -m "feat(pipeline): repo status state machine + multi-axis persistence"
```

---

## Task 6: End-to-end smoke test

**Files:** none (manual verification).

- [ ] **Step 1: Reset DB and run pipeline**

```bash
npm run db:reset      # apply all migrations cleanly
npm start "claude code skills"   # or another query that returns < 5 repos
```

Watch logs. Expected:

- For each repo: `[INFO] Processing repository: …`
- `[INFO] Analyzing content with Gemini (gemini-…) [structured]…` per file
- No JSON parse errors.
- Final: `Pipeline completed successfully.`

- [ ] **Step 2: Verify DB state**

In Supabase Studio or `psql`:

```sql
-- All repos finished
SELECT name, status, error_count, last_processed_at FROM repos ORDER BY id;
-- Expected: every row has status='done' (or 'failed' with a populated last_error)

-- files_sources has no status column
\d public.files_sources

-- Multi-axis taxonomy populated
SELECT a.id, c.name AS class, COUNT(DISTINCT ad.domain_id) AS domains,
       COUNT(DISTINCT aa.activity_id) AS activities,
       COUNT(DISTINCT at.tag_id) AS tags
FROM analysis a
LEFT JOIN classes c ON c.id = a.class_id
LEFT JOIN analysis_domains ad ON ad.analysis_id = a.id
LEFT JOIN analysis_activities aa ON aa.analysis_id = a.id
LEFT JOIN analysis_tags at ON at.analysis_id = a.id
GROUP BY a.id, c.name
ORDER BY a.id;
-- Expected: each row has a class, ≥1 domain, ≥1 activity, often ≥1 tag

-- Summaries are not duplicated
SELECT summary, COUNT(*) FROM analysis GROUP BY summary HAVING COUNT(*) > 1;
-- Expected: zero rows (or very few — boilerplate detection)
```

- [ ] **Step 3: Re-run idempotency check**

Run `npm start "<same query>"` a second time.
Expected:

- Logs show same repos being re-processed.
- No DB errors about duplicate `analysis.file_source_id`.
- M2M counts in the verification query above are stable (not multiplying).

- [ ] **Step 4: Final commit (if any docs/config tweaks emerged)**

```bash
git add -u
git commit -m "chore: smoke-test fixes for taxonomy v3" || echo "nothing to commit"
```

---

## Self-review notes

**Spec coverage check:**

- §1 status on repos → Task 1 (migration) + Task 5 (pipeline transitions) ✓
- §2 taxonomy redesign → Task 1 (DDL + seeds) + Task 5 (persistence) ✓
- §3 structured Gemini output → Task 3 (client) + Task 4 (classifier + schema) ✓
- §4 pipeline sequence → Task 5 ✓
- BIGINT-only FKs → Task 1 (all new lookup PKs are `BIGINT GENERATED ALWAYS AS IDENTITY`; M2M FKs explicitly `BIGINT`) ✓
- `analysis.UNIQUE(file_source_id)` for idempotency → Task 1 + verified in Task 5 (`onConflict: 'file_source_id'`) ✓

**Scope addition flagged:** `extractUseCases.js` is removed and merged into the structured classifier call (saves one Gemini call per file). Spec didn't explicitly include `use_cases` in the JSON schema; this plan adds it. If the user prefers to keep them separate, drop the `use_cases` field from the schema in Task 4 and restore `extractUseCases.js` use in Task 5.

**Known limitations:**

- `recordFileError` uses an RPC fallback path. If `increment_repo_error` doesn't exist as a Postgres function, the read-modify-write path is taken — non-atomic but acceptable for a single-threaded pipeline.
- M2M inserts are sequential per axis. Acceptable for the current corpus size; can be batched later.
