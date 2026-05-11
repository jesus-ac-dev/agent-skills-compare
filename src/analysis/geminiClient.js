import { GoogleGenerativeAI } from '@google/generative-ai'
import dotenv from 'dotenv'
import logger from '../utils/logger.js'

dotenv.config()

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'
const MAX_RETRIES = Number(process.env.GEMINI_MAX_RETRIES ?? 3)
const DEFAULT_RETRY_DELAY_MS = 30_000
const MAX_RETRY_DELAY_MS = 120_000

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function isRateLimitError(error) {
  const status = error?.status ?? error?.response?.status
  if (status === 429) return true
  return /\b429\b|too many requests|quota/i.test(error?.message ?? '')
}

function parseRetryDelayMs(error, attempt) {
  const message = error?.message ?? ''
  const jsonMatch = message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i)
  if (jsonMatch) return Math.min(Math.ceil(Number(jsonMatch[1]) * 1000), MAX_RETRY_DELAY_MS)
  const textMatch = message.match(/retry in\s+(\d+(?:\.\d+)?)\s*s/i)
  if (textMatch) return Math.min(Math.ceil(Number(textMatch[1]) * 1000), MAX_RETRY_DELAY_MS)
  const backoff = DEFAULT_RETRY_DELAY_MS * 2 ** (attempt - 1)
  return Math.min(backoff, MAX_RETRY_DELAY_MS)
}

function buildModel({ schema, temperature }) {
  const generationConfig = {}
  if (typeof temperature === 'number') generationConfig.temperature = temperature
  if (schema) {
    generationConfig.responseMimeType = 'application/json'
    generationConfig.responseSchema = schema
  }
  return genAI.getGenerativeModel({
    model: MODEL_NAME,
    ...(Object.keys(generationConfig).length ? { generationConfig } : {})
  })
}

async function generateWithRetry(model, prompt, content) {
  let attempt = 0
  while (true) {
    attempt++
    try {
      return await model.generateContent([prompt, content])
    } catch (error) {
      if (!isRateLimitError(error) || attempt > MAX_RETRIES) throw error
      const waitMs = parseRetryDelayMs(error, attempt)
      logger.warn(
        `Gemini rate-limited (attempt ${attempt}/${MAX_RETRIES}). Waiting ${Math.round(waitMs / 1000)}s before retry.`
      )
      await sleep(waitMs)
    }
  }
}

/**
 * Analyzes content with Gemini.
 *
 * @param {string} content - File content to analyze.
 * @param {string} prompt  - Instruction prompt.
 * @param {object} [options]
 * @param {object} [options.schema]      - JSON schema for structured output. When set,
 *                                         the response is parsed strictly as JSON.
 * @param {number} [options.temperature] - Sampling temperature (0–1).
 * @returns {Promise<object>}
 */
export async function analyzeContent(content, prompt, options = {}) {
  const model = buildModel(options)
  logger.info(
    `Analyzing content with Gemini (${MODEL_NAME})${options.schema ? ' [structured]' : ''}…`
  )

  const result = await generateWithRetry(model, prompt, content)
  const text = result.response.text()

  if (options.schema) {
    return JSON.parse(text)
  }

  // Fallback: legacy regex JSON extraction
  try {
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/{[\s\S]*}/)
    if (jsonMatch) return JSON.parse(jsonMatch[1] || jsonMatch[0])
    return { text }
  } catch {
    logger.warn('Failed to parse JSON from Gemini response, returning raw text.')
    return { text }
  }
}
