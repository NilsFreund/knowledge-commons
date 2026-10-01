import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pruneUsage, readUsage, recordUsage, STATS_FILE, summarize, usageEventSchema, type UsageEvent } from '../src/core/index.ts'

let root: string

function event(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return { at: '2026-09-21T10:00:00.000Z', source: 'mcp', name: 'knowledge_context', ok: true, ms: 5, ...overrides }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kn-stats-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('recordUsage', () => {
  test('appends one line per call', async () => {
    await recordUsage(root, event())
    await recordUsage(root, event({ name: 'knowledge_search' }))

    const lines = (await readFile(join(root, STATS_FILE), 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(usageEventSchema.parse(JSON.parse(lines[1] ?? '')).name).toBe('knowledge_search')
  })

  test('stays silent when the directory does not exist, so a call never fails over counting', async () => {
    await expect(recordUsage(join(root, 'nope'), event())).resolves.toBeUndefined()
  })
})

describe('readUsage', () => {
  test('returns nothing for a store that was never used', async () => {
    expect(await readUsage(root)).toEqual({ events: [], unreadable: 0 })
  })

  test('counts lines it cannot parse instead of discarding the whole log', async () => {
    await recordUsage(root, event())
    await appendFile(join(root, STATS_FILE), 'not json\n{"at":"nonsense"}\n', 'utf8')

    const { events, unreadable } = await readUsage(root)
    expect(events).toHaveLength(1)
    expect(unreadable).toBe(2)
  })

  test('filters to events at or after a cutoff', async () => {
    await recordUsage(root, event({ at: '2026-09-01T10:00:00.000Z' }))
    await recordUsage(root, event({ at: '2026-09-20T10:00:00.000Z' }))

    const { events } = await readUsage(root, new Date('2026-09-10T00:00:00.000Z'))
    expect(events).toHaveLength(1)
    expect(events[0]?.at).toBe('2026-09-20T10:00:00.000Z')
  })
})

describe('summarize', () => {
  const events = [
    event({ name: 'knowledge_context', ms: 10, detail: 'shop' }),
    event({ name: 'knowledge_context', ms: 20, detail: 'shop' }),
    event({ name: 'knowledge_context', ms: 30, detail: 'global', at: '2026-09-22T10:00:00.000Z' }),
    event({ name: 'knowledge_read', ok: false, ms: 4 }),
    event({ name: 'doctor', source: 'cli', ms: 2 }),
  ]

  test('counts calls and errors', () => {
    const summary = summarize(events)
    expect(summary.total).toBe(5)
    expect(summary.errors).toBe(1)
  })

  test('reports the span the log covers', () => {
    const summary = summarize(events)
    expect(summary.first).toBe('2026-09-21T10:00:00.000Z')
    expect(summary.last).toBe('2026-09-22T10:00:00.000Z')
  })

  test('groups by name and source, busiest first', () => {
    const [first] = summarize(events).byName
    expect(first).toMatchObject({ name: 'knowledge_context', source: 'mcp', calls: 3, errors: 0, medianMs: 20 })
  })

  test('keeps the same name apart when it came from different sources', () => {
    const mixed = summarize([event({ name: 'doctor', source: 'cli' }), event({ name: 'doctor', source: 'mcp' })])
    expect(mixed.byName).toHaveLength(2)
  })

  test('counts details per tool, which is how write outcomes and scopes are reported', () => {
    expect(summarize(events).details).toEqual([{ name: 'knowledge_context', detail: 'shop', calls: 2 }, { name: 'knowledge_context', detail: 'global', calls: 1 }])
  })

  test('counts calls per day in order', () => {
    expect(summarize(events).byDay).toEqual([
      { day: '2026-09-21', calls: 4 },
      { day: '2026-09-22', calls: 1 },
    ])
  })

  test('says nothing rather than dividing by zero on an empty log', () => {
    expect(summarize([])).toMatchObject({ total: 0, errors: 0, byName: [], byDay: [], details: [] })
  })
})

describe('pruneUsage', () => {
  test('keeps recent events and drops the rest', async () => {
    await recordUsage(root, event({ at: '2026-09-01T10:00:00.000Z' }))
    await recordUsage(root, event({ at: '2026-09-20T10:00:00.000Z' }))

    const removed = await pruneUsage(root, new Date('2026-09-10T00:00:00.000Z'))
    expect(removed).toBe(1)
    expect((await readUsage(root)).events).toHaveLength(1)
  })
})
