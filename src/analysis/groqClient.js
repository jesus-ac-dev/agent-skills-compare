import Groq from 'groq-sdk'
import dotenv from 'dotenv'
import logger from '../utils/logger.js'

dotenv.config()

const MODEL_NAME = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
const MAX_RETRIES = Number(process.env.GROQ_MAX_RETRIES ?? 3)
const DEFAULT_RETRY_DELAY_MS = 5_000
const MAX_RETRY_DELAY_MS = 60_000
// How long we're willing to sleep when the daily token/request quota is hit.
// Default = 1h. Anything longer aborts cleanly so the user can decide.
const MAX_DAILY_WAIT_MS = Number(process.env.GROQ_MAX_DAILY_WAIT_MS ?? 60 * 60 * 1000)
const DAILY_WAIT_BUFFER_MS = 10_000

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

export class DailyQuotaExceededError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DailyQuotaExceededError'
  }
}

function isDailyQuotaError(error) {
  const message = error?.message ?? ''
  // Groq messages: "tokens per day (TPD): Limit ..." or "requests per day (RPD): Limit ..."
  return /\b(tpd|rpd|per[\s-]?day|daily)\b/i.test(message)
}

/**
 * Parses Groq's "Please try again in 27m27.648s" style message and returns
 * the delay in milliseconds. Returns null if the format isn't recognised.
 */
function parseDailyQuotaDelayMs(message) {
  const match = String(message ?? '').match(/try again in\s+(?:(\d+)m)?(\d+(?:\.\d+)?)?\s*s/i)
  if (!match) return null
  const minutes = Number(match[1] ?? 0)
  const seconds = Number(match[2] ?? 0)
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null
  return Math.ceil((minutes * 60 + seconds) * 1000)
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
        const delayMs = parseDailyQuotaDelayMs(error.message)
        if (delayMs !== null && delayMs <= MAX_DAILY_WAIT_MS) {
          const totalMs = delayMs + DAILY_WAIT_BUFFER_MS
          const minutes = Math.ceil(totalMs / 60_000)
          logger.warn(
            `Groq daily quota hit — sleeping ~${minutes}min then resuming. ` +
              `(Set GROQ_MAX_DAILY_WAIT_MS to change the cap; current cap = ${Math.round(MAX_DAILY_WAIT_MS / 60_000)}min.)`
          )
          await sleep(totalMs)
          continue
        }
        logger.error(
          `Groq daily quota exceeded and wait would exceed the cap. Aborting: ${error.message}`
        )
        throw new DailyQuotaExceededError(error.message)
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
