// src/analysis/providers/factory.js
import { supabase } from '../../db/supabaseClient.js'
import logger from '../../utils/logger.js'
import { GroqProvider } from './groqProvider.js'
import { GeminiProvider } from './geminiProvider.js'
import { ClaudeCliProvider } from './claudeCliProvider.js'
import { CodexCliProvider } from './codexCliProvider.js'

const REGISTRY = {
  [GroqProvider.providerName]: GroqProvider,
  [GeminiProvider.providerName]: GeminiProvider,
  [ClaudeCliProvider.providerName]: ClaudeCliProvider,
  [CodexCliProvider.providerName]: CodexCliProvider
}

let cached = null

export async function getActiveProvider() {
  if (cached) return cached
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'llm_provider')
    .single()
  if (error) {
    logger.warn(`settings lookup failed (${error.message}); defaulting to groq`)
  }
  const name = data?.value ?? 'groq'
  const Cls = REGISTRY[name]
  if (!Cls) throw new Error(`Unknown provider: ${name}`)
  cached = new Cls()
  logger.info(`Active LLM provider: ${name}`)
  return cached
}

export function listProviders() {
  return Object.keys(REGISTRY)
}

// Only exposed for tests that need a fresh cache.
export function _resetCacheForTests() {
  cached = null
}
