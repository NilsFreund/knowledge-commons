import { z } from 'zod'

export const ENTRY_TYPES = ['feedback', 'project', 'reference', 'user'] as const
export type EntryType = (typeof ENTRY_TYPES)[number]

/** Unique across the whole store: `[[wikilinks]]` address an entry by name alone. */
const nameSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be kebab-case (lowercase letters, digits and single hyphens)')

const dateSchema = z.iso.date()

const scopeSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be kebab-case')

export const frontmatterSchema = z.object({
  name: nameSchema,
  description: z.string().min(1).max(300),
  type: z.enum(ENTRY_TYPES),
  created: dateSchema,
  updated: dateSchema,
  sources: z.array(z.string().min(1)).default([]),
})

export type Frontmatter = z.infer<typeof frontmatterSchema>

export interface Entry extends Frontmatter {
  /** Taken from the containing directory, never from frontmatter, so it cannot drift. */
  readonly scope: string
  readonly body: string
  readonly links: readonly string[]
  readonly path: string
}

export function entryId(entry: Pick<Entry, 'scope' | 'name'>): string {
  return `${entry.scope}/${entry.name}`
}

export interface IndexRow {
  readonly id: string
  readonly name: string
  readonly scope: string
  readonly type: EntryType
  readonly description: string
}

export function toIndexRow(entry: Entry): IndexRow {
  return { id: entryId(entry), name: entry.name, scope: entry.scope, type: entry.type, description: entry.description }
}

export const scopeRuleSchema = z.object({
  scope: scopeSchema,
  inherits: z.array(scopeSchema).default([]),
})

export type ScopeRule = z.infer<typeof scopeRuleSchema>

export const DEFAULT_SCOPE = 'global'
export const DEFAULT_DEDUPE_THRESHOLD = 0.22

export const configSchema = z.object({
  scopes: z.record(z.string(), scopeRuleSchema).default({}),
  dedupeThreshold: z.number().min(0).max(1).default(DEFAULT_DEDUPE_THRESHOLD),
  /** Pairs judged different on review; detection is tuned for recall, so `doctor` needs this to converge. */
  dismissedDuplicates: z.array(z.tuple([z.string(), z.string()])).default([]),
})

export function duplicateKey(a: string, b: string): string {
  return [a, b].sort().join('\u0000')
}

export type StoreConfig = z.infer<typeof configSchema>
