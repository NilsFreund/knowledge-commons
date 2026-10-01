import { normalize, STOPWORDS } from './text.ts'
import { ENTRY_TYPES } from './types.ts'

const BODY_HEAD_CHARS = 400
const MIN_TOKEN_LENGTH = 3
const JACCARD_WEIGHT = 0.5
const WIKILINK_PATTERN = /\[\[[^\]]*\]\]/g
const TYPE_PREFIX = new RegExp(`^(${ENTRY_TYPES.join('|')})-`)

export interface SimilarityInput {
  readonly name: string
  readonly description: string
  readonly body: string
}

export interface TermWeights {
  readonly of: (token: string) => number
}

export const UNIFORM_WEIGHTS: TermWeights = { of: () => 1 }

/** Words most of the store shares, such as the domain it is about, say little about whether two entries agree. */
export function buildWeights(corpus: readonly SimilarityInput[]): TermWeights {
  const documentFrequency = new Map<string, number>()
  for (const input of corpus) {
    for (const token of tokensOf(input)) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1)
  }

  const size = corpus.length
  return { of: (token) => Math.log((size + 1) / ((documentFrequency.get(token) ?? 0) + 1)) + 1 }
}

export function tokensOf(input: SimilarityInput): ReadonlySet<string> {
  return contentTokens(comparableText(input))
}

/** Content words, not character n-grams: n-grams put a true match at 0.26 and a false one at 0.22. */
export function similarity(a: SimilarityInput, b: SimilarityInput, weights: TermWeights = UNIFORM_WEIGHTS): number {
  return similarityOfTokens(tokensOf(a), tokensOf(b), weights)
}

export function similarityOfTokens(a: ReadonlySet<string>, b: ReadonlySet<string>, weights: TermWeights): number {
  const shared = weightOf(intersection(a, b), weights)
  if (shared === 0) return 0

  const totalA = weightOf(a, weights)
  const totalB = weightOf(b, weights)
  const jaccard = shared / (totalA + totalB - shared)
  const overlap = shared / Math.min(totalA, totalB)
  return round(JACCARD_WEIGHT * jaccard + (1 - JACCARD_WEIGHT) * overlap)
}

function weightOf(tokens: Iterable<string>, weights: TermWeights): number {
  let total = 0
  for (const token of tokens) total += weights.of(token)
  return total
}

function comparableText(input: SimilarityInput): string {
  const body = input.body.replace(WIKILINK_PATTERN, ' ').slice(0, BODY_HEAD_CHARS)
  return `${input.name.replace(TYPE_PREFIX, '').replaceAll('-', ' ')} ${input.description} ${body}`
}

export function contentTokens(text: string): ReadonlySet<string> {
  const tokens = new Set<string>()
  for (const word of normalize(text).split(' ')) {
    if (word.length < MIN_TOKEN_LENGTH || STOPWORDS.has(word)) continue
    tokens.add(stem(word))
  }
  return tokens
}

/** Folds plurals and a final `e`, so `entries` meets `entry` and `caches` meets `cache`. */
function stem(word: string): string {
  if (word.length < 4) return word
  return singular(word).replace(/y$/, 'i').replace(/e$/, '')
}

function singular(word: string): string {
  if (word.endsWith('ies')) return `${word.slice(0, -3)}i`
  if (word.endsWith('ss')) return word
  if (word.endsWith('s')) return word.slice(0, -1)
  return word
}

function intersection(a: ReadonlySet<string>, b: ReadonlySet<string>): readonly string[] {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  return [...small].filter((token) => large.has(token))
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
