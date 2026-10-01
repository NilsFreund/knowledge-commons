const BODY_HEAD_CHARS = 400
const MIN_TOKEN_LENGTH = 3
const JACCARD_WEIGHT = 0.5
const WIKILINK_PATTERN = /\[\[[^\]]*\]\]/g

export interface SimilarityInput {
  readonly name: string
  readonly description: string
  readonly body: string
}

/** Content words, not character n-grams: n-grams put a true match at 0.26 and a false one at 0.22. */
export function similarity(a: SimilarityInput, b: SimilarityInput): number {
  const tokensA = contentTokens(comparableText(a))
  const tokensB = contentTokens(comparableText(b))
  const shared = intersectionSize(tokensA, tokensB)
  if (shared === 0) return 0

  const jaccard = shared / (tokensA.size + tokensB.size - shared)
  const overlap = shared / Math.min(tokensA.size, tokensB.size)
  return round(JACCARD_WEIGHT * jaccard + (1 - JACCARD_WEIGHT) * overlap)
}

function comparableText(input: SimilarityInput): string {
  const body = input.body.replace(WIKILINK_PATTERN, ' ').slice(0, BODY_HEAD_CHARS)
  return `${input.name.replaceAll('-', ' ')} ${input.description} ${body}`
}

/** Marks are dropped rather than replaced, so `prüfen` folds to `prufen` instead of splitting in two. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replaceAll('ß', 'ss')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function contentTokens(text: string): ReadonlySet<string> {
  const tokens = new Set<string>()
  for (const word of normalize(text).split(' ')) {
    if (word.length < MIN_TOKEN_LENGTH || STOPWORDS.has(word)) continue
    tokens.add(singularize(word))
  }
  return tokens
}

function singularize(word: string): string {
  return word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word
}

function intersectionSize(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let shared = 0
  for (const token of small) {
    if (large.has(token)) shared += 1
  }
  return shared
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

const STOPWORDS: ReadonlySet<string> = new Set(
  `the and but for with from this that these those are was were been being does did doing not never only
   also very can could should would will shall may might must there here when while what which who whom
   whose how why you your yours our its into they them their his her mine one two all any each every some
   such own same too just more most other others always than then
   der die das den dem des ein eine einen einem eines und oder aber wenn dann als wie was wer wo wann
   nicht nie immer noch schon nur auch sehr kann könnte soll sollte muss müssen wird werden wurde worden
   sind ist war waren sein seine ihre ihren für mit von bei aus nach über unter vor durch gegen ohne
   man sich selbst dass weil damit sodass bitte`
    .split(/\s+/)
    .filter(Boolean),
)
