import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readdir, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { AGENT_IDS, install, stub, type InstallAction, type InstallOptions } from '../src/cli/install.ts'

let home: string

const BASE: Omit<InstallOptions, 'home'> = {
  storeRoot: '/store',
  agents: AGENT_IDS,
  prompts: ['polish'],
  invocation: { command: '/usr/local/bin/kn', args: ['mcp'] },
  dryRun: false,
}

const CLAUDE_CONFIG = '.claude.json'
const CURSOR_CONFIG = join('.cursor', 'mcp.json')
const CODEX_CONFIG = join('.codex', 'config.toml')

async function run(overrides: Partial<InstallOptions> = {}): Promise<readonly InstallAction[]> {
  return await install({ ...BASE, home, ...overrides })
}

async function seed(relative: string, content: string): Promise<void> {
  const path = join(home, relative)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
}

async function read(relative: string): Promise<string> {
  return await readFile(join(home, relative), 'utf8')
}

function statusOf(actions: readonly InstallAction[], relative: string): InstallAction | undefined {
  return actions.find((action) => action.target === join(home, relative))
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'kn-home-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('install', () => {
  test('sets up every agent from scratch', async () => {
    const actions = await run()
    expect(actions.every((action) => action.status === 'created')).toBe(true)

    expect(JSON.parse(await read(CLAUDE_CONFIG))).toEqual({
      mcpServers: { knowledge: { command: '/usr/local/bin/kn', args: ['mcp'], env: { KN_HOME: '/store' } } },
    })
    expect(await read(CODEX_CONFIG)).toContain('[mcp_servers.knowledge]')
    expect(await read(join('.claude', 'commands', 'polish.md'))).toBe(stub('polish'))
    expect(await read(join('.codex', 'prompts', 'polish.md'))).toBe(stub('polish'))
    expect(await read(join('.cursor', 'commands', 'polish.md'))).toBe(stub('polish'))
  })

  test('points the server at the store it was installed from', async () => {
    await run({ storeRoot: '/elsewhere/knowledge' })
    expect(await read(CODEX_CONFIG)).toContain('KN_HOME = "/elsewhere/knowledge"')
    expect(JSON.parse(await read(CURSOR_CONFIG)).mcpServers.knowledge.env.KN_HOME).toBe('/elsewhere/knowledge')
  })

  test('keeps the rest of an existing JSON config', async () => {
    await seed(CURSOR_CONFIG, JSON.stringify({ mcpServers: { other: { command: 'x' } }, somethingElse: 1 }))
    await run({ agents: ['cursor'] })

    const config = JSON.parse(await read(CURSOR_CONFIG))
    expect(config.somethingElse).toBe(1)
    expect(config.mcpServers.other).toEqual({ command: 'x' })
    expect(config.mcpServers.knowledge.command).toBe('/usr/local/bin/kn')
  })

  test('never rewrites a knowledge entry someone already configured', async () => {
    await seed(CURSOR_CONFIG, JSON.stringify({ mcpServers: { knowledge: { command: 'mine' } } }))
    const actions = await run({ agents: ['cursor'] })

    expect(statusOf(actions, CURSOR_CONFIG)?.status).toBe('unchanged')
    expect(JSON.parse(await read(CURSOR_CONFIG)).mcpServers.knowledge).toEqual({ command: 'mine' })
  })

  test('appends to an existing TOML config instead of rewriting it', async () => {
    await seed(CODEX_CONFIG, '# keep this comment\nmodel = "some-model"\n\n[mcp_servers.other]\ncommand = "x"\n')
    await run({ agents: ['codex'] })

    const config = await read(CODEX_CONFIG)
    expect(config).toContain('# keep this comment')
    expect(config).toContain('[mcp_servers.other]')
    expect(config.indexOf('[mcp_servers.knowledge]')).toBeGreaterThan(config.indexOf('[mcp_servers.other]'))
  })

  test('leaves a TOML config that already declares the server alone', async () => {
    const original = '[mcp_servers.knowledge]\ncommand = "mine"\n'
    await seed(CODEX_CONFIG, original)
    const actions = await run({ agents: ['codex'] })

    expect(statusOf(actions, CODEX_CONFIG)?.status).toBe('unchanged')
    expect(await read(CODEX_CONFIG)).toBe(original)
  })

  test('refuses a JSON config it cannot parse rather than replacing it', async () => {
    await seed(CURSOR_CONFIG, '{ not json')
    const actions = await run({ agents: ['cursor'] })

    expect(statusOf(actions, CURSOR_CONFIG)?.status).toBe('skipped')
    expect(await read(CURSOR_CONFIG)).toBe('{ not json')
  })

  test('keeps a copy of a command file it replaces', async () => {
    await seed(join('.cursor', 'commands', 'polish.md'), 'my own long-form polish prompt')
    const actions = await run({ agents: ['cursor'] })

    expect(statusOf(actions, join('.cursor', 'commands', 'polish.md'))?.status).toBe('updated')
    const backups = (await readdir(join(home, '.cursor', 'commands'))).filter((file) => file.includes('.bak-'))
    expect(backups).toHaveLength(1)
    expect(await read(join('.cursor', 'commands', backups[0] as string))).toBe('my own long-form polish prompt')
  })

  test('reports an already-current stub as unchanged and leaves no backup', async () => {
    await run({ agents: ['cursor'] })
    const actions = await run({ agents: ['cursor'] })

    expect(statusOf(actions, join('.cursor', 'commands', 'polish.md'))?.status).toBe('unchanged')
    expect((await readdir(join(home, '.cursor', 'commands'))).filter((file) => file.includes('.bak-'))).toHaveLength(0)
  })

  test('writes nothing on a dry run', async () => {
    const actions = await run({ dryRun: true })
    expect(actions.every((action) => action.status === 'created')).toBe(true)
    expect(await readdir(home)).toEqual([])
  })
})

describe('stub', () => {
  test('carries no instructions of its own beyond the call', () => {
    const content = stub('polish')
    expect(content).toContain('knowledge_prompt')
    expect(content).toContain('name: polish')
    expect(content.split('\n').length).toBeLessThan(15)
  })

  test('describes a prompt it has never heard of', () => {
    expect(stub('whatchanged')).toContain('Run the whatchanged prompt')
  })
})
