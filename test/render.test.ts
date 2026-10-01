import { describe, expect, test } from 'bun:test'
import type { Candidate, Diagnostic, Entry, ResearchDoc, UsageSummary } from '../src/core/index.ts'
import { summarize, toIndexRow, type UsageEvent } from '../src/core/index.ts'
import {
  renderCandidates,
  renderContext,
  renderDiagnostics,
  renderDiscovery,
  renderEntries,
  renderIndex,
  renderResearchDocs,
  renderResearchList,
  renderSearch,
  renderStats,
  renderWriteOutcome,
} from '../src/render.ts'

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    name: 'feedback-never-commit',
    description: 'The user performs all git operations themselves',
    type: 'feedback',
    created: '2026-01-01',
    updated: '2026-01-02',
    sources: [],
    scope: 'global',
    body: 'Never run git commit.',
    links: [],
    path: '/store/knowledge/global/feedback-never-commit.md',
    ...overrides,
  }
}

function doc(overrides: Partial<ResearchDoc> = {}): ResearchDoc {
  return {
    name: 'pool-behaviour-on-restart',
    title: 'What the connection pool does when the database restarts',
    created: '2026-01-01',
    updated: '2026-02-02',
    sources: [],
    scope: 'shop',
    body: '## 2026-01-01\n\nDropped and reopened lazily.',
    sections: [{ date: '2026-01-01', body: 'Dropped and reopened lazily.' }],
    path: '/store/research/shop/pool-behaviour-on-restart.md',
    ...overrides,
  }
}

describe('renderContext', () => {
  test('points an empty scope at the tool that fills it', () => {
    const text = renderContext({ scopes: ['global'], index: [], included: [], instructionFiles: [] }, '/repo')
    expect(text).toContain('/repo')
    expect(text).toContain('knowledge_write')
  })

  test('lists the scopes most specific first and indexes every entry', () => {
    const text = renderContext({ scopes: ['shop', 'global'], index: [toIndexRow(entry())], included: [], instructionFiles: [] }, '/repo')
    expect(text).toContain('shop, global')
    expect(text).toContain('global/feedback-never-commit')
  })

  test('separates the inlined bodies from the index', () => {
    const text = renderContext({ scopes: ['global'], index: [toIndexRow(entry())], included: [entry()], instructionFiles: [] }, '/repo')
    expect(text).toContain('Never run git commit.')
    expect(text).toContain('always apply')
  })
})

describe('renderContext with repository instructions', () => {
  test('names the files it found, without inlining them', () => {
    const text = renderContext(
      { scopes: ['shop'], index: [], included: [], repoRoot: '/repos/shop', instructionFiles: ['AGENTS.md', '.cursor/rules/'] },
      '/repos/shop',
    )
    expect(text).toContain('/repos/shop/AGENTS.md')
    expect(text).toContain('/repos/shop/.cursor/rules/')
    expect(text).toContain('already loaded them')
  })

  test('names them even when the store holds nothing yet, which is when it matters most', () => {
    const text = renderContext(
      { scopes: ['shop'], index: [], included: [], repoRoot: '/repos/shop', instructionFiles: ['AGENTS.md'] },
      '/repos/shop',
    )
    expect(text).toContain('Nothing recorded yet')
    expect(text).toContain('/repos/shop/AGENTS.md')
  })

  test('says nothing when the repository has none', () => {
    const text = renderContext({ scopes: ['shop'], index: [], included: [], instructionFiles: [] }, '/repos/shop')
    expect(text).not.toContain('its own instructions')
  })
})

describe('renderIndex and renderEntries', () => {
  test('an index row carries id, type and description', () => {
    expect(renderIndex([toIndexRow(entry())])).toBe(
      '- global/feedback-never-commit (feedback) - The user performs all git operations themselves',
    )
  })

  test('an entry carries its id, description and body', () => {
    const text = renderEntries([entry()])
    expect(text).toContain('### global/feedback-never-commit')
    expect(text).toContain('Never run git commit.')
  })
})

describe('renderSearch', () => {
  test('says so when nothing matched', () => {
    expect(renderSearch([])).toBe('No matches.')
  })

  test('shows the score with each hit', () => {
    expect(renderSearch([{ entry: entry(), score: 0.7 }])).toContain('0.70  global/feedback-never-commit')
  })
})

describe('renderWriteOutcome', () => {
  test('reports a creation', () => {
    expect(renderWriteOutcome({ status: 'created', entry: entry() })).toBe('Created global/feedback-never-commit.')
  })

  test('reports an update, and says so when the scope moved', () => {
    const previous = entry({ scope: 'shop' })
    expect(renderWriteOutcome({ status: 'updated', entry: entry(), previous })).toContain('moved from shop/')
    expect(renderWriteOutcome({ status: 'updated', entry: entry(), previous: entry() })).not.toContain('moved')
  })
})

describe('renderCandidates', () => {
  const candidate: Candidate = {
    id: 'global/feedback-never-commit',
    name: 'feedback-never-commit',
    scope: 'global',
    description: 'The user performs all git operations themselves',
    score: 0.39,
  }

  test('states that nothing was written and how to proceed', () => {
    const text = renderCandidates([candidate])
    expect(text).toContain('Nothing was written')
    expect(text).toContain('updateName')
    expect(text).toContain('confirm')
  })

  test('agrees in number with the candidate count', () => {
    expect(renderCandidates([candidate])).toContain('This entry overlaps')
    expect(renderCandidates([candidate, { ...candidate, id: 'global/other' }])).toContain('These entries overlap')
  })

  /** "Never commit" and "Always commit" overlap at 0.79, so the wording is the only thing stopping a merge of opposites. */
  test('never claims the overlap means agreement, and says what to do about a contradiction', () => {
    const text = renderCandidates([candidate])
    expect(text).not.toContain('same fact')
    expect(text).toContain('Do not merge an opposite')
    expect(text).toContain('ask the user')
    expect(text).toContain('only when every one is unrelated')
  })
})

describe('renderDiagnostics', () => {
  test('says so when the store is healthy', () => {
    expect(renderDiagnostics([])).toBe('No problems found.')
  })

  test('puts errors before warnings and counts both', () => {
    const diagnostics: Diagnostic[] = [
      { level: 'warning', message: 'a warning' },
      { level: 'error', message: 'an error' },
    ]
    const lines = renderDiagnostics(diagnostics).split('\n')
    expect(lines[0]).toContain('error')
    expect(lines[1]).toContain('warning')
    expect(renderDiagnostics(diagnostics)).toContain('1 error(s), 1 warning(s)')
  })
})

describe('renderStats', () => {
  function event(overrides: Partial<UsageEvent> = {}): UsageEvent {
    return { at: '2026-09-21T10:00:00.000Z', source: 'mcp', name: 'knowledge_context', ok: true, ms: 5, ...overrides }
  }

  test('says so before anything has been recorded', () => {
    expect(renderStats(summarize([]))).toBe('Nothing recorded yet.')
  })

  test('counts calls and errors, and breaks details out per tool', () => {
    const summary: UsageSummary = summarize([
      event({ detail: 'shop' }),
      event({ detail: 'shop' }),
      event({ name: 'knowledge_read', ok: false }),
    ])
    const text = renderStats(summary)

    expect(text).toContain('3 calls')
    expect(text).toContain('1 error')
    expect(text).toContain('knowledge_context')
    expect(text).toContain('2  shop')
  })

  test('says "no errors" rather than "0 errors"', () => {
    expect(renderStats(summarize([event()]))).toContain('no errors')
  })
})

describe('renderDiscovery', () => {
  test('is silent when there is nothing to import', () => {
    expect(renderDiscovery([], '/home/me')).toBe('')
  })

  test('shortens the home directory and names the scope it would use', () => {
    const text = renderDiscovery(
      [{ agent: 'claude', path: '/home/me/.claude/projects/-home-me-shop/memory', items: 44, repo: '/home/me/shop', scope: 'shop' }],
      '/home/me',
    )
    expect(text).toContain('~/.claude/projects')
    expect(text).toContain('44')
    expect(text).toContain('->  shop')
  })

  test('marks a Codex file as needing review instead of giving it a count', () => {
    const text = renderDiscovery([{ agent: 'codex', path: '/home/me/.codex/memories/MEMORY.md', items: 78 }], '/home/me')
    expect(text).toContain('needs review by hand')
    expect(text).not.toContain('78')
  })

  test('says a repository is gone rather than inventing a scope', () => {
    const text = renderDiscovery([{ agent: 'claude', path: '/home/me/.claude/projects/-gone/memory', items: 3 }], '/home/me')
    expect(text).toContain('its repository is gone')
  })
})

describe('research rendering', () => {
  test('a listing carries the round count and the last update', () => {
    const text = renderResearchList([
      { id: 'shop/pool-behaviour-on-restart', name: 'pool-behaviour-on-restart', scope: 'shop', title: 'What the connection pool does when the database restarts', updated: '2026-02-02', rounds: 2 },
    ])
    expect(text).toContain('2 rounds')
    expect(text).toContain('2026-02-02')
  })

  test('a single round is counted in the singular', () => {
    const text = renderResearchList([
      { id: 'shop/x-y', name: 'x-y', scope: 'shop', title: 'T', updated: '2026-02-02', rounds: 1 },
    ])
    expect(text).toContain('1 round ')
  })

  test('an empty listing points at nothing rather than printing a header', () => {
    expect(renderResearchList([])).toBe('No research recorded yet.')
  })

  test('a document keeps its title, id and every round', () => {
    const text = renderResearchDocs([doc()])
    expect(text).toContain('# What the connection pool does when the database restarts')
    expect(text).toContain('shop/pool-behaviour-on-restart')
    expect(text).toContain('Dropped and reopened lazily.')
  })
})
