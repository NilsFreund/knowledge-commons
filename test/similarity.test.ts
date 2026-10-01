import { describe, expect, test } from 'bun:test'
import { contentTokens, DEFAULT_DEDUPE_THRESHOLD, normalize, similarity } from '../src/core/index.ts'
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
