import { describe, expect, test } from 'bun:test'
import { searchScores, tokenize, type Searchable } from '../src/core/index.ts'

const ENTRY: Searchable = {
  name: 'project-restart-policy',
  description: 'Restart the service after a config change',
  body: 'The start sequence matters. Änderungen müssen geprüft werden.',
}

const ROUTING: Searchable = { name: 'call-routing', description: 'How a call is routed', body: 'Every call goes through the router.' }
const BILLING: Searchable = { name: 'call-billing', description: 'How a call is billed', body: 'Each call is billed per minute.' }
const PLAYBACK: Searchable = { name: 'call-playback', description: 'Playback of a recorded call', body: 'Playback streams the recording of the call.' }
const CALLS = [ROUTING, BILLING, PLAYBACK]

function scoreOf(query: string, item: Searchable = ENTRY, corpus: readonly Searchable[] = [item]): number {
  return searchScores(query, corpus).find((hit) => hit.item === item)?.score ?? 0
}

describe('matching', () => {
  test('ignores a term that only appears inside a longer word', () => {
    expect(scoreOf('art')).toBe(0)
    expect(scoreOf('quence')).toBe(0)
  })

  test('matches a term that begins a word, so a prefix still finds it', () => {
    expect(scoreOf('restart')).toBeGreaterThan(0)
    expect(scoreOf('serv')).toBeGreaterThan(0)
  })

  test('takes a short term only as a whole word, since short prefixes begin half the words in a store', () => {
    expect(scoreOf('sta')).toBe(0)
  })

  test('counts a prefix hit for less than the word itself', () => {
    expect(scoreOf('serv')).toBeLessThan(scoreOf('service'))
  })

  test('weights a hit in the name above one in the body', () => {
    expect(scoreOf('policy')).toBeGreaterThan(scoreOf('sequence'))
  })

  test('finds an accented word, which used to be split apart', () => {
    expect(scoreOf('änderungen')).toBeGreaterThan(0)
    expect(scoreOf('anderungen')).toBeGreaterThan(0)
  })
})

describe('the query', () => {
  test('scores an empty or all-stopword query at zero', () => {
    expect(scoreOf('')).toBe(0)
    expect(scoreOf('a')).toBe(0)
    expect(scoreOf('the and nicht')).toBe(0)
  })

  /** A question phrased as a sentence used to rank the right entry far lower than its keywords did. */
  test('scores a sentence the same as its keywords', () => {
    expect(scoreOf('how do we restart the service in this repo', ENTRY, [ENTRY, ROUTING])).toBe(
      scoreOf('restart service', ENTRY, [ENTRY, ROUTING]),
    )
  })

  test('does not count a term no entry contains against the ones that match', () => {
    expect(scoreOf('playback zzzz', PLAYBACK, CALLS)).toBe(scoreOf('playback', PLAYBACK, CALLS))
  })
})

describe('ranking', () => {
  /** A query term matching most of the store used to count as much as the one that identifies the entry. */
  test('ranks the entry holding the rare term above one that only shares the common one', () => {
    expect(scoreOf('call playback', PLAYBACK, CALLS)).toBeGreaterThan(scoreOf('call playback', ROUTING, CALLS))
  })

  test('ranks a hit in a short body above the same hit in a long one', () => {
    const short: Searchable = { name: 'notes-a', description: 'Notes', body: 'Use the replica for reads.' }
    const long: Searchable = { name: 'notes-b', description: 'Notes', body: `Use the replica for reads. ${'Unrelated filler text. '.repeat(40)}` }
    expect(scoreOf('replica', short, [short, long])).toBeGreaterThan(scoreOf('replica', long, [short, long]))
  })

  test('stays below one however often a term repeats', () => {
    const repeated: Searchable = { name: 'replica-replica', description: 'replica replica', body: 'replica '.repeat(50) }
    expect(scoreOf('replica', repeated)).toBeLessThan(1)
  })
})

describe('tokenize', () => {
  test('drops terms too short to mean anything, and repeats', () => {
    expect(tokenize('a bc def def')).toEqual(['bc', 'def'])
  })

  test('drops a stopword written with an umlaut', () => {
    expect(tokenize('für über müssen deploy')).toEqual(['deploy'])
  })
})
