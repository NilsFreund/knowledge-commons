import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

export interface DiscoveredSource {
  readonly agent: 'claude' | 'codex'
  readonly path: string
  readonly items: number
  readonly repo?: string
  readonly scope?: string
}

const CLAUDE_PROJECTS = ['.claude', 'projects']
const CODEX_MEMORY = ['.codex', 'memories', 'MEMORY.md']
const CODEX_SECTION = /^##\s+(User preferences|Reusable knowledge|Failures and how to do differently)\s*$/

export async function discoverSources(home: string): Promise<readonly DiscoveredSource[]> {
  return [...(await discoverClaude(home)), ...(await discoverCodex(home))]
}

async function discoverClaude(home: string): Promise<readonly DiscoveredSource[]> {
  const projects = join(home, ...CLAUDE_PROJECTS)
  if (!existsSync(projects)) return []

  const found: DiscoveredSource[] = []
  for (const slug of (await readdir(projects)).sort()) {
    const path = join(projects, slug, 'memory')
    const items = await countEntries(path)
    if (items === 0) continue

    const repo = resolveSlug(slug)
    found.push({ agent: 'claude', path, items, ...(repo === undefined ? {} : { repo, scope: basename(repo) }) })
  }

  return withUniqueScopes(found)
}

async function discoverCodex(home: string): Promise<readonly DiscoveredSource[]> {
  const path = join(home, ...CODEX_MEMORY)
  if (!existsSync(path)) return []

  const raw = await readFile(path, 'utf8')
  const items = raw.split('\n').filter((line) => CODEX_SECTION.test(line)).length
  return items === 0 ? [] : [{ agent: 'codex', path, items }]
}

async function countEntries(dir: string): Promise<number> {
  try {
    if (!(await stat(dir)).isDirectory()) return 0
    return (await readdir(dir)).filter((file) => file.endsWith('.md') && file !== 'MEMORY.md').length
  } catch {
    return 0
  }
}

/** A hyphen in a repository name makes the slug ambiguous, so candidates are walked, not decoded. */
export function resolveSlug(slug: string, exists: (path: string) => boolean = existsSync): string | undefined {
  const parts = slug.split('-').filter(Boolean)
  return parts.length === 0 ? undefined : walk('/', parts, exists)
}

function walk(base: string, parts: readonly string[], exists: (path: string) => boolean): string | undefined {
  if (parts.length === 0) return base

  for (let take = 1; take <= parts.length; take += 1) {
    const next = join(base, parts.slice(0, take).join('-'))
    if (!exists(next)) continue

    const resolved = walk(next, parts.slice(take), exists)
    if (resolved !== undefined) return resolved
  }

  return undefined
}

/** Two repositories can share a basename, and a scope name has to be unique across the store. */
function withUniqueScopes(sources: readonly DiscoveredSource[]): readonly DiscoveredSource[] {
  const counts = new Map<string, number>()
  for (const source of sources) {
    if (source.scope !== undefined) counts.set(source.scope, (counts.get(source.scope) ?? 0) + 1)
  }

  return sources.map((source) => {
    if (source.scope === undefined || (counts.get(source.scope) ?? 0) < 2 || source.repo === undefined) return source
    return { ...source, scope: qualify(source.repo) }
  })
}

function qualify(repo: string): string {
  const parts = repo.split('/').filter(Boolean)
  return parts.slice(-2).join('-').toLowerCase()
}
