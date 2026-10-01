import { normalize } from './similarity.ts'

export interface Searchable {
  readonly name: string
  readonly description: string
  readonly body: string
}

const FIELD_WEIGHTS = { name: 3, description: 2, body: 1 } as const
const MAX_WEIGHT = FIELD_WEIGHTS.name + FIELD_WEIGHTS.description + FIELD_WEIGHTS.body
const MIN_TERM_LENGTH = 2

/** Term coverage rather than the overlap used for duplicates: a query is a few words, an entry is not. */
export function searchScore(query: string, entry: Searchable): number {
  const terms = tokenize(query)
  if (terms.length === 0) return 0

  const fields = {
    name: normalize(entry.name.replaceAll('-', ' ')),
    description: normalize(entry.description),
    body: normalize(entry.body),
  }

  let total = 0
  for (const term of terms) {
    const weight =
      (startsWord(fields.name, term) ? FIELD_WEIGHTS.name : 0) +
      (startsWord(fields.description, term) ? FIELD_WEIGHTS.description : 0) +
      (startsWord(fields.body, term) ? FIELD_WEIGHTS.body : 0)
    total += weight / MAX_WEIGHT
  }

  return round(total / terms.length)
}

/** A term has to begin a word: `rec` finds `recording`, `art` does not find `restart`. */
function startsWord(field: string, term: string): boolean {
  return field.startsWith(term) || field.includes(` ${term}`)
}

export function tokenize(query: string): readonly string[] {
  return normalize(query)
    .split(' ')
    .filter((term) => term.length > MIN_TERM_LENGTH - 1)
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
