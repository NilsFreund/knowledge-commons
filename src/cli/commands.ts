import { homedir } from 'node:os'
import { resolve } from 'node:path'
import {
  DEFAULT_SCOPE,
  discoverSources,
  duplicateKey,
  formatError,
  initStore,
  loadConfig,
  pruneUsage,
  readUsage,
  saveConfig,
  ResearchStore,
  Store,
  summarize,
  toIndexRow,
  writeInputSchema,
  type DiscoveredSource,
  type Result,
} from '../core/index.ts'
import { startStdioServer } from '../mcp/server.ts'
import {
  renderContext,
  renderDiagnostics,
  renderEntries,
  renderIndex,
  renderDiscovery,
  renderResearchDocs,
  renderResearchHits,
  renderResearchList,
  renderSearch,
  renderStats,
  renderWriteOutcome,
} from '../render.ts'
import { importClaude, importClaudeInto, importCodex } from './import.ts'
import { AGENT_IDS, agentLabel, install, isAgentId, type AgentId } from './install.ts'
import { Options, UsageError, type OptionDefs } from './options.ts'
import { resolveStoreRoot, serverInvocation } from './paths.ts'

interface CommandContext {
  readonly options: Options
  readonly positionals: readonly string[]
}

export interface Command {
  readonly usage: string
  readonly summary: string
  readonly options?: OptionDefs
  run(context: CommandContext): Promise<number>
}

const STORE: OptionDefs = { store: { type: 'string' } }
const JSON_OUTPUT: OptionDefs = { json: { type: 'boolean', default: false } }

export const COMMANDS: Record<string, Command> = {
  init: {
    usage: 'kn init [directory] [--import]',
    summary: 'Create a knowledge store, and show what there is to import',
    options: { ...STORE, import: { type: 'boolean', default: false } },
    async run({ options, positionals }) {
      const root = positionals[0] ? resolve(positionals[0]) : storeRoot(options)
      const { created } = unwrap(await initStore(root))
      console.log(`Store ${created.length === 0 ? 'already at' : 'ready at'} ${root}.`)

      const home = homedir()
      const sources = await discoverSources(home)
      if (sources.length === 0) {
        console.log('Next: `kn install`, then teach it as you work with /write-knowledge.')
        return 0
      }

      if (!options.flag('import')) {
        console.log(`\n${renderDiscovery(sources, home)}\n\nTake it with \`kn init --import\`, or start empty with \`kn install\`.`)
        return 0
      }

      return await adopt(root, sources)
    },
  },

  context: {
    usage: 'kn context [--cwd <path>] [--query <text>]',
    summary: 'Show the knowledge that applies to a directory',
    options: { ...STORE, ...JSON_OUTPUT, cwd: { type: 'string' }, query: { type: 'string' } },
    async run({ options }) {
      const store = await openStore(options)
      const cwd = resolve(options.string('cwd') ?? process.cwd())
      const query = options.string('query')
      const result = await store.context(query === undefined ? { cwd } : { cwd, query })

      print(options, result, () => renderContext(result, cwd))
      return 0
    },
  },

  search: {
    usage: 'kn search <query...> [--scope <name>] [--limit <n>]',
    summary: 'Find entries by term',
    options: { ...STORE, ...JSON_OUTPUT, scope: { type: 'string', multiple: true }, limit: { type: 'string' } },
    async run({ options, positionals }) {
      const query = positionals.join(' ')
      if (query.length === 0) throw new UsageError('search needs a query')

      const store = await openStore(options)
      const scopes = options.list('scope')
      const hits = await store.search(query, searchOptions(scopes, options.integer('limit')))

      print(options, hits, () => renderSearch(hits))
      return hits.length > 0 ? 0 : 1
    },
  },

  read: {
    usage: 'kn read <name...>',
    summary: 'Print entries in full',
    options: { ...STORE, ...JSON_OUTPUT },
    async run({ options, positionals }) {
      if (positionals.length === 0) throw new UsageError('read needs at least one entry name')

      const store = await openStore(options)
      const entries = unwrap(await store.read(positionals))

      print(options, entries, () => renderEntries(entries))
      return 0
    },
  },

  list: {
    usage: 'kn list [--scope <name>] [--type <type>]',
    summary: 'List every entry',
    options: { ...STORE, ...JSON_OUTPUT, scope: { type: 'string' }, type: { type: 'string' } },
    async run({ options }) {
      const store = await openStore(options)
      const { entries, problems } = await store.load()
      const scope = options.string('scope')
      const type = options.string('type')
      const matching = entries.filter((entry) => (!scope || entry.scope === scope) && (!type || entry.type === type))

      print(options, matching, () => (matching.length === 0 ? 'No entries.' : renderIndex(matching.map(toIndexRow))))
      for (const problem of problems) console.error(`warning: ${formatError(problem)}`)
      return 0
    },
  },

  write: {
    usage: 'kn write < entry.json',
    summary: 'Record an entry from JSON on stdin (agents should use the MCP tool instead)',
    options: { ...STORE, ...JSON_OUTPUT },
    async run({ options }) {
      const store = await openStore(options)
      const input = writeInputSchema.safeParse(JSON.parse(await readStdin()))
      if (!input.success) {
        const issues = input.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        throw new UsageError(`invalid entry on stdin:\n  ${issues.join('\n  ')}`)
      }

      const outcome = unwrap(await store.write(input.data))
      print(options, outcome, () => renderWriteOutcome(outcome))
      return outcome.status === 'candidates' ? 1 : 0
    },
  },

  prompt: {
    usage: 'kn prompt [name]',
    summary: 'Print a stored command prompt',
    options: STORE,
    async run({ options, positionals }) {
      const store = await openStore(options)
      const name = positionals[0]
      if (name === undefined) {
        console.log((await store.listPrompts()).join('\n') || 'No prompts in this store.')
        return 0
      }

      console.log(unwrap(await store.readPrompt(name)).trimEnd())
      return 0
    },
  },

  scope: {
    usage: 'kn scope list | kn scope add <repo-path> <name> [--inherits a,b] | kn scope remove <repo-path>',
    summary: 'Map repositories to scopes',
    options: { ...STORE, inherits: { type: 'string' } },
    async run({ options, positionals }) {
      const [action = 'list', ...rest] = positionals
      const root = storeRoot(options)
      const config = unwrap(await loadConfig(root))

      if (action === 'list') {
        const rules = Object.entries(config.scopes)
        console.log(
          rules.length === 0
            ? 'No scopes configured; everything resolves to `global`.'
            : rules.map(([path, rule]) => describeScope(path, rule.scope, rule.inherits)).join('\n'),
        )
        return 0
      }

      if (action === 'add') {
        const [path, name] = rest
        if (!path || !name) throw new UsageError('scope add needs a repository path and a scope name')

        const inherits = options.commaList('inherits') ?? [DEFAULT_SCOPE]
        await saveConfig(root, { ...config, scopes: { ...config.scopes, [resolve(path)]: { scope: name, inherits: [...inherits] } } })
        console.log(describeScope(resolve(path), name, inherits))
        return 0
      }

      if (action === 'remove') {
        const [path] = rest
        if (!path) throw new UsageError('scope remove needs a repository path')

        const { [resolve(path)]: removed, ...remaining } = config.scopes
        if (!removed) throw new UsageError(`no scope configured for ${resolve(path)}`)

        await saveConfig(root, { ...config, scopes: remaining })
        console.log(`removed ${resolve(path)}`)
        return 0
      }

      throw new UsageError(`unknown scope action \`${action}\``)
    },
  },

  research: {
    usage: 'kn research list | kn research search <query...> | kn research read <name...>',
    summary: 'Recorded research: what exists, what it says',
    options: { ...STORE, ...JSON_OUTPUT, scope: { type: 'string', multiple: true }, limit: { type: 'string' } },
    async run({ options, positionals }) {
      const research = ResearchStore.open(storeRoot(options))
      const scopes = options.list('scope')
      const [action = 'list', ...rest] = positionals

      if (action === 'list') {
        const summaries = await research.list(scopes)
        print(options, summaries, () => renderResearchList(summaries))
        return 0
      }

      if (action === 'search') {
        const query = rest.join(' ')
        if (query.length === 0) throw new UsageError('research search needs a query')

        const hits = await research.search(query, searchOptions(scopes, options.integer('limit')))
        print(options, hits, () => renderResearchHits(hits))
        return hits.length > 0 ? 0 : 1
      }

      if (action === 'read') {
        if (rest.length === 0) throw new UsageError('research read needs at least one name')

        const docs = unwrap(await research.read(rest))
        print(options, docs, () => renderResearchDocs(docs))
        return 0
      }

      throw new UsageError(`unknown research action \`${action}\``)
    },
  },

  doctor: {
    usage: 'kn doctor [--dismiss <entry> <entry>]',
    summary: 'Check the store for broken links, duplicates and unreadable files',
    options: { ...STORE, ...JSON_OUTPUT, dismiss: { type: 'boolean', default: false } },
    async run({ options, positionals }) {
      const store = await openStore(options)
      if (options.flag('dismiss')) return await dismiss(store, positionals)

      const research = await ResearchStore.open(store.root).list()
      const diagnostics = await store.doctor(research.map((summary) => summary.name))
      print(options, diagnostics, () => renderDiagnostics(diagnostics))
      return diagnostics.some((diagnostic) => diagnostic.level === 'error') ? 1 : 0
    },
  },

  stats: {
    usage: 'kn stats [--since <days>] [--prune <days>]',
    summary: 'Show how often the tools and commands have been called',
    options: { ...STORE, ...JSON_OUTPUT, since: { type: 'string' }, prune: { type: 'string' } },
    async run({ options }) {
      const root = storeRoot(options)

      const pruneDays = options.integer('prune')
      if (pruneDays !== undefined) {
        const removed = await pruneUsage(root, daysAgo(pruneDays))
        console.log(`Removed ${removed} event(s) older than ${pruneDays} day(s).`)
        return 0
      }

      const sinceDays = options.integer('since')
      const { events, unreadable } = await readUsage(root, sinceDays === undefined ? undefined : daysAgo(sinceDays))
      const summary = summarize(events, unreadable)

      print(options, summary, () => renderStats(summary))
      return 0
    },
  },

  import: {
    usage: 'kn import claude --from <memory-dir> --scope <name> | kn import codex --from <MEMORY.md> [--out <file>]',
    summary: 'Pull existing memories in from another agent',
    options: {
      ...STORE,
      from: { type: 'string' },
      scope: { type: 'string' },
      out: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
    async run({ options, positionals }) {
      const source = positionals[0]
      if (source === 'claude') return await importClaude(await openStore(options), options)
      if (source === 'codex') return await importCodex(options)
      throw new UsageError('import needs a source: `claude` or `codex`')
    },
  },

  install: {
    usage: 'kn install [--agent claude,codex,cursor] [--dry-run]',
    summary: 'Register the MCP server and the command stubs with your agents',
    options: { ...STORE, agent: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
    async run({ options }) {
      const store = await openStore(options)
      const dryRun = options.flag('dry-run')
      const actions = await install({
        storeRoot: store.root,
        home: homedir(),
        agents: agents(options.commaList('agent')),
        prompts: await store.listPrompts(),
        invocation: serverInvocation(),
        dryRun,
      })

      if (dryRun) console.log('Dry run, nothing was written.\n')

      let current: AgentId | undefined
      for (const action of actions) {
        if (action.agent !== current) {
          current = action.agent
          console.log(`${agentLabel(action.agent)}:`)
        }
        console.log(`  ${action.status.padEnd(9)} ${action.target}${action.note ? `  (${action.note})` : ''}`)
      }

      if (!dryRun) console.log('\nRestart your agents so they pick up the server.')
      return 0
    },
  },

  mcp: {
    usage: 'kn mcp',
    summary: 'Serve the store over MCP on stdio (your agents run this, you normally do not)',
    options: STORE,
    async run({ options }) {
      await startStdioServer({ storeRoot: storeRoot(options) })
      await new Promise<never>(() => {})
      return 0
    },
  },
}

async function dismiss(store: Store, names: readonly string[]): Promise<number> {
  const [a, b] = names
  if (a === undefined || b === undefined || names.length !== 2) {
    throw new UsageError('--dismiss needs exactly two entry names')
  }
  unwrap(await store.read([a, b]))

  const config = unwrap(await loadConfig(store.root))
  const key = duplicateKey(a, b)
  if (config.dismissedDuplicates.some(([x, y]) => duplicateKey(x, y) === key)) {
    console.log(`${a} and ${b} were already dismissed.`)
    return 0
  }

  await saveConfig(store.root, { ...config, dismissedDuplicates: [...config.dismissedDuplicates, [a, b]] })
  console.log(`Dismissed ${a} and ${b}. Undo by editing dismissedDuplicates in ${store.root}/config.json.`)
  return 0
}

function agents(requested: readonly string[] | undefined): readonly AgentId[] {
  if (requested === undefined) return AGENT_IDS

  const unknown = requested.filter((agent) => !isAgentId(agent))
  if (unknown.length > 0) throw new UsageError(`unknown agent(s): ${unknown.join(', ')}. Known: ${AGENT_IDS.join(', ')}`)
  return requested.filter(isAgentId)
}

/** Imports what discovery found and maps each repository to its scope, so the store is useful immediately. */
async function adopt(root: string, sources: readonly DiscoveredSource[]): Promise<number> {
  const store = unwrap(await Store.open(root))
  const config = unwrap(await loadConfig(root))
  const scopes = { ...config.scopes }
  const pending: string[] = []

  for (const source of sources) {
    if (source.scope === undefined || source.repo === undefined) {
      pending.push(source.path)
      continue
    }

    const outcome = await importClaudeInto(store, source.path, source.scope, false)
    scopes[source.repo] = { scope: source.scope, inherits: [DEFAULT_SCOPE] }
    console.log(`  ${source.scope}: ${outcome.imported} imported, ${outcome.skipped.length} skipped, ${outcome.problems.length} unreadable`)
  }

  await saveConfig(root, { ...config, scopes })
  for (const path of pending) console.log(`  ${path}: needs review, see \`kn import codex --help\``)
  console.log('\nNext: `kn doctor`, then `kn install`.')
  return 0
}

function searchOptions(
  scopes: readonly string[] | undefined,
  limit: number | undefined,
): { scopes?: readonly string[]; limit?: number } {
  return { ...(scopes === undefined ? {} : { scopes }), ...(limit === undefined ? {} : { limit }) }
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

function describeScope(path: string, scope: string, inherits: readonly string[]): string {
  return `${path} -> ${scope}${inherits.length > 0 ? ` (inherits ${inherits.join(', ')})` : ''}`
}

function storeRoot(options: Options): string {
  return resolveStoreRoot(options.string('store'))
}

async function openStore(options: Options): Promise<Store> {
  return unwrap(await Store.open(storeRoot(options)))
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(formatError(result.error))
  return result.value
}

function print(options: Options, data: unknown, render: () => string): void {
  console.log(options.flag('json') ? JSON.stringify(data, null, 2) : render())
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf8')
}
