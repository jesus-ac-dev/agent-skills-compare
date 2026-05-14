import { describe, it, expect } from 'vitest'
import { normaliseGithubUrl } from '../src/utils/githubUrl.js'

describe('normaliseGithubUrl', () => {
  it.each([
    ['https://github.com/anthropics/skills', 'https://github.com/anthropics/skills', 'skills'],
    ['https://github.com/anthropics/skills/', 'https://github.com/anthropics/skills', 'skills'],
    ['https://github.com/Kilo-Org/kilocode', 'https://github.com/kilo-org/kilocode', 'kilocode'],
    [
      '  https://github.com/Fission-AI/openspec  ',
      'https://github.com/fission-ai/openspec',
      'openspec'
    ]
  ])('%s → %s / %s', (input, expectedUrl, expectedName) => {
    const out = normaliseGithubUrl(input)
    expect(out).toEqual({ repo_url: expectedUrl, name: expectedName })
  })

  it.each([
    'github.com/owner/repo', // missing scheme
    'https://github.com/owner', // missing repo
    'https://gitlab.com/owner/repo', // wrong host
    'https://github.com/owner/repo/blob/main/x.md', // extra path
    'not a url',
    '',
    null,
    undefined,
    42
  ])('rejects %p', (input) => {
    expect(normaliseGithubUrl(input)).toBeNull()
  })
})
