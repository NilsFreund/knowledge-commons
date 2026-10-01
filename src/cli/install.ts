import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const AGENT_IDS = ['claude', 'codex', 'cursor'] as const
export type AgentId = (typeof AGENT_IDS)[number]

export function isAgentId(value: string): value is AgentId {
  return AGENT_IDS.some((id) => id === value)
}

export interface ServerInvocation {
  readonly command: string
  readonly args: readonly string[]
}

export interface InstallOptions {
  readonly storeRoot: string
  readonly home: string
  readonly agents: readonly AgentId[]
  readonly prompts: readonly string[]
  readonly invocation: ServerInvocation
  readonly dryRun: boolean
}

export interface InstallAction {
  readonly agent: AgentId
  readonly target: string
  readonly status: 'created' | 'updated' | 'unchanged' | 'skipped'
  readonly note?: string
}

interface AgentLayout {
  readonly label: string
  readonly mcpConfig: { readonly format: 'json' | 'toml'; readonly path: string }
  readonly commandsDir: string
}

const AGENTS: Record<AgentId, AgentLayout> = {
  claude: {
    label: 'Claude Code',
    mcpConfig: { format: 'json', path: '.claude.json' },
    commandsDir: join('.claude', 'commands'),
  },
  codex: {
    label: 'Codex',
    mcpConfig: { format: 'toml', path: join('.codex', 'config.toml') },
    commandsDir: join('.codex', 'prompts'),
  },
  cursor: {
    label: 'Cursor',
    mcpConfig: { format: 'json', path: join('.cursor', 'mcp.json') },
    commandsDir: join('.cursor', 'commands'),
  },
}

const SERVER_KEY = 'knowledge'

const PROMPT_SUMMARIES: Record<string, string> = {
  polish: 'Review and refine all uncommitted changes against the shared knowledge store.',
  'write-knowledge': 'Record what you just learned in the shared knowledge store.',
  'write-research': 'Record what this research found, so it does not have to be done again.',
  'read-research': 'Find out what has already been established on a topic.',
}

export function agentLabel(agent: AgentId): string {
  return AGENTS[agent].label
}

export async function install(options: InstallOptions): Promise<readonly InstallAction[]> {
  const actions: InstallAction[] = []
  for (const agent of options.agents) {
    actions.push(await installServer(agent, options))
    for (const prompt of options.prompts) {
      actions.push(await installStub(agent, prompt, options))
    }
  }
  return actions
}

/** An existing `knowledge` entry is never rewritten: someone pointed it there on purpose. */
async function installServer(agent: AgentId, options: InstallOptions): Promise<InstallAction> {
  const layout = AGENTS[agent]
  const target = join(options.home, layout.mcpConfig.path)
  const existing = existsSync(target) ? await readFile(target, 'utf8') : undefined

  return layout.mcpConfig.format === 'json'
    ? await installServerJson(agent, target, existing, options)
    : await installServerToml(agent, target, existing, options)
}

async function installServerJson(
  agent: AgentId,
  target: string,
  existing: string | undefined,
  options: InstallOptions,
): Promise<InstallAction> {
  let config: Record<string, unknown> = {}
  if (existing !== undefined) {
    let parsed: unknown
    try {
      parsed = JSON.parse(existing)
    } catch {
      return { agent, target, status: 'skipped', note: 'not valid JSON; add the server by hand' }
    }
    if (!isRecord(parsed)) return { agent, target, status: 'skipped', note: 'not a JSON object' }
    config = parsed
  }

  const existingServers = config['mcpServers']
  const servers = isRecord(existingServers) ? existingServers : {}
  if (SERVER_KEY in servers) {
    return { agent, target, status: 'unchanged', note: `\`${SERVER_KEY}\` already configured` }
  }

  const next = { ...config, mcpServers: { ...servers, [SERVER_KEY]: serverEntry(options) } }
  if (!options.dryRun) {
    await backup(target)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  }
  return { agent, target, status: existing === undefined ? 'created' : 'updated' }
}

/** Appended rather than rewritten, so the user's comments and formatting survive. */
async function installServerToml(
  agent: AgentId,
  target: string,
  existing: string | undefined,
  options: InstallOptions,
): Promise<InstallAction> {
  if (existing !== undefined && new RegExp(`^\\[mcp_servers\\.${SERVER_KEY}\\]`, 'm').test(existing)) {
    return { agent, target, status: 'unchanged', note: `\`${SERVER_KEY}\` already configured` }
  }

  const block = [
    `[mcp_servers.${SERVER_KEY}]`,
    `command = ${tomlString(options.invocation.command)}`,
    `args = [${options.invocation.args.map(tomlString).join(', ')}]`,
    '',
    `[mcp_servers.${SERVER_KEY}.env]`,
    `KN_HOME = ${tomlString(options.storeRoot)}`,
    '',
  ].join('\n')

  if (!options.dryRun) {
    await backup(target)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, `${existing ?? ''}${separatorBefore(existing)}${block}`, 'utf8')
  }
  return { agent, target, status: existing === undefined ? 'created' : 'updated' }
}

async function installStub(agent: AgentId, prompt: string, options: InstallOptions): Promise<InstallAction> {
  const target = join(options.home, AGENTS[agent].commandsDir, `${prompt}.md`)
  const content = stub(prompt)
  const existing = existsSync(target) ? await readFile(target, 'utf8') : undefined
  if (existing === content) return { agent, target, status: 'unchanged' }

  if (!options.dryRun) {
    await backup(target)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
  return existing === undefined
    ? { agent, target, status: 'created' }
    : { agent, target, status: 'updated', note: 'previous version kept as a .bak file' }
}

/** Carries no instructions of its own, so editing a prompt in the store needs no reinstall. */
export function stub(prompt: string): string {
  const summary = PROMPT_SUMMARIES[prompt] ?? `Run the ${prompt} prompt from the shared knowledge store.`
  return [
    '---',
    `name: ${prompt}`,
    `description: ${summary}`,
    '---',
    '',
    `Call the \`knowledge_prompt\` tool with \`name: "${prompt}"\` and follow the instructions it returns.`,
    '',
    'Those instructions are the current version of this command. Do not act on a remembered version of it,',
    'and do not skip the call.',
    '',
  ].join('\n')
}

function serverEntry(options: InstallOptions): Record<string, unknown> {
  return {
    command: options.invocation.command,
    args: [...options.invocation.args],
    env: { KN_HOME: options.storeRoot },
  }
}

async function backup(target: string): Promise<void> {
  if (!existsSync(target)) return
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
  await copyFile(target, `${target}.bak-${stamp}`)
}

function separatorBefore(existing: string | undefined): string {
  if (existing === undefined) return ''
  if (existing.endsWith('\n\n')) return ''
  if (existing.endsWith('\n')) return '\n'
  return '\n\n'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tomlString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}
