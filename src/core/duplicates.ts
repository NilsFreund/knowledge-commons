import { similarity } from './similarity.ts'
import { duplicateKey, entryId, type Entry } from './types.ts'

const CANDIDATE_LIMIT = 5

export interface Candidate {
  readonly id: string
  readonly name: string
  readonly scope: string
  readonly description: string
  readonly score: number
}

export interface DuplicatePair {
  readonly a: Entry
  readonly b: Entry
  readonly score: number
}

export function findCandidates(
  input: { name: string; description: string; body: string },
  entries: readonly Entry[],
  threshold: number,
): readonly Candidate[] {
  return entries
    .map((entry) => ({ entry, score: similarity(input, entry) }))
    .filter((hit) => hit.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATE_LIMIT)
    .map(({ entry, score }) => ({
      id: entryId(entry),
      name: entry.name,
      scope: entry.scope,
      description: entry.description,
      score,
    }))
}

export function findNearDuplicates(
  entries: readonly Entry[],
  threshold: number,
  dismissed: readonly (readonly [string, string])[],
): readonly DuplicatePair[] {
  const ignored = new Set(dismissed.map(([a, b]) => duplicateKey(a, b)))
  const pairs: DuplicatePair[] = []

  for (const [index, a] of entries.entries()) {
    for (const b of entries.slice(index + 1)) {
      if (ignored.has(duplicateKey(a.name, b.name))) continue
      const score = similarity(a, b)
      if (score >= threshold) pairs.push({ a, b, score })
    }
  }

  return pairs
}
