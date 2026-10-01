import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSections, ResearchStore, type ResearchWriteInput } from '../src/core/index.ts'

let root: string

function open(today = '2026-09-23'): ResearchStore {
  return ResearchStore.open(root, () => today)
}

function input(overrides: Partial<ResearchWriteInput> = {}): ResearchWriteInput {
  return {
    name: 'pool-behaviour-on-restart',
    title: 'What the connection pool does when the database restarts',
    scope: 'global',
    body: 'Idle connections are dropped and reopened lazily on the next query.',
    ...overrides,
  }
}

async function write(store: ResearchStore, overrides: Partial<ResearchWriteInput> = {}) {
  const result = await store.write(input(overrides))
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kn-research-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('an untouched store', () => {
  test('has no research and does not fail for want of a directory', async () => {
    expect(await open().list()).toEqual([])
    expect(await open().search('anything')).toEqual([])
  })
})

describe('a store that does not exist', () => {
  test('is named as the problem, rather than blamed on another writer', async () => {
    const result = await ResearchStore.open(join(root, 'nope')).write(input())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('store_not_found')
  })
})

describe('write', () => {
  test('records the first round under a dated heading', async () => {
    const outcome = await write(open())
    expect(outcome.status).toBe('created')
    if (outcome.status !== 'created') return

    expect(outcome.doc.sections).toEqual([{ date: '2026-09-23', body: input().body }])
    expect(outcome.doc.path).toBe(join(root, 'research', 'global', 'pool-behaviour-on-restart.md'))
  })

  test('appends a later round instead of replacing what was true before', async () => {
    await write(open('2026-09-23'))
    const outcome = await write(open('2026-11-02'), { body: 'The per-participant rate changed.' })

    expect(outcome.status).toBe('appended')
    if (outcome.status !== 'appended') return
    expect(outcome.rounds).toBe(2)
    expect(outcome.doc.sections.map((section) => section.date)).toEqual(['2026-09-23', '2026-11-02'])
    expect(outcome.doc.sections[0]?.body).toBe(input().body)
  })

  test('keeps the original creation date and takes the newer title', async () => {
    await write(open('2026-09-23'))
    const outcome = await write(open('2026-11-02'), { title: 'Pool behaviour, revisited' })

    expect(outcome.doc.created).toBe('2026-09-23')
    expect(outcome.doc.updated).toBe('2026-11-02')
    expect(outcome.doc.title).toBe('Pool behaviour, revisited')
  })

  test('unions the sources across rounds, because each one has to stay recheckable', async () => {
    await write(open('2026-09-23'), { sources: ['https://example.test/pricing'] })
    const outcome = await write(open('2026-11-02'), { sources: ['https://example.test/changelog'] })

    expect(outcome.doc.sources).toEqual(['https://example.test/pricing', 'https://example.test/changelog'])
  })

  test('appends into the scope the document already lives in, not the one passed in', async () => {
    await write(open(), { scope: 'shop' })
    const outcome = await write(open('2026-11-02'), { scope: 'global' })

    expect(outcome.doc.scope).toBe('shop')
    expect((await open().load()).docs).toHaveLength(1)
  })

  test('rejects a name that is not kebab-case before touching the disk', async () => {
    const result = await open().write(input({ name: 'Not Kebab' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid_entry')
    expect((await open().load()).docs).toEqual([])
  })

  test('defaults to the global scope when none is given', async () => {
    const result = await open().write({ name: 'x-y-z', title: 'T', body: 'B' })
    expect(result.ok && result.value.doc.scope).toBe('global')
  })
})

describe('list and search', () => {
  beforeEach(async () => {
    await write(open('2026-09-23'), { name: 'pool-behaviour-on-restart', title: 'What the connection pool does when the database restarts' })
    await write(open('2026-11-02'), { name: 'retry-backoff-defaults', title: 'What the client retries and how long it waits', scope: 'shop', body: 'Retries use exponential backoff with a cap.' })
  })

  test('lists the most recently revisited first, with its round count', async () => {
    const summaries = await open().list()
    expect(summaries.map((summary) => summary.id)).toEqual(['shop/retry-backoff-defaults', 'global/pool-behaviour-on-restart'])
    expect(summaries[0]?.rounds).toBe(1)
  })

  test('limits a listing to the scopes asked for', async () => {
    expect((await open().list(['shop'])).map((summary) => summary.name)).toEqual(['retry-backoff-defaults'])
  })

  test('finds a document by its subject', async () => {
    const hits = await open().search('exponential backoff')
    expect(hits[0]?.doc.name).toBe('retry-backoff-defaults')
  })

  test('returns nothing rather than everything for an unrelated query', async () => {
    expect(await open().search('kubernetes ingress certificates')).toEqual([])
  })
})

describe('read', () => {
  test('accepts the scope/name a listing prints, not only the bare name', async () => {
    await write(open(), { scope: 'shop' })
    const result = await open().read(['shop/pool-behaviour-on-restart'])
    expect(result.ok && result.value[0]?.name).toBe('pool-behaviour-on-restart')
  })

  test('names what is missing instead of silently returning less', async () => {
    await write(open())
    const result = await open().read(['pool-behaviour-on-restart', 'nope'])

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.detail).toEqual(['nope'])
  })
})

describe('load', () => {
  test('reports a file it cannot parse without losing the rest', async () => {
    await write(open())
    await mkdir(join(root, 'research', 'global'), { recursive: true })
    await writeFile(join(root, 'research', 'global', 'broken.md'), 'no frontmatter here', 'utf8')

    const { docs, problems } = await open().load()
    expect(docs).toHaveLength(1)
    expect(problems).toHaveLength(1)
  })

  test('reports a file whose name disagrees with its frontmatter', async () => {
    await write(open())
    const raw = await readFile(join(root, 'research', 'global', 'pool-behaviour-on-restart.md'), 'utf8')
    await writeFile(join(root, 'research', 'global', 'renamed.md'), raw, 'utf8')

    const { problems } = await open().load()
    expect(problems[0]?.message).toContain('filename does not match')
  })
})

describe('parseSections', () => {
  test('splits on dated headings and ignores other headings', () => {
    const body = '## 2026-01-01\n\nfirst\n\n## Not a date\n\nstill first\n\n## 2026-02-02\n\nsecond'
    expect(parseSections(body)).toEqual([
      { date: '2026-01-01', body: 'first\n\n## Not a date\n\nstill first' },
      { date: '2026-02-02', body: 'second' },
    ])
  })

  test('finds nothing in a body that has no rounds', () => {
    expect(parseSections('just prose')).toEqual([])
  })
})

describe('concurrent writes', () => {
  test('appends both rounds instead of one clobbering the other', async () => {
    const store = open()
    await Promise.all([
      store.write(input({ body: 'first finding' })),
      store.write(input({ body: 'second finding' })),
    ])

    const { docs } = await open().load()
    expect(docs).toHaveLength(1)
    expect(docs[0]?.body).toContain('first finding')
    expect(docs[0]?.body).toContain('second finding')
  })
})
