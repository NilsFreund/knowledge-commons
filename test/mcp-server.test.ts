import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initStore, STATS_FILE } from '../src/core/index.ts'
import { createServer } from '../src/mcp/server.ts'

const TOOLS = [
  'knowledge_context',
  'knowledge_search',
  'knowledge_read',
  'knowledge_write',
  'knowledge_prompt',
  'knowledge_index',
  'research_write',
  'research_search',
  'research_read',
  'research_list',
]

let root: string
let client: Client

async function call(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
  const result = await client.callTool({ name, arguments: args })
  const [block] = result.content as { type: string; text: string }[]
  return { text: block?.text ?? '', isError: result.isError === true }
}

async function write(overrides: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
  return await call('knowledge_write', {
    name: 'feedback-never-commit',
    description: 'The user performs all git operations themselves',
    type: 'feedback',
    scope: 'global',
    body: 'Never run git commit or git push. Stage the changes and stop there.',
    ...overrides,
  })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kn-mcp-'))
  await initStore(root)

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test', version: '0' })
  await Promise.all([client.connect(clientTransport), createServer({ storeRoot: root }).connect(serverTransport)])
})

afterEach(async () => {
  await client.close()
  await rm(root, { recursive: true, force: true })
})

describe('the tool surface', () => {
  test('offers exactly the tools the README documents', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOLS].sort())
  })

  test('describes every tool, since the description is how an agent picks one', async () => {
    const { tools } = await client.listTools()
    for (const tool of tools) {
      expect(tool.description ?? '').not.toBe('')
    }
  })

  test('marks the reads as read-only and the writes as not', async () => {
    const { tools } = await client.listTools()
    const readOnly = Object.fromEntries(tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint]))
    expect(readOnly['knowledge_search']).toBe(true)
    expect(readOnly['knowledge_write']).toBe(false)
    expect(readOnly['research_write']).toBe(false)
  })
})

describe('knowledge_context', () => {
  test('tells an agent the store is empty and what to do about it', async () => {
    const { text, isError } = await call('knowledge_context', { cwd: '/tmp/anywhere' })
    expect(isError).toBe(false)
    expect(text).toContain('knowledge_write')
  })

  test('inlines a feedback entry once one exists', async () => {
    await write({ confirm: true })
    const { text } = await call('knowledge_context', { cwd: '/tmp/anywhere' })
    expect(text).toContain('global/feedback-never-commit')
    expect(text).toContain('Stage the changes and stop there.')
  })
})

describe('knowledge_write', () => {
  test('creates when the store holds nothing like it', async () => {
    expect((await write()).text).toContain('Created global/feedback-never-commit')
  })

  test('reports candidates and writes nothing when a reworded duplicate exists', async () => {
    await write()
    const { text } = await write({
      name: 'git-is-the-users-job',
      description: 'Do not commit or push on the user behalf, they handle git themselves',
      body: 'The user handles every git operation. Do not create commits, do not push branches.',
    })

    expect(text).toContain('Nothing was written')
    expect(text).toContain('global/feedback-never-commit')
  })

  test('rejects an invalid entry as an error rather than writing it', async () => {
    const { text, isError } = await write({ name: 'Not Kebab' })
    expect(isError).toBe(true)
    expect(text).toContain('kebab-case')
  })
})

describe('knowledge_read', () => {
  beforeEach(async () => {
    await write()
  })

  /** Nine days of real use showed agents passing back the id they were shown, and getting an error. */
  test('accepts the scope/name that knowledge_context prints', async () => {
    const { text, isError } = await call('knowledge_read', { names: ['global/feedback-never-commit'] })
    expect(isError).toBe(false)
    expect(text).toContain('Stage the changes and stop there.')
  })

  test('accepts the bare name as well', async () => {
    expect((await call('knowledge_read', { names: ['feedback-never-commit'] })).isError).toBe(false)
  })

  test('names what it could not find', async () => {
    const { text, isError } = await call('knowledge_read', { names: ['nope'] })
    expect(isError).toBe(true)
    expect(text).toContain('nope')
  })
})

describe('knowledge_prompt', () => {
  test('returns a stored prompt', async () => {
    expect((await call('knowledge_prompt', { name: 'polish' })).text).toContain('knowledge_context')
  })

  test('lists what is available when the name is wrong', async () => {
    const { text, isError } = await call('knowledge_prompt', { name: 'nope' })
    expect(isError).toBe(true)
    expect(text).toContain('polish')
  })
})

describe('research', () => {
  const research = { name: 'pool-behaviour-on-restart', title: 'What the connection pool does when the database restarts', scope: 'shop' }

  test('records a first round, then appends to it', async () => {
    expect((await call('research_write', { ...research, body: 'Dropped and reopened lazily.' })).text).toContain('Recorded shop/pool-behaviour-on-restart')

    const second = await call('research_write', { ...research, body: 'The driver keeps them instead.' })
    expect(second.text).toContain('Appended')
    expect(second.text).toContain('2 rounds')
  })

  test('reads back every round, by the id a listing prints', async () => {
    await call('research_write', { ...research, body: 'Dropped and reopened lazily.' })
    await call('research_write', { ...research, body: 'The driver keeps them instead.' })

    const { text } = await call('research_read', { names: ['shop/pool-behaviour-on-restart'] })
    expect(text).toContain('Dropped and reopened lazily.')
    expect(text).toContain('The driver keeps them instead.')
  })

  test('says so when nothing is recorded, instead of returning an empty answer', async () => {
    expect((await call('research_search', { query: 'anything' })).text).toContain('research_write')
    expect((await call('research_list', {})).text).toContain('No research recorded')
  })
})

describe('usage recording', () => {
  test('writes one line per call, with the write outcome', async () => {
    await write()
    await call('knowledge_search', { query: 'git' })

    const events = (await readFile(join(root, STATS_FILE), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { name: string; source: string; ok: boolean; detail?: string })

    expect(events.map((event) => event.name)).toEqual(['knowledge_write', 'knowledge_search'])
    expect(events.every((event) => event.source === 'mcp' && event.ok)).toBe(true)
    expect(events[0]?.detail).toBe('created')
  })

  test('records a failed call as failed', async () => {
    await call('knowledge_read', { names: ['nope'] })

    const [event] = (await readFile(join(root, STATS_FILE), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { ok: boolean })
    expect(event?.ok).toBe(false)
  })
})

describe('a store that is not there', () => {
  test('is reported rather than crashing the server', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const other = new Client({ name: 'test', version: '0' })
    await Promise.all([
      other.connect(clientTransport),
      createServer({ storeRoot: join(root, 'gone') }).connect(serverTransport),
    ])

    const result = await other.callTool({ name: 'knowledge_index', arguments: {} })
    const [block] = result.content as { text: string }[]
    expect(result.isError).toBe(true)
    expect(block?.text).toContain('no knowledge store at')
    await other.close()
  })
})
