import { describe, it, expect } from 'vitest'
import { generateHash } from '../src/utils/hash.js'

describe('hash utility', () => {
  it('should generate consistent hashes for the same content', () => {
    const content = 'hello world'
    const hash1 = generateHash(content)
    const hash2 = generateHash(content)
    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(64) // SHA-256 hex length
  })

  it('should generate different hashes for different content', () => {
    const hash1 = generateHash('content 1')
    const hash2 = generateHash('content 2')
    expect(hash1).not.toBe(hash2)
  })
})
