import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { z } from 'zod'
import { err, ok, type KnowledgeError, type Result } from './result.ts'
import { searchScore } from './search.ts'
import { withWriteLock, writeFileAtomic } from './write.ts'

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*\r?\n?/
const SECTION_PATTERN = /^##[^\S\r\n]+(\d{4}-\d{2}-\d{2})[^\S\r\n]*$/gm
const MIN_SEARCH_SCORE = 0.1
const SEARCH_LIMIT = 20

export const researchFrontmatterSchema = z.object({
  name: z
    .string()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be kebab-case'),
  title: z.string().min(1).max(200),
  created: z.iso.date(),
  updated: z.iso.date(),
  sources: z.array(z.string().min(1)).default([]),
})

export type ResearchFrontmatter = z.infer<typeof researchFrontmatterSchema>

export interface ResearchSection {
  readonly date: string
  readonly body: string
}

export interface ResearchDoc extends ResearchFrontmatter {
  readonly scope: string
  readonly body: string
  readonly sections: readonly ResearchSection[]
  readonly path: string
}

export interface ResearchSummary {
  readonly id: string
  readonly name: string
  readonly scope: string
  readonly title: string
  readonly updated: string
  readonly rounds: number
}

export interface ResearchHit {
  readonly doc: ResearchDoc
  readonly score: number
}

export type ResearchOutcome =
  | { readonly status: 'created'; readonly doc: ResearchDoc }
  | { readonly status: 'appended'; readonly doc: ResearchDoc; readonly rounds: number }

export const researchWriteSchema = z.object({
  name: researchFrontmatterSchema.shape.name,
  title: researchFrontmatterSchema.shape.title,
  scope: z.string().min(1).default('global'),
  body: z.string().min(1),
  sources: z.array(z.string().min(1)).default([]),
})

export type ResearchWriteInput = z.input<typeof researchWriteSchema>

export function researchId(doc: Pick<ResearchDoc, 'scope' | 'name'>): string {
  return `${doc.scope}/${doc.name}`
}

export class ResearchStore {
  private constructor(
    readonly root: string,
    private readonly today: () => string,
  ) {}

  static open(root: string, today: () => string = isoToday): ResearchStore {
    return new ResearchStore(resolve(root), today)
  }

  get dir(): string {
    return join(this.root, 'research')
  }

  async load(): Promise<{ docs: readonly ResearchDoc[]; problems: readonly KnowledgeError[] }> {
    const docs: ResearchDoc[] = []
    const problems: KnowledgeError[] = []

    for (const scope of await this.scopes()) {
      for (const file of await this.files(scope)) {
        const path = join(this.dir, scope, file)
        const parsed = parseResearchFile(await readFile(path, 'utf8'), scope, path)

        if (!parsed.ok) problems.push(parsed.error)
        else if (`${parsed.value.name}.md` !== file) {
          problems.push({ code: 'invalid_entry', message: `${path}: filename does not match \`${parsed.value.name}\`` })
        } else docs.push(parsed.value)
      }
    }

    return { docs, problems }
  }

  async list(scopes?: readonly string[]): Promise<readonly ResearchSummary[]> {
    const { docs } = await this.load()
    return docs
      .filter((doc) => scopes === undefined || scopes.includes(doc.scope))
      .sort((a, b) => b.updated.localeCompare(a.updated) || a.name.localeCompare(b.name))
      .map(toSummary)
  }

  async search(query: string, options: { scopes?: readonly string[]; limit?: number } = {}): Promise<readonly ResearchHit[]> {
    const { docs } = await this.load()
    const scopes = options.scopes
    return docs
      .filter((doc) => scopes === undefined || scopes.includes(doc.scope))
      .map((doc) => ({ doc, score: searchScore(query, { name: doc.name, description: doc.title, body: doc.body }) }))
      .filter((hit) => hit.score >= MIN_SEARCH_SCORE)
      .sort((a, b) => b.score - a.score || a.doc.name.localeCompare(b.doc.name))
      .slice(0, options.limit ?? SEARCH_LIMIT)
  }

  /** Accepts the bare name and the `scope/name` a listing prints, because callers copy what they were shown. */
  async read(names: readonly string[]): Promise<Result<readonly ResearchDoc[]>> {
    const { docs } = await this.load()
    const byName = new Map<string, ResearchDoc>()
    for (const doc of docs) {
      byName.set(doc.name, doc)
      byName.set(researchId(doc), doc)
    }

    const found: ResearchDoc[] = []
    const missing: string[] = []
    for (const name of names) {
      const doc = byName.get(name)
      if (doc) found.push(doc)
      else missing.push(name)
    }

    return missing.length > 0 ? err('entry_not_found', 'unknown research', missing) : ok(found)
  }

  /** A repeat of the same question appends a dated round rather than replacing what was true before. */
  async write(rawInput: ResearchWriteInput): Promise<Result<ResearchOutcome>> {
    if (!(await isDirectory(this.root))) {
      return err('store_not_found', `no knowledge store at ${this.root}`, ['run `kn init` to create one'])
    }

    try {
      return await withWriteLock(this.root, () => this.writeOne(rawInput))
    } catch (cause) {
      return err('io_failed', cause instanceof Error ? cause.message : String(cause))
    }
  }

  private async writeOne(rawInput: ResearchWriteInput): Promise<Result<ResearchOutcome>> {
    const parsed = researchWriteSchema.safeParse(rawInput)
    if (!parsed.success) {
      return err('invalid_entry', 'invalid research', parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`))
    }

    const input = parsed.data
    const { docs } = await this.load()
    const existing = docs.find((doc) => doc.name === input.name)
    const today = this.today()
    const section = `## ${today}\n\n${input.body.trim()}`

    if (existing === undefined) {
      const doc = await this.persist(input.scope, section, {
        name: input.name,
        title: input.title,
        created: today,
        updated: today,
        sources: input.sources,
      })
      return ok({ status: 'created', doc })
    }

    const doc = await this.persist(existing.scope, `${existing.body}\n\n${section}`, {
      name: existing.name,
      title: input.title,
      created: existing.created,
      updated: today,
      sources: [...new Set([...existing.sources, ...input.sources])],
    })
    return ok({ status: 'appended', doc, rounds: doc.sections.length })
  }

  private async persist(scope: string, body: string, frontmatter: ResearchFrontmatter): Promise<ResearchDoc> {
    const dir = join(this.dir, scope)
    await mkdir(dir, { recursive: true })

    const path = join(dir, `${frontmatter.name}.md`)
    const raw = serializeResearchFile(frontmatter, body)
    await writeFileAtomic(path, raw)

    const parsed = parseResearchFile(raw, scope, path)
    if (!parsed.ok) throw new Error(`wrote research that cannot be read back: ${parsed.error.message}`)
    return parsed.value
  }

  private async scopes(): Promise<readonly string[]> {
    try {
      const dirents = await readdir(this.dir, { withFileTypes: true })
      return dirents
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name)
        .sort()
    } catch {
      return []
    }
  }

  private async files(scope: string): Promise<readonly string[]> {
    const files = await readdir(join(this.dir, scope))
    return files.filter((file) => file.endsWith('.md')).sort()
  }
}

export function parseResearchFile(raw: string, scope: string, path: string): Result<ResearchDoc> {
  const match = FRONTMATTER_PATTERN.exec(raw)
  if (!match?.[1]) return err('invalid_entry', `${path}: missing YAML frontmatter`)

  let parsed: unknown
  try {
    parsed = parseYaml(match[1])
  } catch (cause) {
    return err('invalid_entry', `${path}: frontmatter is not valid YAML`, [String(cause)])
  }

  const frontmatter = researchFrontmatterSchema.safeParse(parsed)
  if (!frontmatter.success) {
    return err('invalid_entry', `${path}: invalid frontmatter`, frontmatter.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`))
  }

  const body = raw.slice(match[0].length).trim()
  if (body.length === 0) return err('invalid_entry', `${path}: body is empty`)

  return ok({ ...frontmatter.data, scope, body, sections: parseSections(body), path })
}

export function serializeResearchFile(frontmatter: ResearchFrontmatter, body: string): string {
  const ordered: ResearchFrontmatter = {
    name: frontmatter.name,
    title: frontmatter.title,
    created: frontmatter.created,
    updated: frontmatter.updated,
    sources: frontmatter.sources,
  }
  return `---\n${stringifyYaml(ordered, { lineWidth: 0 })}---\n\n${body.trim()}\n`
}

export function parseSections(body: string): readonly ResearchSection[] {
  const headings = [...body.matchAll(SECTION_PATTERN)]
  return headings.flatMap((heading, index) => {
    const date = heading[1]
    if (date === undefined || heading.index === undefined) return []

    const start = heading.index + heading[0].length
    const end = headings[index + 1]?.index ?? body.length
    return [{ date, body: body.slice(start, end).trim() }]
  })
}

function toSummary(doc: ResearchDoc): ResearchSummary {
  return {
    id: researchId(doc),
    name: doc.name,
    scope: doc.scope,
    title: doc.title,
    updated: doc.updated,
    rounds: doc.sections.length,
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

function isoToday(): string {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}
