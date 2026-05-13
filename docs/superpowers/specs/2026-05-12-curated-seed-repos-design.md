# Curated Seed Repos — Design

**Date:** 2026-05-12
**Status:** Design approved, ready for plan
**Author:** Claude (brainstorming with @jesus-ac-dev)

## Context

The pipeline currently discovers repos exclusively via the GitHub search API ([src/index.js:283](../../../src/index.js#L283)). The user has a curated list of high-value repos (Anthropic skills, mattpocock/skills, Cline, Kilocode, etc.) that may not surface reliably from a generic "agent skills" query. Roadmap section B ([docs/roadmap.md:46-70](../../roadmap.md#L46)) already sketches the solution; this spec finalises the design.

## Goals

1. A static JSON list at `config/curated-repos.json` seeds high-value repos into the `repos` table before any search runs.
2. The seed step is **idempotent and one-shot per run**: re-running the pipeline does not re-process curated repos that are already `done`.
3. The seed step is **decoupled from the LLM choice**. Whichever provider is active in `settings.llm_provider` (Groq today, Claude CLI once the parallel plan lands) does the classification.
4. Updates to a previously-processed repo go through the existing per-repo refresh action (`UPDATE repos SET status='pending' WHERE id=?`), **not** the curated list.

## Non-goals

- Storing the `reason` field in the database (lives only in the JSON, committed to git).
- A separate `npm run seed:curated` command (the seed integrates into the normal pipeline startup).
- A new CLI flag for "curated-only" mode (use existing `--resume` after a seed run to achieve the same effect).
- Schema changes (no `is_curated` column, no `curated_reason` column).
- Re-classifying already-`done` curated repos when the active LLM changes (out of scope; would require a separate "force re-analysis" mechanism that doesn't depend on hash skip).

## Architecture

```
                          ┌──────────────────────────┐
                          │ config/curated-repos.json│  15 entries, committed
                          └──────────────┬───────────┘
                                         ▼
                          ┌──────────────────────────┐
                          │ seedCuratedRepos()       │  new, ~40 LOC
                          │  INSERT IGNORE pending    │
                          └──────────────┬───────────┘
                                         ▼
src/index.js main():                     ▼
   1. await getActiveProvider()  (existing, from LLM-selector plan)
   2. await seedCuratedRepos()   ← NEW (skipped when --resume)
   3. await findResumableRepos() (existing — picks up the new pending rows)
   4. for each → processRepo()   (existing, unchanged)
   5. searchRepos(query)         (existing, unchanged)
                                         │
                                         ▼
                          ┌──────────────────────────┐
                          │ classifyProject(content) │  existing
                          │  └─ getActiveProvider()  │  decides Groq/Gemini/Claude-CLI
                          └──────────────────────────┘
```

**Composition with the LLM provider selector.** Zero shared code between this feature and [the LLM provider selector plan](2026-05-12-llm-provider-selector-design.md). The seed only writes to the `repos` table; the provider only reads `settings.llm_provider`. They compose at runtime via the existing `findResumableRepos` → `processRepo` → `classifyProject` chain.

## Components

| File                         | LOC  | Responsibility                                                                                                                                                                                                     |
| ---------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `config/curated-repos.json`  | data | Array of `{ url, reason }`. Validated at seed-time. Committed to git.                                                                                                                                              |
| `src/seed/curatedRepos.js`   | ~40  | Exports `seedCuratedRepos()`. Reads JSON, validates+normalises URLs, calls `supabase.from('repos').upsert(rows, { onConflict: 'repo_url', ignoreDuplicates: true })`. Returns `{ inserted, skipped }` for the log. |
| `src/index.js`               | +3   | One import, one `await seedCuratedRepos()` call before `findResumableRepos()`, inside the `!resumeOnly` branch.                                                                                                    |
| `tests/seed-curated.test.js` | ~60  | 6 vitest cases (see Testing).                                                                                                                                                                                      |

**Format of `config/curated-repos.json`:**

```json
[
  {
    "url": "https://github.com/anthropics/skills",
    "reason": "Official — source of truth for Agent Skills"
  }
]
```

`url` is required; `reason` is documentation-only. URLs are normalised (lowercase owner, no trailing slash, no path beyond `/owner/repo`) before insert.

## Data flow

**Normal run (`npm start "agent skills"`):**

1. `getActiveProvider()` — reads `settings.llm_provider`, caches the provider instance.
2. `seedCuratedRepos()`:
   - Read `config/curated-repos.json`. If file missing → `logger.warn(...)`, return `{ inserted: 0, skipped: 0 }`, continue pipeline.
   - Parse JSON. If malformed → throw (the file exists but is broken — fail fast).
   - For each entry, validate URL against `^https://github\.com/[^/]+/[^/]+/?$`. Invalid → `logger.warn(...)`, skip entry.
   - Normalise: lowercase owner, strip trailing slash, strip any path beyond `/owner/repo`.
   - Deduplicate within the list (in-memory).
   - `supabase.from('repos').upsert(rows, { onConflict: 'repo_url', ignoreDuplicates: true })`.
   - Count `inserted` (returned rows length) vs `skipped` (list length − inserted) and log.
3. `findResumableRepos()` — picks up the new `pending` rows alongside any existing `processing`/`pending` rows.
4. Each repo goes through `processRepo()`, which uses the cached provider.
5. After resumables drain, `searchRepos(query)` runs as today.

**Resume mode (`npm start "" -- --resume`):**

Same flow but `seedCuratedRepos()` is **skipped**. Rationale: `--resume` should not introduce new ingest from any source. Re-running without `--resume` will re-seed (idempotent due to `ON CONFLICT DO NOTHING`).

## Error handling

| Scenario                            | Behaviour                                                          | Why                                                              |
| ----------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `config/curated-repos.json` missing | Warn, continue                                                     | First-time runs without a curated list must still work.          |
| JSON parse error                    | Throw, abort                                                       | File present but broken — visibility over silent skip.           |
| Entry missing `url`                 | Warn, skip entry                                                   | Per-entry validation; others continue.                           |
| URL fails regex                     | Warn, skip entry                                                   | Same.                                                            |
| Supabase upsert fails               | Throw, abort                                                       | DB error is serious; better than silently proceeding.            |
| URL already in `repos` (any status) | Silently skipped by `ON CONFLICT DO NOTHING`, counted in `skipped` | Per the user's rule: curated list never overrides existing rows. |

Classification errors (`GroqDailyQuotaError`, `ClaudeCliQuotaError`, etc.) happen later in `processRepo` and are not the seeder's concern.

## Testing

`tests/seed-curated.test.js`, vitest, supabase mocked with `vi.mock`. Six cases:

1. **File missing** — `fs.readFile` rejects `ENOENT`. No throw, `logger.warn` called, supabase upsert NOT called.
2. **Malformed JSON** — `readFile` returns `"not json {"`. Throws, supabase upsert NOT called.
3. **Empty list** — Returns `[]`. No throw, supabase upsert NOT called.
4. **Mixed validity** — `[{ reason: "x" }, { url: "https://gitlab.com/a/b" }, { url: "https://github.com/a/b" }]`. Warnings for first two; upsert called with one row.
5. **Idempotence** — 3 valid URLs, mock returns `data: []`. Upsert called once with options `{ onConflict: 'repo_url', ignoreDuplicates: true }`.
6. **Normalisation** — `https://github.com/Kilo-Org/kilocode/` becomes `https://github.com/kilo-org/kilocode` in the upserted row.

Tests bring the suite from 9 → 15.

## Runtime workflow (how to use this with Claude CLI)

Prerequisites for processing the curated list through the Claude CLI:

1. **LLM provider selector** ([sister spec](2026-05-12-llm-provider-selector-design.md)) lands at least Task 7 (`ClaudeCliProvider`). UI tasks (8-15) are optional for runtime — `settings.llm_provider` can be flipped via SQL or `PUT /api/settings/llm-provider`.
2. This feature lands. Order with the sister branch is flexible; merging this **after** Task 6 of the LLM selector (factory wired into `classifyProject`) avoids transient broken state.
3. `claude` CLI in PATH and authenticated (`claude --version` succeeds, `claude login` already run).
4. Flip the active provider:
   ```sql
   UPDATE settings SET value = 'claude-cli' WHERE key = 'llm_provider';
   ```
5. Run:
   ```bash
   npm start "agent skills"
   ```

Expected log:

```
[INFO] Active LLM provider: claude-cli
[INFO] Seeded 15 new curated repos (0 already in DB, skipped)
[INFO] Resuming 15 repo(s) from previous runs.
[INFO] Processing repository: anthropics/skills
[INFO] Analyzing content with Claude CLI (attempt 1/2)…
...
```

**Quota interrupt behaviour:** `ClaudeCliQuotaError` propagates exactly like `GroqDailyQuotaError` today — the current repo stays `processing`, the pipeline exits cleanly, and the next run resumes via `findResumableRepos`.

## What stays untouched

- `processRepo()` and the file-level loop — no changes.
- `classifyProject.js` — only touched by the LLM-selector plan, not by this one.
- All existing migrations and tests (existing 9 stay green).
- The GitHub search path (`searchRepos`) and its dedup behaviour.

## Risks

| Risk                                                        | Mitigation                                                                                                                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The seed JSON gets out of sync with what's in the DB        | Acceptable — JSON is the source of truth for "what to seed next first-time"; DB is the source of truth for "what has been processed". They're allowed to diverge. |
| User edits JSON and expects re-processing of unchanged URLs | Documented: editing the JSON only affects URLs not yet in the DB. Re-processing existing entries is the per-repo refresh action.                                  |
| Conflict with the LLM-selector branch on `src/index.js`     | Expected, small (~2 adjacent lines near top of `main()`). Rebase resolves.                                                                                        |
