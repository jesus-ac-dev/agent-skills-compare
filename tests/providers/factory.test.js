// tests/providers/factory.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSupabase = { from: vi.fn() }

vi.mock('../../src/db/supabaseClient.js', () => ({
  supabase: mockSupabase
}))

// Mock provider modules so the factory does not try to construct real clients.
vi.mock('../../src/analysis/providers/groqProvider.js', () => ({
  GroqProvider: class {
    static providerName = 'groq'
  }
}))
vi.mock('../../src/analysis/providers/geminiProvider.js', () => ({
  GeminiProvider: class {
    static providerName = 'gemini'
  }
}))
vi.mock('../../src/analysis/providers/claudeCliProvider.js', () => ({
  ClaudeCliProvider: class {
    static providerName = 'claude-cli'
  }
}))

function chainableSelect(result) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result)
  }
}

beforeEach(() => {
  mockSupabase.from.mockReset()
  vi.resetModules()
})

describe('getActiveProvider', () => {
  it('returns the provider named in settings.llm_provider', async () => {
    mockSupabase.from.mockReturnValue(chainableSelect({ data: { value: 'gemini' }, error: null }))
    const { getActiveProvider } = await import('../../src/analysis/providers/factory.js')
    const provider = await getActiveProvider()
    expect(provider.constructor.providerName).toBe('gemini')
  })

  it('falls back to groq when the row is missing', async () => {
    mockSupabase.from.mockReturnValue(chainableSelect({ data: null, error: null }))
    const { getActiveProvider } = await import('../../src/analysis/providers/factory.js')
    const provider = await getActiveProvider()
    expect(provider.constructor.providerName).toBe('groq')
  })

  it('throws on an unknown provider name', async () => {
    mockSupabase.from.mockReturnValue(chainableSelect({ data: { value: 'mystery' }, error: null }))
    const { getActiveProvider } = await import('../../src/analysis/providers/factory.js')
    await expect(getActiveProvider()).rejects.toThrow(/Unknown provider: mystery/)
  })

  it('caches the resolved instance across calls', async () => {
    mockSupabase.from.mockReturnValue(chainableSelect({ data: { value: 'groq' }, error: null }))
    const { getActiveProvider } = await import('../../src/analysis/providers/factory.js')
    const a = await getActiveProvider()
    const b = await getActiveProvider()
    expect(a).toBe(b)
    expect(mockSupabase.from).toHaveBeenCalledTimes(1)
  })
})

describe('listProviders', () => {
  it('returns all registered provider names', async () => {
    const { listProviders } = await import('../../src/analysis/providers/factory.js')
    expect(listProviders().sort()).toEqual(['claude-cli', 'gemini', 'groq'])
  })
})
