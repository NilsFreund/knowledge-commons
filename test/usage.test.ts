import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { STATS_FILE, type UsageEvent } from '../src/core/index.ts'
import { record } from '../src/usage.ts'

let root: string

function event(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return { at: '2026-09-21T10:00:00.000Z', source: 'cli', name: 'doctor', ok: true, ms: 3, ...overrides }
}

async function recorded(): Promise<readonly UsageEvent[]> {
  const path = join(root, STATS_FILE)
  if (!existsSync(path)) return []
  return (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as UsageEvent)
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kn-usage-'))
  delete process.env['KN_NO_USAGE']
})

afterEach(async () => {
  delete process.env['KN_NO_USAGE']
  await rm(root, { recursive: true, force: true })
})

describe('record', () => {
  test('appends an ordinary call', async () => {
    await record(root, event())
    expect((await recorded()).map((entry) => entry.name)).toEqual(['doctor'])
  })

  test('writes nothing at all when KN_NO_USAGE is set', async () => {
    process.env['KN_NO_USAGE'] = '1'
    await record(root, event())
    expect(existsSync(join(root, STATS_FILE))).toBe(false)
  })

  test('honours KN_NO_USAGE even when it is empty, since setting it at all is the opt out', async () => {
    process.env['KN_NO_USAGE'] = ''
    await record(root, event())
    expect(await recorded()).toEqual([])
  })

  test.each(['init', 'mcp'])('skips the %s command', async (name) => {
    await record(root, event({ name }))
    expect(await recorded()).toEqual([])
  })

  test('still records a tool call that happens to share one of those names', async () => {
    await record(root, event({ source: 'mcp', name: 'init' }))
    expect((await recorded()).map((entry) => entry.source)).toEqual(['mcp'])
  })

  test('never throws when the store directory is missing', async () => {
    await expect(record(join(root, 'gone'), event())).resolves.toBeUndefined()
  })
})
