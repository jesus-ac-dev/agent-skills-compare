// tests/providers/claudeCli.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

const mockSpawn = vi.fn()

vi.mock('child_process', () => ({
  spawn: mockSpawn
}))

const { ClaudeCliProvider, ClaudeCliError, ClaudeCliQuotaError } =
  await import('../../src/analysis/providers/claudeCliProvider.js')

function fakeChild({ stdout = '', stderr = '', exitCode = 0 } = {}) {
  const child = new EventEmitter()
  child.stdin = { write: vi.fn(), end: vi.fn() }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  // Use setTimeout(fn, 0) so events fire in the macrotask queue, after the
  // implementation has a chance to call spawn() and register listeners.
  // queueMicrotask fires too early for chained mockReturnValueOnce children
  // because both fakeChild() calls run at setup time and both microtasks drain
  // before the second spawn() is ever invoked.
  setTimeout(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout))
    if (stderr) child.stderr.emit('data', Buffer.from(stderr))
    child.emit('exit', exitCode, null)
  }, 0)
  return child
}

const validEnvelope = (resultObj) =>
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    result: JSON.stringify(resultObj),
    session_id: 'abc',
    duration_ms: 123
  })

const sampleResult = {
  summary: 'sample summary at least eighty chars long, mentioning concrete behaviour of the file',
  maturity: 'stable',
  score: 7,
  class: 'skill',
  domains: ['backend'],
  activities: ['debugging'],
  tags: ['python'],
  use_cases: [{ title: 'x', description: 'y' }]
}

beforeEach(() => {
  mockSpawn.mockReset()
})

describe('ClaudeCliProvider.analyzeContent', () => {
  it('parses two-level JSON on happy path', async () => {
    mockSpawn.mockReturnValueOnce(fakeChild({ stdout: validEnvelope(sampleResult) }))
    const provider = new ClaudeCliProvider()
    const out = await provider.analyzeContent('content here', 'prompt', {
      schema: {},
      temperature: 0.4
    })
    expect(out).toEqual(sampleResult)
    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      ['--print', '--output-format', 'json'],
      expect.any(Object)
    )
  })

  it('retries once when the response is missing required keys, then succeeds', async () => {
    const incompleteResult = JSON.stringify({ summary: 'too short' })
    const envelopeMissingKeys = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: incompleteResult
    })
    mockSpawn
      .mockReturnValueOnce(fakeChild({ stdout: envelopeMissingKeys }))
      .mockReturnValueOnce(fakeChild({ stdout: validEnvelope(sampleResult) }))
    const provider = new ClaudeCliProvider()
    const out = await provider.analyzeContent('c', 'p', { schema: {} })
    expect(out).toEqual(sampleResult)
    expect(mockSpawn).toHaveBeenCalledTimes(2)
  })

  it('retries once when the inner JSON fails to parse, then succeeds', async () => {
    const badEnvelope = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'not json'
    })
    mockSpawn
      .mockReturnValueOnce(fakeChild({ stdout: badEnvelope }))
      .mockReturnValueOnce(fakeChild({ stdout: validEnvelope(sampleResult) }))
    const provider = new ClaudeCliProvider()
    const out = await provider.analyzeContent('c', 'p', { schema: {} })
    expect(out).toEqual(sampleResult)
    expect(mockSpawn).toHaveBeenCalledTimes(2)
  })

  it('throws ClaudeCliError when both attempts fail to parse', async () => {
    const badEnvelope = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'not json'
    })
    mockSpawn
      .mockReturnValueOnce(fakeChild({ stdout: badEnvelope }))
      .mockReturnValueOnce(fakeChild({ stdout: badEnvelope }))
    const provider = new ClaudeCliProvider()
    await expect(provider.analyzeContent('c', 'p', { schema: {} })).rejects.toBeInstanceOf(
      ClaudeCliError
    )
  })

  it('throws ClaudeCliQuotaError on exit≠0 with quota-shaped stderr', async () => {
    mockSpawn.mockReturnValueOnce(
      fakeChild({ stderr: 'usage limit reached, try again later', exitCode: 1 })
    )
    const provider = new ClaudeCliProvider()
    await expect(provider.analyzeContent('c', 'p', { schema: {} })).rejects.toBeInstanceOf(
      ClaudeCliQuotaError
    )
  })

  it('throws ClaudeCliQuotaError when envelope subtype is error with quota-shaped message', async () => {
    const errorEnvelope = JSON.stringify({
      type: 'result',
      subtype: 'error',
      result: 'weekly limit exceeded for this account'
    })
    mockSpawn.mockReturnValueOnce(fakeChild({ stdout: errorEnvelope }))
    const provider = new ClaudeCliProvider()
    await expect(provider.analyzeContent('c', 'p', { schema: {} })).rejects.toBeInstanceOf(
      ClaudeCliQuotaError
    )
  })
})

describe('ClaudeCliProvider.healthCheck', () => {
  it('returns available:true when `claude --version` exits 0', async () => {
    mockSpawn.mockReturnValueOnce(fakeChild({ stdout: 'claude 1.2.3', exitCode: 0 }))
    const provider = new ClaudeCliProvider()
    const result = await provider.healthCheck()
    expect(result).toEqual({ available: true })
  })

  it('returns available:false with reason when `claude --version` exits non-zero', async () => {
    mockSpawn.mockReturnValueOnce(fakeChild({ stderr: 'something wrong', exitCode: 127 }))
    const provider = new ClaudeCliProvider()
    const result = await provider.healthCheck()
    expect(result.available).toBe(false)
    expect(result.reason).toMatch(/exited 127/)
  })

  it('returns available:false with reason when `claude` is missing', async () => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    setTimeout(
      () => child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })),
      0
    )
    mockSpawn.mockReturnValueOnce(child)
    const provider = new ClaudeCliProvider()
    const result = await provider.healthCheck()
    expect(result.available).toBe(false)
    expect(result.reason).toMatch(/not found|ENOENT/)
  })
})
