import { describe, it, expect } from 'vitest'
import { filterRelevantFiles } from '../src/github/fetchFiles.js'

describe('filterRelevantFiles', () => {
  describe('keeps agentic artefacts', () => {
    it.each([
      'README.md',
      '.claude/skills/tdd-workflow/SKILL.md',
      'agents/code-reviewer.md',
      'src/agent/loop.ts',
      'scripts/install.sh',
      '.opencode/prompts/agents/architect.txt',
      '.claude/mcp.json',
      '.cursor/plugins/foo/plugin.json',
      'agents/bar/agent.json'
    ])('keeps %s', (p) => {
      expect(filterRelevantFiles([p])).toEqual([p])
    })
  })

  describe('rejects binaries (existing behaviour)', () => {
    it.each(['logo.png', 'screenshot.jpg', 'docs/handbook.pdf', 'font.woff2'])('drops %s', (p) => {
      expect(filterRelevantFiles([p])).toEqual([])
    })
  })

  describe('rejects noise directories (Layer A)', () => {
    it.each([
      'node_modules/react/index.js',
      'dist/bundle.js',
      'build/output.md',
      'coverage/lcov-report/index.html',
      '.next/server/pages.js',
      'vendor/lib/foo.py',
      'src/__pycache__/foo.pyc',
      'target/debug/build.log',
      'tests/__snapshots__/foo.snap'
    ])('drops %s', (p) => {
      expect(filterRelevantFiles([p])).toEqual([])
    })
  })

  describe('rejects test infrastructure (Layer A)', () => {
    it.each([
      'cli/src/__tests__/board-auth.test.ts',
      'cli/src/__tests__/helpers/embedded-postgres.ts',
      'tests/fileKind.test.js',
      'src/test/e2e/fixtures/workspace/README.md',
      'packages/foo/spec/parser-spec.rb',
      'e2e/cypress/integration/login.cy.ts',
      'cypress/fixtures/users.json',
      'playwright/tests/checkout.spec.ts',
      // SKILL.md as a test fixture is still a fixture, not a real skill
      'packages/opencode/test/fixture/skills/agents-sdk/SKILL.md'
    ])('drops %s', (p) => {
      expect(filterRelevantFiles([p])).toEqual([])
    })
  })

  describe('rejects test/spec filenames anywhere (Layer C)', () => {
    it.each([
      'src/foo.test.ts',
      'src/foo.spec.js',
      'src/foo.test.py',
      'src/foo.spec.rb',
      'src/component.test.tsx'
    ])('drops %s', (p) => {
      expect(filterRelevantFiles([p])).toEqual([])
    })
  })

  describe('rejects non-agentic by kind (Layer B)', () => {
    it.each([
      'tsconfig.json',
      'package.json',
      '.github/workflows/ci.yml',
      'docker-compose.yaml',
      'LICENSE',
      'CHANGELOG.md', // markdown but blocklisted by name (Layer C)
      'README.txt' // text-extension prose isn't a prompt artefact
    ])('drops %s', (p) => {
      expect(filterRelevantFiles([p])).toEqual([])
    })
  })

  describe('keeps agentic config when in allow-listed paths', () => {
    it.each([
      '.claude/mcp.json',
      '.cursor/manifest.json',
      'agents/foo/agent.json',
      'plugins/bar/marketplace.json'
    ])('keeps %s', (p) => {
      expect(filterRelevantFiles([p])).toEqual([p])
    })
  })

  describe('rejects path-name blocklist (Layer C)', () => {
    it.each([
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      'CHANGELOG.md',
      'CONTRIBUTING.md',
      'CODE_OF_CONDUCT.md',
      '.gitignore',
      '.eslintrc.json',
      '.prettierrc',
      'tailwind.config.ts',
      'vite.config.js',
      'app.min.js',
      'bundle.js.map',
      'tests/__snapshots__/foo.snap'
    ])('drops %s', (p) => {
      expect(filterRelevantFiles([p])).toEqual([])
    })
  })

  describe('rejects extension-less paths (except whitelist)', () => {
    it('drops .codex/skills/<name> without extension', () => {
      expect(filterRelevantFiles(['.codex/skills/tdd-guide'])).toEqual([])
    })

    it('drops random extension-less files', () => {
      expect(filterRelevantFiles(['some/path/foo'])).toEqual([])
    })

    it('drops Dockerfile / Makefile (rarely agentic)', () => {
      expect(filterRelevantFiles(['Dockerfile', 'Makefile'])).toEqual([])
    })
  })
})
