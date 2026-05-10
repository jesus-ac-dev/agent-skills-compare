import Groq from 'groq-sdk'
import dotenv from 'dotenv'
import logger from '../utils/logger.js'

dotenv.config()

const MODEL_NAME = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
const MAX_RETRIES = Number(process.env.GROQ_MAX_RETRIES ?? 3)
const DEFAULT_RETRY_DELAY_MS = 5_000
const MAX_RETRY_DELAY_MS = 60_000

let _client
function getClient() {
  if (!_client) {
    _client = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0 })
  }
  return _client
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function isRateLimitError(error) {
  const status = error?.status ?? error?.response?.status
  if (status === 429) return true
  return /\b429\b|too many requests|rate.?limit/i.test(error?.message ?? '')
}

function isDailyQuotaError(error) {
  const message = error?.message ?? ''
  return /per.?day|daily/i.test(message)
}

function parseRetryDelayMs(error, attempt) {
  const headers = error?.headers ?? error?.response?.headers
  const retryAfter = headers?.['retry-after']
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds)) {
      return Math.min(Math.ceil(seconds * 1000), MAX_RETRY_DELAY_MS)
    }
  }
  const message = error?.message ?? ''
  const textMatch = message.match(/try again in\s+(\d+(?:\.\d+)?)\s*s/i)
  if (textMatch) {
    return Math.min(Math.ceil(Number(textMatch[1]) * 1000), MAX_RETRY_DELAY_MS)
  }
  const backoff = DEFAULT_RETRY_DELAY_MS * 2 ** (attempt - 1)
  return Math.min(backoff, MAX_RETRY_DELAY_MS)
}

async function callWithRetry(messages, options) {
  let attempt = 0
  while (true) {
    attempt++
    try {
      return await getClient().chat.completions.create({
        model: MODEL_NAME,
        messages,
        ...options
      })
    } catch (error) {
      if (isDailyQuotaError(error)) {
        logger.error('Groq daily quota exceeded — aborting (no point retrying).')
        throw error
      }
      if (!isRateLimitError(error) || attempt > MAX_RETRIES) throw error
      const waitMs = parseRetryDelayMs(error, attempt)
      logger.warn(
        `Groq rate-limited (attempt ${attempt}/${MAX_RETRIES}). Waiting ${Math.round(waitMs / 1000)}s before retry.`
      )
      await sleep(waitMs)
    }
  }
}

/**
 * Analyzes content with Groq.
 *
 * Mirrors geminiClient.analyzeContent so callers can swap providers transparently.
 * When a schema is provided, json_object mode is used (Groq's universally supported
 * structured-output mode); the prompt is responsible for enforcing the shape.
 *
 * @param {string} content - File content to analyze.
 * @param {string} prompt  - Instruction prompt (used as the system message).
 * @param {object} [options]
 * @param {object} [options.schema]      - Schema hint (if present, forces JSON output).
 * @param {number} [options.temperature] - Sampling temperature (0–1).
 * @returns {Promise<object>}
 */
export async function analyzeContent(content, prompt, options = {}) {
  const { schema, temperature } = options
  const requestOptions = {}

  if (typeof temperature === 'number') requestOptions.temperature = temperature
  if (schema) requestOptions.response_format = { type: 'json_object' }

  logger.info(`Analyzing content with Groq (${MODEL_NAME})${schema ? ' [json_object]' : ''}…`)

  const completion = await callWithRetry(
    [
      { role: 'system', content: prompt },
      { role: 'user', content }
    ],
    requestOptions
  )

  const text = completion.choices?.[0]?.message?.content ?? ''

  if (schema) {
    return JSON.parse(text)
  }

  try {
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/{[\s\S]*}/)
    if (jsonMatch) return JSON.parse(jsonMatch[1] || jsonMatch[0])
    return { text }
  } catch {
    logger.warn('Failed to parse JSON from Groq response, returning raw text.')
    return { text }
  }
}
