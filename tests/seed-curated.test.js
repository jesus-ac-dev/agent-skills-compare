import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSupabase = { from: vi.fn() }
const mockReadFile = vi.fn()
const mockLoggerWarn = vi.fn()
const mockLoggerInfo = vi.fn()

vi.mock('../src/db/supabaseClient.js', () => ({ supabase: mockSupabase }))
vi.mock('node:fs/promises', () => ({ readFile: mockReadFile }))
vi.mock('../src/utils/logger.js', () => ({
  default: { warn: mockLoggerWarn, info: mockLoggerInfo, error: vi.fn() }
}))

const { seedCuratedRepos } = await import('../src/seed/curatedRepos.js')

function upsertChain(result = { data: [], error: null }) {
  const chain = {
    upsert: vi.fn().mockReturnThis(),
    select: vi.fn().mockResolvedValue(result)
  }
  return chain
}

beforeEach(() => {
  mockSupabase.from.mockReset()
  mockReadFile.mockReset()
  mockLoggerWarn.mockReset()
  mockLoggerInfo.mockReset()
})

describe('seedCuratedRepos', () => {
  it('warns and returns zero when the file is missing', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockReadFile.mockRejectedValue(err)

    const result = await seedCuratedRepos()

    expect(result).toEqual({ inserted: 0, skipped: 0, invalid: 0 })
    expect(mockLoggerWarn).toHaveBeenCalledWith(expect.stringMatching(/curated-repos\.json/i))
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  it('throws when the JSON is malformed', async () => {
    mockReadFile.mockResolvedValue('not json {')

    await expect(seedCuratedRepos()).rejects.toThrow(/json|parse/i)
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  it('returns zero and does not call supabase when the list is empty', async () => {
    mockReadFile.mockResolvedValue('[]')

    const result = await seedCuratedRepos()

    expect(result).toEqual({ inserted: 0, skipped: 0, invalid: 0 })
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  it('skips entries missing a url field or with invalid github URLs', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { reason: 'no url here' },
        { url: 'https://gitlab.com/owner/repo' },
        { url: 'not-a-url' },
        { url: 'https://github.com/anthropics/skills' }
      ])
    )
    const chain = upsertChain({
      data: [{ repo_url: 'https://github.com/anthropics/skills' }],
      error: null
    })
    mockSupabase.from.mockReturnValue(chain)

    const result = await seedCuratedRepos()

    expect(result.invalid).toBe(3)
    expect(result.inserted).toBe(1)
    expect(chain.upsert).toHaveBeenCalledWith(
      [{ repo_url: 'https://github.com/anthropics/skills', name: 'skills', status: 'pending' }],
      { onConflict: 'repo_url', ignoreDuplicates: true }
    )
  })

  it('calls upsert with ignoreDuplicates and tracks inserted vs skipped', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { url: 'https://github.com/a/b' },
        { url: 'https://github.com/c/d' },
        { url: 'https://github.com/e/f' }
      ])
    )
    const chain = upsertChain({
      data: [{ repo_url: 'https://github.com/a/b' }, { repo_url: 'https://github.com/c/d' }],
      error: null
    })
    mockSupabase.from.mockReturnValue(chain)

    const result = await seedCuratedRepos()

    expect(result).toEqual({ inserted: 2, skipped: 1, invalid: 0 })
    expect(mockSupabase.from).toHaveBeenCalledWith('repos')
    expect(chain.upsert).toHaveBeenCalledTimes(1)
    expect(chain.upsert.mock.calls[0][1]).toEqual({
      onConflict: 'repo_url',
      ignoreDuplicates: true
    })
  })

  it('normalises owner to lowercase and strips trailing slash', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { url: 'https://github.com/Kilo-Org/kilocode/' },
        { url: 'https://github.com/Fission-AI/openspec' }
      ])
    )
    const chain = upsertChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    await seedCuratedRepos()

    const rows = chain.upsert.mock.calls[0][0]
    expect(rows).toEqual([
      { repo_url: 'https://github.com/kilo-org/kilocode', name: 'kilocode', status: 'pending' },
      { repo_url: 'https://github.com/fission-ai/openspec', name: 'openspec', status: 'pending' }
    ])
  })
})
