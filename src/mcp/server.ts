import { McpServer, type CallToolResult } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'
import {
  formatError,
  researchWriteSchema,
  ResearchStore,
  Store,
  toIndexRow,
  writeInputSchema,
  type KnowledgeError,
} from '../core/index.ts'
import {
  renderContext,
  renderEntries,
  renderIndex,
  renderResearchDocs,
  renderResearchHits,
  renderResearchList,
  renderResearchOutcome,
  renderSearch,
  renderWriteOutcome,
} from '../render.ts'
import { record } from '../usage.ts'

const VERSION = '0.1.0'

type ToolOutput = string | { readonly text: string; readonly detail: string } | { readonly ok: false; readonly error: KnowledgeError }

export interface ServerOptions {
  readonly storeRoot: string
}

export function createServer(options: ServerOptions): McpServer {
  const server = new McpServer({ name: 'knowledge', version: VERSION }, { capabilities: { tools: {} } })

  server.registerTool(
    'knowledge_context',
    {
      title: 'Knowledge for this directory',
      description:
        'Everything recorded for the repository a path belongs to: an index of every entry in scope, with the bodies of the entries that always apply already inlined, and the paths of any instruction files the repository carries itself. Call this before reviewing or changing code, and pass what the work is about as the query to pull in the rest.',
      inputSchema: z.object({
        cwd: z.string().describe('Absolute path to the working directory, normally the repository you are in'),
        query: z.string().optional().describe('What the task is about, used to inline further relevant entries'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ cwd, query }) =>
      call(options, 'knowledge_context', async (store) => {
        const result = await store.context(query === undefined ? { cwd } : { cwd, query })
        return { text: renderContext(result, cwd), detail: result.scopes[0] ?? 'global' }
      }),
  )

  server.registerTool(
    'knowledge_search',
    {
      title: 'Search knowledge',
      description: 'Find entries by term across every scope. Use it to check whether a fact is already recorded.',
      inputSchema: z.object({
        query: z.string().min(1),
        scopes: z.array(z.string()).optional().describe('Restrict to these scopes; omit to search all of them'),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ query, scopes, limit }) =>
      call(options, 'knowledge_search', async (store) => {
        const hits = await store.search(query, scopes ? { scopes, limit } : { limit })
        return renderSearch(hits)
      }),
  )

  server.registerTool(
    'knowledge_read',
    {
      title: 'Read knowledge entries',
      description: 'The full text of entries. Pass either the bare name or the `scope/name` an index or search result printed.',
      inputSchema: z.object({ names: z.array(z.string().min(1)).min(1) }),
      annotations: { readOnlyHint: true },
    },
    async ({ names }) =>
      call(options, 'knowledge_read', async (store) => {
        const entries = await store.read(names)
        return entries.ok ? renderEntries(entries.value) : entries
      }),
  )

  server.registerTool(
    'knowledge_write',
    {
      title: 'Record a knowledge entry',
      description:
        'Record one durable fact so every agent picks it up from now on. If similar entries already exist, the call reports them and writes nothing: read them, then call again with updateName to merge into one, or confirm to add a separate entry.',
      inputSchema: writeInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      call(options, 'knowledge_write', async (store) => {
        const outcome = await store.write(input)
        return outcome.ok ? { text: renderWriteOutcome(outcome.value), detail: outcome.value.status } : outcome
      }),
  )

  server.registerTool(
    'knowledge_prompt',
    {
      title: 'Get a stored prompt',
      description: 'The current instructions for a command such as polish or write-knowledge. Follow what it returns.',
      inputSchema: z.object({ name: z.string().min(1) }),
      annotations: { readOnlyHint: true },
    },
    async ({ name }) =>
      call(options, 'knowledge_prompt', async (store) => {
        const prompt = await store.readPrompt(name)
        if (prompt.ok) return prompt.value
        const available = await store.listPrompts()
        return { ...prompt, error: { ...prompt.error, detail: [`available: ${available.join(', ') || 'none'}`] } }
      }),
  )

  server.registerTool(
    'knowledge_index',
    {
      title: 'List every knowledge entry',
      description: 'The whole store, across all scopes. Prefer knowledge_context when you are working in a repository.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () =>
      call(options, 'knowledge_index', async (store) => {
        const { entries } = await store.load()
        if (entries.length === 0) return 'The store is empty. Record the first fact with knowledge_write.'
        return renderIndex(entries.map(toIndexRow))
      }),
  )

  server.registerTool(
    'research_write',
    {
      title: 'Record a research result',
      description:
        'Store what a piece of research found, under a stable name for the question it answers. Recording the same name again appends a new dated round instead of replacing the old one, so what was true before stays readable.',
      inputSchema: researchWriteSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) =>
      callResearch(options, 'research_write', async (research) => {
        const outcome = await research.write(input)
        return outcome.ok ? { text: renderResearchOutcome(outcome.value), detail: outcome.value.status } : outcome
      }),
  )

  server.registerTool(
    'research_search',
    {
      title: 'Find recorded research',
      description: 'Look for research on a topic before doing it again. Returns titles and dates, not the documents.',
      inputSchema: z.object({
        query: z.string().min(1),
        scopes: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ query, scopes, limit }) =>
      callResearch(options, 'research_search', async (research) => {
        const hits = await research.search(query, scopes ? { scopes, limit } : { limit })
        return renderResearchHits(hits)
      }),
  )

  server.registerTool(
    'research_read',
    {
      title: 'Read recorded research',
      description: 'The full documents, every dated round included. Pass either the bare name or the `scope/name` a listing printed.',
      inputSchema: z.object({ names: z.array(z.string().min(1)).min(1) }),
      annotations: { readOnlyHint: true },
    },
    async ({ names }) =>
      callResearch(options, 'research_read', async (research) => {
        const docs = await research.read(names)
        return docs.ok ? renderResearchDocs(docs.value) : docs
      }),
  )

  server.registerTool(
    'research_list',
    {
      title: 'List recorded research',
      description: 'Every recorded question with its scope, how many rounds it has and when it was last revisited.',
      inputSchema: z.object({ scopes: z.array(z.string()).optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ scopes }) =>
      callResearch(options, 'research_list', async (research) => renderResearchList(await research.list(scopes))),
  )

  return server
}

export async function startStdioServer(options: ServerOptions): Promise<void> {
  await serveStdio(() => createServer(options))
  // stdout carries JSON-RPC and nothing else.
  console.error(`knowledge MCP server ready (store: ${options.storeRoot})`)
}

async function call(
  options: ServerOptions,
  tool: string,
  run: (store: Store) => Promise<ToolOutput>,
): Promise<CallToolResult> {
  const started = Date.now()
  const result = await attempt(options.storeRoot, run)

  await record(options.storeRoot, {
    at: new Date().toISOString(),
    source: 'mcp',
    name: tool,
    ok: result.isError !== true,
    ms: Date.now() - started,
    ...(result.detail === undefined ? {} : { detail: result.detail }),
  })

  return { content: result.content, ...(result.isError === true ? { isError: true } : {}) }
}

async function callResearch(
  options: ServerOptions,
  tool: string,
  run: (research: ResearchStore) => Promise<ToolOutput>,
): Promise<CallToolResult> {
  const started = Date.now()
  const result = await attemptResearch(options.storeRoot, run)

  await record(options.storeRoot, {
    at: new Date().toISOString(),
    source: 'mcp',
    name: tool,
    ok: result.isError !== true,
    ms: Date.now() - started,
    ...(result.detail === undefined ? {} : { detail: result.detail }),
  })

  return { content: result.content, ...(result.isError === true ? { isError: true } : {}) }
}

async function attemptResearch(
  root: string,
  run: (research: ResearchStore) => Promise<ToolOutput>,
): Promise<CallToolResult & { detail?: string }> {
  try {
    return toResult(await run(ResearchStore.open(root)))
  } catch (cause) {
    return toolError(cause instanceof Error ? cause.message : String(cause))
  }
}

function toResult(output: ToolOutput): CallToolResult & { detail?: string } {
  if (typeof output === 'string') return { content: [{ type: 'text', text: output }] }
  if ('text' in output) return { content: [{ type: 'text', text: output.text }], detail: output.detail }
  return toolError(formatError(output.error))
}

async function attempt(
  root: string,
  run: (store: Store) => Promise<ToolOutput>,
): Promise<CallToolResult & { detail?: string }> {
  const store = await Store.open(root)
  if (!store.ok) return toolError(formatError(store.error))

  try {
    return toResult(await run(store.value))
  } catch (cause) {
    return toolError(cause instanceof Error ? cause.message : String(cause))
  }
}

function toolError(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] }
}
