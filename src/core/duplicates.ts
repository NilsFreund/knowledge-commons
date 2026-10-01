import { buildWeights, similarityOfTokens, tokensOf } from './similarity.ts'
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
  const weights = buildWeights([...entries, input])
  const inputTokens = tokensOf(input)

  return entries
    .map((entry) => ({ entry, score: similarityOfTokens(inputTokens, tokensOf(entry), weights) }))
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
