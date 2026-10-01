import { describe, expect, test } from 'bun:test'
import { buildWeights, contentTokens, DEFAULT_DEDUPE_THRESHOLD, normalize, similarity, UNIFORM_WEIGHTS, type SimilarityInput } from '../src/core/index.ts'
import { COMMIT_MESSAGES, METRICS_DASHBOARD, NEVER_COMMIT, NEVER_COMMIT_REWORDED, SHORT_ANSWERS } from './fixtures.ts'

describe('normalize', () => {
  test('folds case, punctuation and accents into single-spaced words', () => {
    expect(normalize('Never --no-verify, ever!')).toBe('never no verify ever')
  })
})

describe('normalize', () => {
  test('folds an accent instead of splitting the word around it', () => {
    expect(normalize('prüfen')).toBe('prufen')
    expect(normalize('Änderungen müssen')).toBe('anderungen mussen')
  })

  test('folds the sharp s so both spellings of a word meet', () => {
    expect(normalize('Straße')).toBe(normalize('Strasse'))
    expect(normalize('Größe')).toBe('grosse')
  })
})

describe('contentTokens', () => {
  test('drops stopwords and short words in both English and German', () => {
    expect([...contentTokens('the user should not commit')]).toEqual(['user', 'commit'])
    expect([...contentTokens('der Nutzer soll nicht committen')]).toEqual(['nutzer', 'committen'])
  })

  test('keeps an accented word whole', () => {
    expect([...contentTokens('Änderungen prüfen')]).toEqual(['anderungen', 'prufen'])
  })

  test('folds plurals so one rule matches its own restatement', () => {
    expect(contentTokens('commits').has('commit')).toBe(true)
    expect(contentTokens('access').has('access')).toBe(true)
  })

  test.each([
    ['entries', 'entry'],
    ['caches', 'cache'],
    ['branches', 'branch'],
    ['movies', 'movie'],
    ['rules', 'rule'],
  ])('folds %p and %p to the same token', (plural, singular) => {
    expect([...contentTokens(plural)]).toEqual([...contentTokens(singular)])
  })
})

describe('similarity', () => {
  test('is symmetric', () => {
    expect(similarity(NEVER_COMMIT, COMMIT_MESSAGES)).toBe(similarity(COMMIT_MESSAGES, NEVER_COMMIT))
  })

  test('scores an entry against itself at 1', () => {
    expect(similarity(NEVER_COMMIT, NEVER_COMMIT)).toBe(1)
  })

  test('scores unrelated entries at 0', () => {
    expect(similarity(NEVER_COMMIT, METRICS_DASHBOARD)).toBe(0)
  })

  test('ignores wikilink targets, so cross-referencing entries do not look alike for that reason', () => {
    const linked = { ...SHORT_ANSWERS, body: `${SHORT_ANSWERS.body} Same bar as [[feedback-commit-messages]].` }
    expect(similarity(linked, COMMIT_MESSAGES)).toBeLessThan(similarity(SHORT_ANSWERS, COMMIT_MESSAGES) + 0.001)
  })

  /** Tighten the scoring, not this test, if a change ever brings these two groups closer together. */
  test('separates a reworded duplicate from entries that merely share vocabulary', () => {
    const duplicate = similarity(NEVER_COMMIT_REWORDED, NEVER_COMMIT)
    const nearMisses = [
      similarity(NEVER_COMMIT, COMMIT_MESSAGES),
      similarity(NEVER_COMMIT, SHORT_ANSWERS),
      similarity(NEVER_COMMIT_REWORDED, COMMIT_MESSAGES),
      similarity(COMMIT_MESSAGES, SHORT_ANSWERS),
    ]

    expect(duplicate).toBeGreaterThan(DEFAULT_DEDUPE_THRESHOLD)
    for (const score of nearMisses) {
      expect(score).toBeLessThan(DEFAULT_DEDUPE_THRESHOLD)
    }
    expect(duplicate).toBeGreaterThan(Math.max(...nearMisses) * 2)
  })
})

/** Invented entries that share only their domain word, the way a real store shares its subject. */
const TOPICS = [
  ['currency', 'rounding', 'cents'],
  ['audit', 'export', 'spreadsheet'],
  ['refund', 'reversal', 'chargeback'],
  ['taxes', 'vat', 'invoice'],
  ['archive', 'retention', 'purge'],
  ['timezone', 'midnight', 'cutoff'],
  ['permission', 'role', 'approver'],
  ['webhook', 'retry', 'signature'],
  ['migration', 'schema', 'column'],
  ['dashboard', 'chart', 'widget'],
  ['locale', 'translation', 'plural'],
  ['backup', 'snapshot', 'restore'],
] as const

function domainCorpus(): SimilarityInput[] {
  return TOPICS.map(([first, second, third]) => ({
    name: `project-ledger-${first}`,
    description: `Ledger ${first} and ${second}`,
    body: `The ledger treats ${first} through ${second}, recorded as ${third}.`,
  }))
}

describe('buildWeights', () => {
  test('weighs a word most entries share below one that almost none do', () => {
    const weights = buildWeights(domainCorpus())
    expect(weights.of('ledger')).toBeLessThan(weights.of('reconciliation'))
  })

  test('gives a word the corpus has never seen the highest weight', () => {
    const weights = buildWeights(domainCorpus())
    expect(weights.of('unseen')).toBeGreaterThan(weights.of('ledger'))
  })

  test('never weighs a word at zero or below, so a shared common word still counts for something', () => {
    expect(buildWeights(domainCorpus()).of('ledger')).toBeGreaterThan(0)
  })
})

describe('similarity under IDF', () => {
  test('reproduces the unweighted score when no weights are given', () => {
    expect(similarity(NEVER_COMMIT, NEVER_COMMIT_REWORDED)).toBe(similarity(NEVER_COMMIT, NEVER_COMMIT_REWORDED, UNIFORM_WEIGHTS))
  })

  test('lowers a pair whose overlap is only the shared domain word, more than a pair that shares something specific', () => {
    const corpus = domainCorpus()
    const weights = buildWeights(corpus)
    const [first, second] = corpus
    if (first === undefined || second === undefined) throw new Error('the corpus needs at least two entries')
    const domainOnly: [SimilarityInput, SimilarityInput] = [first, second]
    const specific: [SimilarityInput, SimilarityInput] = [
      { name: 'ledger-reconciliation', description: 'Ledger reconciliation runs nightly', body: 'Reconciliation compares the ledger with the bank feed.' },
      { name: 'ledger-reconcile-job', description: 'Nightly reconciliation of the ledger', body: 'The reconciliation job compares the ledger against the bank feed.' },
    ]

    const dropFor = ([a, b]: [SimilarityInput, SimilarityInput]): number => similarity(a, b) - similarity(a, b, weights)
    expect(dropFor(domainOnly)).toBeGreaterThan(dropFor(specific))
  })

  /** The threshold is calibrated on uniform scores; this checks the weighted ones still sit on the right sides of it. */
  test('keeps a reworded duplicate above the threshold and a near miss below it', () => {
    const weights = buildWeights([...domainCorpus(), NEVER_COMMIT, NEVER_COMMIT_REWORDED, COMMIT_MESSAGES, SHORT_ANSWERS])
    expect(similarity(NEVER_COMMIT_REWORDED, NEVER_COMMIT, weights)).toBeGreaterThan(DEFAULT_DEDUPE_THRESHOLD)
    expect(similarity(NEVER_COMMIT, COMMIT_MESSAGES, weights)).toBeLessThan(DEFAULT_DEDUPE_THRESHOLD)
    expect(similarity(NEVER_COMMIT, SHORT_ANSWERS, weights)).toBeLessThan(DEFAULT_DEDUPE_THRESHOLD)
  })
})
