import { describe, expect, test } from 'bun:test'
import { extractCodexFacts } from '../../src/importers/codex.ts'

const MEMORY = `# Task Group: /repos/shop checkout rework

scope: Covers the checkout rework.
applies_to: cwd=/repos/shop; reuse_rule=safe to reuse for similar checkout work

## Task 1: Move the coupon field, success

### rollout_summary_files

- rollout_summaries/2026-01-02T09-00-00-abcd-coupon_field.md (cwd=/repos/shop, updated_at=2026-01-02)

### keywords

- coupon, checkout, discount

## User preferences

- when the user said "erst analysieren, dann bauen", stop after the analysis and wait for approval [Task 1]
- when the user rejected a new abstraction, prefer the smallest change that fits
  the surrounding code [Task 1]

## Reusable knowledge

- The coupon rules live in a shared helper and are reused by both the API and the frontend [Task 1]

## Failures and how to do differently

- Symptom: the first patch failed. Cause: the surrounding lines differed. Fix: read the exact lines before patching [Task 1]

# Task Group: /repos/website copy pass

scope: Wording only.

## User preferences

- when the user asked for German copy, keep the informal register

## Reusable knowledge

`

describe('extractCodexFacts', () => {
  test('lifts facts out of the three sections that hold standing statements', () => {
    const { facts } = extractCodexFacts(MEMORY)
    expect(facts.map((fact) => fact.kind)).toEqual(['preference', 'preference', 'knowledge', 'failure', 'preference'])
  })

  test('drops the per-session bookkeeping sections', () => {
    const { facts } = extractCodexFacts(MEMORY)
    expect(facts.some((fact) => fact.text.includes('rollout_summaries/'))).toBe(false)
    expect(facts.some((fact) => fact.text.includes('coupon, checkout, discount'))).toBe(false)
  })

  test('attributes each fact to its task group and working directory', () => {
    const [first] = extractCodexFacts(MEMORY).facts
    expect(first?.group).toBe('/repos/shop checkout rework')
    expect(first?.cwd).toBe('/repos/shop')
  })

  test('leaves cwd unset for a group that declares none', () => {
    const last = extractCodexFacts(MEMORY).facts.at(-1)
    expect(last?.group).toBe('/repos/website copy pass')
    expect(last?.cwd).toBeUndefined()
  })

  test('joins a bullet that wraps across lines', () => {
    const { facts } = extractCodexFacts(MEMORY)
    expect(facts[1]?.text).toBe('when the user rejected a new abstraction, prefer the smallest change that fits the surrounding code')
  })

  test('strips the task back-references, which mean nothing once a fact stands alone', () => {
    const { facts } = extractCodexFacts(MEMORY)
    expect(facts.some((fact) => fact.text.includes('[Task'))).toBe(false)
  })

  test('reports a recognised section that turned out to be empty', () => {
    const { problems } = extractCodexFacts(MEMORY)
    expect(problems).toEqual(['/repos/website copy pass: section for knowledge had no entries'])
  })

  test('returns nothing for a file with no recognised sections', () => {
    expect(extractCodexFacts('# Notes\n\nSome prose.\n').facts).toEqual([])
  })
})
