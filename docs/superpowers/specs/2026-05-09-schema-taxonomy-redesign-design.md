# Design: Schema & Taxonomia v3 — status no repo, taxonomia multi-eixo, output estruturado do Gemini

**Data:** 2026-05-09
**Branch:** `refactor-schema-pipeline-v2-7777126772629270693`

## Motivação

A refactor anterior (`20260509000000_refactor_schema.sql`) deixou três problemas:

1. **`files_sources.status` é redundante.** O pipeline insere sempre `'processed'`. Não dá visibilidade nenhuma. O conceito útil — saber que repos ainda faltam processar — pertence ao `repos`, que é a unidade de trabalho real.
2. **Taxonomia confusa.** `categories`, `sub_categories`, `classes` misturam três eixos (artefacto / domínio / atividade) num único campo single-select. Um ficheiro como "skill de code-review para backend Python" não cabe nesse modelo. As listas seed eram pobres (`Iot Engineer` como categoria, etc.).
3. **Classifier produz outputs inconsistentes.** Summaries genéricos/repetidos, campos em falta, JSON mal formado. Falta um contrato forte com o modelo.

## Decisões de design

### 1. Status state machine no `repos`

`repos` ganha colunas:

| Coluna              | Tipo        | Default     | Notas                                               |
| ------------------- | ----------- | ----------- | --------------------------------------------------- |
| `status`            | TEXT        | `'pending'` | CHECK em `('pending','processing','done','failed')` |
| `last_processed_at` | TIMESTAMPTZ | NULL        | Atualizado quando passa a `done` ou `failed`        |
| `error_count`       | INTEGER     | `0`         | Incrementado por cada ficheiro que falhou           |
| `last_error`        | TEXT        | NULL        | Mensagem do último erro (debug)                     |

Transições:

- Início do processamento de um repo → `processing`
- Erro num ficheiro isolado → mantém `processing`, `error_count++`, `last_error = msg`
- Loop de ficheiros termina sem falha catastrófica → `done`, `last_processed_at = NOW()`
- Falha catastrófica (não conseguir listar ficheiros, ex.: rate-limit, repo deleted) → `failed`, `last_error = msg`

`files_sources.status` é **removido**.

### 2. Taxonomia multi-eixo

Substituir `categories` + `sub_categories` por três eixos ortogonais. `classes` mantém-se como single-select por ser a única dimensão genuinamente 1:1 com o ficheiro.

#### Tabelas lookup (todas BIGINT IDENTITY)

| Tabela       | Vocabulário                                | Cardinalidade com `analysis`  |
| ------------ | ------------------------------------------ | ----------------------------- |
| `classes`    | Fechado (seed na migration)                | 1:1 via `analysis.class_id`   |
| `domains`    | Fechado (seed na migration)                | M2M via `analysis_domains`    |
| `activities` | Semi-aberto (seed + upsert do classifier)  | M2M via `analysis_activities` |
| `tags`       | Livre (sem seed; upsert por `LOWER(name)`) | M2M via `analysis_tags`       |

Todos os PKs e FKs são `BIGINT GENERATED ALWAYS AS IDENTITY` (substitui o `SERIAL` da migration anterior). As tabelas `categories` e `sub_categories` são **removidas com `DROP TABLE ... CASCADE`**.

`activities` e `tags` recebem índice `UNIQUE` em `LOWER(name)` para evitar duplicação por capitalização (sem extensão `citext`).

#### Tabelas M2M

```sql
analysis_domains    (analysis_id BIGINT, domain_id BIGINT,    PK (analysis_id, domain_id))
analysis_activities (analysis_id BIGINT, activity_id BIGINT,  PK (analysis_id, activity_id))
analysis_tags       (analysis_id BIGINT, tag_id BIGINT,       PK (analysis_id, tag_id))
```

Todos com `ON DELETE CASCADE` em ambos os FKs.

#### `analysis`

- `class_id BIGINT REFERENCES classes(id)` (mantém-se, nullable se classifier falhar a resolver)
- `sub_category_id` é **removido**
- Adiciona `UNIQUE(file_source_id)` para idempotência em re-runs

#### Vocabulário inicial

`classes` (15):
`skill`, `subagent`, `slash-command`, `hook`, `mcp-server`, `plugin`, `output-style`, `settings-preset`, `prompt-template`, `tool-definition`, `workflow`, `framework`, `eval-benchmark`, `dataset`, `guide`

`domains` (16):
`backend`, `frontend`, `mobile`, `devops`, `infrastructure`, `database`, `data-ai`, `security`, `blockchain`, `iot`, `gamedev`, `scientific`, `fintech`, `business`, `creative`, `meta-agentic`

`activities` seed (21):
`code-review`, `planning`, `spec-writing`, `debugging`, `testing`, `refactoring`, `documentation`, `security-audit`, `performance-tuning`, `data-analysis`, `content-writing`, `research`, `automation`, `prompt-engineering`, `agent-building`, `evaluation`, `knowledge-mgmt`, `productivity`, `learning`, `migration`, `monitoring`

`tags`: arranca vazio.

### 3. Output estruturado do Gemini

Trocar o prompt JSON-em-texto pelo modo nativo de structured output (`responseMimeType: "application/json"` + `responseSchema`). O schema é construído **em runtime** a partir das listas fechadas na BD, para que adicionar uma `class` ou `domain` seja só uma migration.

Schema:

```ts
{
  type: "object",
  required: ["summary", "maturity", "score", "class", "domains", "activities", "tags"],
  properties: {
    summary:    { type: "string", minLength: 80 },
    maturity:   { type: "string", enum: ["experimental", "stable", "abandoned"] },
    score:      { type: "number", minimum: 0, maximum: 10 },
    class:      { type: "string", enum: [<from DB classes>] },
    domains:    { type: "array",  items: { type: "string", enum: [<from DB domains>] }, minItems: 1 },
    activities: { type: "array",  items: { type: "string" }, minItems: 1 },
    tags:       { type: "array",  items: { type: "string" } }
  }
}
```

Prompt: instrui explicitamente _"summary deve ser específico a este ficheiro/repo, mencionar nomes concretos do que faz, evitar boilerplate genérico"_. `temperature: 0.4` (variação suficiente, mantém-se factual).

### 4. Pipeline — sequência por ficheiro

1. Upsert `repos` (já existe). Se for um repo novo, status fica `pending`. Imediatamente antes do loop de ficheiros: `UPDATE status='processing'`.
2. Upsert `files_sources` (sem `status`).
3. Chamar Gemini com schema estruturado.
4. Upsert `analysis` por `file_source_id` (devolve `analysis_id`).
5. Limpar M2M associada (`DELETE FROM analysis_activities/domains/tags WHERE analysis_id = $1`) — garante consistência em re-runs.
6. Resolver `class_id` (closed list; se vier algo fora da lista, log + `null`).
7. Para cada `domain` retornado: resolver `domain_id` (closed list; ignora desconhecidos); insert em `analysis_domains`.
8. Para cada `activity`: upsert em `activities` por `LOWER(name)`; insert em `analysis_activities`.
9. Para cada `tag`: upsert em `tags` por `LOWER(name)`; insert em `analysis_tags`.
10. Em caso de erro nos passos 3–9: `error_count++`, `last_error = msg`, continua para o próximo ficheiro.

No fim do loop: `UPDATE repos SET status='done', last_processed_at=NOW()`. Se o passo de listagem (`listFilesRecursive`) falhar antes do loop: `status='failed'`.

## Arquivos afetados

- **Nova migration:** `supabase/migrations/20260510000000_taxonomy_redesign.sql`
- **`src/analysis/classifyProject.js`** — passa a usar `responseSchema`, recebe listas fechadas como parâmetros
- **`src/analysis/geminiClient.js`** — suportar `responseSchema` e `responseMimeType`
- **`src/index.js`** — state machine do `repos`, novo fluxo de persistência multi-eixo
- **Possível novo:** `src/db/lookups.js` — helpers `getClassId(name)`, `upsertActivity(name)`, `upsertTag(name)`, `loadClosedVocabulary()` para construir o schema do Gemini

## Não-objetivos

- Não retroatamente migrar dados. Tabelas afetadas (`categories`, `sub_categories`, M2M ainda inexistentes) estão vazias ou com dados de teste — `DROP CASCADE` é aceitável.
- Não introduzir RLS policies novas (segue o que está).
- Não alterar `searchRepos` nem `fetchFiles`.

## Riscos / Open questions

- **Custo de upsert por tag**: cada `analysis` pode gerar 5–15 inserts/upserts em M2M. Com batches grandes, considerar transação por ficheiro. Versão 1 mantém-se simples (sem transação explícita).
- **Vocabulário fechado pode estrangular o classifier** se a lista de `domains` ficar curta. Mitigação: a lista é editável só com migration; arrancar com 16 entradas dá folga.
- **`tags` pode crescer descontrolado**. Aceita-se nesta versão; se virar problema, adicionar etapa de canonicalização periódica (fora de scope agora).
