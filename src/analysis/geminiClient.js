import { GoogleGenerativeAI } from '@google/generative-ai'
import dotenv from 'dotenv'
import logger from '../utils/logger.js'

dotenv.config()

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'
const MAX_RETRIES = Number(process.env.GEMINI_MAX_RETRIES ?? 3)
const DEFAULT_RETRY_DELAY_MS = 30_000
const MAX_RETRY_DELAY_MS = 120_000

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const model = genAI.getGenerativeModel({ model: MODEL_NAME })

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

async function generateWithRetry(prompt, content) {
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
 * Analyzes the content of a file using Gemini.
 * @param {string} content - The file content to analyze.
 * @param {string} prompt - The analysis prompt.
 * @returns {Promise<object>} The analyzed data.
 */
export async function analyzeContent(content, prompt) {
  try {
    logger.info(`Analyzing content with Gemini (${MODEL_NAME})...`)
    const result = await generateWithRetry(prompt, content)
    const response = await result.response
    const text = response.text()

    try {
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/{[\s\S]*}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1] || jsonMatch[0])
      }
      return { text }
    } catch (e) {
      logger.warn('Failed to parse JSON from Gemini response, returning raw text.')
      return { text }
    }
  } catch (error) {
    logger.error('Error in Gemini analysis:', error.message)
    throw error
  }
}
