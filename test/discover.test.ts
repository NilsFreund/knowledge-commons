import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverSources, resolveSlug } from '../src/core/index.ts'

function filesystem(paths: readonly string[]): (path: string) => boolean {
  const set = new Set(paths)
  return (path) => set.has(path)
}

describe('resolveSlug', () => {
  test('resolves a slug with no hyphens of its own', () => {
    const exists = filesystem(['/Users', '/Users/me', '/Users/me/dev', '/Users/me/dev/app'])
    expect(resolveSlug('-Users-me-dev-app', exists)).toBe('/Users/me/dev/app')
  })

  /** The slug for `dev/my-app` and for `dev/my/app` is identical; only the filesystem can tell them apart. */
  test('keeps a hyphen that belongs to the directory name', () => {
    const exists = filesystem(['/Users', '/Users/me', '/Users/me/dev', '/Users/me/dev/my-app'])
    expect(resolveSlug('-Users-me-dev-my-app', exists)).toBe('/Users/me/dev/my-app')
  })

  test('splits at the hyphen when the nested path is the one that exists', () => {
    const exists = filesystem(['/Users', '/Users/me', '/Users/me/dev', '/Users/me/dev/my', '/Users/me/dev/my/app'])
    expect(resolveSlug('-Users-me-dev-my-app', exists)).toBe('/Users/me/dev/my/app')
  })

  test('prefers the deeper reading when a prefix also exists but leads nowhere', () => {
    const exists = filesystem(['/Users', '/Users/me', '/Users/me/dev', '/Users/me/dev/my', '/Users/me/dev/my-app'])
    expect(resolveSlug('-Users-me-dev-my-app', exists)).toBe('/Users/me/dev/my-app')
  })

  test('gives up rather than guessing when the repository is gone', () => {
    expect(resolveSlug('-Users-me-dev-deleted', filesystem(['/Users', '/Users/me', '/Users/me/dev']))).toBeUndefined()
  })

  test('gives up on an empty slug', () => {
    expect(resolveSlug('-', filesystem([]))).toBeUndefined()
  })
})

describe('discoverSources', () => {
  let home: string

  async function seedClaudeMemory(slug: string, files: readonly string[]): Promise<void> {
    const dir = join(home, '.claude', 'projects', slug, 'memory')
    await mkdir(dir, { recursive: true })
    for (const file of files) await writeFile(join(dir, file), 'x', 'utf8')
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'kn-home-'))
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  test('finds nothing on a machine with no agents installed', async () => {
    expect(await discoverSources(home)).toEqual([])
  })

  test('counts entries and skips the regenerated index', async () => {
    await seedClaudeMemory('-tmp', ['a.md', 'b.md', 'MEMORY.md', 'notes.txt'])
    const [source] = await discoverSources(home)
    expect(source).toMatchObject({ agent: 'claude', items: 2 })
  })

  test('ignores a project directory that holds no entries', async () => {
    await seedClaudeMemory('-tmp', ['MEMORY.md'])
    expect(await discoverSources(home)).toEqual([])
  })

  test('reports a source without a scope when its repository no longer exists', async () => {
    await seedClaudeMemory('-tmp-gone-for-good-12345', ['a.md'])
    const [source] = await discoverSources(home)
    expect(source?.scope).toBeUndefined()
    expect(source?.repo).toBeUndefined()
  })

  test('finds the Codex memory file and leaves it unscoped, since it needs review', async () => {
    await mkdir(join(home, '.codex', 'memories'), { recursive: true })
    await writeFile(
      join(home, '.codex', 'memories', 'MEMORY.md'),
      '# Task Group: x\n\n## User preferences\n\n- a\n\n## Reusable knowledge\n\n- b\n',
      'utf8',
    )

    const [source] = await discoverSources(home)
    expect(source).toMatchObject({ agent: 'codex', items: 2 })
    expect(source?.scope).toBeUndefined()
  })

  test('ignores a Codex file with no sections worth lifting', async () => {
    await mkdir(join(home, '.codex', 'memories'), { recursive: true })
    await writeFile(join(home, '.codex', 'memories', 'MEMORY.md'), '# Notes\n\nprose only\n', 'utf8')
    expect(await discoverSources(home)).toEqual([])
  })
})
