# 🔍 Agentic Repo Explorer agent-skills-compare

Pipeline inteligente para descobrir, analisar e classificar repositórios GitHub e websites que contenham agentes, skills, workflows e documentação relevante — tudo sem clonar repositórios completos.

Este projeto usa:

- **Node.js** — backend principal (pipeline)
- **LLM providers** — Groq, Gemini, Claude CLI ou Codex CLI para análise semântica, extração de use cases e classificação
- **Supabase** — base de dados relacional
- **GitHub REST API** — descoberta e extração seletiva de ficheiros
- **Next.js 15** — UI integrada para consulta e filtragem dos dados

---

## 🎯 Objetivo

Criar um sistema capaz de descobrir e catalogar "skills" e padrões agênticos reutilizáveis, organizados por classes, domínios e atividades.

1. **Descobrir repositórios relevantes**
   - via GitHub Search API
   - via listas externas (web crawler leve - planned)

## 🚀 Como Correr

### 1. Requisitos

- Node.js 20+
- Supabase (Local ou Cloud)
- Uma credencial/provider LLM configurado: Groq API Key, Gemini API Key, `claude` CLI ou `codex` CLI
- GitHub Token (opcional, para evitar rate limits)

### 2. Setup

```bash
npm install
cp .env.example .env # Configurar as chaves
npm run db:reset     # Inicializar a BD (requer Supabase CLI)
```

### 3. Pipeline (Backend)

Para pesquisar e analisar repositórios (ex.: "claude code skills"):

```bash
npm start "claude code skills"
```

### 4. UI (Frontend)

Para ver os resultados no browser:

```bash
npm run dev
```

Aceda a `http://localhost:3000`.

---

## 🧱 Arquitetura e Taxonomia

O sistema classifica cada ficheiro analisado em quatro eixos:

- **Class:** O que é o artefacto (ex: `skill`, `subagent`, `mcp-server`)
- **Domains:** Área de assunto (ex: `backend`, `security`, `data-ai`)
- **Activities:** O que o agente faz (ex: `code-review`, `planning`, `debugging`)
- **Tags:** Etiquetas livres para tecnologias ou conceitos específicos.

A UI permite filtrar por estes eixos e visualizar detalhes de cada repositório, incluindo use cases extraídos e resumos.

## 📦 Estrutura do Projeto

- `app/`: Páginas e layouts do Next.js.
- `components/`: Componentes UI (shadcn/ui).
- `src/`: Lógica do pipeline de extração e análise.
- `supabase/`: Migrações e definições de schema.
- `docs/`: Documentação de design, roadmap e modelos de dados.

## 🧠 Porque não clonamos repositórios?

- **Velocidade:** Extraímos apenas ficheiros de texto/markdown via API.
- **Eficiência:** Skip automático de ficheiros já analisados (via hash).
- **Escala:** Permite analisar centenas de repositórios sem saturar o disco.

## 📄 Licença

Apache 2.0
