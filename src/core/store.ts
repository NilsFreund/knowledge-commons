import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { loadConfig } from './config.ts'
import { diagnose, type Diagnostic } from './doctor.ts'
import { findCandidates, type Candidate } from './duplicates.ts'
import { parseEntryFile, serializeEntryFile } from './entry-file.ts'
import { listPrompts, readPrompt } from './prompts.ts'
import { err, ok, type KnowledgeError, type Result } from './result.ts'
import { searchScore } from './search.ts'
import { withWriteLock, writeFileAtomic } from './write.ts'
import { findInstructionFiles } from './instructions.ts'
import { resolveScope } from './scope.ts'
import { entryId, frontmatterSchema, toIndexRow, type Entry, type IndexRow, type StoreConfig } from './types.ts'

const CONTEXT_QUERY_THRESHOLD = 0.34
const CONTEXT_QUERY_LIMIT = 10
const SEARCH_LIMIT = 20

/** Below this a hit rests on one query term appearing somewhere, which buries the real matches. */
const MIN_SEARCH_SCORE = 0.1

export const writeInputSchema = frontmatterSchema
  .pick({ name: true, description: true, type: true })
  .extend({
    scope: z.string().min(1),
    body: z.string().min(1),
    sources: z.array(z.string().min(1)).default([]),
    confirm: z.boolean().default(false),
    updateName: z.string().optional(),
  })

export type WriteInput = z.input<typeof writeInputSchema>
type ValidatedWriteInput = z.output<typeof writeInputSchema>

export type WriteOutcome =
  | { readonly status: 'candidates'; readonly candidates: readonly Candidate[] }
  | { readonly status: 'created'; readonly entry: Entry }
  | { readonly status: 'updated'; readonly entry: Entry; readonly previous: Entry }

export interface LoadedEntries {
  readonly entries: readonly Entry[]
  readonly problems: readonly KnowledgeError[]
}

export interface ContextResult {
  readonly scopes: readonly string[]
  readonly index: readonly IndexRow[]
  readonly included: readonly Entry[]
  readonly repoRoot?: string
  readonly instructionFiles: readonly string[]
}

export interface SearchHit {
  readonly entry: Entry
  readonly score: number
}

export interface SearchOptions {
  readonly scopes?: readonly string[]
  readonly limit?: number
}

export interface ContextInput {
  readonly cwd: string
  readonly query?: string
}

export interface StoreOptions {
  readonly today?: () => string
}

export class Store {
  private constructor(
    readonly root: string,
    readonly config: StoreConfig,
    private readonly today: () => string,
  ) {}

  static async open(root: string, options: StoreOptions = {}): Promise<Result<Store>> {
    const resolved = resolve(root)
    if (!(await isDirectory(join(resolved, 'knowledge')))) {
      return err('store_not_found', `no knowledge store at ${resolved}`, ['run `kn init` to create one'])
    }

    const config = await loadConfig(resolved)
    return config.ok ? ok(new Store(resolved, config.value, options.today ?? isoToday)) : config
  }

  get knowledgeDir(): string {
    return join(this.root, 'knowledge')
  }

  get commandsDir(): string {
    return join(this.root, 'commands')
  }

  /** Re-read on every call: the store is small, and a long-lived server would otherwise serve stale entries. */
  async load(): Promise<LoadedEntries> {
    const entries: Entry[] = []
    const problems: KnowledgeError[] = []

    for (const scope of await this.listScopes()) {
      for (const file of await this.entryFiles(scope)) {
        const path = join(this.knowledgeDir, scope, file)
        const parsed = parseEntryFile(await readFile(path, 'utf8'), scope, path)

        if (!parsed.ok) problems.push(parsed.error)
        else if (`${parsed.value.name}.md` !== file) {
          problems.push({
            code: 'invalid_entry',
            message: `${path}: filename does not match frontmatter name \`${parsed.value.name}\``,
          })
        } else entries.push(parsed.value)
      }
    }

    return { entries, problems }
  }

  async listScopes(): Promise<readonly string[]> {
    const dirents = await readdir(this.knowledgeDir, { withFileTypes: true })
    return dirents
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)
      .sort()
  }

  /** Accepts the bare name and the `scope/name` an index prints, because callers copy what they were shown. */
  async read(names: readonly string[]): Promise<Result<readonly Entry[]>> {
    const { entries } = await this.load()
    const byName = new Map<string, Entry>()
    for (const entry of entries) {
      byName.set(entry.name, entry)
      byName.set(entryId(entry), entry)
    }

    const found: Entry[] = []
    const missing: string[] = []
    for (const name of names) {
      const entry = byName.get(name)
      if (entry) found.push(entry)
      else missing.push(name)
    }

    return missing.length > 0
      ? err('entry_not_found', `unknown ${missing.length === 1 ? 'entry' : 'entries'}`, missing)
      : ok(found)
  }

  async search(query: string, options: SearchOptions = {}): Promise<readonly SearchHit[]> {
    const { entries } = await this.load()
    const scopes = options.scopes
    return score(scopes ? entries.filter((entry) => scopes.includes(entry.scope)) : entries, query, MIN_SEARCH_SCORE)
      .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
      .slice(0, options.limit ?? SEARCH_LIMIT)
  }

  async context({ cwd, query }: ContextInput): Promise<ContextResult> {
    const { scopes, root } = resolveScope(cwd, this.config)
    const instructionFiles = root === undefined ? [] : await findInstructionFiles(root)
    const { entries } = await this.load()
    const inScope = entries
      .filter((entry) => scopes.includes(entry.scope))
      .sort((a, b) => scopes.indexOf(a.scope) - scopes.indexOf(b.scope) || a.name.localeCompare(b.name))

    const inline = new Set(inScope.filter((entry) => entry.type === 'feedback').map((entry) => entry.name))
    if (query !== undefined) {
      for (const hit of matching(inScope, query)) inline.add(hit.entry.name)
    }

    return {
      scopes,
      index: inScope.map(toIndexRow),
      included: inScope.filter((entry) => inline.has(entry.name)),
      ...(root === undefined ? {} : { repoRoot: root }),
      instructionFiles,
    }
  }

  /** Two-step on purpose: reporting look-alikes rather than writing them is what keeps copies out. */
  async write(rawInput: WriteInput): Promise<Result<WriteOutcome>> {
    try {
      return await withWriteLock(this.root, () => this.writeOne(rawInput))
    } catch (cause) {
      return err('io_failed', cause instanceof Error ? cause.message : String(cause))
    }
  }

  private async writeOne(rawInput: WriteInput): Promise<Result<WriteOutcome>> {
    const parsed = writeInputSchema.safeParse(rawInput)
    if (!parsed.success) {
      return err('invalid_entry', 'invalid entry', parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`))
    }

    const input = parsed.data
    const { entries } = await this.load()

    if (input.updateName !== undefined) {
      const previous = entries.find((entry) => entry.name === input.updateName)
      return previous
        ? await this.update(previous, input)
        : err('entry_not_found', `unknown entry \`${input.updateName}\``)
    }

    const taken = entries.find((entry) => entry.name === input.name)
    if (taken) {
      return err('entry_exists', `\`${input.name}\` already exists in scope \`${taken.scope}\``, [
        'pass updateName to merge into it, or choose a different name',
      ])
    }

    if (!input.confirm) {
      const candidates = findCandidates(input, entries, this.config.dedupeThreshold)
      if (candidates.length > 0) return ok({ status: 'candidates', candidates })
    }

    const today = this.today()
    const entry = await this.persist(input.scope, input.body, {
      name: input.name,
      description: input.description,
      type: input.type,
      created: today,
      updated: today,
      sources: input.sources,
    })
    return ok({ status: 'created', entry })
  }

  async readPrompt(name: string): Promise<Result<string>> {
    return await readPrompt(this.commandsDir, name)
  }

  async listPrompts(): Promise<readonly string[]> {
    return await listPrompts(this.commandsDir)
  }

  async doctor(researchNames: readonly string[] = []): Promise<readonly Diagnostic[]> {
    const { entries, problems } = await this.load()
    return diagnose({ entries, problems, config: this.config, researchNames })
  }

  private async update(previous: Entry, input: ValidatedWriteInput): Promise<Result<WriteOutcome>> {
    const entry = await this.persist(input.scope, input.body, {
      name: previous.name,
      description: input.description,
      type: input.type,
      created: previous.created,
      updated: this.today(),
      sources: [...new Set([...previous.sources, ...input.sources])],
    })

    if (previous.path !== entry.path) await rm(previous.path)
    return ok({ status: 'updated', entry, previous })
  }

  private async persist(scope: string, body: string, frontmatter: z.output<typeof frontmatterSchema>): Promise<Entry> {
    const dir = join(this.knowledgeDir, scope)
    await mkdir(dir, { recursive: true })

    const path = join(dir, `${frontmatter.name}.md`)
    const raw = serializeEntryFile(frontmatter, body)
    await writeFileAtomic(path, raw)

    const parsed = parseEntryFile(raw, scope, path)
    if (!parsed.ok) throw new Error(`wrote an entry that cannot be read back: ${parsed.error.message}`)
    return parsed.value
  }

  private async entryFiles(scope: string): Promise<readonly string[]> {
    const files = await readdir(join(this.knowledgeDir, scope))
    return files.filter((file) => file.endsWith('.md')).sort()
  }
}

function score(entries: readonly Entry[], query: string, minimum: number): SearchHit[] {
  return entries.map((entry) => ({ entry, score: searchScore(query, entry) })).filter((hit) => hit.score >= minimum)
}

function matching(entries: readonly Entry[], query: string): readonly SearchHit[] {
  return score(entries, query, CONTEXT_QUERY_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, CONTEXT_QUERY_LIMIT)
}

function isoToday(): string {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}
