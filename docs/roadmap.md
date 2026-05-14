# Roadmap

Estado depois das sessões intensivas de 2026-05-12 e 2026-05-13. Snapshot mais detalhado em [docs/status-2026-05-13.md](status-2026-05-13.md).

## ✅ Já feito

**Schema + pipeline (taxonomia v3 e fixes):**

- **Taxonomia multi-eixo** (commits `130b626..306941d`): `repos.status`, classes/domains/activities/tags + M2M, structured output do classifier.
- **Fix M2M + Groq como provedor inicial** (`3ba57c3`, `33a5e33`): tabelas `tags`/`activities` populadas; free tier do Groq (~14k req/dia).
- **Resume + hash skip + saída limpa em daily quota** (`aa1f7bf`): re-runs do mesmo corpus = 0 chamadas LLM em ficheiros inalterados.
- **Domain semi-open + auto-wait em daily quota**: domains desconhecidos auto-inseridos; pipeline dorme até reset se o delay for ≤ `GROQ_MAX_DAILY_WAIT_MS`.
- **Pipeline halt on quota + dedup por hash + broaden file discovery** (`02868d1`): `QuotaError` partilhado em `BaseProvider`, all-files (não só `.md`), dedup intra-repo por hash.
- **Re-add `files_sources.status`** (`45d180e`): per-file granularidade (`pending/processing/completed/reused/skipped/error`) que o refactor `02868d1` assumia mas tinha sido dropped numa migration anterior.

**LLM provider selector (Etapa nova):**

- **Settings table + factory + 3 providers** (`fa1784d..16a73f0`): `groqProvider`, `geminiProvider`, `claudeCliProvider` extendem `BaseProvider`; `factory.js` lê `settings.llm_provider` e cacheia.
- **API + UI selector** (`cc2b792..bd7e9ed`): `GET/PUT /api/settings/llm-provider`, `GET /api/settings/llm-provider/health`, dropdown no header com chips de health.
- **`QuotaError` partilhado** (`be59b0f`): qualquer provider que estoure quota propaga via `instanceof QuotaError`; pipeline sai limpo, repo fica `processing`.

**Curated seed list (Etapa B):**

- **Loader + 15 entries** (`f6ca0c6` + fixes `1786a64`): `config/curated-repos.json`, `src/seed/curatedRepos.js`, INSERT IGNORE em `repos` com `status='pending'`. Idempotente.
- **Prioridade explícita** (`1786a64`): curated processadas em ordem do JSON, **antes** de qualquer outro pending — o `findResumableRepos` corre depois.
- **Manual repo add via UI** (`7775744`): `POST /api/repos` + `<RepoAdd />` no header. Reusa `normaliseGithubUrl` partilhado com o seed.

**Classifier code-aware (Etapa nova):**

- **Per-extension file_types + kind branching** (`1e6ce2c`): `src/utils/fileKind.js`, `file_types` extendido para `javascript/typescript/python/shell/json/yaml/html`, prompt do classifier ramifica por `kind ∈ {markdown, code, config, text}`.

**Operações de qualidade (Etapa D):**

- **`npm run db:health`** (`45d180e`): contagens por status, top recent errors, fragmentação por root word.
- **`npm run db:canonicalize`** (`2d75adb`): dry-run por defeito, `--apply` para commit. Mapa em `config/canonical-aliases.json` editado pelo user.

**UI (Etapa C — completa):**

- **`/` (Analyses)** — tabela de `analysis_with_axes`, search livre, filtros via URL (`?class=`, `?domain=`, `?activity=`, `?tag=`) com chip activo.
- **`/repos`** — fleet view com todos os repos, status pills, contagem de ficheiros, error count, last analyzed, botão Reanalyze. Filtros por status + "only with errors".
- **`/repos/[id]`** — chips de file-status no topo, relative time, chips clicáveis por análise (class/domain/activity/tag → drill-down para `/`).
- **`/stats`** — top entries por axis, cada item é link para `/?<axis>=<value>`, "Show all" expande além do top 10.
- **`/run`** — disparar pipeline com streaming de logs (`/api/pipeline`), badge de resumables.

---

## Próximas etapas

### A1. Fix do prompt para prevenir fragmentação

Ainda não feito. O `db:canonicalize` cura retroactivamente, mas a fragmentação volta a aparecer em cada run novo. **~10 linhas** em `classifyProject.js`:

- Carregar lista actual de `activities` da BD (já temos `loadClosedVocabulary()` para closed lists — estender para semi-open).
- Acrescentar ao system prompt: _"PREFER these existing values when they fit; only invent new ones for truly novel concepts. Use noun form (e.g. 'analysis', not 'analyzing'). Singular over plural."_

**Critério:** depois do fix, um run num repo grande não produz `analyzing` se `analysis` já existir.

### D2. Truncate / sumarizar summaries muito longos

Alguns ficheiros produzem summaries de 3-4 frases que partem layouts da UI. Opções:

- Acrescentar `summary_short TEXT` derivado (primeiros 200 chars + …).
- Forçar no prompt: "summary: ONE sentence, ≤ 200 chars" (já tem `minLength: 80`).

### 2. Filtro "only with errors" na `/`

A view `analysis_with_axes` não tem `files_sources.status`. Para filtrar por erro na lista, ou:

- Estender a view com `files_sources.status` (precisa de re-create view, simples).
- Ou query separada para `files_sources.status='error'` e mostrar numa secção dedicada.

### 3. Pagination na `/`

Hoje `/` faz `select('*')` sem limit. Com 4k+ análises na BD, vai começar a doer no carregamento. Adicionar `range(from, from + 50)` + paginação básica (next/prev).

### 4. (Adiada — só se sentires falta) Search semântica

Embeddings via `pgvector` + um job `npm run embed:backfill` para gerar embeddings dos summaries. Não vale a pena enquanto filtros + drill-down chegarem.

---

## Quirks descobertos durante as sessões (vale a pena lembrar)

- **`repos.name` é NOT NULL** — qualquer insert via curated/manual precisa de passar o nome (extraído da URL).
- **GitHub URLs com case-mixed owner** (`Kilo-Org`) precisam de ser lowercased para o UNIQUE de `repo_url` funcionar — feito em `normaliseGithubUrl`.
- **Postgres BIGINT IDENTITY queima IDs em rollback** — gaps nos IDs (ex: passar de 5 para 12) acontecem por inserts falhados anteriormente. Cosmético, não bug.
- **shadcn `DropdownMenuLabel` requer `<DropdownMenuGroup>` parent** — caso contrário falha com `MenuGroupRootContext is missing`.
- **PostgREST `select` cap de 1000 rows** — para contagens grandes, usar `count: 'exact', head: true` por valor distinto (padrão em `scripts/db-health.mjs`).
- **`supabase` CLI nunca sem `--local`** — o repo nunca esteve linked a cloud. Preferir `npm run db:*`.
- **Nunca `npm run build` enquanto `npm run dev` corre** — partilham `.next/`, parte tudo.
