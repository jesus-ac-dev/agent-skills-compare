import { describe, it, expect } from 'vitest'
import { detectFileKind, detectFileTypeName } from '../src/utils/fileKind.js'

describe('detectFileTypeName', () => {
  it.each([
    ['README.md', 'markdown'],
    ['docs/intro.mdx', 'markdown'],
    ['src/index.js', 'javascript'],
    ['src/index.mjs', 'javascript'],
    ['src/legacy.cjs', 'javascript'],
    ['src/index.ts', 'typescript'],
    ['app/page.tsx', 'typescript'],
    ['scripts/build.py', 'python'],
    ['scripts/install.sh', 'shell'],
    ['scripts/profile.zsh', 'shell'],
    ['package.json', 'json'],
    ['.github/workflows/ci.yml', 'yaml'],
    ['public/index.html', 'html'],
    ['LICENSE', 'text'],
    ['Dockerfile', 'text'],
    ['weird.bin', 'text']
  ])('%s → %s', (path, expected) => {
    expect(detectFileTypeName(path)).toBe(expected)
  })

  it('is case-insensitive', () => {
    expect(detectFileTypeName('README.MD')).toBe('markdown')
    expect(detectFileTypeName('src/Foo.TS')).toBe('typescript')
  })

  it('handles undefined / empty path', () => {
    expect(detectFileTypeName(undefined)).toBe('text')
    expect(detectFileTypeName('')).toBe('text')
  })
})

describe('detectFileKind', () => {
  it.each([
    ['README.md', 'markdown'],
    ['src/index.ts', 'code'],
    ['package.json', 'config'],
    ['.github/ci.yml', 'config'],
    ['LICENSE', 'text']
  ])('%s → %s', (path, expected) => {
    expect(detectFileKind(path)).toBe(expected)
  })
})
