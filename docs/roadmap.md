# Roadmap

Estado depois do redesign de schema/taxonomia v3 e fixes subsequentes.

## ✅ Já feito

- **Taxonomia multi-eixo** (commits `130b626..306941d`): `repos.status`, classes/domains/activities/tags + M2M, structured output do classifier.
- **Fix M2M + Groq como provedor** (`3ba57c3`, `33a5e33`): tabelas `tags`/`activities` populadas como deve ser; free tier do Groq (~14k req/dia) substitui o limite de 20/dia do Gemini.
- **Resume + hash skip + saída limpa em daily quota** (`aa1f7bf`): re-runs do mesmo corpus = 0 chamadas LLM em ficheiros inalterados; repos `processing` retomados ao arranque; daily quota propaga-se sem stack trace.
- **Domain semi-open + auto-wait em daily quota**: domains desconhecidos (ex.: `marketing`) são auto-inseridos em vez de descartados; quando o erro de TPD/RPD vem com delay parseável e o delay é ≤ `GROQ_MAX_DAILY_WAIT_MS` (default 1h), o pipeline dorme + 10s e retoma sozinho.
- **Snapshot da BD** em [docs/database/](database/) — schema + sample data + queries-tipo para a UI.

Isto resolve a **Etapa 1** original (incremental vs refresh) na prática:

- Incremental: já é o default. `done` salta, `processing`+`pending` resumem, hash igual salta.
- Refresh per-repo: `UPDATE repos SET status='pending' WHERE id=?` (a UI pode disparar isto com um botão).
- Refresh global: `UPDATE repos SET status='pending'` — re-roda tudo, hash skip mantém custo baixo.

## Próximas etapas

### A. Canonicalização do vocabulário aberto

**Problema:** dados reais já mostram fragmentação previsível em `activities` e `tags`:

| Cluster       | Variantes observadas                                                                                 | Canónica sugerida                      |
| ------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Análise       | `analyzing`, `analysis`, `data-analysis`, `failure-analysis`, `writing-style-analysis`               | `data-analysis` (seed)                 |
| Optimização   | `optimizing`, `optimization`, `content-optimization`, `outreach-optimization`                        | `performance-tuning` ou `optimization` |
| Pesquisa      | `researching`, `research`                                                                            | `research` (seed)                      |
| Implementação | `implementing`, `implementation`                                                                     | `implementation`                       |
| Segurança     | `security-audit`, `security-auditing`, `auditing`, `vulnerability-assessment`, `penetration-testing` | `security-audit` (seed)                |
| Design        | `designing`, `api-design`, `architecture-planning`, `workflow-design`                                | `planning` ou novo `design`            |

**Proposta — duas vertentes:**

1. **Prevenir** (fix no prompt, ~10 linhas): carregar a lista actual de `activities` (e `domains`) da BD e injectá-la no system prompt como _"PREFER these existing values when they fit; only invent new ones for truly novel concepts. Use noun form, not gerund (e.g. 'analysis', not 'analyzing')."_ Reduz fragmentação em re-runs futuros sem mexer em dados antigos.

2. **Corrigir** (canonicalizar o que já existe): comando standalone `npm run db:canonicalize` que aplica um mapa `{ analyzing → analysis, researching → research, ... }` actualizando `analysis_activities`/`analysis_tags` para apontar para a entrada canónica e apagando duplicados. Mapa fica em `config/canonical-aliases.json` para o utilizador editar.

**Critérios de aceitação:**

- Depois de aplicar o fix do prompt, um run novo num repo grande não produz duplicados óbvios (gerund/noun, plural/singular).
- Depois de correr `db:canonicalize` com um mapa razoável, a contagem em `activities` cai ≥ 20% sem perder informação (cada eliminado tem um destino canónico, todas as M2M são preservadas).

### ✅ B. Lista curada de repos seed (feito 2026-05-13)

Implementado em `src/seed/curatedRepos.js` + `config/curated-repos.json` (15 entries iniciais). O loader corre no arranque de `main()` antes do `findResumableRepos`, inserindo URLs novas com `status='pending'`. Idempotente via `ON CONFLICT DO NOTHING` (`ignoreDuplicates: true`) — re-runs não tocam em repos já processados. Skipped em modo `--resume`.

Adicionar novos repos canónicos: editar `config/curated-repos.json` e correr `npm start` (com ou sem query). Reanalisar repos existentes continua a ser via `UPDATE repos SET status='pending' WHERE id=?` — a lista curada nunca sobrepõe estado existente.

Spec: [docs/superpowers/specs/2026-05-12-curated-seed-repos-design.md](superpowers/specs/2026-05-12-curated-seed-repos-design.md).

### C. UI simples para ler os dados (sub-projecto)

**Handoff para Jules AI:** [docs/database/README.md](database/README.md) tem schema, sample data, modelo conceptual, queries-tipo. A `analysis_with_axes` view é a primeira coisa a materializar; o resto é UI por cima dela.

**Stack sugerida:**

- Next.js 15 App Router + `@supabase/supabase-js` (anon key, read-only).
- `shadcn/ui` para componentes; tabela com `@tanstack/react-table`.
- Filtros em URL via `useSearchParams` (URL = estado).

**Vistas mínimas:**

1. **Lista** — filtros lado-a-lado por `class`, `domains` (multi-select OR), `activities` (multi-select OR), `tags`, score mínimo, maturity. Cards com avatar/nome/summary/chips dos eixos.
2. **Detalhe de repo** — lista de ficheiros analisados + classificação por ficheiro + `use_cases`.
3. **Stats** — top tags/activities/domains, distribuição por class, contagem por status.

**Operações de pipeline disparadas da UI:**

- "Reanalisar repo" → `UPDATE repos SET status='pending' WHERE id=?`. O pipeline (quando correr) apanha-o em `findResumableRepos`.
- "Marcar como ignorado" → idealmente novo estado `archived` ou flag separada; fora de scope mínimo.

**Onde fica:** sub-pasta `web/` na raiz (monorepo simples) ou repo separado se a UI crescer.

### D. Operações de qualidade contínua

Pequenas mas úteis quando a BD começar a crescer:

- **`npm run db:health`** — relatório SQL rápido: repos por estado, ficheiros sem análise, análises órfãs, top erros recentes. Útil para detectar drift antes de virar problema.
- **Truncar `summary` muito longos** ou ter um campo `summary_short` derivado — alguns ficheiros gigantes produzem summaries de várias frases que partem layouts da UI.
- **Re-classify** com modelo melhor (ex.: trocar `llama-3.3-70b-versatile` por algo do Tier 1 pago): combinado com `db:canonicalize` e com hash skip, fica relativamente barato testar diferentes modelos em batch.

## Ordem sugerida

1. (A1) Fix do prompt para canonicalização — 10 linhas, payoff imediato.
2. (C) UI via Jules AI — desbloqueia produto real.
3. (A2) Canonicalização retroactiva — quando houver dados suficientes para justificar.
4. (D) Operações de qualidade — só quando a dor aparecer.

Cada uma destas etapas merece o seu próprio brainstorming + spec + plano antes de implementar — o ciclo `superpowers:brainstorming → writing-plans → subagent-driven-development` deu bons frutos no v3.
