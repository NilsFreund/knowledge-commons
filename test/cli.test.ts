import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../src/cli/index.ts'

let root: string
let out: string[]
let errors: string[]
let originalHome: string | undefined

const log = console.log
const error = console.error

/** Every case passes --store, and KN_HOME guards against a case that forgets and would hit the real store. */
async function run(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  out = []
  errors = []
  const code = await main(args)
  return { code, out: out.join('\n'), err: errors.join('\n') }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kn-cli-'))
  originalHome = process.env['KN_HOME']
  process.env['KN_HOME'] = root
  console.log = (...parts: unknown[]) => void out.push(parts.join(' '))
  console.error = (...parts: unknown[]) => void errors.push(parts.join(' '))
})

afterEach(async () => {
  console.log = log
  console.error = error
  if (originalHome === undefined) delete process.env['KN_HOME']
  else process.env['KN_HOME'] = originalHome
  await rm(root, { recursive: true, force: true })
})

describe('dispatch', () => {
  test.each([[], ['--help'], ['-h'], ['help']])('prints the command list for %p', async (...args) => {
    const result = await run(...(args as string[]))
    expect(result.code).toBe(0)
    expect(result.out).toContain('kn <command> [options]')
  })

  test('rejects an unknown command and shows what is available', async () => {
    const result = await run('nope')
    expect(result.code).toBe(1)
    expect(result.err).toContain('Unknown command')
    expect(result.err).toContain('doctor')
  })

  test('prints usage for a single command on --help, without running it', async () => {
    const result = await run('doctor', '--help')
    expect(result.code).toBe(0)
    expect(result.out).toContain('kn doctor')
  })

  test('reports an unknown flag rather than ignoring it', async () => {
    const result = await run('doctor', '--nonsense')
    expect(result.code).toBe(1)
    expect(result.err).not.toBe('')
  })
})

describe('init', () => {
  test('creates a store and says where', async () => {
    const result = await run('init', join(root, 'store'))
    expect(result.code).toBe(0)
    expect(result.out).toContain('Store ready at')
  })

  test('is safe to run twice', async () => {
    await run('init', join(root, 'store'))
    const second = await run('init', join(root, 'store'))
    expect(second.code).toBe(0)
    expect(second.out).toContain('already at')
  })
})

describe('commands against a store', () => {
  let store: string

  beforeEach(async () => {
    store = join(root, 'store')
    await run('init', store)
  })

  async function write(name: string, description: string, body: string): Promise<void> {
    const input = JSON.stringify({ name, description, type: 'feedback', scope: 'global', body, confirm: true })
    const original = process.stdin
    Object.defineProperty(process, 'stdin', {
      value: (async function* () {
        yield Buffer.from(input)
      })(),
      configurable: true,
    })
    await run('write', '--store', store)
    Object.defineProperty(process, 'stdin', { value: original, configurable: true })
  }

  test('reports a healthy store', async () => {
    const result = await run('doctor', '--store', store)
    expect(result.code).toBe(0)
    expect(result.out).toContain('No problems found')
  })

  test('lists nothing before anything is written', async () => {
    expect((await run('list', '--store', store)).out).toBe('No entries.')
  })

  test('writes an entry from stdin and lists it', async () => {
    await write('feedback-never-commit', 'The user does all git themselves', 'Never run git commit.')
    const result = await run('list', '--store', store)
    expect(result.out).toContain('global/feedback-never-commit')
  })

  test('returns JSON when asked, so a script can read it', async () => {
    await write('feedback-never-commit', 'The user does all git themselves', 'Never run git commit.')
    const result = await run('list', '--store', store, '--json')
    expect(JSON.parse(result.out)).toHaveLength(1)
  })

  test('exits non-zero when a search finds nothing', async () => {
    expect((await run('search', 'kubernetes', '--store', store)).code).toBe(1)
  })

  test('treats a missing query as a usage error, not a failure', async () => {
    const result = await run('search', '--store', store)
    expect(result.code).toBe(2)
    expect(result.err).toContain('needs a query')
  })

  test('reports an unknown entry as an error', async () => {
    const result = await run('read', 'nope', '--store', store)
    expect(result.code).toBe(1)
    expect(result.err).toContain('nope')
  })

  test('maps a repository to a scope and lists it back', async () => {
    await run('scope', 'add', '/repos/shop', 'shop', '--store', store)
    expect((await run('scope', 'list', '--store', store)).out).toContain('-> shop')
  })

  test('refuses to remove a scope that was never mapped', async () => {
    expect((await run('scope', 'remove', '/repos/gone', '--store', store)).code).toBe(2)
  })

  test('prints a stored prompt, and lists them when none is named', async () => {
    expect((await run('prompt', 'polish', '--store', store)).out).toContain('knowledge_context')
    expect((await run('prompt', '--store', store)).out).toContain('write-research')
  })

  test('counts its own calls', async () => {
    await run('doctor', '--store', store)
    const result = await run('stats', '--store', store)
    expect(result.out).toContain('doctor')
    expect(result.out).toContain('cli')
  })

  test('removes an entry and refuses while something links to it', async () => {
    await write('feedback-never-commit', 'The user does all git themselves', 'Never run git commit.')
    await write('feedback-commit-messages', 'One line only', 'See [[feedback-never-commit]].')

    const blocked = await run('rm', 'feedback-never-commit', '--store', store)
    expect(blocked.code).toBe(1)
    expect(blocked.err).toContain('still linked from')

    const forced = await run('rm', 'feedback-never-commit', '--force', '--store', store)
    expect(forced.code).toBe(0)
    expect(forced.out).toContain('Removed global/feedback-never-commit')
  })

  test('renames an entry and reports the repointed links', async () => {
    await write('feedback-never-commit', 'The user does all git themselves', 'Never run git commit.')
    await write('feedback-commit-messages', 'One line only', 'See [[feedback-never-commit]].')

    const result = await run('mv', 'feedback-never-commit', 'git-is-the-users-job', '--store', store)
    expect(result.code).toBe(0)
    expect(result.out).toContain('Repointed 1 link(s)')
  })

  test.each([
    [['rm'], 'exactly one entry name'],
    [['mv', 'only-one'], 'the current name and the new one'],
  ])('treats %p as a usage error', async (args, message) => {
    const result = await run(...(args as string[]), '--store', store)
    expect(result.code).toBe(2)
    expect(result.err).toContain(message)
  })

  test('says so when there is no research', async () => {
    expect((await run('research', 'list', '--store', store)).out).toContain('No research recorded')
  })

  test('rejects an unknown research action', async () => {
    expect((await run('research', 'nonsense', '--store', store)).code).toBe(2)
  })
})

describe('a store that does not exist', () => {
  test('is reported rather than silently treated as empty', async () => {
    const result = await run('list', '--store', join(root, 'gone'))
    expect(result.code).toBe(1)
    expect(result.err).toContain('no knowledge store at')
  })
})
