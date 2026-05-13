import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSupabase = {
  from: vi.fn()
}

vi.mock('../src/db/supabaseClient.js', () => ({
  supabase: mockSupabase
}))

const { resolveClosedId, upsertOpenId, loadClosedVocabulary } = await import('../src/db/lookups.js')

function chainable(result) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result)
  }
  return chain
}

beforeEach(() => {
  mockSupabase.from.mockReset()
})

describe('resolveClosedId', () => {
  it('returns the id when name matches (case-insensitive)', async () => {
    mockSupabase.from.mockReturnValue(chainable({ data: { id: 7 }, error: null }))
    const id = await resolveClosedId('classes', 'Skill')
    expect(id).toBe(7)
    expect(mockSupabase.from).toHaveBeenCalledWith('classes')
  })

  it('returns null when name not found', async () => {
    mockSupabase.from.mockReturnValue(chainable({ data: null, error: null }))
    const id = await resolveClosedId('classes', 'nonexistent')
    expect(id).toBeNull()
  })

  it('returns null when name is empty', async () => {
    const id = await resolveClosedId('classes', '')
    expect(id).toBeNull()
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })
})

describe('upsertOpenId', () => {
  it('upserts and returns the id', async () => {
    const chain = chainable({ data: { id: 42 }, error: null })
    mockSupabase.from.mockReturnValue(chain)
    const id = await upsertOpenId('tags', 'Python')
    expect(id).toBe(42)
    expect(chain.upsert).toHaveBeenCalledWith({ name: 'python' }, { onConflict: 'name' })
  })

  it('returns null when name is empty', async () => {
    const id = await upsertOpenId('tags', '   ')
    expect(id).toBeNull()
  })
})

describe('loadClosedVocabulary', () => {
  it('returns sorted name lists for classes, domains and activities', async () => {
    const callMap = new Map([
      ['classes', { data: [{ name: 'skill' }, { name: 'agent' }], error: null }],
      ['domains', { data: [{ name: 'backend' }, { name: 'data-ai' }], error: null }],
      [
        'activities',
        {
          data: [{ name: 'planning' }, { name: 'debugging' }, { name: 'code-review' }],
          error: null
        }
      ]
    ])
    mockSupabase.from.mockImplementation((table) => {
      const chain = {
        select: vi.fn().mockResolvedValue(callMap.get(table))
      }
      return chain
    })

    const vocab = await loadClosedVocabulary()
    expect(vocab.classes).toEqual(['agent', 'skill'])
    expect(vocab.domains).toEqual(['backend', 'data-ai'])
    expect(vocab.activities).toEqual(['code-review', 'debugging', 'planning'])
  })

  it('caps activities at 100 even when the DB has more', async () => {
    const big = Array.from({ length: 250 }, (_, i) => ({
      name: `activity-${String(i).padStart(3, '0')}`
    }))
    const callMap = new Map([
      ['classes', { data: [], error: null }],
      ['domains', { data: [], error: null }],
      ['activities', { data: big, error: null }]
    ])
    mockSupabase.from.mockImplementation((table) => ({
      select: vi.fn().mockResolvedValue(callMap.get(table))
    }))

    const vocab = await loadClosedVocabulary()
    expect(vocab.activities).toHaveLength(100)
    expect(vocab.activities[0]).toBe('activity-000')
  })
})
