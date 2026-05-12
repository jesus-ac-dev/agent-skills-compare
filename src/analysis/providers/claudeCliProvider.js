// src/analysis/providers/claudeCliProvider.js — STUB, replaced in Task 7
import { BaseProvider } from './BaseProvider.js'

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
  // Real analyzeContent + healthCheck come in Task 7.
}
