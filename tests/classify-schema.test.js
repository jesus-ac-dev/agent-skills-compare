import { describe, it, expect, vi } from 'vitest'
import { buildClassifyResponseSchema } from '../src/analysis/classifyProject.js'

vi.mock('../src/analysis/providers/factory.js', () => ({
  getActiveProvider: vi.fn().mockResolvedValue({
    analyzeContent: vi.fn().mockResolvedValue({})
  })
}))

describe('buildClassifyResponseSchema', () => {
  it('produces a schema with closed enums for class and domains', () => {
    const schema = buildClassifyResponseSchema({
      classes: ['skill', 'agent'],
      domains: ['backend', 'data-ai']
    })
    expect(schema.type).toBe('object')
    expect(schema.required).toEqual(
      expect.arrayContaining([
        'summary',
        'maturity',
        'score',
        'class',
        'domains',
        'activities',
        'tags',
        'use_cases'
      ])
    )
    expect(schema.properties.class.enum).toEqual(['skill', 'agent'])
    expect(schema.properties.domains.items.enum).toEqual(['backend', 'data-ai'])
    expect(schema.properties.summary.minLength).toBeGreaterThanOrEqual(80)
    expect(schema.properties.maturity.enum).toEqual(['experimental', 'stable', 'abandoned'])
    expect(schema.properties.use_cases.items.required).toEqual(['title', 'description'])
  })
})
