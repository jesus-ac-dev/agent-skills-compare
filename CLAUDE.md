# CLAUDE.md

Contexto rápido para futuras sessões a trabalhar neste repo.

## O que é

Pipeline Node.js (ESM) que descobre repos GitHub com artefactos agênticos (skills, sub-agents, MCPs, plugins, hooks, prompts), classifica-os com o Gemini e indexa-os numa BD Supabase. O objectivo final é uma base de dados pesquisável de "skills" reutilizáveis.

## Como correr

```bash
npm install
npm test                       # vitest, 9 testes
npm run lint                   # eslint (cobre .js e .tsx)
npm run verify:ui              # tsc --noEmit && eslint (NÃO toca em .next/ — safe com dev a correr)
npm run db:reset               # aplica todas as migrations num Supabase local
npm run db:push                # aplica só as pendentes (cloud — local usa `supabase migration up`)
npm start "agent skills"       # corre o pipeline para a query
npm start "" -- --resume       # só processa repos com status processing/pending, sem search nova
npm run dev                    # arranca a UI Next.js em http://localhost:3000
```

**⚠️ Nunca correr `npm run build` enquanto `npm run dev` está activo** — sobrepõe o `.next/` e o dev server passa a responder 500 a tudo até reiniciar. Para validar o código UI com o dev activo, usa `npm run verify:ui` (typecheck + lint, sem build).

**⚠️ Supabase CLI: este repo nunca está `link`ed.** Qualquer comando `supabase <cmd>` (migration list, db diff, status, etc.) precisa de `--local`, senão falha com "Cannot find project ref. Have you run supabase link?". Preferir os wrappers `npm run db:*` quando existirem. **Não correr** `supabase link` (liga ao cloud, não é o que queremos) nem `supabase db reset` sem confirmação explícita (é destrutivo).

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

## Comportamento do pipeline (resume + skip por hash + quota)

- **Resume:** no arranque, `findResumableRepos` apanha repos com `status` ∈ `{processing, pending}` e processa-os antes da pesquisa GitHub. `processing` significa "ficou a meio na corrida anterior" → entra primeiro. `done` e `failed` são saltados.
- **Skip por hash:** dentro de cada repo, `loadAnalyzedHashes(repoId)` carrega `(url → hash)` dos ficheiros que já têm `analysis`. Para cada ficheiro, depois do download e do `generateHash`, se o hash bater certo com o que está em BD, salta a chamada ao LLM. Resultado: re-runs do mesmo corpus = 0 chamadas LLM em ficheiros inalterados.
- **Daily quota:** `groqClient.js` exporta `DailyQuotaExceededError`. Quando o erro é detectado (regex em `tpd|rpd|per-day|daily` na mensagem), o pipeline propaga e sai limpo, deixando o repo actual como `processing` para retomar no próximo run após o reset (geralmente meia-noite UTC).
- **Per-repo refresh (futuro / via UI):** basta pôr `repos.status='pending'` para esse repo e correr o pipeline outra vez — entra na fila do `findResumableRepos`. Ficheiros com hash diferente são re-analisados; iguais são saltados.

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
