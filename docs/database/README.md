# Database overview

Snapshot do schema e dados do pipeline (`agent-skills-compare`). Útil para construir a UI sem precisar de re-correr o pipeline ou inspeccionar o Supabase Studio.

## Ficheiros

- **[schema.sql](schema.sql)** — DDL completo da BD (gerado por `npx supabase db dump --local --schema public`). É a fonte de verdade para a UI; abrange tabelas, índices, constraints, RLS policies, funções.
- **[data-sample.sql](data-sample.sql)** — INSERTs de todos os dados actuais (gerado por `npx supabase db dump --local --data-only`). Permite trabalhar offline com dados realistas. Tamanho moderado (≈4k linhas) — pode ser truncado se crescer.

Para refrescar:

```bash
npx supabase db dump --local --schema public -f docs/database/schema.sql
npx supabase db dump --local --data-only      -f docs/database/data-sample.sql
```

## Modelo conceptual

Cada **`repo`** (URL único do GitHub) tem zero ou mais **`files_sources`** (um por ficheiro Markdown/texto descoberto, identificado pelo URL completo do blob). Cada `files_sources` tem **zero ou uma** análise (`analysis`) — chave única em `file_source_id`.

Uma `analysis` arruma a sua classificação em **quatro eixos**:

| Eixo                        | Cardinalidade               | Tabela                               | Tipo de vocabulário              |
| --------------------------- | --------------------------- | ------------------------------------ | -------------------------------- |
| `class` (artefacto)         | 1:1 via `analysis.class_id` | `classes`                            | Fechado, seed estável            |
| `domains` (área de assunto) | M:N                         | `analysis_domains` × `domains`       | Semi-aberto (seed + auto-upsert) |
| `activities` (o que faz)    | M:N                         | `analysis_activities` × `activities` | Semi-aberto (seed + auto-upsert) |
| `tags` (livre)              | M:N                         | `analysis_tags` × `tags`             | Aberto (sem seed)                |

Estado do `repo` é vivido via `repos.status ∈ {pending, processing, done, failed}` — `pending`/`processing` são fila de trabalho do pipeline, `done` está pronto a ser exibido, `failed` precisa de intervenção (ver `repos.last_error`).

## Queries-tipo para a UI

### Lista de análises com todos os eixos resolvidos

```sql
SELECT
  a.id,
  a.summary,
  a.maturity,
  a.score,
  c.name                                    AS class,
  ARRAY_REMOVE(ARRAY_AGG(DISTINCT d.name), NULL)   AS domains,
  ARRAY_REMOVE(ARRAY_AGG(DISTINCT act.name), NULL) AS activities,
  ARRAY_REMOVE(ARRAY_AGG(DISTINCT t.name), NULL)   AS tags,
  fs.url    AS file_url,
  fs.path   AS file_path,
  r.name    AS repo_name,
  r.repo_url,
  r.avatar_url,
  r.stars
FROM analysis a
JOIN files_sources fs       ON fs.id = a.file_source_id
JOIN repos r                ON r.id = fs.repo_id
LEFT JOIN classes c         ON c.id = a.class_id
LEFT JOIN analysis_domains ad    ON ad.analysis_id = a.id
LEFT JOIN domains d         ON d.id = ad.domain_id
LEFT JOIN analysis_activities aa ON aa.analysis_id = a.id
LEFT JOIN activities act    ON act.id = aa.activity_id
LEFT JOIN analysis_tags at  ON at.analysis_id = a.id
LEFT JOIN tags t            ON t.id = at.tag_id
WHERE r.status = 'done'
GROUP BY a.id, c.name, fs.url, fs.path, r.name, r.repo_url, r.avatar_url, r.stars
ORDER BY a.score DESC NULLS LAST;
```

Boa candidata a `CREATE VIEW analysis_with_axes AS ...` quando se materializar este SELECT — a UI pode `SELECT * FROM analysis_with_axes WHERE 'backend' = ANY(domains) AND 'code-review' = ANY(activities)` sem rescrever os JOINs.

### Filtros multi-eixo (OR dentro do eixo, AND entre eixos)

```sql
-- "skills de code-review para backend ou data-ai"
SELECT *
FROM analysis_with_axes
WHERE class = 'skill'
  AND activities && ARRAY['code-review']
  AND domains && ARRAY['backend', 'data-ai'];
```

O operador `&&` (array overlap) é o atalho para "qualquer entrada em comum".

### Stats globais para o dashboard

```sql
-- Distribuição por class
SELECT c.name, COUNT(*) AS n
FROM analysis a JOIN classes c ON c.id = a.class_id
GROUP BY c.name ORDER BY n DESC;

-- Top tags
SELECT t.name, COUNT(*) AS n
FROM analysis_tags at JOIN tags t ON t.id = at.tag_id
GROUP BY t.name ORDER BY n DESC LIMIT 30;

-- Top activities
SELECT act.name, COUNT(*) AS n
FROM analysis_activities aa JOIN activities act ON act.id = aa.activity_id
GROUP BY act.name ORDER BY n DESC LIMIT 30;
```

### Detalhe de um repo

```sql
SELECT
  fs.path,
  a.summary,
  a.maturity,
  a.score,
  a.use_cases,
  c.name AS class
FROM files_sources fs
LEFT JOIN analysis a ON a.file_source_id = fs.id
LEFT JOIN classes c  ON c.id = a.class_id
WHERE fs.repo_id = $1
ORDER BY a.score DESC NULLS LAST, fs.path;
```

## Convenções para a UI

- **IDs são BIGINT.** No client TypeScript, prefere `string` para os ids (evita perder precisão com inteiros muito grandes em JS) e converte para `number` só quando comparas.
- **`use_cases` é JSONB**, array de `{title, description}`. Render directo, não precisa de outra query.
- **`status` no `repos`** controla visibilidade — UI deve filtrar `WHERE status = 'done'` na listagem principal e mostrar `processing/pending` num separador "a processar" se quiseres dar transparência.
- **`tags` é open vocabulary** — quando o utilizador escrever no autocomplete, faz `ilike` na tabela `tags`.
- **`domains` e `activities` são semi-abertos** — mostra a lista actual ordenada por contagem como sugestões, mas aceita que cresçam.
- **Auth** — usa a `anon` key do Supabase no client. Activa RLS read-only nas tabelas relevantes antes de expor publicamente.
