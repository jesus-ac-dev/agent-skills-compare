# LLM Provider Selector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a header selector in the Next.js UI that switches the pipeline's LLM classifier between Groq, Gemini, and a new Claude CLI subprocess provider, with the choice persisted in a `settings` table and consumed once at pipeline startup.

**Architecture:** A `BaseProvider` abstract class with one concrete class per provider (each owns invocation, parsing, retries, errors). A factory reads `settings.llm_provider` from Supabase, caches the instance, and exposes it to the pipeline. New API routes under `/api/settings/llm-provider` expose the current value, an updater, and a per-provider health probe. The UI mounts a `<ProviderSelect>` in the header that calls those endpoints, disabled while a run is active.

**Tech Stack:** Node.js ESM, Next.js 15 (App Router) + Turbopack, Supabase JS, vitest, TypeScript (UI only), shadcn/ui (DropdownMenu), Tailwind v4.

**Reference spec:** [docs/superpowers/specs/2026-05-12-llm-provider-selector-design.md](../specs/2026-05-12-llm-provider-selector-design.md)

---

## File Structure

**Backend (pipeline) — ESM JS:**

- Create: `src/analysis/providers/BaseProvider.js` — abstract interface
- Create: `src/analysis/providers/factory.js` — registry + `getActiveProvider()`
- Create: `src/analysis/providers/groqProvider.js` — moves logic from `groqClient.js`, exports `GroqProvider` + `GroqDailyQuotaError`
- Create: `src/analysis/providers/geminiProvider.js` — moves logic from `geminiClient.js`, exports `GeminiProvider` + `GeminiError`
- Create: `src/analysis/providers/claudeCliProvider.js` — new, exports `ClaudeCliProvider` + `ClaudeCliError` + `ClaudeCliQuotaError`
- Delete: `src/analysis/groqClient.js` (after move)
- Delete: `src/analysis/geminiClient.js` (after move)
- Modify: `src/analysis/classifyProject.js` — replace direct `analyzeContent` import with `getActiveProvider()`
- Modify: `src/index.js` — import `GroqDailyQuotaError` from new path; rename references; add factory warm-up log

**Database:**

- Create: `supabase/migrations/20260512100000_create_settings_table.sql` — table + RLS + seed

**Server-side Next bridge:**

- Create: `lib/supabase-server.ts` — service-role Supabase client for API routes

**API routes:**

- Create: `app/api/settings/llm-provider/route.ts` — `GET` + `PUT`
- Create: `app/api/settings/llm-provider/health/route.ts` — `GET`

**UI:**

- Create: `lib/use-provider-settings.ts` — hook (current + available + mutate)
- Create: `components/ui/dropdown-menu.tsx` — shadcn primitive (installed via CLI)
- Create: `components/provider-select.tsx` — header dropdown
- Modify: `app/layout.tsx` — mount `<ProviderSelect />` before nav links

**Tests:**

- Create: `tests/providers/factory.test.js` — factory caching + fallback + unknown name
- Create: `tests/providers/claudeCli.test.js` — spawn mocked; parse, retry, quota, healthCheck
- Modify: `tests/classify-schema.test.js` — update import to new provider path

---

## Task 1: Create `settings` table migration

**Files:**

- Create: `supabase/migrations/20260512100000_create_settings_table.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260512100000_create_settings_table.sql

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

CREATE TRIGGER settings_set_updated_at
  BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY settings_read_anon ON settings
  FOR SELECT USING (true);
-- No write policy: anon cannot write; service_role bypasses RLS.

INSERT INTO settings (key, value) VALUES ('llm_provider', 'groq')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Apply locally**

Run: `supabase migration up`
Expected: `Applying migration 20260512100000_create_settings_table.sql...` then `Local database is up to date.`

- [ ] **Step 3: Verify via REST**

Run (replace ANON_KEY with `NEXT_PUBLIC_SUPABASE_ANON_KEY` from `.env`):

```bash
curl -s "http://127.0.0.1:54221/rest/v1/settings?select=*" \
  -H "apikey: <ANON_KEY>" | jq
```

Expected: `[{"key":"llm_provider","value":"groq","updated_at":"..."}]`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260512100000_create_settings_table.sql
git commit -m "feat(db): add settings table with llm_provider seed"
```

---

## Task 2: `BaseProvider` abstract class

**Files:**

- Create: `src/analysis/providers/BaseProvider.js`

- [ ] **Step 1: Write the abstract class**

```js
// src/analysis/providers/BaseProvider.js

/**
 * Abstract interface every LLM provider implements.
 * Concrete subclasses live in this folder and own everything they need
 * (invocation, parsing, retries, provider-specific errors).
 */
export class BaseProvider {
  /**
   * @param {string} content - File content to classify.
   * @param {string} prompt  - System prompt (already includes vocabulary).
   * @param {object} options
   * @param {object} [options.schema]      - JSON Schema describing expected output.
   * @param {number} [options.temperature] - Sampling temperature (0–1). May be ignored.
   * @returns {Promise<object>}
   */
  async analyzeContent(_content, _prompt, _options) {
    throw new Error(`${this.constructor.name}: analyzeContent not implemented`)
  }

  /**
   * Cheap probe — no LLM call. Tells the UI whether the provider is usable.
   * @returns {Promise<{available: boolean, reason?: string}>}
   */
  async healthCheck() {
    throw new Error(`${this.constructor.name}: healthCheck not implemented`)
  }

  get name() {
    return this.constructor.providerName
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/analysis/providers/BaseProvider.js
git commit -m "feat(providers): add BaseProvider abstract interface"
```

---

## Task 3: Move `groqClient.js` → `groqProvider.js`

This is a refactor with no behaviour change — all logic from the existing 159-line file moves into a class. Tests covering Groq behaviour today will be re-pointed in a later task; this task verifies via lint and a manual `npm test` (which will still pass because no test currently imports the symbols directly, except via `classifyProject`).

**Files:**

- Create: `src/analysis/providers/groqProvider.js`
- Modify: `src/index.js:4` — update import path + rename `DailyQuotaExceededError` → `GroqDailyQuotaError`
- Modify: `src/index.js:208` — rename usage
- Modify: `src/index.js:291` — rename usage
- Delete: `src/analysis/groqClient.js`

- [ ] **Step 1: Create the new provider file**

````js
// src/analysis/providers/groqProvider.js
import Groq from 'groq-sdk'
import dotenv from 'dotenv'
import logger from '../../utils/logger.js'
import { BaseProvider } from './BaseProvider.js'

dotenv.config()

const MODEL_NAME = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
const MAX_RETRIES = Number(process.env.GROQ_MAX_RETRIES ?? 3)
const DEFAULT_RETRY_DELAY_MS = 5_000
const MAX_RETRY_DELAY_MS = 60_000
const MAX_DAILY_WAIT_MS = Number(process.env.GROQ_MAX_DAILY_WAIT_MS ?? 60 * 60 * 1000)
const DAILY_WAIT_BUFFER_MS = 10_000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export class GroqDailyQuotaError extends Error {
  constructor(message) {
    super(message)
    this.name = 'GroqDailyQuotaError'
  }
}

function isRateLimitError(error) {
  const status = error?.status ?? error?.response?.status
  if (status === 429) return true
  return /\b429\b|too many requests|rate.?limit/i.test(error?.message ?? '')
}

function isDailyQuotaError(error) {
  const message = error?.message ?? ''
  return /\b(tpd|rpd|per[\s-]?day|daily)\b/i.test(message)
}

function parseDailyQuotaDelayMs(message) {
  const match = String(message ?? '').match(/try again in\s+(?:(\d+)m)?(\d+(?:\.\d+)?)?\s*s/i)
  if (!match) return null
  const minutes = Number(match[1] ?? 0)
  const seconds = Number(match[2] ?? 0)
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null
  return Math.ceil((minutes * 60 + seconds) * 1000)
}

function parseRetryDelayMs(error, attempt) {
  const headers = error?.headers ?? error?.response?.headers
  const retryAfter = headers?.['retry-after']
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds)) {
      return Math.min(Math.ceil(seconds * 1000), MAX_RETRY_DELAY_MS)
    }
  }
  const message = error?.message ?? ''
  const textMatch = message.match(/try again in\s+(\d+(?:\.\d+)?)\s*s/i)
  if (textMatch) {
    return Math.min(Math.ceil(Number(textMatch[1]) * 1000), MAX_RETRY_DELAY_MS)
  }
  const backoff = DEFAULT_RETRY_DELAY_MS * 2 ** (attempt - 1)
  return Math.min(backoff, MAX_RETRY_DELAY_MS)
}

export class GroqProvider extends BaseProvider {
  static providerName = 'groq'

  #client = null

  #getClient() {
    if (!this.#client) {
      this.#client = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0 })
    }
    return this.#client
  }

  async #callWithRetry(messages, options) {
    let attempt = 0
    while (true) {
      attempt++
      try {
        return await this.#getClient().chat.completions.create({
          model: MODEL_NAME,
          messages,
          ...options
        })
      } catch (error) {
        if (isDailyQuotaError(error)) {
          const delayMs = parseDailyQuotaDelayMs(error.message)
          if (delayMs !== null && delayMs <= MAX_DAILY_WAIT_MS) {
            const totalMs = delayMs + DAILY_WAIT_BUFFER_MS
            const minutes = Math.ceil(totalMs / 60_000)
            logger.warn(
              `Groq daily quota hit — sleeping ~${minutes}min then resuming. ` +
                `(Set GROQ_MAX_DAILY_WAIT_MS to change the cap; current cap = ${Math.round(MAX_DAILY_WAIT_MS / 60_000)}min.)`
            )
            await sleep(totalMs)
            continue
          }
          logger.error(
            `Groq daily quota exceeded and wait would exceed the cap. Aborting: ${error.message}`
          )
          throw new GroqDailyQuotaError(error.message)
        }
        if (!isRateLimitError(error) || attempt > MAX_RETRIES) throw error
        const waitMs = parseRetryDelayMs(error, attempt)
        logger.warn(
          `Groq rate-limited (attempt ${attempt}/${MAX_RETRIES}). Waiting ${Math.round(waitMs / 1000)}s before retry.`
        )
        await sleep(waitMs)
      }
    }
  }

  async analyzeContent(content, prompt, options = {}) {
    const { schema, temperature } = options
    const requestOptions = {}

    if (typeof temperature === 'number') requestOptions.temperature = temperature
    if (schema) requestOptions.response_format = { type: 'json_object' }

    logger.info(`Analyzing content with Groq (${MODEL_NAME})${schema ? ' [json_object]' : ''}…`)

    const completion = await this.#callWithRetry(
      [
        { role: 'system', content: prompt },
        { role: 'user', content }
      ],
      requestOptions
    )

    const text = completion.choices?.[0]?.message?.content ?? ''

    if (schema) return JSON.parse(text)

    try {
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/{[\s\S]*}/)
      if (jsonMatch) return JSON.parse(jsonMatch[1] || jsonMatch[0])
      return { text }
    } catch {
      logger.warn('Failed to parse JSON from Groq response, returning raw text.')
      return { text }
    }
  }

  async healthCheck() {
    if (!process.env.GROQ_API_KEY) {
      return { available: false, reason: 'GROQ_API_KEY not set' }
    }
    return { available: true }
  }
}
````

- [ ] **Step 2: Update `src/index.js` import and references**

Open `src/index.js` and replace line 4:

```js
import { DailyQuotaExceededError } from './analysis/groqClient.js'
```

with:

```js
import { GroqDailyQuotaError } from './analysis/providers/groqProvider.js'
```

Then replace both occurrences of `DailyQuotaExceededError` (lines 208 and 291) with `GroqDailyQuotaError`:

```bash
# Sanity:
grep -n "DailyQuotaExceededError\|GroqDailyQuotaError" src/index.js
# Expected after edit: only GroqDailyQuotaError mentioned.
```

Note: line 112 has a comment mentioning `DailyQuotaExceededError`. Update it to `GroqDailyQuotaError` for accuracy.

- [ ] **Step 3: Delete the old file**

```bash
rm src/analysis/groqClient.js
```

- [ ] **Step 4: Verify no stale imports**

```bash
grep -rn "groqClient" src/ tests/ || echo "OK: no references"
```

Expected: `OK: no references`

- [ ] **Step 5: Run lint and existing tests**

```bash
npm run lint
npm test
```

Expected: lint clean; 9/9 tests still passing (no test imports groqClient directly; `classifyProject` still imports it, addressed in Task 6).

> ⚠️ This step will currently leave `classifyProject.js` referencing the deleted file. To keep tests green between this task and Task 6, **temporarily** point `classifyProject.js` at the new module — change line 1 from `import { analyzeContent } from './groqClient.js'` to:
>
> ```js
> import { GroqProvider } from './providers/groqProvider.js'
> const _groq = new GroqProvider()
> const analyzeContent = (...args) => _groq.analyzeContent(...args)
> ```
>
> This shim disappears in Task 6 when we wire the factory in. Without the shim, `npm test` cannot pass mid-plan.

- [ ] **Step 6: Commit**

```bash
git add src/analysis/providers/groqProvider.js src/analysis/classifyProject.js src/index.js
git rm src/analysis/groqClient.js
git commit -m "refactor(providers): move Groq client into GroqProvider class"
```

---

## Task 4: Move `geminiClient.js` → `geminiProvider.js`

Same pattern as Task 3 but simpler (no daily-quota helper, 95 lines).

**Files:**

- Create: `src/analysis/providers/geminiProvider.js`
- Delete: `src/analysis/geminiClient.js`

- [ ] **Step 1: Inspect current file**

```bash
cat src/analysis/geminiClient.js
```

Read everything before extracting — keep the exact same logic. Identify any helpers or constants.

- [ ] **Step 2: Create the new provider file**

```js
// src/analysis/providers/geminiProvider.js
import { GoogleGenerativeAI } from '@google/generative-ai'
import dotenv from 'dotenv'
import logger from '../../utils/logger.js'
import { BaseProvider } from './BaseProvider.js'

dotenv.config()

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'
const MAX_RETRIES = Number(process.env.GEMINI_MAX_RETRIES ?? 3)

export class GeminiError extends Error {
  constructor(message) {
    super(message)
    this.name = 'GeminiError'
  }
}

export class GeminiProvider extends BaseProvider {
  static providerName = 'gemini'

  #client = null

  #getClient() {
    if (!this.#client) {
      if (!process.env.GEMINI_API_KEY) {
        throw new GeminiError('GEMINI_API_KEY not set')
      }
      this.#client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    }
    return this.#client
  }

  async analyzeContent(content, prompt, options = {}) {
    // Move the body of analyzeContent from geminiClient.js here, line-for-line,
    // replacing references to module-level helpers with private methods or
    // module-level functions exported above. Preserve all retry / schema logic.
    // (See cat output in Step 1.)
    throw new Error('Replace this stub with the migrated body from geminiClient.js')
  }

  async healthCheck() {
    if (!process.env.GEMINI_API_KEY) {
      return { available: false, reason: 'GEMINI_API_KEY not set' }
    }
    return { available: true }
  }
}
```

> ⚠️ The body of `analyzeContent` above is a stub. **You must copy the real body** from `src/analysis/geminiClient.js` into the method, adjusting `this.#getClient()` for client access and `this.constructor.providerName` for logs. Do not change behaviour — this is a refactor.

- [ ] **Step 3: Delete the old file**

```bash
rm src/analysis/geminiClient.js
```

- [ ] **Step 4: Verify no stale imports**

```bash
grep -rn "geminiClient" src/ tests/ || echo "OK: no references"
```

Expected: `OK: no references` (the existing code only imports geminiClient.js via the comment in classifyProject, never as code).

- [ ] **Step 5: Run lint and tests**

```bash
npm run lint && npm test
```

Expected: clean. Gemini is not exercised by tests directly, so this is mostly a smoke check.

- [ ] **Step 6: Commit**

```bash
git add src/analysis/providers/geminiProvider.js
git rm src/analysis/geminiClient.js
git commit -m "refactor(providers): move Gemini client into GeminiProvider class"
```

---

## Task 5: Factory with cache + tests

**Files:**

- Create: `tests/providers/factory.test.js`
- Create: `src/analysis/providers/factory.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/providers/factory.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSupabase = { from: vi.fn() }

vi.mock('../../src/db/supabaseClient.js', () => ({
  supabase: mockSupabase
}))

// Mock provider modules so the factory does not try to construct real clients.
vi.mock('../../src/analysis/providers/groqProvider.js', () => ({
  GroqProvider: class {
    static providerName = 'groq'
  }
}))
vi.mock('../../src/analysis/providers/geminiProvider.js', () => ({
  GeminiProvider: class {
    static providerName = 'gemini'
  }
}))
vi.mock('../../src/analysis/providers/claudeCliProvider.js', () => ({
  ClaudeCliProvider: class {
    static providerName = 'claude-cli'
  }
}))

function chainableSelect(result) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result)
  }
}

beforeEach(() => {
  mockSupabase.from.mockReset()
  vi.resetModules()
})

describe('getActiveProvider', () => {
  it('returns the provider named in settings.llm_provider', async () => {
    mockSupabase.from.mockReturnValue(chainableSelect({ data: { value: 'gemini' }, error: null }))
    const { getActiveProvider } = await import('../../src/analysis/providers/factory.js')
    const provider = await getActiveProvider()
    expect(provider.constructor.providerName).toBe('gemini')
  })

  it('falls back to groq when the row is missing', async () => {
    mockSupabase.from.mockReturnValue(chainableSelect({ data: null, error: null }))
    const { getActiveProvider } = await import('../../src/analysis/providers/factory.js')
    const provider = await getActiveProvider()
    expect(provider.constructor.providerName).toBe('groq')
  })

  it('throws on an unknown provider name', async () => {
    mockSupabase.from.mockReturnValue(chainableSelect({ data: { value: 'mystery' }, error: null }))
    const { getActiveProvider } = await import('../../src/analysis/providers/factory.js')
    await expect(getActiveProvider()).rejects.toThrow(/Unknown provider: mystery/)
  })

  it('caches the resolved instance across calls', async () => {
    mockSupabase.from.mockReturnValue(chainableSelect({ data: { value: 'groq' }, error: null }))
    const { getActiveProvider } = await import('../../src/analysis/providers/factory.js')
    const a = await getActiveProvider()
    const b = await getActiveProvider()
    expect(a).toBe(b)
    expect(mockSupabase.from).toHaveBeenCalledTimes(1)
  })
})

describe('listProviders', () => {
  it('returns all registered provider names', async () => {
    const { listProviders } = await import('../../src/analysis/providers/factory.js')
    expect(listProviders().sort()).toEqual(['claude-cli', 'gemini', 'groq'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/providers/factory.test.js
```

Expected: FAIL with `Cannot find module '../../src/analysis/providers/factory.js'`.

- [ ] **Step 3: Write the factory**

```js
// src/analysis/providers/factory.js
import { supabase } from '../../db/supabaseClient.js'
import logger from '../../utils/logger.js'
import { GroqProvider } from './groqProvider.js'
import { GeminiProvider } from './geminiProvider.js'
import { ClaudeCliProvider } from './claudeCliProvider.js'

const REGISTRY = {
  [GroqProvider.providerName]: GroqProvider,
  [GeminiProvider.providerName]: GeminiProvider,
  [ClaudeCliProvider.providerName]: ClaudeCliProvider
}

let cached = null

export async function getActiveProvider() {
  if (cached) return cached
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'llm_provider')
    .single()
  if (error) {
    logger.warn(`settings lookup failed (${error.message}); defaulting to groq`)
  }
  const name = data?.value ?? 'groq'
  const Cls = REGISTRY[name]
  if (!Cls) throw new Error(`Unknown provider: ${name}`)
  cached = new Cls()
  logger.info(`Active LLM provider: ${name}`)
  return cached
}

export function listProviders() {
  return Object.keys(REGISTRY)
}

// Only exposed for tests that need a fresh cache.
export function _resetCacheForTests() {
  cached = null
}
```

> Note: `ClaudeCliProvider` does not exist yet — this import will fail when the factory is loaded in production. That is fine because:
>
> 1. The tests in Step 1 mock it.
> 2. Task 7 creates the real `claudeCliProvider.js` before the factory is wired into the pipeline (Task 8).

To keep the tests green between this task and Task 7, **create a stub file** at the same time as the factory:

```js
// src/analysis/providers/claudeCliProvider.js — STUB, replaced in Task 7
import { BaseProvider } from './BaseProvider.js'
export class ClaudeCliError extends Error {}
export class ClaudeCliQuotaError extends ClaudeCliError {}
export class ClaudeCliProvider extends BaseProvider {
  static providerName = 'claude-cli'
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/providers/factory.test.js
```

Expected: 5 tests pass.

- [ ] **Step 5: Run full test suite + lint**

```bash
npm test && npm run lint
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/analysis/providers/factory.js src/analysis/providers/claudeCliProvider.js tests/providers/factory.test.js
git commit -m "feat(providers): add factory with DB-driven provider selection"
```

---

## Task 6: Wire factory into the pipeline

**Files:**

- Modify: `src/analysis/classifyProject.js` — replace the shim from Task 3 with the factory call

- [ ] **Step 1: Replace the shim with the factory call**

In `src/analysis/classifyProject.js`, replace the temporary shim at lines 1–N (added in Task 3) and the call to `analyzeContent` inside `classifyProject` so the final file looks like:

```js
// src/analysis/classifyProject.js
import { getActiveProvider } from './providers/factory.js'
import { loadClosedVocabulary } from '../db/lookups.js'

function buildSystemPrompt({ classes, domains }) {
  // ...unchanged body from current file...
}

export function buildClassifyResponseSchema({ classes, domains }) {
  // ...unchanged body from current file...
}

export async function classifyProject(content) {
  const vocab = await loadClosedVocabulary()
  const schema = buildClassifyResponseSchema(vocab)
  const prompt = buildSystemPrompt(vocab)
  const provider = await getActiveProvider()
  return await provider.analyzeContent(content, prompt, {
    schema,
    temperature: 0.4
  })
}
```

Keep `buildSystemPrompt` and `buildClassifyResponseSchema` bodies exactly as they are today — only the import line and the function body of `classifyProject` change.

- [ ] **Step 2: Update the existing test that imports from `classifyProject`**

Open `tests/classify-schema.test.js` and add a mock for the factory at the top, alongside any existing mocks:

```js
import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/analysis/providers/factory.js', () => ({
  getActiveProvider: vi.fn().mockResolvedValue({
    analyzeContent: vi.fn().mockResolvedValue({})
  })
}))

// ...rest of existing test stays unchanged...
```

If the existing test does not actually call `classifyProject` (just `buildClassifyResponseSchema`), the mock may not be strictly needed — but adding it is safe and avoids surprise once the factory loads at import time.

- [ ] **Step 3: Run tests + lint**

```bash
npm test && npm run lint
```

Expected: 14 tests pass (9 existing + 5 from Task 5). Lint clean.

- [ ] **Step 4: Commit**

```bash
git add src/analysis/classifyProject.js tests/classify-schema.test.js
git commit -m "feat(pipeline): wire LLM provider factory into classifyProject"
```

---

## Task 7: `ClaudeCliProvider` with tests

The biggest new piece. Replaces the stub from Task 5.

**Files:**

- Create: `tests/providers/claudeCli.test.js`
- Modify: `src/analysis/providers/claudeCliProvider.js` (replaces stub)

- [ ] **Step 1: Write the failing test**

```js
// tests/providers/claudeCli.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

const mockSpawn = vi.fn()

vi.mock('child_process', () => ({
  spawn: mockSpawn
}))

const { ClaudeCliProvider, ClaudeCliError, ClaudeCliQuotaError } =
  await import('../../src/analysis/providers/claudeCliProvider.js')

function fakeChild({ stdout = '', stderr = '', exitCode = 0 } = {}) {
  const child = new EventEmitter()
  child.stdin = { write: vi.fn(), end: vi.fn() }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  queueMicrotask(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout))
    if (stderr) child.stderr.emit('data', Buffer.from(stderr))
    child.emit('exit', exitCode, null)
  })
  return child
}

const validEnvelope = (resultObj) =>
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    result: JSON.stringify(resultObj),
    session_id: 'abc',
    duration_ms: 123
  })

const sampleResult = {
  summary: 'sample summary at least eighty chars long, mentioning concrete behaviour of the file',
  maturity: 'stable',
  score: 7,
  class: 'skill',
  domains: ['backend'],
  activities: ['debugging'],
  tags: ['python'],
  use_cases: [{ title: 'x', description: 'y' }]
}

beforeEach(() => {
  mockSpawn.mockReset()
})

describe('ClaudeCliProvider.analyzeContent', () => {
  it('parses two-level JSON on happy path', async () => {
    mockSpawn.mockReturnValueOnce(fakeChild({ stdout: validEnvelope(sampleResult) }))
    const provider = new ClaudeCliProvider()
    const out = await provider.analyzeContent('content here', 'prompt', {
      schema: {},
      temperature: 0.4
    })
    expect(out).toEqual(sampleResult)
    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      ['--print', '--output-format', 'json'],
      expect.any(Object)
    )
  })

  it('retries once when the inner JSON fails to parse, then succeeds', async () => {
    const badEnvelope = JSON.stringify({ type: 'result', subtype: 'success', result: 'not json' })
    mockSpawn
      .mockReturnValueOnce(fakeChild({ stdout: badEnvelope }))
      .mockReturnValueOnce(fakeChild({ stdout: validEnvelope(sampleResult) }))
    const provider = new ClaudeCliProvider()
    const out = await provider.analyzeContent('c', 'p', { schema: {} })
    expect(out).toEqual(sampleResult)
    expect(mockSpawn).toHaveBeenCalledTimes(2)
  })

  it('throws ClaudeCliError when both attempts fail to parse', async () => {
    const badEnvelope = JSON.stringify({ type: 'result', subtype: 'success', result: 'not json' })
    mockSpawn
      .mockReturnValueOnce(fakeChild({ stdout: badEnvelope }))
      .mockReturnValueOnce(fakeChild({ stdout: badEnvelope }))
    const provider = new ClaudeCliProvider()
    await expect(provider.analyzeContent('c', 'p', { schema: {} })).rejects.toBeInstanceOf(
      ClaudeCliError
    )
  })

  it('throws ClaudeCliQuotaError on exit≠0 with quota-shaped stderr', async () => {
    mockSpawn.mockReturnValueOnce(
      fakeChild({ stderr: 'usage limit reached, try again later', exitCode: 1 })
    )
    const provider = new ClaudeCliProvider()
    await expect(provider.analyzeContent('c', 'p', { schema: {} })).rejects.toBeInstanceOf(
      ClaudeCliQuotaError
    )
  })

  it('throws ClaudeCliQuotaError when envelope subtype is error with quota-shaped message', async () => {
    const errorEnvelope = JSON.stringify({
      type: 'result',
      subtype: 'error',
      result: 'weekly limit exceeded for this account'
    })
    mockSpawn.mockReturnValueOnce(fakeChild({ stdout: errorEnvelope }))
    const provider = new ClaudeCliProvider()
    await expect(provider.analyzeContent('c', 'p', { schema: {} })).rejects.toBeInstanceOf(
      ClaudeCliQuotaError
    )
  })
})

describe('ClaudeCliProvider.healthCheck', () => {
  it('returns available:true when `claude --version` exits 0', async () => {
    mockSpawn.mockReturnValueOnce(fakeChild({ stdout: 'claude 1.2.3', exitCode: 0 }))
    const provider = new ClaudeCliProvider()
    const result = await provider.healthCheck()
    expect(result).toEqual({ available: true })
  })

  it('returns available:false with reason when `claude` is missing', async () => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    queueMicrotask(() =>
      child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))
    )
    mockSpawn.mockReturnValueOnce(child)
    const provider = new ClaudeCliProvider()
    const result = await provider.healthCheck()
    expect(result.available).toBe(false)
    expect(result.reason).toMatch(/not found|ENOENT/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/providers/claudeCli.test.js
```

Expected: FAIL — the stub provider has no `analyzeContent`, so the first test errors out.

- [ ] **Step 3: Implement the provider**

```js
// src/analysis/providers/claudeCliProvider.js
import { spawn } from 'child_process'
import logger from '../../utils/logger.js'
import { BaseProvider } from './BaseProvider.js'

const QUOTA_REGEX = /rate.?limit|usage.?limit|weekly.?limit|too many/i
const REQUIRED_KEYS = [
  'summary',
  'maturity',
  'score',
  'class',
  'domains',
  'activities',
  'tags',
  'use_cases'
]

export class ClaudeCliError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ClaudeCliError'
  }
}

export class ClaudeCliQuotaError extends ClaudeCliError {
  constructor(message) {
    super(message)
    this.name = 'ClaudeCliQuotaError'
  }
}

export class ClaudeCliProvider extends BaseProvider {
  static providerName = 'claude-cli'

  #warnedTemperature = false

  #buildPrompt(content, prompt, schema, correction) {
    const parts = [
      prompt,
      '',
      'Schema to match (JSON Schema):',
      JSON.stringify(schema),
      '',
      'Content to classify:',
      content,
      '',
      'Respond with ONLY the raw JSON object matching the schema. No prose, no markdown fences.'
    ]
    if (correction) {
      parts.push('')
      parts.push(
        `Your previous response was not valid JSON. Error: ${correction}. Return ONLY the JSON object.`
      )
    }
    return parts.join('\n')
  }

  async #invokeCli(fullPrompt) {
    return await new Promise((resolve, reject) => {
      const child = spawn('claude', ['--print', '--output-format', 'json'], {
        cwd: process.cwd(),
        env: { ...process.env }
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })
      child.on('error', (err) => reject(err))
      child.on('exit', (code) => {
        if (code !== 0) {
          if (QUOTA_REGEX.test(stderr)) {
            return reject(new ClaudeCliQuotaError(`claude CLI quota: ${stderr.trim()}`))
          }
          return reject(
            new ClaudeCliError(`claude CLI exited ${code}: ${stderr.trim() || stdout.trim()}`)
          )
        }
        resolve(stdout)
      })
      child.stdin.write(fullPrompt)
      child.stdin.end()
    })
  }

  async analyzeContent(content, prompt, options = {}) {
    const { schema, temperature } = options
    if (typeof temperature === 'number' && !this.#warnedTemperature) {
      logger.warn('ClaudeCliProvider: `temperature` is ignored — Claude CLI does not expose it.')
      this.#warnedTemperature = true
    }

    let correction = null
    for (let attempt = 1; attempt <= 2; attempt++) {
      const fullPrompt = this.#buildPrompt(content, prompt, schema, correction)
      logger.info(`Analyzing content with Claude CLI (attempt ${attempt}/2)…`)

      let stdout
      try {
        stdout = await this.#invokeCli(fullPrompt)
      } catch (err) {
        // Quota/error already mapped — propagate without retry.
        throw err
      }

      let envelope
      try {
        envelope = JSON.parse(stdout)
      } catch (err) {
        throw new ClaudeCliError(
          `Could not parse CLI envelope JSON: ${err.message}; raw=${stdout.slice(0, 200)}`
        )
      }

      if (envelope.subtype === 'error') {
        if (QUOTA_REGEX.test(envelope.result ?? '')) {
          throw new ClaudeCliQuotaError(`claude CLI quota: ${envelope.result}`)
        }
        throw new ClaudeCliError(`claude CLI returned error envelope: ${envelope.result}`)
      }

      const resultText = envelope.result ?? ''
      let obj
      try {
        obj = JSON.parse(resultText)
      } catch (err) {
        if (attempt === 2) {
          throw new ClaudeCliError(
            `Invalid JSON after retry: ${err.message}; raw=${resultText.slice(0, 200)}`
          )
        }
        correction = err.message
        continue
      }

      if (typeof obj !== 'object' || obj === null) {
        if (attempt === 2) throw new ClaudeCliError('Response is not an object')
        correction = 'response was not a JSON object'
        continue
      }

      const missing = REQUIRED_KEYS.filter((k) => !(k in obj))
      if (missing.length > 0) {
        if (attempt === 2)
          throw new ClaudeCliError(`Response missing required keys: ${missing.join(', ')}`)
        correction = `response missing keys: ${missing.join(', ')}`
        continue
      }

      return obj
    }
    // Unreachable
    throw new ClaudeCliError('analyzeContent loop exited unexpectedly')
  }

  async healthCheck() {
    return await new Promise((resolve) => {
      const child = spawn('claude', ['--version'], { cwd: process.cwd(), env: { ...process.env } })
      child.on('error', (err) => {
        const reason = err.code === 'ENOENT' ? '`claude` CLI not found in PATH' : err.message
        resolve({ available: false, reason })
      })
      child.on('exit', (code) => {
        if (code === 0) resolve({ available: true })
        else resolve({ available: false, reason: `claude --version exited ${code}` })
      })
    })
  }
}
```

- [ ] **Step 4: Run tests until green**

```bash
npm test -- tests/providers/claudeCli.test.js
```

Expected: 7 tests pass.

- [ ] **Step 5: Run full suite + lint**

```bash
npm test && npm run lint
```

Expected: all green (21 tests now).

- [ ] **Step 6: Commit**

```bash
git add src/analysis/providers/claudeCliProvider.js tests/providers/claudeCli.test.js
git commit -m "feat(providers): add ClaudeCliProvider with spawn-based JSON parsing"
```

---

## Task 8: Add the resume-aware factory warm-up log in `src/index.js`

This is a small follow-up so the pipeline logs which provider was resolved at startup, useful for debugging.

**Files:**

- Modify: `src/index.js:252` area (top of `main()`)

- [ ] **Step 1: Add the warm-up line**

In `src/index.js`, near the start of `main()` (right after the `query`/`resumeOnly` parse), add:

```js
import { getActiveProvider } from './analysis/providers/factory.js'
```

(Place near the other imports at the top of the file.)

And in `main()`:

```js
async function main() {
  const args = process.argv.slice(2)
  const resumeOnly = args.includes('--resume')
  const positional = args.filter((a) => !a.startsWith('--'))
  const query = positional[0] || 'agent skills'

  const provider = await getActiveProvider()
  logger.info(
    resumeOnly
      ? `Starting pipeline (resume-only mode — provider: ${provider.name})`
      : `Starting pipeline (query: "${query}", provider: ${provider.name})`
  )
  // ...rest unchanged...
```

The factory already loaded the provider lazily inside `classifyProject`; warming it up here just makes the choice visible in logs from line 1.

- [ ] **Step 2: Run tests + manual smoke**

```bash
npm test && npm run lint
node src/index.js --resume    # should log "provider: groq" then resume (or no-op)
```

Expected: tests pass; manual run logs the provider name.

- [ ] **Step 3: Commit**

```bash
git add src/index.js
git commit -m "feat(pipeline): log active LLM provider at startup"
```

---

## Task 9: Server-side Supabase client + `GET`/`PUT` API route

**Files:**

- Create: `lib/supabase-server.ts`
- Create: `app/api/settings/llm-provider/route.ts`

- [ ] **Step 1: Create the server client**

```ts
// lib/supabase-server.ts
import { createClient } from '@supabase/supabase-js'

// service_role — server-side ONLY. Never import this from a "use client" component.
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  // Throwing at module load surfaces the misconfig early in dev.
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for server routes')
}

export const supabaseServer = createClient(url, key)
```

- [ ] **Step 2: Create the route**

```ts
// app/api/settings/llm-provider/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

const ALLOWED = new Set(['groq', 'gemini', 'claude-cli'])

export async function GET() {
  const { data, error } = await supabaseServer
    .from('settings')
    .select('value')
    .eq('key', 'llm_provider')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ current: data?.value ?? 'groq' })
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const value = body?.value
  if (typeof value !== 'string' || !ALLOWED.has(value)) {
    return NextResponse.json(
      { error: `value must be one of ${[...ALLOWED].join(', ')}` },
      { status: 400 }
    )
  }

  const { error } = await supabaseServer
    .from('settings')
    .upsert({ key: 'llm_provider', value }, { onConflict: 'key' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ current: value })
}
```

- [ ] **Step 3: Manual smoke test**

```bash
# Dev server already running on port 2000 (per CLAUDE.md / user setup):
curl -s http://localhost:2000/api/settings/llm-provider | jq
# Expected: {"current":"groq"}

curl -s -X PUT http://localhost:2000/api/settings/llm-provider \
  -H "Content-Type: application/json" \
  -d '{"value":"gemini"}' | jq
# Expected: {"current":"gemini"}

curl -s http://localhost:2000/api/settings/llm-provider | jq
# Expected: {"current":"gemini"}

# Reset for next tasks:
curl -s -X PUT http://localhost:2000/api/settings/llm-provider \
  -H "Content-Type: application/json" \
  -d '{"value":"groq"}' | jq

# Bad value:
curl -s -o /dev/null -w "%{http_code}" -X PUT http://localhost:2000/api/settings/llm-provider \
  -H "Content-Type: application/json" -d '{"value":"mystery"}'
# Expected: 400
```

- [ ] **Step 4: Lint UI**

```bash
npm run verify:ui
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/supabase-server.ts app/api/settings/llm-provider/route.ts
git commit -m "feat(api): add GET/PUT /api/settings/llm-provider"
```

---

## Task 10: Health-check API route

**Files:**

- Create: `app/api/settings/llm-provider/health/route.ts`

- [ ] **Step 1: Create the route**

```ts
// app/api/settings/llm-provider/health/route.ts
import { NextResponse } from 'next/server'
// Path is relative to this file:
//   app/api/settings/llm-provider/health/route.ts → ../../../../src/analysis/providers/...
import { GroqProvider } from '../../../../../src/analysis/providers/groqProvider.js'
import { GeminiProvider } from '../../../../../src/analysis/providers/geminiProvider.js'
import { ClaudeCliProvider } from '../../../../../src/analysis/providers/claudeCliProvider.js'

export async function GET() {
  const providers = [new GroqProvider(), new GeminiProvider(), new ClaudeCliProvider()]

  const results = await Promise.all(
    providers.map(async (p) => {
      try {
        const r = await p.healthCheck()
        return [p.constructor.providerName, r]
      } catch (err) {
        return [p.constructor.providerName, { available: false, reason: err.message }]
      }
    })
  )

  return NextResponse.json(Object.fromEntries(results))
}
```

> The relative path looks awkward. If Next.js' `@/` alias is configured to point at the repo root (check `tsconfig.json` paths), prefer:
>
> ```ts
> import { GroqProvider } from '@/src/analysis/providers/groqProvider.js'
> ```
>
> Verify in the existing `app/api/pipeline/route.ts` for the established convention before committing this file.

- [ ] **Step 2: Manual smoke test**

```bash
curl -s http://localhost:2000/api/settings/llm-provider/health | jq
# Expected shape:
# {
#   "groq":       { "available": true },
#   "gemini":     { "available": false, "reason": "GEMINI_API_KEY not set" },
#   "claude-cli": { "available": true }   # or false with ENOENT reason
# }
```

- [ ] **Step 3: Lint UI**

```bash
npm run verify:ui
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/api/settings/llm-provider/health/route.ts
git commit -m "feat(api): add GET /api/settings/llm-provider/health"
```

---

## Task 11: `useProviderSettings` hook

**Files:**

- Create: `lib/use-provider-settings.ts`

- [ ] **Step 1: Write the hook**

```ts
// lib/use-provider-settings.ts
'use client'

import { useEffect, useState, useCallback } from 'react'

const POLL_INTERVAL_MS = 30_000

export type ProviderName = 'groq' | 'gemini' | 'claude-cli'

export interface HealthMap {
  [name: string]: { available: boolean; reason?: string }
}

export function useProviderSettings() {
  const [current, setCurrent] = useState<ProviderName | null>(null)
  const [available, setAvailable] = useState<HealthMap>({})
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    try {
      const [curRes, healthRes] = await Promise.all([
        fetch('/api/settings/llm-provider').then((r) => r.json()),
        fetch('/api/settings/llm-provider/health').then((r) => r.json())
      ])
      setCurrent(curRes.current as ProviderName)
      setAvailable(healthRes as HealthMap)
    } catch (err) {
      console.error('useProviderSettings fetch failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const mutate = useCallback(
    async (name: ProviderName) => {
      const prev = current
      setCurrent(name) // optimistic
      try {
        const res = await fetch('/api/settings/llm-provider', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: name })
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || 'PUT failed')
        }
        const data = await res.json()
        setCurrent(data.current as ProviderName)
      } catch (err) {
        console.error('useProviderSettings mutate failed:', err)
        setCurrent(prev) // revert
        throw err
      }
    },
    [current]
  )

  useEffect(() => {
    refetch()
    const onFocus = () => refetch()
    window.addEventListener('focus', onFocus)
    const id = setInterval(refetch, POLL_INTERVAL_MS)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(id)
    }
  }, [refetch])

  return { current, available, loading, mutate, refetch }
}
```

- [ ] **Step 2: Lint UI**

```bash
npm run verify:ui
```

Expected: clean (TS strict + ESLint).

- [ ] **Step 3: Commit**

```bash
git add lib/use-provider-settings.ts
git commit -m "feat(ui): add useProviderSettings hook"
```

---

## Task 12: Install shadcn `DropdownMenu` primitive

**Files:**

- Create: `components/ui/dropdown-menu.tsx` (generated by shadcn CLI)

- [ ] **Step 1: Install the primitive**

```bash
npx shadcn@latest add dropdown-menu
```

Expected: prompts to confirm overwrite if file exists; creates `components/ui/dropdown-menu.tsx` and adds `@radix-ui/react-dropdown-menu` to `package.json`.

If shadcn CLI fails or you prefer manual: install the radix dep and copy the component file from the shadcn docs.

```bash
# Manual fallback:
npm install @radix-ui/react-dropdown-menu
# Then copy https://ui.shadcn.com/docs/components/dropdown-menu into components/ui/dropdown-menu.tsx
```

- [ ] **Step 2: Verify it builds**

```bash
npm run verify:ui
```

Expected: clean. The new file may have a few "unused" warnings depending on shadcn's template — they are safe to keep.

- [ ] **Step 3: Commit**

```bash
git add components/ui/dropdown-menu.tsx package.json package-lock.json
git commit -m "chore(ui): add shadcn dropdown-menu primitive"
```

---

## Task 13: `<ProviderSelect>` component

**Files:**

- Create: `components/provider-select.tsx`

- [ ] **Step 1: Write the component**

```tsx
// components/provider-select.tsx
'use client'

import { useEffect, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useProviderSettings, type ProviderName } from '@/lib/use-provider-settings'

const LABELS: Record<ProviderName, string> = {
  groq: '⚡ Groq',
  gemini: '✨ Gemini',
  'claude-cli': '🤖 Claude CLI'
}

export function ProviderSelect() {
  const { current, available, loading, mutate } = useProviderSettings()
  const [running, setRunning] = useState(false)

  // Poll the pipeline state so we can disable the selector during runs.
  useEffect(() => {
    let stopped = false
    const tick = async () => {
      try {
        const res = await fetch('/api/pipeline')
        const data = await res.json()
        if (!stopped) setRunning(!!data.running)
      } catch {
        // ignore
      }
    }
    tick()
    const id = setInterval(tick, 5_000)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [])

  if (loading || !current) {
    return <span className="text-sm text-muted-foreground">Provider: …</span>
  }

  const trigger = (
    <button
      type="button"
      disabled={running}
      className="text-sm font-medium px-2 py-1 rounded border bg-white hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
      title={running ? 'Pipeline running — wait or cancel' : 'Switch active LLM (applies next run)'}
    >
      Provider: {LABELS[current]} {running ? '(locked)' : '▾'}
    </button>
  )

  if (running) return trigger

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Switch LLM provider</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(Object.keys(LABELS) as ProviderName[]).map((name) => {
          const isCurrent = name === current
          const isAvailable = available[name]?.available
          return (
            <DropdownMenuItem
              key={name}
              onSelect={() => {
                void mutate(name)
              }}
              className="flex items-center justify-between gap-4"
            >
              <span>{LABELS[name]}</span>
              <span className="flex items-center gap-2 text-xs">
                {isCurrent && <span className="text-green-700">✓ active</span>}
                {!isCurrent && isAvailable && <span className="text-green-700">● ready</span>}
                {!isCurrent && !isAvailable && (
                  <span
                    className="text-neutral-500"
                    title={available[name]?.reason ?? 'not available'}
                  >
                    ● n/a
                  </span>
                )}
              </span>
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Applies to next run
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 2: Lint UI**

```bash
npm run verify:ui
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/provider-select.tsx
git commit -m "feat(ui): add ProviderSelect dropdown component"
```

---

## Task 14: Mount `<ProviderSelect>` in the layout

**Files:**

- Modify: `app/layout.tsx`

- [ ] **Step 1: Add the import and mount the component**

In `app/layout.tsx`, add an import next to the existing `ResumableBadge` import:

```tsx
import { ProviderSelect } from '@/components/provider-select'
```

Then in the `<nav>` block, add `<ProviderSelect />` before the existing links. Final shape of the nav:

```tsx
<nav className="flex items-center gap-6">
  <ProviderSelect />
  <Link href="/" className="text-sm font-medium hover:underline">
    Analyses
  </Link>
  <Link href="/stats" className="text-sm font-medium hover:underline">
    Stats
  </Link>
  <ResumableBadge />
</nav>
```

(Add `items-center` to the `<nav>` className if not already there, so the dropdown button aligns with the text links.)

- [ ] **Step 2: Lint + manual smoke**

```bash
npm run verify:ui
# Open http://localhost:2000 in browser:
# - Header shows: "Provider: ⚡ Groq ▾  Analyses  Stats  Run [badge]"
# - Click the provider button → dropdown opens with 3 options
# - Pick "Gemini" → header label updates, BD row changes (verify with curl)
# - Reset to Groq
```

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(ui): mount ProviderSelect in the header"
```

---

## Task 15: Full verification + plan complete

**Files:** none — verification only.

- [ ] **Step 1: Run the full verification suite**

```bash
npm test
# Expected: 21 tests passing (9 original + 5 factory + 7 claudeCli)

npm run lint
# Expected: 0 errors, 0 warnings

npm run verify:ui
# Expected: tsc clean, eslint clean
```

- [ ] **Step 2: Manual smoke checklist (browser at http://localhost:2000)**

- [ ] Provider dropdown opens, lists Groq / Gemini / Claude CLI with chips
- [ ] Switching providers updates `settings.llm_provider` in DB (verify via REST)
- [ ] `GET /api/settings/llm-provider/health` returns 3 entries
- [ ] Start a Run with provider = Groq → log mentions "provider: groq"
- [ ] Cancel Run, switch to Claude CLI, start a new Run → log mentions "provider: claude-cli" (if `claude` is in PATH)
- [ ] Provider dropdown is disabled while a Run is active

- [ ] **Step 3: Final commit if any tidy-ups**

```bash
git status
# If clean, plan is done.
```

---

## Notes for the implementer

- This plan touches both ESM JS (pipeline) and TypeScript (UI). The `tsconfig.json` already has `allowJs: true` and the project uses `"type": "module"` — no config changes needed.
- The shim in Task 3 Step 5 is intentionally ugly and goes away in Task 6. If you find the shim still present after Task 6, that is a bug.
- The factory caches the provider in module state. If you ever need to invalidate during a single Node process lifetime, use `_resetCacheForTests()` — but production callers should never need that.
- Never bypass the husky pre-commit hook with `--no-verify`. If a hook fails, fix the underlying lint/format issue.
- Never run `npm run build` while the dev server is up — it overwrites the `.next/` directory the dev process keeps in memory and every route then returns 500 until you restart `npm run dev`. Use `npm run verify:ui` (alias for `tsc --noEmit && eslint .`) instead.
