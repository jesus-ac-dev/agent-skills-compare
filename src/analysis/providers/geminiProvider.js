// src/analysis/providers/geminiProvider.js
import { GoogleGenerativeAI } from '@google/generative-ai'
import dotenv from 'dotenv'
import logger from '../../utils/logger.js'
import { BaseProvider } from './BaseProvider.js'

dotenv.config()

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'
const MAX_RETRIES = Number(process.env.GEMINI_MAX_RETRIES ?? 3)
const DEFAULT_RETRY_DELAY_MS = 30_000
const MAX_RETRY_DELAY_MS = 120_000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export class GeminiError extends Error {
  constructor(message) {
    super(message)
    this.name = 'GeminiError'
  }
}

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

export class GeminiProvider extends BaseProvider {
  static providerName = 'gemini'

  #client = null

  #getClient() {
    if (!this.#client) {
      if (!process.env.GEMINI_API_KEY) {
        throw new GeminiError('GEMINI_API_KEY not set')
      }
      this.#client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    }
    return this.#client
  }

  #buildModel({ schema, temperature }) {
    const generationConfig = {}
    if (typeof temperature === 'number') generationConfig.temperature = temperature
    if (schema) {
      generationConfig.responseMimeType = 'application/json'
      generationConfig.responseSchema = schema
    }
    return this.#getClient().getGenerativeModel({
      model: MODEL_NAME,
      ...(Object.keys(generationConfig).length ? { generationConfig } : {})
    })
  }

  async #generateWithRetry(model, prompt, content) {
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

  async analyzeContent(content, prompt, options = {}) {
    const model = this.#buildModel(options)
    logger.info(
      `Analyzing content with Gemini (${MODEL_NAME})${options.schema ? ' [structured]' : ''}…`
    )

    const result = await this.#generateWithRetry(model, prompt, content)
    const text = result.response.text()

    if (options.schema) return JSON.parse(text)

    try {
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/{[\s\S]*}/)
      if (jsonMatch) return JSON.parse(jsonMatch[1] || jsonMatch[0])
      return { text }
    } catch {
      logger.warn('Failed to parse JSON from Gemini response, returning raw text.')
      return { text }
    }
  }

  async healthCheck() {
    if (!process.env.GEMINI_API_KEY) {
      return { available: false, reason: 'GEMINI_API_KEY not set' }
    }
    return { available: true }
  }
}
