# 🔍 Agentic Repo Explorer agent-skills-compare

Pipeline inteligente para descobrir, analisar e classificar repositórios GitHub e websites que contenham agentes, skills, workflows e documentação relevante — tudo sem clonar repositórios completos.

Este projeto usa:

- **Node.js** — backend principal
- **Gemini API** — análise semântica, extração de use cases, classificação
- **Supabase** — base de dados + storage + autenticação opcional
- **GitHub REST API** — descoberta e extração seletiva de ficheiros
- **Web crawler leve** — para páginas externas com coleções de agentes/skills

---

## 🎯 Objetivo

Criar um sistema capaz de:

1. **Descobrir repositórios relevantes**
   - via GitHub Search API
   - via listas externas (web crawling leve)

2. **Extrair apenas o necessário**
   - ficheiros `.md`
   - READMEs
   - docs de agentes/skills
   - exemplos e workflows

3. **Analisar com Gemini**
   - gerar resumos
   - extrair _use cases_
   - classificar maturidade
   - identificar tecnologias (MCP, multi-agent, RAG, etc.)

4. **Guardar tudo em Supabase**
   - URLs visitados
   - metadata do repositório
   - avaliações automáticas
   - histórico de análises
   - ranking final

5. **Evitar duplicados**
   - cada URL é registado
   - cada repo tem hash de conteúdo analisado
   - reanálises só quando há mudanças

6. **Frontend **
   - Uma homepage onde podemos consultar e filtrar a info

## 🧱 Arquitetura (Visão Geral)

┌────────────────────────┐
│ GitHub API │
│ - search repos │
│ - fetch files (.md) │
└───────────┬────────────┘
│
▼
┌────────────────────────┐
│ Web Crawler │
│ - páginas externas │
│ - listas de agentes │
└───────────┬────────────┘
│ URLs
▼
┌────────────────────────┐
│ Supabase DB │
│ - urls visitados │
│ - repos analisados │
│ - avaliações │
│ - ranking │
└───────────┬────────────┘
│ conteúdo
▼
┌────────────────────────┐
│ Gemini API │
│ - resumo │
│ - use cases │
│ - classificação │
│ - tags │
└───────────┬────────────┘
│ insights
▼
┌────────────────────────┐
│ Dashboard / CLI │
│ - ranking │
│ - export JSON │
│ - pesquisa │
└────────────────────────┘

## 📦 Estrutura do Projeto

agentic-repo-explorer/
│
├── src/
│ ├── github/
│ │ ├── searchRepos.js
│ │ ├── fetchFiles.js
│ │ └── rateLimit.js
│ │
│ ├── crawler/
│ │ └── crawlPage.js
│ │
│ ├── analysis/
│ │ ├── geminiClient.js
│ │ ├── extractUseCases.js
│ │ └── classifyProject.js
│ │
│ ├── db/
│ │ ├── supabaseClient.js
│ │ ├── saveRepo.js
│ │ └── saveAnalysis.js
│ │
│ ├── utils/
│ │ ├── logger.js
│ │ └── hash.js
│ │
│ └── index.js
│
├── supabase/
│ ├── schema.sql
│ └── seed.sql
│
├── .env.example
├── package.json
└── README.md

## 🗄️ Estrutura da Base de Dados (Supabase)

### **Tabela: `sources`**

Cada URL é uma fonte independente.

| coluna       | tipo        | descrição                                 |
| ------------ | ----------- | ----------------------------------------- |
| id           | uuid        | PK                                        |
| url          | text        | URL única                                 |
| type         | text        | `github_repo`, `github_file`, `website`   |
| repo_id      | uuid        | FK opcional → `repos.id`                  |
| status       | text        | `pending`, `processed`, `error`           |
| last_checked | timestamptz | última visita                             |
| hash         | text        | hash do conteúdo (para evitar reanálises) |

### **Tabela: `repos`**

Um repositório GitHub ou website que representa um “projeto”.

| coluna      | tipo        | descrição                                       |
| ----------- | ----------- | ----------------------------------------------- |
| id          | uuid        | PK                                              |
| name        | text        | nome do projeto                                 |
| repo_url    | text        | URL GitHub ou website principal                 |
| stars       | int         | estrelas (se GitHub)                            |
| last_commit | timestamptz | atividade                                       |
| tags        | jsonb       | tags agregadas de todos os ficheiros            |
| score       | float       | score global (calculado a partir dos ficheiros) |

### **Tabela: `files`**

Este é o core do sistema.

| coluna       | tipo        | descrição                                    |
| ------------ | ----------- | -------------------------------------------- |
| id           | uuid        | PK                                           |
| source_id    | uuid        | FK → `sources.id`                            |
| repo_id      | uuid        | FK → `repos.id`                              |
| path         | text        | caminho no repo (ex: `docs/skills/agent.md`) |
| content      | text        | conteúdo bruto extraído                      |
| hash         | text        | hash do conteúdo                             |
| type         | text        | `markdown`, `json`, `yaml`, `html`           |
| extracted_at | timestamptz | quando foi extraído                          |

### **Tabela: `analysis`**

Resultados da análise do Gemini.

| coluna     | tipo        | descrição                             |
| ---------- | ----------- | ------------------------------------- |
| id         | uuid        | PK                                    |
| file_id    | uuid        | FK → `files.id`                       |
| summary    | text        | resumo                                |
| use_cases  | jsonb       | lista                                 |
| entities   | jsonb       | agentes, skills, ferramentas          |
| maturity   | text        | `experimental`, `stable`, `abandoned` |
| score      | float       | score do ficheiro                     |
| model      | text        | modelo usado (ex: `gemini-2.0-pro`)   |
| created_at | timestamptz | timestamp                             |

### **Tabela: `entities`**

Extrair entidades normalizadas.

| coluna      | tipo  | descrição                                            |
| ----------- | ----- | ---------------------------------------------------- |
| id          | uuid  | PK                                                   |
| file_id     | uuid  | FK                                                   |
| type        | text  | `agent`, `skill`, `workflow`, `tool`, `architecture` |
| name        | text  | nome da entidade                                     |
| description | text  | descrição                                            |
| metadata    | jsonb | qualquer extra                                       |

## 🚀 Como Funciona (Fluxo)

1. **Pesquisar repositórios**
   - node src/github/searchRepos.js "agent skills"

2. Extrair ficheiros relevantes

- README.md
- docs/
- .claude/
- skills/
- agents/
- examples/
- qualquer .md com palavras-chave

3. Enviar para Gemini

- extrair use cases
- gerar resumo
- classificar maturidade
- gerar score

4. Guardar no Supabase

5. Dashboard / CLI

- ver ranking
- exportar JSON
- procurar por tags

## 🧠 Porque não clonamos repositórios?

- mais rápido
- menos storage
- menos problemas com repositórios gigantes
- evita duplicados
- permite análise incremental
- reduz custos de API/compute

🧪 Roadmap
[ ] CLI para correr todo o pipeline
[ ] Dashboard web (Next.js)
[ ] Suporte para MCP / Agent Protocol
[ ] Scheduler para reanálises automáticas
[ ] Export para dataset treinável

## 🤝 Contribuições

Pull requests são bem-vindos.
Issues com ideias de use cases também.

##📄 Licença
Apache 2.0
