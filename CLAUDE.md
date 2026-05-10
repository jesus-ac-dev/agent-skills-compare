# CLAUDE.md

Contexto rápido para futuras sessões a trabalhar neste repo.

## O que é

Pipeline Node.js (ESM) que descobre repos GitHub com artefactos agênticos (skills, sub-agents, MCPs, plugins, hooks, prompts), classifica-os com o Gemini e indexa-os numa BD Supabase. O objectivo final é uma base de dados pesquisável de "skills" reutilizáveis.

## Como correr

```bash
npm install
npm test                       # vitest, 9 testes
npm run lint                   # eslint (neostandard)
npm run db:reset               # aplica todas as migrations num Supabase local
npm run db:push                # aplica só as pendentes
npm start "agent skills"       # corre o pipeline para a query
```

Requer `.env` com `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `GITHUB_TOKEN` (opcional mas recomendado). Ver [.env.example](.env.example).

## Schema (estado actual — pós taxonomia v3)

- `repos` — unidade de trabalho do pipeline. Tem `status ∈ {pending, processing, done, failed}`, `last_processed_at`, `error_count`, `last_error`. Status é movido aqui (já não está em `files_sources`).
- `files_sources` — um registo por ficheiro descoberto (`url` único). FKs para `source_types`, `file_types`.
- `analysis` — uma análise por `file_source_id` (UNIQUE). Contém `summary`, `maturity`, `score`, `use_cases` JSONB, `class_id` (FK BIGINT, single-select).
- **Taxonomia multi-eixo** (M2M com `analysis`):
  - `domains` (fechado, 16 entries — backend/frontend/security/data-ai/...) → `analysis_domains`
  - `activities` (semi-aberto, 21 seeds — code-review/planning/debugging/... — classifier pode acrescentar) → `analysis_activities`
  - `tags` (livre, sem seed; upsert por `LOWER(name)`) → `analysis_tags`
  - `classes` (fechado, 15 entries — skill/subagent/mcp-server/...) é single-select via `analysis.class_id`

## Convenções

- **Todos os PKs e FKs são `BIGINT GENERATED ALWAYS AS IDENTITY`.** Sem UUIDs, sem SERIAL para novas tabelas. Se mexeres em schema, mantém isto.
- Migrations são SQL plano em `supabase/migrations/<timestamp>_<name>.sql`. Aplica-se via Supabase CLI.
- Test framework: **vitest** (pattern em `tests/*.test.js`). Mocks de Supabase usam `vi.mock(...)` + top-level `await import(...)`.
- Pre-commit hook (husky + lint-staged) corre prettier e eslint em ficheiros staged. **Não bypass** com `--no-verify` — resolve a causa.
- Pipeline state machine: ver `processRepo` em `src/index.js`. Falhas catastróficas (listagem de ficheiros) → `status='failed'`. Erros isolados de ficheiros → `error_count++` e continua.

## LLM (Groq por defeito)

- O classifier usa **Groq** (`llama-3.3-70b-versatile` por defeito) via `src/analysis/groqClient.js`. Free tier muito mais generoso que o Gemini (≈14k req/dia vs 20).
- `analyzeContent(content, prompt, { schema, temperature })` espelha a interface do `geminiClient.js`. Quando `schema` é passado, usa `response_format: { type: 'json_object' }` (não impõe schema do lado do servidor — confia no prompt).
- O classifier (`src/analysis/classifyProject.js`) injecta as listas fechadas de `classes` e `domains` no system prompt em runtime via `loadClosedVocabulary()`. Adicionar uma class/domain é só uma migration.
- `temperature: 0.4` por defeito (variação suficiente, mantém-se factual).
- `geminiClient.js` continua na árvore como referência / fallback opcional. Para o usar, troca o import em `classifyProject.js` para `./geminiClient.js` e configura `GEMINI_API_KEY` no `.env`. O Gemini suporta `responseSchema` nativo (impõe schema do lado do servidor) — útil se quiseres esquemas com `minLength`/`minItems`/`enum` strict.

## Helpers DB

`src/db/lookups.js`:

- `resolveClosedId(table, name)` — case-insensitive lookup, devolve `id` ou `null`.
- `upsertOpenId(table, name)` — lower-case + upsert, devolve `id`.
- `loadClosedVocabulary()` — devolve `{ classes: string[], domains: string[] }` ordenados, para construir o schema do Gemini.

## Onde está a documentação de design

- Spec: [docs/superpowers/specs/2026-05-09-schema-taxonomy-redesign-design.md](docs/superpowers/specs/2026-05-09-schema-taxonomy-redesign-design.md)
- Plano de implementação: [docs/superpowers/plans/2026-05-09-schema-taxonomy-redesign.md](docs/superpowers/plans/2026-05-09-schema-taxonomy-redesign.md)
- Roadmap (próximas etapas): [docs/roadmap.md](docs/roadmap.md)
