import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configSchema, initStore, loadConfig, saveConfig, Store, type StoreConfig, type Result, type WriteInput } from '../src/core/index.ts'
import { COMMIT_MESSAGES, NEVER_COMMIT, NEVER_COMMIT_REWORDED } from './fixtures.ts'

const TODAY = '2026-09-21'

let root: string
let store: Store

async function open(): Promise<Store> {
  const result = await Store.open(root, { today: () => TODAY })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function entry(input: Partial<WriteInput> & Pick<WriteInput, 'name' | 'description' | 'body'>): WriteInput {
  return { type: 'feedback', scope: 'global', ...input }
}

function unwrapConfig(result: Result<StoreConfig>): StoreConfig {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

async function write(input: WriteInput) {
  const result = await store.write(input)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kn-test-'))
  await initStore(root)
  store = await open()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('initStore', () => {
  test('creates a usable store and seeds the prompts', async () => {
    expect(await store.listScopes()).toEqual(['global'])
    expect(await store.listPrompts()).toEqual(['polish', 'read-research', 'write-knowledge', 'write-research'])
    expect((await store.readPrompt('polish')).ok).toBe(true)
  })

  test('is safe to re-run and does not overwrite an edited prompt', async () => {
    await writeFile(join(root, 'commands', 'polish.md'), 'edited', 'utf8')
    const again = await initStore(root)
    expect(again.ok && again.value.created).toEqual([])

    const prompt = await store.readPrompt('polish')
    expect(prompt.ok && prompt.value).toBe('edited')
  })
})

describe('Store.open', () => {
  test('refuses a directory that is not a store', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'kn-empty-'))
    const result = await Store.open(empty)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('store_not_found')
    await rm(empty, { recursive: true, force: true })
  })
})

describe('write', () => {
  test('creates immediately when nothing similar exists', async () => {
    const outcome = await write(entry(NEVER_COMMIT))
    expect(outcome.status).toBe('created')
    if (outcome.status !== 'created') return
    expect(outcome.entry.created).toBe(TODAY)
    expect(outcome.entry.updated).toBe(TODAY)
    expect(outcome.entry.path).toBe(join(root, 'knowledge', 'global', 'feedback-never-commit.md'))
  })

  test('reports candidates and writes nothing when a reworded duplicate exists', async () => {
    await write(entry(NEVER_COMMIT))
    const outcome = await write(entry(NEVER_COMMIT_REWORDED))

    expect(outcome.status).toBe('candidates')
    if (outcome.status !== 'candidates') return
    expect(outcome.candidates.map((candidate) => candidate.id)).toEqual(['global/feedback-never-commit'])
    expect((await store.load()).entries).toHaveLength(1)
  })

  test('does not stop a genuinely different entry that shares vocabulary', async () => {
    await write(entry(NEVER_COMMIT))
    expect((await write(entry(COMMIT_MESSAGES))).status).toBe('created')
  })

  test('writes anyway once the agent confirms', async () => {
    await write(entry(NEVER_COMMIT))
    const outcome = await write(entry({ ...NEVER_COMMIT_REWORDED, confirm: true }))
    expect(outcome.status).toBe('created')
    expect((await store.load()).entries).toHaveLength(2)
  })

  test('merges into an existing entry, preserving its creation date and sources', async () => {
    const earlier = await Store.open(root, { today: () => '2026-01-05' })
    if (!earlier.ok) throw new Error(earlier.error.message)
    await earlier.value.write(entry({ ...NEVER_COMMIT, sources: ['claude:shop'] }))

    const outcome = await write(
      entry({
        ...NEVER_COMMIT_REWORDED,
        sources: ['codex:memory'],
        updateName: 'feedback-never-commit',
      }),
    )

    expect(outcome.status).toBe('updated')
    if (outcome.status !== 'updated') return
    expect(outcome.entry.name).toBe('feedback-never-commit')
    expect(outcome.entry.description).toBe(NEVER_COMMIT_REWORDED.description)
    expect(outcome.entry.created).toBe('2026-01-05')
    expect(outcome.entry.updated).toBe(TODAY)
    expect(outcome.entry.sources).toEqual(['claude:shop', 'codex:memory'])
    expect((await store.load()).entries).toHaveLength(1)
  })

  test('moves the file when a merge changes the scope', async () => {
    await write(entry(NEVER_COMMIT))
    const outcome = await write(entry({ ...NEVER_COMMIT, scope: 'shop', updateName: 'feedback-never-commit' }))

    expect(outcome.status).toBe('updated')
    const { entries } = await store.load()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.scope).toBe('shop')
  })

  test('rejects a name that is already taken', async () => {
    await write(entry(NEVER_COMMIT))
    const result = await store.write(entry({ ...NEVER_COMMIT, description: 'Something else entirely', body: 'Different.' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('entry_exists')
  })

  test('rejects a merge into an entry that does not exist', async () => {
    const result = await store.write(entry({ ...NEVER_COMMIT, updateName: 'nope' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('entry_not_found')
  })

  test('does not let two overlapping writes of the same name both create it', async () => {
    const [first, second] = await Promise.all([
      store.write(entry({ ...NEVER_COMMIT, confirm: true })),
      store.write(entry({ ...NEVER_COMMIT, confirm: true })),
    ])

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1)
    expect((await store.load()).entries).toHaveLength(1)
  })

  test('rejects invalid input before touching the disk', async () => {
    const result = await store.write(entry({ ...NEVER_COMMIT, name: 'Not Kebab' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid_entry')
    expect((await store.load()).entries).toHaveLength(0)
  })
})

describe('read and search', () => {
  beforeEach(async () => {
    await write(entry(NEVER_COMMIT))
    await write(entry({ ...COMMIT_MESSAGES, scope: 'shop', type: 'reference' }))
  })

  test('returns entries in the order asked for', async () => {
    const result = await store.read(['feedback-commit-messages', 'feedback-never-commit'])
    expect(result.ok && result.value.map((found) => found.name)).toEqual(['feedback-commit-messages', 'feedback-never-commit'])
  })

  test('accepts the scope/name an index prints, not only the bare name', async () => {
    const result = await store.read(['global/feedback-never-commit', 'shop/feedback-commit-messages'])
    expect(result.ok && result.value.map((found) => found.name)).toEqual(['feedback-never-commit', 'feedback-commit-messages'])
  })

  test('names every unknown entry instead of silently dropping it', async () => {
    const result = await store.read(['feedback-never-commit', 'nope', 'also-nope'])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.detail).toEqual(['nope', 'also-nope'])
  })

  test('ranks by term coverage across name, description and body', async () => {
    const hits = await store.search('conventional commits subject line')
    expect(hits[0]?.entry.name).toBe('feedback-commit-messages')
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 0)
  })

  test('drops hits that rest on a single term appearing somewhere', async () => {
    const hits = await store.search('conventional commits subject line with several unrelated words here')
    expect(hits.map((hit) => hit.entry.name)).toEqual(['feedback-commit-messages'])
  })

  test('can be limited to a set of scopes', async () => {
    const hits = await store.search('commit', { scopes: ['global'] })
    expect(hits.map((hit) => hit.entry.scope)).toEqual(['global'])
  })
})

describe('context', () => {
  beforeEach(async () => {
    await saveConfig(root, configSchema.parse({ scopes: { '/repos/shop': { scope: 'shop', inherits: ['global'] } } }))
    store = await open()
    await write(entry(NEVER_COMMIT))
    await write(entry({ ...COMMIT_MESSAGES, scope: 'shop', type: 'reference' }))
    await write(entry({ name: 'project-website', description: 'Unrelated repository', body: 'Nothing to see.', scope: 'website', type: 'project' }))
  })

  test('indexes the resolved scopes and nothing else', async () => {
    const result = await store.context({ cwd: '/repos/shop/src' })
    expect(result.scopes).toEqual(['shop', 'global'])
    expect(result.index.map((row) => row.id)).toEqual(['shop/feedback-commit-messages', 'global/feedback-never-commit'])
  })

  test('inlines feedback bodies because they always apply', async () => {
    const result = await store.context({ cwd: '/repos/shop/src' })
    expect(result.included.map((found) => found.name)).toEqual(['feedback-never-commit'])
  })

  test('inlines other types only when the query reaches them', async () => {
    const result = await store.context({ cwd: '/repos/shop/src', query: 'conventional commits subject line' })
    expect(result.included.map((found) => found.name).sort()).toEqual(['feedback-commit-messages', 'feedback-never-commit'])
  })

  test('falls back to the global scope outside any configured repository', async () => {
    const result = await store.context({ cwd: '/somewhere/else' })
    expect(result.scopes).toEqual(['global'])
    expect(result.index.map((row) => row.id)).toEqual(['global/feedback-never-commit'])
  })
})

describe('doctor', () => {
  test('is quiet on a healthy store', async () => {
    await write(entry(NEVER_COMMIT))
    expect(await store.doctor()).toEqual([])
  })

  test('reports a broken wikilink', async () => {
    await write(entry({ ...NEVER_COMMIT, body: `${NEVER_COMMIT.body} See [[does-not-exist]].` }))
    const diagnostics = await store.doctor()
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ level: 'warning' })
    expect(diagnostics[0]?.message).toContain('[[does-not-exist]]')
  })

  test('reports the same name living in two scopes, which wikilinks cannot address', async () => {
    await write(entry(NEVER_COMMIT))
    await Bun.write(join(root, 'knowledge', 'shop', 'feedback-never-commit.md'), await Bun.file(join(root, 'knowledge', 'global', 'feedback-never-commit.md')).text())
    const diagnostics = await store.doctor()
    expect(diagnostics.some((diagnostic) => diagnostic.level === 'error' && diagnostic.message.includes('2 scopes'))).toBe(true)
  })

  test('reports a file whose name disagrees with its frontmatter', async () => {
    await write(entry(NEVER_COMMIT))
    await Bun.write(join(root, 'knowledge', 'global', 'renamed.md'), await Bun.file(join(root, 'knowledge', 'global', 'feedback-never-commit.md')).text())
    const diagnostics = await store.doctor()
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('filename does not match'))).toBe(true)
  })

  test('accepts a link into research, which is a real target', async () => {
    await write(entry({ ...NEVER_COMMIT, body: `${NEVER_COMMIT.body} See [[pool-behaviour-on-restart]].` }))
    expect(await store.doctor(['pool-behaviour-on-restart'])).toEqual([])
  })

  test('still reports that link when no such research exists', async () => {
    await write(entry({ ...NEVER_COMMIT, body: `${NEVER_COMMIT.body} See [[pool-behaviour-on-restart]].` }))
    expect(await store.doctor()).toHaveLength(1)
  })

  test('reports a link that could never name an entry', async () => {
    await write(entry({ ...NEVER_COMMIT, body: `${NEVER_COMMIT.body} See [[feedback_...]].` }))
    const diagnostics = await store.doctor()
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('is not a valid entry name'))).toBe(true)
  })

  test('reports near-duplicates that were confirmed past the threshold', async () => {
    await write(entry(NEVER_COMMIT))
    await write(entry({ ...NEVER_COMMIT_REWORDED, confirm: true }))
    const diagnostics = await store.doctor()
    expect(diagnostics.some((diagnostic) => diagnostic.message.startsWith('possible duplicate'))).toBe(true)
  })

  test('stays quiet about a pair that was looked at and dismissed', async () => {
    await write(entry(NEVER_COMMIT))
    await write(entry({ ...NEVER_COMMIT_REWORDED, confirm: true }))
    await saveConfig(root, configSchema.parse({ dismissedDuplicates: [[NEVER_COMMIT_REWORDED.name, NEVER_COMMIT.name]] }))
    store = await open()

    expect(await store.doctor()).toEqual([])
  })

  test('reports a dismissal whose entries are gone, so the list does not rot', async () => {
    await saveConfig(root, configSchema.parse({ dismissedDuplicates: [['gone-a', 'gone-b']] }))
    store = await open()

    const diagnostics = await store.doctor()
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toContain('stale dismissal')
  })
})

describe('repository instructions', () => {
  beforeEach(async () => {
    await saveConfig(root, configSchema.parse({ scopes: { [root]: { scope: 'shop', inherits: ['global'] } } }))
    store = await open()
  })

  test('names an AGENTS.md sitting in the repository root', async () => {
    await writeFile(join(root, 'AGENTS.md'), '# rules', 'utf8')
    expect((await store.context({ cwd: root })).instructionFiles).toEqual(['AGENTS.md'])
  })

  test('finds the file from a subdirectory of the repository', async () => {
    await writeFile(join(root, 'CLAUDE.md'), '# rules', 'utf8')
    await mkdir(join(root, 'src', 'deep'), { recursive: true })
    expect((await store.context({ cwd: join(root, 'src', 'deep') })).instructionFiles).toEqual(['CLAUDE.md'])
  })

  test('reports a rules directory only when it holds something', async () => {
    await mkdir(join(root, '.cursor', 'rules'), { recursive: true })
    expect((await store.context({ cwd: root })).instructionFiles).toEqual([])

    await writeFile(join(root, '.cursor', 'rules', 'style.mdc'), 'x', 'utf8')
    expect((await store.context({ cwd: root })).instructionFiles).toEqual(['.cursor/rules/'])
  })

  test('looks nowhere when the directory maps to no repository', async () => {
    const result = await store.context({ cwd: '/tmp' })
    expect(result.repoRoot).toBeUndefined()
    expect(result.instructionFiles).toEqual([])
  })
})

describe('remove', () => {
  beforeEach(async () => {
    await write(entry(NEVER_COMMIT))
    await write(entry({ ...COMMIT_MESSAGES, body: `${COMMIT_MESSAGES.body} See [[feedback-never-commit]].` }))
  })

  test('refuses while another entry still links to it, and names the source', async () => {
    const result = await store.remove('feedback-never-commit')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('entry_in_use')
      expect(result.error.detail).toContain('feedback-commit-messages')
    }
    expect((await store.load()).entries).toHaveLength(2)
  })

  test('removes it on force and says what now dangles', async () => {
    const result = await store.remove('feedback-never-commit', { force: true })
    expect(result.ok && result.value.inboundLinks).toEqual(['feedback-commit-messages'])
    expect((await store.load()).entries).toHaveLength(1)
  })

  test('removes an unlinked entry without ceremony', async () => {
    expect((await store.remove('feedback-commit-messages')).ok).toBe(true)
    expect((await store.load()).entries).toHaveLength(1)
  })

  test('does not let an entry block its own removal by linking to itself', async () => {
    await write(entry({ name: 'self-linked', description: 'Points at itself', body: 'See [[self-linked]].', confirm: true }))
    expect((await store.remove('self-linked')).ok).toBe(true)
  })

  test('drops a dismissal that named it, instead of leaving the list rotting', async () => {
    await saveConfig(root, configSchema.parse({ dismissedDuplicates: [['feedback-never-commit', 'feedback-commit-messages']] }))
    store = await open()

    await store.remove('feedback-commit-messages')
    expect(unwrapConfig(await loadConfig(root)).dismissedDuplicates).toEqual([])
  })

  test('reports an unknown entry', async () => {
    const result = await store.remove('nope')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('entry_not_found')
  })
})

describe('rename', () => {
  beforeEach(async () => {
    await write(entry(NEVER_COMMIT))
    await write(entry({ ...COMMIT_MESSAGES, body: `${COMMIT_MESSAGES.body} See [[feedback-never-commit]].` }))
  })

  test('moves the entry and repoints every link to it', async () => {
    const result = await store.rename('feedback-never-commit', 'git-is-the-users-job')
    expect(result.ok && result.value.rewritten).toEqual(['feedback-commit-messages'])

    const after = await store.read(['feedback-commit-messages'])
    expect(after.ok && after.value[0]?.body).toContain('[[git-is-the-users-job]]')
    expect((await store.read(['feedback-never-commit'])).ok).toBe(false)
  })

  test('repoints a link the entry holds to itself', async () => {
    await write(entry({ name: 'self-linked', description: 'Points at itself', body: 'See [[self-linked]].', confirm: true }))
    const result = await store.rename('self-linked', 'points-at-itself')

    expect(result.ok && result.value.entry.body).toContain('[[points-at-itself]]')
    expect(await store.doctor()).toEqual([])
  })

  test('records the rename date without touching the creation date', async () => {
    const result = await store.rename('feedback-never-commit', 'git-is-the-users-job')
    expect(result.ok && result.value.entry.updated).toBe(TODAY)
    expect(result.ok && result.value.entry.created).toBe(TODAY)
  })

  test('refuses a new name that is not kebab-case', async () => {
    const result = await store.rename('feedback-never-commit', 'Not Kebab')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid_entry')
  })

  test('refuses a name that is already taken', async () => {
    const result = await store.rename('feedback-never-commit', 'feedback-commit-messages')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('entry_exists')
  })

  test('carries a dismissal across, so a reviewed pair stays reviewed', async () => {
    await saveConfig(root, configSchema.parse({ dismissedDuplicates: [['feedback-never-commit', 'feedback-commit-messages']] }))
    store = await open()

    await store.rename('feedback-never-commit', 'git-is-the-users-job')
    expect(unwrapConfig(await loadConfig(root)).dismissedDuplicates).toEqual([['git-is-the-users-job', 'feedback-commit-messages']])
    expect(await store.doctor()).toEqual([])
  })

  test('leaves the store untouched when the entry does not exist', async () => {
    expect((await store.rename('nope', 'something-else')).ok).toBe(false)
    expect((await store.load()).entries).toHaveLength(2)
  })
})
