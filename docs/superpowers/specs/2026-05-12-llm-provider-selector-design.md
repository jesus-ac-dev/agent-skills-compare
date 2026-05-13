# LLM Provider Selector — Design

**Date:** 2026-05-12
**Status:** Design approved, ready for plan
**Author:** Claude (brainstorming with @jesus-ac-dev)

## Context

The pipeline classifies repo files with Groq (Llama 3.3 70B) by default and has Gemini wired up as a manual-swap fallback. There is no way to switch at runtime, and adding more providers requires editing a hard-coded import in [src/analysis/classifyProject.js:1](../../../src/analysis/classifyProject.js#L1).

We want a selector in the UI header to choose which provider the pipeline uses for the next run, with three options:

- **Groq** — existing, free tier, fast.
- **Gemini** — existing, paid tier or free with hard daily limit.
- **Claude CLI** — new. Invokes the `claude` Code CLI as a subprocess so the user's Pro/Max subscription absorbs token usage (no per-token billing).

## Goals

1. Single selector in the header changes the active LLM for the next pipeline run.
2. The pipeline (`npm start "query"` and the API-driven `/run` page) both honour the choice.
3. Adding a fourth provider in the future is a single new class file + one line in the factory registry — no other touches.
4. The user gets visible feedback if a provider is not configured (missing env var, `claude` not in PATH).

## Non-goals

- Per-run override on the `/run` page (selector is global).
- Schema-strict validation of LLM responses on all providers (status quo: rely on prompt + downstream failures).
- Mid-run provider switch (pipeline caches the choice once at startup).
- UI testing-library setup (smoke-test the selector manually for v1).

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  UI (Next.js)                                                  │
│    <ProviderSelect> in header                                  │
│      GET /api/settings/llm-provider          (anon, read)      │
│      PUT /api/settings/llm-provider          (server, write)   │
│      GET /api/settings/llm-provider/health   (server)          │
│    Disabled when /api/pipeline reports running                 │
└────────────────────┬───────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│  Supabase                                                      │
│    table settings(key TEXT PK, value TEXT, updated_at)         │
│    seed row: ('llm_provider', 'groq')                          │
│    RLS: anon SELECT, no anon write → service_role bypasses     │
└────────────────────▲───────────────────────────────────────────┘
                     │ service_role (server-side only)
                     │
┌────────────────────┴───────────────────────────────────────────┐
│  Pipeline (src/index.js → src/analysis/classifyProject.js)     │
│    main(): const provider = await getActiveProvider()          │
│    classifyProject() uses the cached provider                  │
└────────────────────────────────────────────────────────────────┘
```

**Application timing.** Pipeline reads `settings.llm_provider` once at the start of `main()` and caches the resolved provider instance in module state. UI surfaces "Applies to next run" so the user understands the boundary.

## Provider abstraction

Each provider is a class in its own file with everything it needs — invocation, parsing, retries, errors. The factory only orchestrates.

```
src/analysis/
├── classifyProject.js              ← calls getActiveProvider()
├── providers/
│   ├── BaseProvider.js             ← abstract: analyzeContent, healthCheck
│   ├── factory.js                  ← reads settings, instantiates, caches
│   ├── groqProvider.js             ← GroqProvider + GroqDailyQuotaError
│   ├── geminiProvider.js           ← GeminiProvider + GeminiError
│   └── claudeCliProvider.js        ← ClaudeCliProvider + ClaudeCliError + ClaudeCliQuotaError
```

`groqClient.js` and `geminiClient.js` are removed after their logic is moved into the matching provider files. [src/index.js:4](../../../src/index.js#L4) updates its `DailyQuotaExceededError` import to `GroqDailyQuotaError` from the new location.

### Contract (`BaseProvider`)

```js
class BaseProvider {
  /** Build prompt, invoke backend, parse, validate-minimum, return object */
  async analyzeContent(content, prompt, { schema, temperature }) → object

  /** Cheap probe — no LLM call. Returns { available, reason? } */
  async healthCheck() → { available: boolean, reason?: string }

  get name() { return this.constructor.providerName }
}
```

Each provider implements every step of the contract its own way:

| Step                | Groq                                                        | Gemini                                     | Claude CLI                                                                                         |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Prompt build        | system + content (schema lives only in system text)         | system + content + `responseSchema` native | system + content + serialised schema + "ONLY raw JSON" footer                                      |
| Invoke              | `chat.completions.create({ response_format: json_object })` | `generateContent({ responseSchema })`      | `spawn('claude', ['--print', '--output-format', 'json'])` + stdin                                  |
| Receive             | `choices[0].message.content` (string)                       | object directly                            | CLI envelope JSON; extract `result` string                                                         |
| Parse               | `JSON.parse(content)`                                       | already an object                          | `JSON.parse(stdout)` → `JSON.parse(envelope.result)` (two levels)                                  |
| Validate            | trust prompt + downstream                                   | server-side schema                         | trust prompt + minimal `typeof` and required-keys check                                            |
| Retry on parse fail | none                                                        | none                                       | up to 2 attempts, second appends correction message                                                |
| Quota error         | `GroqDailyQuotaError` from message regex                    | none (Gemini throws generic)               | `ClaudeCliQuotaError` from exit≠0 + stderr `/rate.?limit\|usage.?limit\|weekly.?limit\|too many/i` |

### Factory

```js
// src/analysis/providers/factory.js
import { supabase } from '../../db/supabaseClient.js'
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
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'llm_provider')
    .single()
  const name = data?.value ?? 'groq'
  const Cls = REGISTRY[name]
  if (!Cls) throw new Error(`Unknown provider: ${name}`)
  cached = new Cls()
  return cached
}

export function listProviders() {
  return Object.keys(REGISTRY)
}
```

## Claude CLI provider — specifics

**Invocation.** `spawn('claude', ['--print', '--output-format', 'json'])`. Prompt goes to stdin (handles long content and special chars). cwd inherited from pipeline. `claude` must be in PATH and logged in (`claude login` already run by the user).

**CLI envelope.**

```json
{
  "type": "result",
  "subtype": "success",
  "result": "<assistant message text>",
  "session_id": "...",
  "duration_ms": 1234,
  "usage": {}
}
```

**Prompt construction** (single string sent via stdin):

```
<system prompt — same as Groq today>

Schema to match (JSON Schema):
<JSON.stringify(schema)>

Content to classify:
<content>

Respond with ONLY the raw JSON object matching the schema. No prose, no markdown fences.
```

**Parse and retry.**

1. `JSON.parse(stdout)` → envelope. If fails, throw `ClaudeCliError`.
2. If `envelope.subtype === 'error'` and message matches quota regex → throw `ClaudeCliQuotaError`.
3. `JSON.parse(envelope.result)` → object. If fails, retry once with appended correction: "Your previous response was not valid JSON. Error: `<err>`. Return ONLY the JSON object."
4. Minimal validation: `typeof === 'object' && 'class' in obj && 'domains' in obj && 'use_cases' in obj`. If fails → throw `ClaudeCliError`.

**Quota detection.** Same regex applied to stderr when exit code ≠ 0, and to envelope `result` when `subtype === 'error'`. The pipeline already handles `*DailyQuotaError`-style errors gracefully — repos stay `processing` for the next run to pick up.

**Caveats:**

- `temperature` parameter is ignored — the CLI does not expose it. Provider logs a one-time warning at first call.
- Each `claude --print` call is a fresh session (no token cache between calls). Expect multi-second latency per file.

## Migration & data model

```sql
-- supabase/migrations/<timestamp>_create_settings_table.sql

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- updated_at trigger (define inline or reuse if present)
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
-- No write policy → anon cannot write; service_role bypasses RLS.

INSERT INTO settings (key, value) VALUES ('llm_provider', 'groq')
ON CONFLICT (key) DO NOTHING;
```

**Notes:**

- `key` is the natural primary key — no surrogate `BIGINT id` here. The user's "BIGINT identity PKs" preference applies to surrogate IDs, not to semantic keys like `(key, value)` lookup tables.
- Schema leaves room for future settings: `('default_query', 'agent skills')`, `('groq_model', 'llama-3.3-70b-versatile')`, etc.

## API surface (Next.js)

All three live under `app/api/settings/llm-provider/`.

### `GET /api/settings/llm-provider`

Public read. Uses anon client via PostgREST (RLS allows it).

```
→ 200 { "current": "groq" }
```

### `PUT /api/settings/llm-provider`

Server-side write. Uses `supabaseServer` (service_role). Validates the value.

```
← { "value": "claude-cli" }
→ 200 { "current": "claude-cli" }
→ 400 if value not in {groq, gemini, claude-cli}
```

### `GET /api/settings/llm-provider/health`

Server-side. Instantiates each provider class, calls `healthCheck()`.

```
→ 200 {
  "groq":       { "available": true },
  "gemini":     { "available": false, "reason": "GEMINI_API_KEY not set" },
  "claude-cli": { "available": true }
}
```

No caching for v1 — all three health checks are cheap (env-var checks and a `claude --version` spawn).

### New module: `lib/supabase-server.ts`

```ts
import { createClient } from '@supabase/supabase-js'

// service_role — NEVER ship to the browser. API routes only.
export const supabaseServer = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
```

The existing `db/supabaseClient.js` (used by the pipeline) already uses service_role from the same env vars — `lib/supabase-server.ts` mirrors it on the Next side with TS types.

## UI / UX

### `components/provider-select.tsx`

Client component placed in the header before the nav links. Uses shadcn `<DropdownMenu>` (matches the rest of the UI which already builds on shadcn primitives).

**Visual states:**

```
Idle:
┌─────────────────────────────┐
│ Provider: ⚡ Groq         ▾ │
└─────────────────────────────┘

Open dropdown:
┌─────────────────────────────┐
│ ⚡ Groq           ✓ active  │
│ ✨ Gemini         ● ready   │
│ 🤖 Claude CLI     ● ready   │
│ ─────────────────────────── │
│ "Applies to next run"       │
└─────────────────────────────┘

Run in flight:
┌─────────────────────────────┐
│ Provider: ⚡ Groq (locked)  │   ← disabled
└─────────────────────────────┘
```

**Health chip colours:**

- ● green: `available: true`
- ● grey: `available: false` with tooltip showing `reason`

User can still pick a "grey" provider — pipeline will fail with a clear error message. We prefer that over hiding the option.

### `lib/use-provider-settings.ts`

```ts
export function useProviderSettings() {
  // GET /api/settings/llm-provider — current value
  // GET /api/settings/llm-provider/health — available map
  // poll both every 30s + on window focus
  // mutate(name): optimistic update then PUT; revert + toast on error
  return { current, available, loading, mutate, refetch }
}
```

### `app/layout.tsx`

Mount `<ProviderSelect />` left of the `Analyses / Stats / Run` nav block.

## Testing

Vitest, mocking external boundaries (no real LLM calls, no real `claude` spawn).

| File                                     | What it covers                                                                                                                                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/providers/factory.test.js`        | `getActiveProvider()` reads DB, returns correct class, caches, defaults to `groq` when row absent, throws on unknown name                                                                                                   |
| `tests/providers/claudeCli.test.js`      | `child_process.spawn` mocked. Cases: happy path two-level parse, parse-fail retry succeeds, retry exhausted throws `ClaudeCliError`, exit≠0 + stderr regex throws `ClaudeCliQuotaError`, healthCheck via `claude --version` |
| existing `tests/classify-schema.test.js` | Update import to point at new provider path; behaviour unchanged                                                                                                                                                            |

Verification after implementation:

```bash
npm run verify:ui   # tsc + eslint, safe with dev running
npm test            # vitest, expect 9 → ~14 tests
npm run lint
```

## Risks & mitigations

| Risk                                                               | Mitigation                                                                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `claude` CLI output format changes between versions                | Provider parses defensively, throws `ClaudeCliError` with raw stdout snippet. Detect early via integration smoke.                    |
| Quota regex false positive (e.g. "rate limit" in a normal message) | Regex is anchored to error paths (stderr when exit≠0, or `subtype === 'error'`). Successful responses are never matched.             |
| Multiple Next.js dev workers each cache their own provider         | v1 has a single dev worker. If we ever cluster, swap module-state cache for a TTL'd read or invalidate on PUT via a pub/sub channel. |
| `service_role` key exposed via the new server module               | TS-checked `process.env.*!` and the file lives in `lib/` server-only path. No `'use client'` directive.                              |
| Health-check spawns `claude --version` on every poll               | Cheap (~50ms). If it becomes noisy, add a 60s in-memory cache on the server.                                                         |
| User changes provider mid-pipeline                                 | Pipeline cached at start. UI shows "Applies to next run" + disables selector while running.                                          |

## What stays untouched

- `src/index.js` flow (besides one `await getActiveProvider()` and one import path update)
- All migrations except the new `settings` one
- Existing `/run` page, except the existing selector hook is reused
- Tests for `hash`, `lookups`, `analysis` — no changes
