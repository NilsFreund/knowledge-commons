import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { z } from 'zod'
import { err, ok, type Result } from './result.ts'
import { frontmatterSchema, type Entry, type Frontmatter } from './types.ts'

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*\r?\n?/
const WIKILINK_PATTERN = /\[\[([a-z0-9]+(?:-[a-z0-9]+)*)\]\]/g
const ANY_BRACKET_PATTERN = /\[\[([^\]\n]*)\]\]/g

export function parseEntryFile(raw: string, scope: string, path: string): Result<Entry> {
  const match = FRONTMATTER_PATTERN.exec(raw)
  if (!match?.[1]) {
    return err('invalid_entry', `${path}: missing YAML frontmatter`)
  }

  let parsed: unknown
  try {
    parsed = parseYaml(match[1])
  } catch (cause) {
    return err('invalid_entry', `${path}: frontmatter is not valid YAML`, [String(cause)])
  }

  const frontmatter = frontmatterSchema.safeParse(parsed)
  if (!frontmatter.success) {
    return err('invalid_entry', `${path}: invalid frontmatter`, formatIssues(frontmatter.error))
  }

  const body = raw.slice(match[0].length).trim()
  if (body.length === 0) {
    return err('invalid_entry', `${path}: body is empty`)
  }

  return ok({ ...frontmatter.data, scope, body, links: extractLinks(body), path })
}

export function serializeEntryFile(frontmatter: Frontmatter, body: string): string {
  const ordered: Frontmatter = {
    name: frontmatter.name,
    description: frontmatter.description,
    type: frontmatter.type,
    created: frontmatter.created,
    updated: frontmatter.updated,
    sources: frontmatter.sources,
  }
  return `---\n${stringifyYaml(ordered, { lineWidth: 0 })}---\n\n${body.trim()}\n`
}

export function extractLinks(body: string): readonly string[] {
  const links = new Set<string>()
  for (const match of body.matchAll(WIKILINK_PATTERN)) {
    if (match[1]) links.add(match[1])
  }
  return [...links]
}

export function extractMalformedLinks(body: string): readonly string[] {
  const valid = new Set(extractLinks(body))
  const malformed = new Set<string>()
  for (const match of body.matchAll(ANY_BRACKET_PATTERN)) {
    const target = match[1] ?? ''
    if (!valid.has(target)) malformed.add(target)
  }
  return [...malformed]
}

function formatIssues(error: z.ZodError): readonly string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.')
    return path ? `${path}: ${issue.message}` : issue.message
  })
}
