// src/analysis/providers/BaseProvider.js

/**
 * Marker base class for "the provider is out of quota — stop and resume later".
 * Concrete providers throw subclasses of this (e.g. GroqDailyQuotaError,
 * ClaudeCliQuotaError) so the pipeline can react uniformly via instanceof.
 */
export class ProviderQuotaError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ProviderQuotaError'
  }
}

/**
 * Abstract interface every LLM provider implements.
 * Concrete subclasses live in this folder and own everything they need
 * (invocation, parsing, retries, provider-specific errors).
 */
export class BaseProvider {
  /**
   * @param {string} content - File content to classify.
   * @param {string} prompt  - System prompt (already includes vocabulary).
   * @param {object} options
   * @param {object} [options.schema]      - JSON Schema describing expected output.
   * @param {number} [options.temperature] - Sampling temperature (0–1). May be ignored.
   * @returns {Promise<object>}
   */
  async analyzeContent(_content, _prompt, _options) {
    throw new Error(`${this.constructor.name}: analyzeContent not implemented`)
  }

  /**
   * Cheap probe — no LLM call. Tells the UI whether the provider is usable.
   * @returns {Promise<{available: boolean, reason?: string}>}
   */
  async healthCheck() {
    throw new Error(`${this.constructor.name}: healthCheck not implemented`)
  }

  get name() {
    return this.constructor.providerName
  }
}
