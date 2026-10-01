import { buildWeights, similarityOfTokens, tokensOf, type SimilarityInput } from './similarity.ts'
import { duplicateKey, entryId, type Entry } from './types.ts'

const CANDIDATE_LIMIT = 5
const NEAREST_LIMIT = 3

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

export function findCandidates(input: SimilarityInput, entries: readonly Entry[], threshold: number): readonly Candidate[] {
  return ranked(input, entries)
    .filter((candidate) => candidate.score >= threshold)
    .slice(0, CANDIDATE_LIMIT)
}

/** A contradiction in other words stays below the threshold but still ranks first, so it is shown without blocking the write. */
export function findNearest(input: SimilarityInput, entries: readonly Entry[]): readonly Candidate[] {
  return ranked(input, entries)
    .filter((candidate) => candidate.score > 0)
    .slice(0, NEAREST_LIMIT)
}

function ranked(input: SimilarityInput, entries: readonly Entry[]): readonly Candidate[] {
  const weights = buildWeights([...entries, input])
  const inputTokens = tokensOf(input)

  return entries
    .map((entry) => ({
      id: entryId(entry),
      name: entry.name,
      scope: entry.scope,
      description: entry.description,
      score: similarityOfTokens(inputTokens, tokensOf(entry), weights),
    }))
    .sort((a, b) => b.score - a.score)
}

export function findNearDuplicates(
  entries: readonly Entry[],
  threshold: number,
  dismissed: readonly (readonly [string, string])[],
): readonly DuplicatePair[] {
  const ignored = new Set(dismissed.map(([a, b]) => duplicateKey(a, b)))
  const weights = buildWeights(entries)
  const tokenized = entries.map((entry) => ({ entry, tokens: tokensOf(entry) }))
  const pairs: DuplicatePair[] = []

  for (const [index, a] of tokenized.entries()) {
    for (const b of tokenized.slice(index + 1)) {
      if (ignored.has(duplicateKey(a.entry.name, b.entry.name))) continue
      const score = similarityOfTokens(a.tokens, b.tokens, weights)
      if (score >= threshold) pairs.push({ a: a.entry, b: b.entry, score })
    }
  }

  return pairs
}
