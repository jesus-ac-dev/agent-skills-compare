# Curated Seed Repos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `config/curated-repos.json` and a `seedCuratedRepos()` loader so the pipeline queues a curated set of high-value GitHub repos as `pending` before any search runs. Idempotent via `ON CONFLICT DO NOTHING`. Decoupled from the LLM provider choice.

**Architecture:** A pure-Node loader reads the JSON, validates+normalises URLs, and calls `supabase.from('repos').upsert(rows, { onConflict: 'repo_url', ignoreDuplicates: true })`. Wired into `src/index.js main()` as one `await` call before `findResumableRepos()`, inside the `!resumeOnly` branch.

**Tech Stack:** Node.js ESM, vitest (with `vi.mock` for supabase), Supabase JS v2 upsert with `ignoreDuplicates`.

**Reference spec:** [docs/superpowers/specs/2026-05-12-curated-seed-repos-design.md](../specs/2026-05-12-curated-seed-repos-design.md)

---

## File Structure

- Create: `config/curated-repos.json` — the 15 curated URLs (data)
- Create: `src/seed/curatedRepos.js` — `seedCuratedRepos()` loader (~40 LOC)
- Create: `tests/seed-curated.test.js` — 6 vitest cases
- Modify: `src/index.js` — 1 import + 1 await call inside `main()`
- Modify: `docs/roadmap.md` — mark section B as done

---

## Task 1: Create the curated list JSON

**Files:**

- Create: `config/curated-repos.json`

- [ ] **Step 1: Create the directory and file**

```bash
mkdir -p config
```

Then write `config/curated-repos.json` with the 15 entries:

```json
[
  {
    "url": "https://github.com/anthropics/skills",
    "reason": "Official — source of truth for Agent Skills"
  },
  {
    "url": "https://github.com/mattpocock/skills",
    "reason": "Skills for Real Engineers (Matt Pocock)"
  },
  {
    "url": "https://github.com/addyosmani/agent-skills",
    "reason": "Production-grade engineering skills for AI coding agents"
  },
  {
    "url": "https://github.com/forrestchang/andrej-karpathy-skills",
    "reason": "CLAUDE.md derived from Andrej Karpathy's observations on LLM coding pitfalls"
  },
  {
    "url": "https://github.com/safishamsi/graphify",
    "reason": "Knowledge-graph skill — turn any folder into a queryable graph"
  },
  {
    "url": "https://github.com/cline/cline",
    "reason": "Autonomous coding agent inside the IDE — system prompts and tool definitions live in code"
  },
  {
    "url": "https://github.com/Kilo-Org/kilocode",
    "reason": "All-in-one agentic engineering platform — heavy .ts/.js"
  },
  {
    "url": "https://github.com/langchain-ai/open-swe",
    "reason": "Open-source async coding agent"
  },
  {
    "url": "https://github.com/paperclipai/paperclip",
    "reason": "Open-source orchestration for zero-human companies"
  },
  {
    "url": "https://github.com/openclaw/openclaw",
    "reason": "Personal AI assistant — agent loop in code"
  },
  {
    "url": "https://github.com/nousresearch/hermes-agent",
    "reason": "NousResearch's agent platform"
  },
  {
    "url": "https://github.com/davila7/claude-code-templates",
    "reason": "CLI tool for configuring and monitoring Claude Code"
  },
  {
    "url": "https://github.com/gsd-build/get-shit-done",
    "reason": "Meta-prompting and context-engineering system (TÂCHES)"
  },
  {
    "url": "https://github.com/Fission-AI/openspec",
    "reason": "Spec-driven development for AI coding assistants"
  },
  {
    "url": "https://github.com/microsoft/vscode-chat-customizations-evaluation",
    "reason": "Microsoft's eval rig for chat customizations"
  }
]
```

- [ ] **Step 2: Validate the JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('config/curated-repos.json','utf8')).length" `
Expected: `15`

- [ ] **Step 3: Commit**

```bash
git add config/curated-repos.json
git commit -m "feat(config): add curated seed repos list (15 entries)"
```

---

## Task 2: TDD `seedCuratedRepos()` — write the tests

**Files:**

- Create: `tests/seed-curated.test.js`

- [ ] **Step 1: Write the test file**

```js
// tests/seed-curated.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockSupabase = { from: vi.fn() }
const mockReadFile = vi.fn()
const mockLoggerWarn = vi.fn()
const mockLoggerInfo = vi.fn()

vi.mock('../src/db/supabaseClient.js', () => ({ supabase: mockSupabase }))
vi.mock('node:fs/promises', () => ({ readFile: mockReadFile }))
vi.mock('../src/utils/logger.js', () => ({
  default: { warn: mockLoggerWarn, info: mockLoggerInfo, error: vi.fn() }
}))

const { seedCuratedRepos } = await import('../src/seed/curatedRepos.js')

function upsertChain(result = { data: [], error: null }) {
  const chain = {
    upsert: vi.fn().mockReturnThis(),
    select: vi.fn().mockResolvedValue(result)
  }
  return chain
}

beforeEach(() => {
  mockSupabase.from.mockReset()
  mockReadFile.mockReset()
  mockLoggerWarn.mockReset()
  mockLoggerInfo.mockReset()
})

describe('seedCuratedRepos', () => {
  it('warns and returns zero when the file is missing', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockReadFile.mockRejectedValue(err)

    const result = await seedCuratedRepos()

    expect(result).toEqual({ inserted: 0, skipped: 0, invalid: 0 })
    expect(mockLoggerWarn).toHaveBeenCalledWith(expect.stringMatching(/curated-repos\.json/i))
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  it('throws when the JSON is malformed', async () => {
    mockReadFile.mockResolvedValue('not json {')

    await expect(seedCuratedRepos()).rejects.toThrow(/json|parse/i)
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  it('returns zero and does not call supabase when the list is empty', async () => {
    mockReadFile.mockResolvedValue('[]')

    const result = await seedCuratedRepos()

    expect(result).toEqual({ inserted: 0, skipped: 0, invalid: 0 })
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  it('skips entries missing a url field or with invalid github URLs', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { reason: 'no url here' },
        { url: 'https://gitlab.com/owner/repo' },
        { url: 'not-a-url' },
        { url: 'https://github.com/anthropics/skills' }
      ])
    )
    const chain = upsertChain({
      data: [{ repo_url: 'https://github.com/anthropics/skills' }],
      error: null
    })
    mockSupabase.from.mockReturnValue(chain)

    const result = await seedCuratedRepos()

    expect(result.invalid).toBe(3)
    expect(result.inserted).toBe(1)
    expect(chain.upsert).toHaveBeenCalledWith(
      [{ repo_url: 'https://github.com/anthropics/skills', status: 'pending' }],
      { onConflict: 'repo_url', ignoreDuplicates: true }
    )
  })

  it('calls upsert with ignoreDuplicates and tracks inserted vs skipped', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { url: 'https://github.com/a/b' },
        { url: 'https://github.com/c/d' },
        { url: 'https://github.com/e/f' }
      ])
    )
    // Two URLs were new (returned), one was an existing-row no-op
    const chain = upsertChain({
      data: [{ repo_url: 'https://github.com/a/b' }, { repo_url: 'https://github.com/c/d' }],
      error: null
    })
    mockSupabase.from.mockReturnValue(chain)

    const result = await seedCuratedRepos()

    expect(result).toEqual({ inserted: 2, skipped: 1, invalid: 0 })
    expect(mockSupabase.from).toHaveBeenCalledWith('repos')
    expect(chain.upsert).toHaveBeenCalledTimes(1)
    expect(chain.upsert.mock.calls[0][1]).toEqual({
      onConflict: 'repo_url',
      ignoreDuplicates: true
    })
  })

  it('normalises owner to lowercase and strips trailing slash', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { url: 'https://github.com/Kilo-Org/kilocode/' },
        { url: 'https://github.com/Fission-AI/openspec' }
      ])
    )
    const chain = upsertChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    await seedCuratedRepos()

    const rows = chain.upsert.mock.calls[0][0]
    expect(rows).toEqual([
      { repo_url: 'https://github.com/kilo-org/kilocode', status: 'pending' },
      { repo_url: 'https://github.com/fission-ai/openspec', status: 'pending' }
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/seed-curated.test.js
```

Expected: FAIL with `Cannot find module '../src/seed/curatedRepos.js'` (the module doesn't exist yet).

---

## Task 3: Implement `seedCuratedRepos()`

**Files:**

- Create: `src/seed/curatedRepos.js`

- [ ] **Step 1: Create the directory and the module**

```bash
mkdir -p src/seed
```

Then write `src/seed/curatedRepos.js`:

```js
import { readFile } from 'node:fs/promises'
import { supabase } from '../db/supabaseClient.js'
import logger from '../utils/logger.js'

const CONFIG_PATH = new URL('../../config/curated-repos.json', import.meta.url)

// Matches https://github.com/<owner>/<repo>[/] and captures owner/repo.
// Disallows extra path segments (e.g. /blob/main/x.md).
const GITHUB_URL_RE = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)\/?$/

function normaliseGithubUrl(url) {
  const match = GITHUB_URL_RE.exec(url)
  if (!match) return null
  const owner = match[1].toLowerCase()
  const repo = match[2]
  return `https://github.com/${owner}/${repo}`
}

/**
 * Seed the `repos` table with curated URLs that may not surface from search.
 * Idempotent: existing rows are left untouched.
 *
 * @returns {Promise<{inserted: number, skipped: number, invalid: number}>}
 */
export async function seedCuratedRepos() {
  let raw
  try {
    raw = await readFile(CONFIG_PATH, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger.warn(`No curated-repos.json found at ${CONFIG_PATH.pathname}; skipping seed.`)
      return { inserted: 0, skipped: 0, invalid: 0 }
    }
    throw err
  }

  let entries
  try {
    entries = JSON.parse(raw)
  } catch (err) {
    throw new Error(`curated-repos.json: invalid JSON — ${err.message}`)
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    return { inserted: 0, skipped: 0, invalid: 0 }
  }

  const seen = new Set()
  const rows = []
  let invalid = 0

  for (const entry of entries) {
    if (!entry || typeof entry.url !== 'string') {
      logger.warn(`curated-repos: skipping entry without url: ${JSON.stringify(entry)}`)
      invalid++
      continue
    }
    const normalised = normaliseGithubUrl(entry.url)
    if (!normalised) {
      logger.warn(`curated-repos: skipping invalid GitHub URL: ${entry.url}`)
      invalid++
      continue
    }
    if (seen.has(normalised)) continue
    seen.add(normalised)
    rows.push({ repo_url: normalised, status: 'pending' })
  }

  if (rows.length === 0) {
    return { inserted: 0, skipped: 0, invalid }
  }

  const { data, error } = await supabase
    .from('repos')
    .upsert(rows, { onConflict: 'repo_url', ignoreDuplicates: true })
    .select()

  if (error) {
    throw new Error(`curated-repos: supabase upsert failed — ${error.message}`)
  }

  const inserted = data?.length ?? 0
  const skipped = rows.length - inserted

  logger.info(
    `Seeded ${inserted} new curated repos (${skipped} already in DB, ${invalid} invalid skipped).`
  )

  return { inserted, skipped, invalid }
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npm test -- tests/seed-curated.test.js
```

Expected: 6 tests pass.

- [ ] **Step 3: Run the full suite**

```bash
npm test
```

Expected: 15 tests pass (9 existing + 6 new). Lint clean (husky pre-commit will catch).

- [ ] **Step 4: Commit**

```bash
git add src/seed/curatedRepos.js tests/seed-curated.test.js
git commit -m "feat(seed): add seedCuratedRepos() loader with 6 vitest cases"
```

---

## Task 4: Wire into `src/index.js` and update roadmap

**Files:**

- Modify: `src/index.js` (top of `main()`, inside `!resumeOnly` branch)
- Modify: `docs/roadmap.md` (mark section B as done)

- [ ] **Step 1: Add the import to `src/index.js`**

In `src/index.js`, add this import after the existing imports at the top of the file (alongside the others, alphabetically near `searchRepos`):

```js
import { seedCuratedRepos } from './seed/curatedRepos.js'
```

- [ ] **Step 2: Call `seedCuratedRepos()` in `main()`**

Locate the `main()` function. Find the block:

```js
if (resumeOnly) {
  logger.info('Pipeline completed (resume-only).')
  return
}

// 2. Fan out to GitHub search for new candidates.
const repos = await searchRepos(query)
```

This currently sits inside the `try { ... } catch` of `main()`. The seed must run **before** `findResumableRepos()` (so the curated rows are visible as `pending` when resumable scan runs), and **only in non-resume mode** (per spec).

Refactor the top of `main()`'s `try` block. Find:

```js
  try {
    // 1. Resume any repos that were left mid-flight.
    const resumable = await findResumableRepos()
```

Replace with:

```js
  try {
    // 1. Seed the curated list (skipped in --resume mode per spec).
    if (!resumeOnly) {
      await seedCuratedRepos()
    }

    // 2. Resume any repos that were left mid-flight (now including freshly seeded pending rows).
    const resumable = await findResumableRepos()
```

Then update the comment on the search block from `// 2. Fan out…` to `// 3. Fan out…` for accuracy.

- [ ] **Step 3: Run full verification**

```bash
npm test && npm run lint
```

Expected: 15 tests pass, lint clean.

- [ ] **Step 4: Smoke test (optional but recommended)**

If the Supabase local stack is running (`supabase status --local`), do a dry run with `--resume` to confirm the wiring doesn't break the resume path:

```bash
node src/index.js --resume
```

Expected: log says "resume-only mode", does NOT log "Seeded …" (because of the `!resumeOnly` guard).

To actually exercise the seed locally:

```bash
node src/index.js "" 2>&1 | head -30
```

Expected log (early lines):

```
[INFO] Starting pipeline (query: "")
[INFO] Seeded 15 new curated repos (0 already in DB, 0 invalid skipped).
[INFO] Resuming 15 repo(s) from previous runs.
```

(If repos with these URLs are already in the DB from prior runs, the counts shift accordingly — that's correct idempotent behaviour.)

- [ ] **Step 5: Update `docs/roadmap.md`**

Open `docs/roadmap.md`. Find section "### B. Lista curada de repos seed" (around line 46). Replace the section heading and content from "### B. Lista curada…" through the end of the section (the description and the JSON example) with:

```markdown
### ✅ B. Lista curada de repos seed (feito 2026-05-12)

Implementado em `src/seed/curatedRepos.js` + `config/curated-repos.json` (15 entries iniciais). O loader corre no arranque de `main()` antes do `findResumableRepos`, inserindo URLs novas com `status='pending'`. Idempotente via `ON CONFLICT DO NOTHING` — re-runs não tocam em repos já processados. Skipped em modo `--resume`.

Adicionar novos repos canónicos: editar `config/curated-repos.json` e correr `npm start` (com ou sem query). Reanalisar repos existentes continua a ser via `UPDATE repos SET status='pending' WHERE id=?`.
```

Then in the "## Ordem sugerida" section at the bottom, remove "(B) Lista curada — quando quiseres garantir cobertura." from the numbered list (it's now done).

- [ ] **Step 6: Commit**

```bash
git add src/index.js docs/roadmap.md
git commit -m "feat(pipeline): wire seedCuratedRepos() into main() before findResumableRepos"
```

---

## Notes for the implementer

- The loader uses `new URL('../../config/curated-repos.json', import.meta.url)` so the path is independent of cwd. Pipeline is normally launched from project root, but this also lets tests / sub-tools call the seed without cd'ing.
- `ignoreDuplicates: true` is supabase-js v2 syntax for `INSERT … ON CONFLICT DO NOTHING`. The `.select()` after is required for `data` to be populated.
- Do not touch `processRepo()` or anything downstream — the seed only inserts rows; everything else is reuse.
- `npm run build` while `npm run dev` is running breaks the dev server's `.next/`. Use `npm run verify:ui` (tsc + eslint, no build) for UI validation. (Not relevant for this plan but worth keeping in mind.)
- Husky pre-commit (prettier + eslint) will format the JSON and the JS. Don't bypass with `--no-verify`.
