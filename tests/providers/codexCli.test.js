// tests/providers/codexCli.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { writeFileSync } from 'fs'

const mockSpawn = vi.fn()

vi.mock('child_process', () => ({
  spawn: mockSpawn
}))

const { CodexCliProvider, CodexCliError, CodexCliQuotaError } =
  await import('../../src/analysis/providers/codexCliProvider.js')

function fakeChild({ stdout = '', stderr = '', exitCode = 0 } = {}) {
  const child = new EventEmitter()
  child.stdin = { write: vi.fn(), end: vi.fn() }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  setTimeout(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout))
    if (stderr) child.stderr.emit('data', Buffer.from(stderr))
    child.emit('exit', exitCode, null)
  }, 0)
  return child
}

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

describe('CodexCliProvider.analyzeContent', () => {
  it('parses JSON from the codex output-last-message file on happy path', async () => {
    mockSpawn.mockImplementationOnce((_cmd, args) => {
      const outputPath = args[args.indexOf('--output-last-message') + 1]
      writeFileSync(outputPath, JSON.stringify(sampleResult))
      return fakeChild()
    })
    const provider = new CodexCliProvider()
    const out = await provider.analyzeContent('content here', 'prompt', {
      schema: {},
      temperature: 0.4
    })
    expect(out).toEqual(sampleResult)
    expect(mockSpawn).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining([
        'exec',
        '--sandbox',
        'read-only',
        '--ask-for-approval',
        'never',
        '--ephemeral',
        '--output-schema',
        '--output-last-message',
        '-'
      ]),
      expect.any(Object)
    )
  })

  it('falls back to stdout when the output file is absent', async () => {
    mockSpawn.mockImplementationOnce(() => fakeChild({ stdout: JSON.stringify(sampleResult) }))
    const provider = new CodexCliProvider()
    const out = await provider.analyzeContent('content here', 'prompt', { schema: {} })
    expect(out).toEqual(sampleResult)
  })

  it('retries once when the response is missing required keys, then succeeds', async () => {
    mockSpawn
      .mockImplementationOnce(() => fakeChild({ stdout: JSON.stringify({ summary: 'too short' }) }))
      .mockImplementationOnce(() => fakeChild({ stdout: JSON.stringify(sampleResult) }))
    const provider = new CodexCliProvider()
    const out = await provider.analyzeContent('c', 'p', { schema: {} })
    expect(out).toEqual(sampleResult)
    expect(mockSpawn).toHaveBeenCalledTimes(2)
  })

  it('throws CodexCliError when both attempts fail to parse', async () => {
    mockSpawn
      .mockImplementationOnce(() => fakeChild({ stdout: 'not json' }))
      .mockImplementationOnce(() => fakeChild({ stdout: 'not json' }))
    const provider = new CodexCliProvider()
    await expect(provider.analyzeContent('c', 'p', { schema: {} })).rejects.toBeInstanceOf(
      CodexCliError
    )
  })

  it('throws CodexCliQuotaError on exit not zero with quota-shaped stderr', async () => {
    mockSpawn.mockImplementationOnce(() =>
      fakeChild({ stderr: '429 rate limit reached, try again later', exitCode: 1 })
    )
    const provider = new CodexCliProvider()
    await expect(provider.analyzeContent('c', 'p', { schema: {} })).rejects.toBeInstanceOf(
      CodexCliQuotaError
    )
  })
})

describe('CodexCliProvider.healthCheck', () => {
  it('returns available:true when `codex --version` exits 0', async () => {
    mockSpawn.mockReturnValueOnce(fakeChild({ stdout: 'codex-cli 0.130.0', exitCode: 0 }))
    const provider = new CodexCliProvider()
    const result = await provider.healthCheck()
    expect(result).toEqual({ available: true })
  })

  it('returns available:false with reason when `codex --version` exits non-zero', async () => {
    mockSpawn.mockReturnValueOnce(fakeChild({ stderr: 'something wrong', exitCode: 127 }))
    const provider = new CodexCliProvider()
    const result = await provider.healthCheck()
    expect(result.available).toBe(false)
    expect(result.reason).toMatch(/exited 127/)
  })

  it('returns available:false with reason when `codex` is missing', async () => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    setTimeout(
      () => child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })),
      0
    )
    mockSpawn.mockReturnValueOnce(child)
    const provider = new CodexCliProvider()
    const result = await provider.healthCheck()
    expect(result.available).toBe(false)
    expect(result.reason).toMatch(/not found|ENOENT/)
  })
})
