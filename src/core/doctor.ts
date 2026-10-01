import { extractMalformedLinks } from './entry-file.ts'
import { findNearDuplicates } from './duplicates.ts'
import type { KnowledgeError } from './result.ts'
import { entryId, type Entry, type StoreConfig } from './types.ts'

export interface Diagnostic {
  readonly level: 'error' | 'warning'
  readonly message: string
}

export interface DiagnoseInput {
  readonly entries: readonly Entry[]
  readonly problems: readonly KnowledgeError[]
  readonly config: StoreConfig
  /** Names of research documents, so a link into research is not reported as broken. */
  readonly researchNames?: readonly string[]
}

export function diagnose({ entries, problems, config, researchNames = [] }: DiagnoseInput): readonly Diagnostic[] {
  const byName = groupByName(entries)
  const linkable = new Set([...byName.keys(), ...researchNames])

  return [
    ...problems.map(toDiagnostic),
    ...ambiguousNames(byName),
    ...brokenLinks(entries, linkable),
    ...nearDuplicates(entries, config),
    ...staleDismissals(config, byName),
  ]
}

function groupByName(entries: readonly Entry[]): ReadonlyMap<string, readonly Entry[]> {
  const byName = new Map<string, Entry[]>()
  for (const entry of entries) {
    byName.set(entry.name, [...(byName.get(entry.name) ?? []), entry])
  }
  return byName
}

function toDiagnostic(problem: KnowledgeError): Diagnostic {
  return { level: 'error', message: [problem.message, ...(problem.detail ?? [])].join(' - ') }
}

function ambiguousNames(byName: ReadonlyMap<string, readonly Entry[]>): readonly Diagnostic[] {
  return [...byName]
    .filter(([, entries]) => entries.length > 1)
    .map(([name, entries]) => ({
      level: 'error' as const,
      message: `\`${name}\` exists in ${entries.length} scopes (${entries.map((entry) => entry.scope).join(', ')}); wikilinks cannot address it`,
    }))
}

function brokenLinks(entries: readonly Entry[], linkable: ReadonlySet<string>): readonly Diagnostic[] {
  return entries.flatMap((entry) => [
    ...entry.links
      .filter((link) => !linkable.has(link))
      .map((link) => ({ level: 'warning' as const, message: `${entryId(entry)}: broken link [[${link}]]` })),
    ...extractMalformedLinks(entry.body).map((link) => ({
      level: 'warning' as const,
      message: `${entryId(entry)}: [[${link}]] is not a valid entry name`,
    })),
  ])
}

function nearDuplicates(entries: readonly Entry[], config: StoreConfig): readonly Diagnostic[] {
  return findNearDuplicates(entries, config.dedupeThreshold, config.dismissedDuplicates).map(({ a, b, score }) => ({
    level: 'warning' as const,
    message: `overlap (${score.toFixed(2)}): ${entryId(a)} and ${entryId(b)} may say the same thing or the opposite. Merge a repeat, resolve a contradiction, or \`kn doctor --dismiss ${a.name} ${b.name}\` if they are unrelated`,
  }))
}

function staleDismissals(config: StoreConfig, byName: ReadonlyMap<string, readonly Entry[]>): readonly Diagnostic[] {
  return config.dismissedDuplicates
    .map((pair) => ({ pair, missing: pair.filter((name) => !byName.has(name)) }))
    .filter(({ missing }) => missing.length > 0)
    .map(({ pair, missing }) => ({
      level: 'warning' as const,
      message: `stale dismissal for ${pair[0]} and ${pair[1]}: ${missing.join(' and ')} no longer exists`,
    }))
}
