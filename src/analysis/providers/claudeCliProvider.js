// src/analysis/providers/claudeCliProvider.js
import { spawn } from 'child_process'
import logger from '../../utils/logger.js'
import { BaseProvider } from './BaseProvider.js'

const QUOTA_REGEX = /rate.?limit|usage.?limit|weekly.?limit|too many/i
const REQUIRED_KEYS = [
  'summary',
  'maturity',
  'score',
  'class',
  'domains',
  'activities',
  'tags',
  'use_cases'
]

export class ClaudeCliError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ClaudeCliError'
  }
}

export class ClaudeCliQuotaError extends ClaudeCliError {
  constructor(message) {
    super(message)
    this.name = 'ClaudeCliQuotaError'
  }
}

export class ClaudeCliProvider extends BaseProvider {
  static providerName = 'claude-cli'

  #warnedTemperature = false

  #buildPrompt(content, prompt, schema, correction) {
    const parts = [
      prompt,
      '',
      'Schema to match (JSON Schema):',
      JSON.stringify(schema),
      '',
      'Content to classify:',
      content,
      '',
      'Respond with ONLY the raw JSON object matching the schema. No prose, no markdown fences.'
    ]
    if (correction) {
      parts.push('')
      parts.push(
        `Your previous response was not valid JSON. Error: ${correction}. Return ONLY the JSON object.`
      )
    }
    return parts.join('\n')
  }

  async #invokeCli(fullPrompt) {
    return await new Promise((resolve, reject) => {
      const child = spawn('claude', ['--print', '--output-format', 'json'], {
        cwd: process.cwd(),
        env: { ...process.env }
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })
      child.on('error', (err) => reject(err))
      child.on('exit', (code) => {
        if (code !== 0) {
          if (QUOTA_REGEX.test(stderr)) {
            return reject(new ClaudeCliQuotaError(`claude CLI quota: ${stderr.trim()}`))
          }
          return reject(
            new ClaudeCliError(`claude CLI exited ${code}: ${stderr.trim() || stdout.trim()}`)
          )
        }
        resolve(stdout)
      })
      child.stdin.write(fullPrompt)
      child.stdin.end()
    })
  }

  async analyzeContent(content, prompt, options = {}) {
    const { schema, temperature } = options
    if (typeof temperature === 'number' && !this.#warnedTemperature) {
      logger.warn('ClaudeCliProvider: `temperature` is ignored — Claude CLI does not expose it.')
      this.#warnedTemperature = true
    }

    let correction = null
    for (let attempt = 1; attempt <= 2; attempt++) {
      const fullPrompt = this.#buildPrompt(content, prompt, schema, correction)
      logger.info(`Analyzing content with Claude CLI (attempt ${attempt}/2)…`)

      const stdout = await this.#invokeCli(fullPrompt)

      let envelope
      try {
        envelope = JSON.parse(stdout)
      } catch (err) {
        throw new ClaudeCliError(
          `Could not parse CLI envelope JSON: ${err.message}; raw=${stdout.slice(0, 200)}`
        )
      }

      if (envelope.subtype === 'error') {
        if (QUOTA_REGEX.test(envelope.result ?? '')) {
          throw new ClaudeCliQuotaError(`claude CLI quota: ${envelope.result}`)
        }
        throw new ClaudeCliError(`claude CLI returned error envelope: ${envelope.result}`)
      }

      const resultText = envelope.result ?? ''
      let obj
      try {
        obj = JSON.parse(resultText)
      } catch (err) {
        if (attempt === 2) {
          throw new ClaudeCliError(
            `Invalid JSON after retry: ${err.message}; raw=${resultText.slice(0, 200)}`
          )
        }
        correction = err.message
        continue
      }

      if (typeof obj !== 'object' || obj === null) {
        if (attempt === 2) throw new ClaudeCliError('Response is not an object')
        correction = 'response was not a JSON object'
        continue
      }

      const missing = REQUIRED_KEYS.filter((k) => !(k in obj))
      if (missing.length > 0) {
        if (attempt === 2) {
          throw new ClaudeCliError(`Response missing required keys: ${missing.join(', ')}`)
        }
        correction = `response missing keys: ${missing.join(', ')}`
        continue
      }

      return obj
    }
    // Unreachable
    throw new ClaudeCliError('analyzeContent loop exited unexpectedly')
  }

  async healthCheck() {
    return await new Promise((resolve) => {
      const child = spawn('claude', ['--version'], {
        cwd: process.cwd(),
        env: { ...process.env }
      })
      child.on('error', (err) => {
        const reason = err.code === 'ENOENT' ? '`claude` CLI not found in PATH' : err.message
        resolve({ available: false, reason })
      })
      child.on('exit', (code) => {
        if (code === 0) resolve({ available: true })
        else resolve({ available: false, reason: `claude --version exited ${code}` })
      })
    })
  }
}
