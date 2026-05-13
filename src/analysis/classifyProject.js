import { getActiveProvider } from './providers/factory.js'
import { loadClosedVocabulary } from '../db/lookups.js'

function kindGuidance(kind, path) {
  if (kind === 'code') {
    return `This file is CODE (path: ${path}). Focus on what it actually DOES, not what comments
claim. Look for: exported functions/classes/schemas (public API), tool/command definitions, agent
loop or controller flow, inline system prompts or instructions as string literals, MCP/skill
registration calls, and notable libraries imported (those become tags). If the file is mostly
boilerplate (entry point, types-only, test setup), say so honestly and give it a low score.`
  }
  if (kind === 'config') {
    return `This file is CONFIG (path: ${path}). Focus on what it CONFIGURES: which agent / skill /
plugin / hook does it register, what defaults does it set, what required fields exist.`
  }
  if (kind === 'markdown') {
    return `This file is DOCUMENTATION (path: ${path}). Focus on what the document TEACHES or
INSTRUCTS — the actual skill/workflow it conveys, not the writing style.`
  }
  return `This file is plain text (path: ${path}). Treat it as documentation by default but flag
honestly if it has no analyzable content.`
}

function buildSystemPrompt(
  { classes, domains, activities = [] },
  { kind = 'markdown', path = '' } = {}
) {
  const activitiesHint =
    activities.length > 0
      ? `\n- **PREFER existing activities** when they fit. Current vocabulary (most-used first):
  ${activities.join(', ')}.
  Only invent a new one for a genuinely novel concept that none of the above covers.
  Use NOUN form (e.g. "analysis", not "analyzing"; "review", not "reviewing"). Singular over plural.`
      : ''

  return `You analyze a single file from a public repository that may contain AI agent skills,
sub-agents, MCP servers, plugins, prompts, hooks, or related artifacts. Classify it and return
ONLY a single JSON object (no prose, no markdown fences) with EXACTLY these keys:
summary, maturity, score, class, domains, activities, tags, use_cases.

${kindGuidance(kind, path)}

Field rules:
- "summary": ONE specific paragraph (≥ 80 chars). Mention concrete things THIS file does — names of
  tools, commands, hooks, exported symbols, or notable behaviors. NEVER write boilerplate like
  "This file describes a skill for..." or "This is a configuration file." Be concrete.
- "maturity": one of "experimental", "stable", "abandoned".
- "score": number 0–10 (quality + relevance to agentic artefacts).
- "class": pick EXACTLY ONE from this closed list — ${classes.join(', ')}.
- "domains": array, 1+ entries, each MUST be from this closed list — ${domains.join(', ')}.
- "activities": array, 1+ short kebab-case verbs/use-actions (e.g. "code-review", "planning",
  "debugging", "documentation"). Free vocabulary, but stick to lowercase kebab-case.${activitiesHint}
- "tags": array, 0+ free-form keywords (languages, frameworks, models, libraries:
  "python", "react", "claude-code", "langchain", "postgres"). Lowercase. Prefer canonical forms
  (e.g. "javascript" not "js"; "typescript" not "ts"; "artificial-intelligence" not "ai").
- "use_cases": array, 1+ objects of shape {"title": string, "description": string}.

Return ONLY the JSON object.`
}

export function buildClassifyResponseSchema({ classes, domains }) {
  return {
    type: 'object',
    required: [
      'summary',
      'maturity',
      'score',
      'class',
      'domains',
      'activities',
      'tags',
      'use_cases'
    ],
    properties: {
      summary: { type: 'string', minLength: 80 },
      maturity: { type: 'string', enum: ['experimental', 'stable', 'abandoned'] },
      score: { type: 'number', minimum: 0, maximum: 10 },
      class: { type: 'string', enum: classes },
      domains: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', enum: domains }
      },
      activities: {
        type: 'array',
        minItems: 1,
        items: { type: 'string' }
      },
      tags: {
        type: 'array',
        items: { type: 'string' }
      },
      use_cases: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['title', 'description'],
          properties: {
            title: { type: 'string' },
            description: { type: 'string' }
          }
        }
      }
    }
  }
}

/**
 * Classifies a file with one structured LLM call.
 * The provider (Groq, Gemini, or Claude CLI) is chosen at pipeline startup
 * from settings.llm_provider via the factory; classifyProject just resolves
 * the cached instance and delegates.
 */
export async function classifyProject(content, { kind = 'markdown', path = '' } = {}) {
  const vocab = await loadClosedVocabulary()
  const schema = buildClassifyResponseSchema(vocab)
  const prompt = buildSystemPrompt(vocab, { kind, path })
  const provider = await getActiveProvider()
  return await provider.analyzeContent(content, prompt, {
    schema,
    temperature: 0.4
  })
}
