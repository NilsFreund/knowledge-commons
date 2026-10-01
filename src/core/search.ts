import { normalize, STOPWORDS } from './text.ts'

export interface Searchable {
  readonly name: string
  readonly description: string
  readonly body: string
}

export interface Scored<T> {
  readonly item: T
  readonly score: number
}

const FIELDS = ['name', 'description', 'body'] as const
const FIELD_WEIGHTS = { name: 3, description: 2, body: 1 } as const
const SATURATION = 1.2
const LENGTH_NORMALIZATION = 0.75
const MIN_TERM_LENGTH = 2
/** `pr` begins a word in 75 of 81 entries of a real store, so a short term has to match whole. */
const MIN_PREFIX_LENGTH = 4
/** `call` finding `caller` is as often a different word as an inflection. */
const PREFIX_WEIGHT = 0.5

type Field = (typeof FIELDS)[number]
type Words = Readonly<Record<Field, readonly string[]>>

/** BM25F scaled by the best score the query could reach, so one threshold fits every query. */
export function searchScores<T extends Searchable>(query: string, items: readonly T[]): readonly Scored<T>[] {
  const terms = tokenize(query)
  const documents = items.map((item) => ({ item, words: wordsOf(item) }))
  const averages = averageLengths(documents.map((document) => document.words))

  const matched = documents.map(({ item, words }) => ({
    item,
    frequencies: new Map(terms.map((term) => [term, termFrequency(words, term, averages)])),
  }))

  const weights = new Map(terms.map((term) => [term, rarity(containing(matched, term), items.length)]))
  const possible = sum([...weights.values()])

  return matched.map(({ item, frequencies }) => {
    if (possible === 0) return { item, score: 0 }
    const earned = sum(terms.map((term) => (weights.get(term) ?? 0) * saturate(frequencies.get(term) ?? 0)))
    return { item, score: round(earned / possible) }
  })
}

export function tokenize(query: string): readonly string[] {
  const terms = normalize(query)
    .split(' ')
    .filter((term) => term.length >= MIN_TERM_LENGTH && !STOPWORDS.has(term))
  return [...new Set(terms)]
}

function wordsOf(item: Searchable): Words {
  return {
    name: normalize(item.name.replaceAll('-', ' ')).split(' '),
    description: normalize(item.description).split(' '),
    body: normalize(item.body).split(' '),
  }
}

function containing(documents: readonly { frequencies: ReadonlyMap<string, number> }[], term: string): number {
  return documents.filter((document) => (document.frequencies.get(term) ?? 0) > 0).length
}

function averageLengths(documents: readonly Words[]): Readonly<Record<Field, number>> {
  const average = (field: Field) => sum(documents.map((words) => words[field].length)) / Math.max(documents.length, 1)
  return { name: average('name'), description: average('description'), body: average('body') }
}

/** Field weights apply before saturation, so a hit in the name counts as three hits in the body. */
function termFrequency(words: Words, term: string, averages: Readonly<Record<Field, number>>): number {
  return sum(
    FIELDS.map((field) => {
      const relativeLength = averages[field] === 0 ? 1 : words[field].length / averages[field]
      const lengthFactor = 1 - LENGTH_NORMALIZATION + LENGTH_NORMALIZATION * relativeLength
      return (FIELD_WEIGHTS[field] * occurrences(words[field], term)) / lengthFactor
    }),
  )
}

/** A term has to begin a word: `reco` finds `recording`, `art` does not find `restart`. */
function occurrences(words: readonly string[], term: string): number {
  return sum(words.map((word) => credit(word, term)))
}

function credit(word: string, term: string): number {
  if (word === term) return 1
  if (term.length >= MIN_PREFIX_LENGTH && word.startsWith(term)) return PREFIX_WEIGHT
  return 0
}

/** A term nothing contains weighs zero, so an unknown word in the query does not lower every score. */
function rarity(matching: number, size: number): number {
  return matching === 0 ? 0 : Math.log(1 + (size - matching + 0.5) / (matching + 0.5))
}

function saturate(frequency: number): number {
  return frequency / (SATURATION + frequency)
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
