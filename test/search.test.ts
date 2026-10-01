import { describe, expect, test } from 'bun:test'
import { searchScore, tokenize, type Entry } from '../src/core/index.ts'

const ENTRY: Entry = {
  name: 'project-restart-policy',
  description: 'Restart the service after a config change',
  type: 'project',
  created: '2026-01-01',
  updated: '2026-01-01',
  sources: [],
  scope: 'global',
  body: 'The start sequence matters. Änderungen müssen geprüft werden.',
  links: [],
  path: '/store/knowledge/global/project-restart-policy.md',
}

describe('searchScore', () => {
  test('ignores a term that only appears inside a longer word', () => {
    expect(searchScore('art', ENTRY)).toBe(0)
    expect(searchScore('quence', ENTRY)).toBe(0)
  })

  test('matches a term that begins a word, so a prefix still finds it', () => {
    expect(searchScore('restart', ENTRY)).toBeGreaterThan(0)
    expect(searchScore('serv', ENTRY)).toBeGreaterThan(0)
  })

  test('weights a hit in the name above one in the body', () => {
    expect(searchScore('policy', ENTRY)).toBeGreaterThan(searchScore('sequence', ENTRY))
  })

  test('finds an accented word, which used to be split apart', () => {
    expect(searchScore('änderungen', ENTRY)).toBeGreaterThan(0)
    expect(searchScore('anderungen', ENTRY)).toBeGreaterThan(0)
  })

  test('scores an empty or all-stopword query at zero', () => {
    expect(searchScore('', ENTRY)).toBe(0)
    expect(searchScore('a', ENTRY)).toBe(0)
  })

  test('averages over the terms, so one hit in three scores below three in three', () => {
    expect(searchScore('restart config sequence', ENTRY)).toBeGreaterThan(searchScore('restart zzz yyy', ENTRY))
  })
})

describe('tokenize', () => {
  test('drops terms too short to mean anything', () => {
    expect(tokenize('a bc def')).toEqual(['bc', 'def'])
  })
})
