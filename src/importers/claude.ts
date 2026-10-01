import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { ENTRY_TYPES, type EntryType } from '../core/index.ts'

export interface ImportedEntry {
  readonly name: string
  readonly description: string
  readonly type: EntryType
  readonly body: string
  readonly updated: string
  readonly sourceFile: string
}

export interface ClaudeImportResult {
  readonly entries: readonly ImportedEntry[]
  readonly problems: readonly string[]
  readonly rewrittenLinks: number
}

/** The index Claude regenerates from the other files; it holds no facts of its own. */
const INDEX_FILE = 'MEMORY.md'

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*\r?\n?/
const HEADING_PATTERN = /^#\s+(.+)$/m
const WIKILINK_PATTERN = /\[\[([^\]]+)\]\]/g
const MAX_DESCRIPTION = 300

const claudeFrontmatterSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  type: z.string().optional(),
  metadata: z.object({ type: z.string().optional(), modified: z.union([z.string(), z.date()]).optional() }).optional(),
})

type ClaudeFrontmatter = z.infer<typeof claudeFrontmatterSchema>

export async function importClaudeMemories(dir: string): Promise<ClaudeImportResult> {
  const parsed: ParsedFile[] = []
  const problems: string[] = []

  const files = (await readdir(dir)).filter((file) => file.endsWith('.md') && file !== INDEX_FILE).sort()
  for (const file of files) {
    const result = await parseMemoryFile(join(dir, file))
    if ('problem' in result) problems.push(result.problem)
    else parsed.push(result)
  }

  const { entries, rewrittenLinks } = resolveLinks(parsed)
  return { entries, problems, rewrittenLinks }
}

/** Such directories link by filename, by underscored filename and by frontmatter name, all at once. */
function resolveLinks(parsed: readonly ParsedFile[]): { entries: readonly ImportedEntry[]; rewrittenLinks: number } {
  const canonical = new Map<string, string>()
  for (const file of parsed) {
    for (const alias of file.aliases) canonical.set(alias, file.entry.name)
  }

  let rewrittenLinks = 0
  const entries = parsed.map((file) => {
    const body = file.entry.body.replace(WIKILINK_PATTERN, (match: string, target: string) => {
      const resolved = canonical.get(toKebabCase(target))
      if (resolved === undefined || resolved === target) return match
      rewrittenLinks += 1
      return `[[${resolved}]]`
    })
    return body === file.entry.body ? file.entry : { ...file.entry, body }
  })

  return { entries, rewrittenLinks }
}

interface ParsedFile {
  readonly entry: ImportedEntry
  readonly aliases: readonly string[]
}

async function parseMemoryFile(path: string): Promise<ParsedFile | { problem: string }> {
  const raw = await readFile(path, 'utf8')
  const match = FRONTMATTER_PATTERN.exec(raw)
  const frontmatter = match?.[1] === undefined ? {} : readFrontmatter(match[1])
  if (frontmatter === undefined) return { problem: `${path}: frontmatter could not be read` }

  const body = stripLeadingHeading(raw.slice(match?.[0].length ?? 0).trim())
  if (body.text.length === 0) return { problem: `${path}: empty body` }

  const filename = basename(path, '.md')
  const type = declaredType(frontmatter, filename)
  if (type === undefined || !isEntryType(type)) {
    return { problem: `${path}: no usable type in frontmatter or filename` }
  }

  const description = frontmatter.description ?? body.heading
  if (description === undefined) {
    return { problem: `${path}: no description in frontmatter and no heading to fall back to` }
  }

  const name = toKebabCase(filename)
  return {
    entry: {
      name,
      description: description.slice(0, MAX_DESCRIPTION),
      type,
      body: body.text,
      updated: await resolveUpdated(frontmatter.metadata?.modified, path),
      sourceFile: path,
    },
    aliases: [name, ...(frontmatter.name === undefined ? [] : [toKebabCase(frontmatter.name)])],
  }
}

function readFrontmatter(block: string): ClaudeFrontmatter | undefined {
  const parsed = claudeFrontmatterSchema.safeParse(tryYaml(block) ?? parseLooseFrontmatter(block))
  return parsed.success ? parsed.data : undefined
}

function tryYaml(block: string): unknown {
  try {
    const parsed: unknown = parseYaml(block)
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Recovers frontmatter YAML rejects, in practice an unquoted value containing a colon. */
function parseLooseFrontmatter(block: string): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  let nested: Record<string, unknown> | undefined

  for (const line of block.split('\n')) {
    const match = /^(\s*)([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line)
    if (!match) continue

    const [, indent = '', key = '', rawValue = ''] = match
    const value = unquote(rawValue.trim())
    if (value.length === 0) {
      if (indent.length === 0) {
        nested = {}
        root[key] = nested
      }
      continue
    }
    ;(indent.length > 0 && nested ? nested : root)[key] = value
  }

  return root
}

function unquote(value: string): string {
  const quoted = /^(["'])([\s\S]*)\1$/.exec(value)
  return quoted?.[2] ?? value
}

function stripLeadingHeading(body: string): { text: string; heading?: string } {
  const heading = HEADING_PATTERN.exec(body)
  if (!heading?.[1] || !body.startsWith('#')) return { text: body }
  return { text: body.replace(/^#\s+.+\n+/, '').trim(), heading: heading[1].trim() }
}

function declaredType(frontmatter: ClaudeFrontmatter, filename: string): string | undefined {
  if (frontmatter.metadata?.type !== undefined) return frontmatter.metadata.type
  if (frontmatter.type !== undefined) return frontmatter.type
  return typeFromFilename(filename)
}

function typeFromFilename(filename: string): string | undefined {
  return filename.split(/[_-]/)[0]
}

export function toKebabCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll('ß', 'ss')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

async function resolveUpdated(modified: string | Date | undefined, path: string): Promise<string> {
  if (modified instanceof Date) return toIsoDate(modified)
  if (typeof modified === 'string' && /^\d{4}-\d{2}-\d{2}/.test(modified)) return modified.slice(0, 10)
  return toIsoDate((await stat(path)).mtime)
}

function toIsoDate(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function isEntryType(value: string): value is EntryType {
  return ENTRY_TYPES.some((type) => type === value)
}
