import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { importClaudeMemories, toKebabCase, type ImportedEntry } from '../../src/importers/claude.ts'

const FIXTURES = join(import.meta.dir, '..', 'fixtures', 'claude-memory')

async function importFixtures() {
  const result = await importClaudeMemories(FIXTURES)
  return { ...result, byName: new Map(result.entries.map((entry) => [entry.name, entry])) }
}

function expectEntry(byName: Map<string, ImportedEntry>, name: string): ImportedEntry {
  const entry = byName.get(name)
  if (!entry) throw new Error(`expected an entry named ${name}, got: ${[...byName.keys()].join(', ')}`)
  return entry
}

describe('importClaudeMemories', () => {
  test('skips the regenerated index file', async () => {
    const { byName } = await importFixtures()
    expect([...byName.keys()]).not.toContain('memory')
  })

  test('takes the id from the filename, not the frontmatter name', async () => {
    const { byName } = await importFixtures()
    // The file declares `name: local-dev-env`; the filename is what links point at.
    expect(expectEntry(byName, 'project-local-dev-env').type).toBe('project')
    expect(byName.has('local-dev-env')).toBe(false)
  })

  test('carries frontmatter description, type and date across', async () => {
    const entry = expectEntry((await importFixtures()).byName, 'feedback-short-answers')
    expect(entry.description).toBe('Keep answers short, detail only on request')
    expect(entry.type).toBe('feedback')
    expect(entry.updated).toBe('2026-08-30')
  })

  test('repoints a link written with the filename in its raw spelling', async () => {
    const { byName } = await importFixtures()
    expect(expectEntry(byName, 'feedback-short-answers').body).toContain('[[project-local-dev-env]]')
  })

  test('repoints a link written against a frontmatter name', async () => {
    const { byName, rewrittenLinks } = await importFixtures()
    expect(expectEntry(byName, 'reference-grep-hint').body).toContain('[[project-local-dev-env]]')
    expect(rewrittenLinks).toBe(2)
  })

  test('leaves a link that already names the file alone', async () => {
    const { byName } = await importFixtures()
    expect(expectEntry(byName, 'project-local-dev-env').body).toContain('[[feedback-short-answers]]')
  })

  test('recovers a file whose frontmatter is not valid YAML', async () => {
    const entry = expectEntry((await importFixtures()).byName, 'project-broken-yaml')
    expect(entry.description).toBe('Order matters here: pass the options last, never first')
    expect(entry.type).toBe('project')
  })

  test('recovers a file with no frontmatter at all, using its heading', async () => {
    const entry = expectEntry((await importFixtures()).byName, 'feedback-shared-cache')
    expect(entry.type).toBe('feedback')
    expect(entry.description).toBe('Prefer the shared cache')
    expect(entry.body.startsWith('- Never warm')).toBe(true)
  })

  test('falls back to the filename prefix when the type is missing', async () => {
    expect(expectEntry((await importFixtures()).byName, 'project-no-type').type).toBe('project')
  })

  test('reports a file it cannot make an entry out of, without failing the run', async () => {
    const { problems, entries } = await importFixtures()
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('reference_unusable.md')
    expect(entries.length).toBeGreaterThan(5)
  })
})

describe('toKebabCase', () => {
  test('transliterates rather than dropping accented letters', () => {
    expect(toKebabCase('feedback_prüfen_umlaute')).toBe('feedback-prufen-umlaute')
    expect(toKebabCase('größe_maß')).toBe('grosse-mass')
  })

  test('collapses separators and trims the edges', () => {
    expect(toKebabCase('  Some__Mixed Name  ')).toBe('some-mixed-name')
  })
})
