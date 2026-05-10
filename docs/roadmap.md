# Roadmap

Próximas etapas após o redesign de schema/taxonomia v3 (commits `130b626..306941d`).

## 1. Modos de execução: incremental vs refresh

**Problema:** hoje o pipeline volta a processar **todos** os repos da query a cada run. Em queries grandes ou re-runs frequentes isto é desperdício de chamadas Gemini e pressão sobre rate-limits.

**Proposta:** dois caminhos explícitos, controlados por flag de CLI ou variável de ambiente.

### 1a. Modo `incremental` (default)

Só processa repos novos ou com trabalho por terminar:

- Repos com `status='done'` **são saltados**.
- Repos com `status='pending'`, `'failed'`, ou que ainda não existem em BD são processados normalmente.
- A metadata superficial (`stars`, `last_commit`, `avatar_url`) **continua** a ser actualizada via upsert — barato e dá frescura.

### 1b. Modo `refresh`

Reprocessa tudo, ignorando o `status` actual:

- Cada repo passa pelo state machine completo (`processing` → `done`).
- Como o `analysis` tem `UNIQUE(file_source_id)` e usamos upsert, os dados velhos são substituídos cleanmente; as M2M são limpas e reconstruídas em `persistClassification`.
- Útil quando se troca o modelo Gemini, se altera o prompt do classifier, ou se acrescenta um domain/class novo na taxonomia.

### Como invocar

Sugestão: `npm start -- --mode=incremental "query"` (default) e `npm start -- --mode=refresh "query"`. Implementação: parsear `process.argv` em `src/index.js` antes do `main()`.

### Critérios de aceitação

- Re-correr o pipeline com a mesma query sem `--mode=refresh` não chama Gemini para repos `done`.
- `--mode=refresh` chama Gemini para todos os repos da query, e a contagem de linhas em `analysis` mantém-se estável (não duplica).
- Logs informam claramente o modo activo e quantos repos foram saltados.

---

## 2. Lista curada de repos seed

**Problema:** confiar 100% na pesquisa GitHub deixa de fora repos canónicos conhecidos (ex.: `awesome-claude-code`, repos oficiais da Anthropic, colecções pessoais que valem indexar). E queries diferentes podem perder os mesmos repos.

**Proposta:** ficheiro de configuração estático com uma lista de URLs/`owner/name` que é processada **antes** da query GitHub, no mesmo run.

### Esboço

`config/curated-repos.json`:

```json
[
  {
    "url": "https://github.com/anthropics/claude-code",
    "reason": "Oficial — fonte de verdade do Claude Code"
  },
  {
    "url": "https://github.com/hesreallyhim/awesome-claude-code",
    "reason": "Colecção comunitária canónica"
  }
]
```

Em `src/index.js`, antes do `searchRepos`:

1. Carregar o JSON, dedupe por URL.
2. Para cada entrada, fazer um GET ao endpoint `/repos/{owner}/{name}` da API GitHub para obter a metadata completa (stars, default_branch, etc.) — a mesma forma do `searchRepos`.
3. Concatenar com o resultado de `searchRepos(query)`, dedupe final por `repo_url`.

### Critérios de aceitação

- Se a lista curada tiver 5 repos e a query devolver 10 (3 dos quais já estão na curada), o pipeline processa 12 repos únicos no total.
- A lista curada é processada mesmo se a query falhar (ex.: GitHub rate-limited) — útil como fallback de "garantia mínima".
- O motivo (`reason`) é guardado em `repos.tags` ou num campo dedicado — decisão a fechar quando se implementar.

---

## 3. UI simples para ler os dados recolhidos

**Problema:** Supabase Studio é OK para consultar tabelas mas não dá uma vista de produto — quem é capaz de filtrar por "skills de code-review em backend Python" hoje precisa de escrever SQL.

**Proposta:** Next.js App Router + Supabase JS client (anónimo, RLS read-only) com 2-3 vistas:

- **Lista de repos** com filtros lado-a-lado: `class`, `domain`, `activity`, `tag`, intervalo de score, maturity. Cada card mostra avatar + nome + summary + chips dos eixos.
- **Detalhe de repo** com lista de ficheiros analisados, classificação por ficheiro, use_cases.
- **Stats globais**: top tags, distribuição por class, % com cada domain, evolução do `last_processed_at` (heatmap simples).

### Stack

- Next.js 15 (App Router) — SSR para SEO se um dia for público.
- `@supabase/supabase-js` (read-only com `anon key`).
- `shadcn/ui` para componentes; tabela com `@tanstack/react-table` para o filtro.
- Sem state management externo — `useSearchParams` para os filtros (URL = estado).

### Schema queries necessárias

- Lista filtrada: JOIN `repos × analysis × M2M tables`. Vai exigir uma view ou função SQL para tornar a query trivial do lado do client. Sugestão: `CREATE VIEW analysis_with_axes AS SELECT a.*, c.name AS class, ARRAY_AGG(DISTINCT d.name) AS domains, ARRAY_AGG(DISTINCT act.name) AS activities, ARRAY_AGG(DISTINCT t.name) AS tags FROM analysis a LEFT JOIN classes c ... GROUP BY a.id, c.name`.
- Stats: count + group by directos sobre essa view.

### Critérios de aceitação

- Carregar a lista com 200 repos e aplicar 2 filtros leva < 500ms.
- Os filtros multi-select funcionam como AND entre eixos e OR dentro do mesmo eixo (ex.: `domain=backend OR data-ai`, **e** `activity=code-review`).
- Não expõe a `service_role_key` no cliente.

### Onde fica o código

Sub-pasta `web/` na raiz do repo (monorepo simples) ou repo separado se a UI crescer. Decisão a fechar quando se começar.

---

## Ordem sugerida

1. (1a) Modo incremental — tem o maior ROI imediato e evita re-trabalho enquanto se itera no resto.
2. (2) Lista curada — pequena, dá garantia mínima de cobertura.
3. (3) UI — só faz sentido depois de (1) e (2) terem enchido a BD com dados decentes.

Cada uma destas etapas merece o seu próprio brainstorming + spec + plano antes de implementar — o ciclo `superpowers:brainstorming → writing-plans → subagent-driven-development` deu bons frutos no v3.
