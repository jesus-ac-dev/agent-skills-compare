# CLAUDE.md

Contexto rápido para futuras sessões a trabalhar neste repo.

## O que é

Pipeline Node.js (ESM) que descobre repos GitHub com artefactos agênticos (skills, sub-agents, MCPs, plugins, hooks, prompts), classifica-os com um de três LLMs (Groq / Gemini / Claude CLI — escolhido em runtime via UI) e indexa-os numa BD Supabase. O objectivo final é uma base de dados pesquisável de "skills" reutilizáveis, navegável por axis (class/domain/activity/tag).

## Como correr

```bash
npm install
npm test                            # vitest, ~70 testes
npm run lint                        # eslint (cobre .js e .tsx)
npm run verify:ui                   # tsc --noEmit && eslint (NÃO toca em .next/ — safe com dev a correr)
npm run db:reset                    # aplica todas as migrations num Supabase local
npm run db:push                     # aplica só as pendentes (cloud — local usa `supabase migration up --local`)
npm run db:health                   # relatório read-only: contagens, top erros, fragmentação
npm run db:canonicalize             # dry-run da limpeza de aliases activities/tags
npm run db:canonicalize -- --apply  # aplica a limpeza de aliases
npm start "agent skills"            # corre o pipeline (semeia curated → resume → search)
npm start "" -- --resume            # só processa repos pending/processing; NÃO semeia curated, NÃO faz search
npm run dev                         # arranca a UI Next.js em http://localhost:2000
```

**⚠️ Nunca correr `npm run build` enquanto `npm run dev` está activo** — sobrepõe o `.next/` e o dev server passa a responder 500 a tudo até reiniciar. Para validar o código UI com o dev activo, usa `npm run verify:ui` (typecheck + lint, sem build).

Requer `.env` com `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `GITHUB_TOKEN` (opcional mas recomendado). Ver [.env.example](.env.example).

## Schema (estado actual — pós taxonomia v3 + re-add files_sources.status)

- `repos` — unidade de trabalho do pipeline. Tem `status ∈ {pending, processing, done, failed}`, `last_processed_at`, `error_count`, `last_error`. Status grosso (por-repo).
- `files_sources` — um registo por ficheiro descoberto (`url` único). FKs para `source_types`, `file_types`. Tem `status ∈ {pending, processing, completed, reused, skipped, error}` (granularidade fina por-ficheiro, re-adicionado na migration `20260513130000`).
- `file_types` — `markdown, javascript, typescript, python, shell, json, yaml, html, text`. Resolvido a partir da extensão em `src/utils/fileKind.js`.
- `analysis` — uma análise por `file_source_id` (UNIQUE). Contém `summary`, `maturity`, `score`, `use_cases` JSONB, `class_id` (FK BIGINT, single-select), `model` (string com o nome do provider que produziu).
- `settings(key, value)` — tabela genérica k/v. Linha seed: `('llm_provider', 'groq')`. Define qual o LLM activo (lido pelo `factory.js` no arranque do `main()`).
- **Taxonomia multi-eixo** (M2M com `analysis`):
  - `domains` (fechado, 16 entries — backend/frontend/security/data-ai/...) → `analysis_domains`
  - `activities` (semi-aberto, classifier pode acrescentar) → `analysis_activities`
  - `tags` (livre, sem seed; upsert por `LOWER(name)`) → `analysis_tags`
  - `classes` (fechado, 15 entries — skill/subagent/mcp-server/...) é single-select via `analysis.class_id`
- **View `analysis_with_axes`** — junta `analysis + repos + files_sources + classes` com `ARRAY_AGG` para domains/activities/tags. É a fonte de tudo o que a UI mostra na `/` e `/stats`.

## Convenções

- **Todos os PKs e FKs são `BIGINT GENERATED ALWAYS AS IDENTITY`.** Sem UUIDs, sem SERIAL para novas tabelas. Se mexeres em schema, mantém isto.
- Migrations são SQL plano em `supabase/migrations/<timestamp>_<name>.sql`. Aplica-se via Supabase CLI.
- Test framework: **vitest** (pattern em `tests/*.test.js`). Mocks de Supabase usam `vi.mock(...)` + top-level `await import(...)`.
- Pre-commit hook (husky + lint-staged) corre prettier e eslint em ficheiros staged. **Não bypass** com `--no-verify` — resolve a causa.
- Pipeline state machine: ver `processRepo` em `src/index.js`. Falhas catastróficas (listagem de ficheiros) → `status='failed'`. Erros isolados de ficheiros → `error_count++` e continua.

## Comportamento do pipeline

Ordem em `main()` (`src/index.js`):

1. `getActiveProvider()` — lê `settings.llm_provider`, cacheia a instância. Log: `Active LLM provider: ...`.
2. `seedCuratedRepos()` (saltado em `--resume`) — lê `config/curated-repos.json`, INSERT IGNORE em `repos` com `status='pending'`. Devolve `curatedUrls` em ordem do JSON.
3. **Curated com prioridade** — para cada URL curada que esteja `pending`/`processing`, hidrata via `fetchRepoDetails` e processa **antes** de qualquer outro pending. Ordem = ordem do JSON.
4. `findResumableRepos` — apanha os restantes `processing` (primeiro) e `pending` (depois).
5. `searchRepos(query)` — só corre se não for `--resume`.

**Skip por hash:** `loadAnalyzedHashes(repoId)` carrega `(url → hash)`. Se o hash do ficheiro bater certo, NÃO chama o LLM — reutiliza a `analysis` existente (status `reused` no `files_sources`). Re-runs do mesmo corpus = 0 chamadas LLM.

**Quota (QuotaError):** `src/analysis/providers/BaseProvider.js` exporta `QuotaError`. `GroqDailyQuotaError` e `ClaudeCliQuotaError` extendem-no. Em `main()` o `catch` apanha qualquer `QuotaError` → sai limpo, repo actual fica `processing` para retomar quando o quota reset.

**Per-repo refresh:** `UPDATE repos SET status='pending' WHERE id=?` (botão "Reanalyze" em `/repos/[id]` e `/repos` faz isto). Ficheiros com hash diferente são re-analisados; iguais são `reused`.

## LLM (provider selector via `settings.llm_provider`)

- Três providers em `src/analysis/providers/`: `groqProvider.js`, `geminiProvider.js`, `claudeCliProvider.js`. Todos extendem `BaseProvider` (mesma interface: `analyzeContent`, `healthCheck`, `name`).
- `factory.js` lê `settings.llm_provider` no arranque do `main()` e cacheia a instância. Trocar provider = `PUT /api/settings/llm-provider` ou SQL `UPDATE settings SET value=...`.
- UI: dropdown `<ProviderSelect />` no header — escolhe o provider para o próximo run; mostra chips de health (green ✓/●, grey ●).
- Defaults: `GROQ_MODEL=llama-3.3-70b-versatile` (~14k req/dia), `GEMINI_MODEL=gemini-2.5-flash-lite`, Claude CLI usa o subscription do user (`claude --print --output-format json`).
- **Classifier code-aware:** `classifyProject(content, { kind, path })` em `src/analysis/classifyProject.js`. `kind ∈ {markdown, code, config, text}` derivado da extensão (`src/utils/fileKind.js`). O system prompt ramifica por kind — para `code`, foca-se em exports/tool defs/agent loop em vez de prosa.
- Listas fechadas (`classes`, `domains`) são injectadas no prompt via `loadClosedVocabulary()` em runtime — adicionar uma class/domain é só migration.

## Helpers DB

`src/db/lookups.js`:

- `resolveClosedId(table, name)` — case-insensitive lookup, devolve `id` ou `null`.
- `upsertOpenId(table, name)` — lower-case + upsert, devolve `id`.
- `loadClosedVocabulary()` — devolve `{ classes: string[], domains: string[] }` ordenados para o system prompt.

`src/utils/fileKind.js`:

- `detectFileKind(path)` → `'markdown' | 'code' | 'config' | 'text'` (para escolher o prompt do classifier).
- `detectFileTypeName(path)` → string para `resolveClosedId('file_types', ...)`.

`src/utils/githubUrl.js`:

- `normaliseGithubUrl(url)` → `{ repo_url, name } | null` (owner lowercase, sem trailing slash, sem path extra). Partilhado pelo seed curated e pela API `POST /api/repos`.

## UI (Next.js 15, App Router, porta 2000)

- `/` — lista de análises (`analysis_with_axes`). Suporta filtros via URL: `?class=X`, `?domain=X`, `?activity=X`, `?tag=X`. Chip no topo mostra o filtro activo.
- `/stats` — top de classes/domains/activities/tags. Cada item é link para `/?<axis>=<value>`. "Show all" expande para além do top 10.
- `/repos` — fleet view: todos os repos com status, file count, error count, last analyzed, botão "Reanalyze". Filtros por status + "only with errors".
- `/repos/[id]` — detalhe: chips de file-status counts, botão "Reanalyze", lista de ficheiros analisados com chips clicáveis (class/domain/activity/tag → drill-down para `/`).
- `/run` — disparar runs do pipeline. `/api/pipeline` GET/POST.
- Header: input "Add repo" (POST /api/repos), `<ProviderSelect />`, links nav, `<ResumableBadge />`.

## Curated seed list

`config/curated-repos.json` — 15+ entries em `[{ url, reason }]`. Ordem é processada por prioridade. Editar e correr `npm start` (não-resume) → URLs novas vão para `pending`, existentes ficam intocadas (`ON CONFLICT DO NOTHING`).

## Onde está a documentação de design

- Spec taxonomia v3: [docs/superpowers/specs/2026-05-09-schema-taxonomy-redesign-design.md](docs/superpowers/specs/2026-05-09-schema-taxonomy-redesign-design.md)
- Spec LLM provider selector: [docs/superpowers/specs/2026-05-12-llm-provider-selector-design.md](docs/superpowers/specs/2026-05-12-llm-provider-selector-design.md)
- Spec curated seed: [docs/superpowers/specs/2026-05-12-curated-seed-repos-design.md](docs/superpowers/specs/2026-05-12-curated-seed-repos-design.md)
- Status snapshot: [docs/status-2026-05-13.md](docs/status-2026-05-13.md)
- Roadmap: [docs/roadmap.md](docs/roadmap.md)
