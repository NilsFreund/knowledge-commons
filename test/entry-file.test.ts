import { describe, expect, test } from 'bun:test'
import { extractLinks, extractMalformedLinks, parseEntryFile, serializeEntryFile } from '../src/core/index.ts'

const VALID = `---
name: feedback-short-answers
description: "Keep answers short: a TLDR and a few lines"
type: feedback
created: 2026-08-30
updated: 2026-09-20
sources:
  - claude:shop
---

Default to a TLDR plus a few lines. See [[feedback-no-em-dashes]].
`

describe('parseEntryFile', () => {
  test('reads frontmatter, body and links, and takes the scope from the caller', () => {
    const result = parseEntryFile(VALID, 'global', '/store/knowledge/global/feedback-short-answers.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.name).toBe('feedback-short-answers')
    expect(result.value.type).toBe('feedback')
    expect(result.value.scope).toBe('global')
    expect(result.value.sources).toEqual(['claude:shop'])
    expect(result.value.body).toBe('Default to a TLDR plus a few lines. See [[feedback-no-em-dashes]].')
    expect(result.value.links).toEqual(['feedback-no-em-dashes'])
  })

  test('defaults missing sources to an empty list', () => {
    const raw = VALID.replace('sources:\n  - claude:shop\n', '')
    const result = parseEntryFile(raw, 'global', 'x.md')
    expect(result.ok && result.value.sources).toEqual([])
  })

  test.each([
    ['no frontmatter', 'just a body'],
    ['unterminated frontmatter', '---\nname: a-b-c\n'],
    ['unknown type', VALID.replace('type: feedback', 'type: trivia')],
    ['name that is not kebab-case', VALID.replace('name: feedback-short-answers', 'name: Feedback_Short')],
    ['malformed date', VALID.replace('created: 2026-08-30', 'created: yesterday')],
    ['empty body', VALID.replace('Default to a TLDR plus a few lines. See [[feedback-no-em-dashes]].', '')],
  ])('rejects %s', (_label, raw) => {
    const result = parseEntryFile(raw, 'global', 'x.md')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid_entry')
  })
})

describe('serializeEntryFile', () => {
  test('round-trips an entry unchanged', () => {
    const parsed = parseEntryFile(VALID, 'global', 'x.md')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const reparsed = parseEntryFile(serializeEntryFile(parsed.value, parsed.value.body), 'global', 'x.md')
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return
    expect(reparsed.value).toEqual(parsed.value)
  })

  test('keeps a description containing a colon readable', () => {
    const raw = serializeEntryFile(
      { name: 'a-b-c', description: 'Answers: keep them short', type: 'feedback', created: '2026-01-01', updated: '2026-01-01', sources: [] },
      'Body.',
    )
    const parsed = parseEntryFile(raw, 'global', 'x.md')
    expect(parsed.ok && parsed.value.description).toBe('Answers: keep them short')
  })
})

describe('extractLinks', () => {
  test('deduplicates and ignores malformed links', () => {
    expect(extractLinks('[[a-b]] [[a-b]] [[Not Valid]] [[c]]')).toEqual(['a-b', 'c'])
  })
})

describe('extractMalformedLinks', () => {
  test('reports bracketed targets that could never be an entry name', () => {
    expect(extractMalformedLinks('[[a-b]] [[Not Valid]] [[feedback_...]] [[]]')).toEqual(['Not Valid', 'feedback_...', ''])
  })

  test('says nothing about a body whose links are all well formed', () => {
    expect(extractMalformedLinks('see [[a-b]] and [[c]]')).toEqual([])
  })
})
