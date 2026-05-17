// src/analysis/providers/codexCliProvider.js
import { spawn } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import logger from '../../utils/logger.js'
import { BaseProvider, QuotaError } from './BaseProvider.js'

const QUOTA_REGEX =
  /429|rate.?limit|usage.?limit|weekly.?limit|too many|hit your limit|limit reached|quota|insufficient.?quota|out of credits|billing/i
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

export class CodexCliError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CodexCliError'
  }
}

export class CodexCliQuotaError extends QuotaError {
  constructor(message) {
    super(message)
    this.name = 'CodexCliQuotaError'
  }
}

export class CodexCliProvider extends BaseProvider {
  static providerName = 'codex-cli'

  #warnedTemperature = false

  get modelName() {
    return process.env.CODEX_MODEL || CodexCliProvider.providerName
  }

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
      'Use only the content above. Do not inspect the repository, run commands, or edit files.',
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

  async #invokeCli(fullPrompt, schema) {
    const tempDir = await mkdtemp(join(tmpdir(), 'agent-skills-codex-'))
    const outputPath = join(tempDir, 'last-message.json')
    const schemaPath = join(tempDir, 'schema.json')

    try {
      if (schema) {
        await writeFile(schemaPath, JSON.stringify(schema), 'utf8')
      }

      const { code, stdout, stderr } = await new Promise((resolve, reject) => {
        const args = [
          '--ask-for-approval',
          'never',
          'exec',
          '--sandbox',
          'read-only',
          '--ephemeral',
          '--color',
          'never',
          '-C',
          process.cwd()
        ]

        if (process.env.CODEX_MODEL) {
          args.push('--model', process.env.CODEX_MODEL)
        }
        if (schema) {
          args.push('--output-schema', schemaPath)
        }
        args.push('--output-last-message', outputPath, '-')

        const child = spawn('codex', args, {
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
        child.on('error', (err) => {
          const reason = err.code === 'ENOENT' ? '`codex` CLI not found in PATH' : err.message
          reject(new CodexCliError(reason))
        })
        child.on('exit', (code) => {
          resolve({ code, stdout, stderr })
        })
        child.stdin.write(fullPrompt)
        child.stdin.end()
      })

      let outputText = ''
      try {
        outputText = (await readFile(outputPath, 'utf8')).trim()
      } catch {
        outputText = ''
      }

      if (code !== 0) {
        const msg = [outputText, stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
        if (QUOTA_REGEX.test(msg)) {
          throw new CodexCliQuotaError(`codex CLI quota: ${msg}`)
        }
        throw new CodexCliError(`codex CLI exited ${code}: ${msg}`)
      }

      return outputText || stdout.trim()
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  async analyzeContent(content, prompt, options = {}) {
    const { schema, temperature } = options
    if (typeof temperature === 'number' && !this.#warnedTemperature) {
      logger.warn('CodexCliProvider: `temperature` is ignored - Codex CLI does not expose it.')
      this.#warnedTemperature = true
    }

    let correction = null
    for (let attempt = 1; attempt <= 2; attempt++) {
      const fullPrompt = this.#buildPrompt(content, prompt, schema, correction)
      logger.info(`Analyzing content with Codex CLI (attempt ${attempt}/2)...`)

      const resultText = await this.#invokeCli(fullPrompt, schema)

      let obj
      try {
        obj = JSON.parse(resultText)
      } catch (err) {
        if (attempt === 2) {
          throw new CodexCliError(
            `Invalid JSON after retry: ${err.message}; raw=${resultText.slice(0, 200)}`
          )
        }
        correction = err.message
        continue
      }

      if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
        if (attempt === 2) throw new CodexCliError('Response is not an object')
        correction = 'response was not a JSON object'
        continue
      }

      const missing = REQUIRED_KEYS.filter((k) => !(k in obj))
      if (missing.length > 0) {
        if (attempt === 2) {
          throw new CodexCliError(`Response missing required keys: ${missing.join(', ')}`)
        }
        correction = `response missing keys: ${missing.join(', ')}`
        continue
      }

      return obj
    }
    // Unreachable
    throw new CodexCliError('analyzeContent loop exited unexpectedly')
  }

  async healthCheck() {
    return await new Promise((resolve) => {
      const child = spawn('codex', ['--version'], {
        cwd: process.cwd(),
        env: { ...process.env }
      })
      child.on('error', (err) => {
        const reason = err.code === 'ENOENT' ? '`codex` CLI not found in PATH' : err.message
        resolve({ available: false, reason })
      })
      child.on('exit', (code) => {
        if (code === 0) resolve({ available: true })
        else resolve({ available: false, reason: `codex --version exited ${code}` })
      })
    })
  }
}
