import {
  entryId,
  researchId,
  type Candidate,
  type ContextResult,
  type Diagnostic,
  type DiscoveredSource,
  type Entry,
  type IndexRow,
  type ResearchDoc,
  type ResearchHit,
  type ResearchOutcome,
  type ResearchSummary,
  type SearchHit,
  type UsageCount,
  type UsageSummary,
  type WriteOutcome,
} from './core/index.ts'

export function renderContext(result: ContextResult, cwd: string): string {
  if (result.index.length === 0) {
    return [
      [
        `Nothing recorded yet for ${cwd} (scopes: ${result.scopes.join(', ')}).`,
        'Record one with knowledge_write whenever the user states a preference, a constraint or a decision worth keeping.',
      ].join('\n'),
      renderInstructionFiles(result),
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  const sections = [
    `# Knowledge for ${cwd}`,
    `Scopes, most specific first: ${result.scopes.join(', ')}.`,
    '## Index',
    renderIndex(result.index),
  ]

  if (result.included.length > 0) {
    sections.push(
      '## Entries that always apply here',
      'Anything else in the index can be fetched by name.',
      renderEntries(result.included),
    )
  } else {
    sections.push('Fetch any of these by name to read the full entry.')
  }

  const instructions = renderInstructionFiles(result)
  if (instructions !== '') sections.push(instructions)

  return sections.join('\n\n')
}

/** Named rather than inlined: the agent has file access, and its own host may have loaded them already. */
function renderInstructionFiles(result: ContextResult): string {
  if (result.instructionFiles.length === 0 || result.repoRoot === undefined) return ''

  const root = result.repoRoot
  return [
    '## This repository carries its own instructions',
    'Read these unless your host has already loaded them, and apply them alongside the entries above.',
    result.instructionFiles.map((file) => `- ${root}/${file}`).join('\n'),
  ].join('\n\n')
}

export function renderIndex(rows: readonly IndexRow[]): string {
  return rows.map((row) => `- ${row.id} (${row.type}) - ${row.description}`).join('\n')
}

export function renderEntries(entries: readonly Entry[]): string {
  return entries.map((entry) => `### ${entryId(entry)}\n_${entry.description}_\n\n${entry.body}`).join('\n\n')
}

export function renderSearch(hits: readonly SearchHit[]): string {
  if (hits.length === 0) return 'No matches.'
  return hits.map((hit) => `- ${hit.score.toFixed(2)}  ${entryId(hit.entry)} - ${hit.entry.description}`).join('\n')
}

export function renderWriteOutcome(outcome: WriteOutcome): string {
  switch (outcome.status) {
    case 'created':
      return `Created ${entryId(outcome.entry)}.`
    case 'updated':
      return `Updated ${entryId(outcome.entry)}${outcome.previous.scope === outcome.entry.scope ? '' : ` (moved from ${entryId(outcome.previous)})`}.`
    case 'candidates':
      return renderCandidates(outcome.candidates)
  }
}

/** Overlap cannot tell agreement from contradiction, so this never claims they say the same thing. */
export function renderCandidates(candidates: readonly Candidate[]): string {
  return [
    `Nothing was written. ${candidates.length === 1 ? 'This entry overlaps' : 'These entries overlap'} heavily with what you are writing:`,
    candidates.map((candidate) => `- ${candidate.score.toFixed(2)}  ${candidate.id} - ${candidate.description}`).join('\n'),
    'Decide for each whether it says the same thing, the opposite, or something unrelated. Merge into a repeat with updateName. Do not merge an opposite: ask the user which rule holds. Pass confirm only when every one is unrelated.',
  ].join('\n\n')
}

export function renderDiagnostics(diagnostics: readonly Diagnostic[]): string {
  if (diagnostics.length === 0) return 'No problems found.'
  const errors = diagnostics.filter((diagnostic) => diagnostic.level === 'error')
  const warnings = diagnostics.filter((diagnostic) => diagnostic.level === 'warning')
  return [
    ...errors.map((diagnostic) => `error   ${diagnostic.message}`),
    ...warnings.map((diagnostic) => `warning ${diagnostic.message}`),
    '',
    `${errors.length} error(s), ${warnings.length} warning(s).`,
  ].join('\n')
}

export function renderStats(summary: UsageSummary): string {
  if (summary.total === 0) return 'Nothing recorded yet.'

  const sections = [headline(summary), table(summary.byName)]
  for (const [name, rows] of groupDetails(summary.details)) {
    sections.push([`${name}`, ...rows.map((row) => `  ${String(row.calls).padStart(6)}  ${row.detail}`)].join('\n'))
  }
  if (summary.unreadable > 0) sections.push(`${summary.unreadable} unreadable line(s) in the usage log.`)

  return sections.join('\n\n')
}

function headline(summary: UsageSummary): string {
  const span = summary.first === summary.last ? summary.first?.slice(0, 10) : `${summary.first?.slice(0, 10)} to ${summary.last?.slice(0, 10)}`
  return `${plural(summary.total, 'call')}, ${span}, ${errorCount(summary.errors)}`
}

function errorCount(errors: number): string {
  if (errors === 0) return 'no errors'
  return plural(errors, 'error')
}

function plural(count: number, noun: string): string {
  if (count === 1) return `${count} ${noun}`
  return `${count} ${noun}s`
}

function table(counts: readonly UsageCount[]): string {
  const width = Math.max(...counts.map((count) => count.name.length))
  return [
    `${'calls'.padStart(6)}  ${'errors'.padStart(6)}  ${'p50'.padStart(6)}  ${'name'.padEnd(width)}  source`,
    ...counts.map(
      (count) =>
        `${String(count.calls).padStart(6)}  ${String(count.errors).padStart(6)}  ${`${count.medianMs}ms`.padStart(6)}  ${count.name.padEnd(width)}  ${count.source}`,
    ),
  ].join('\n')
}

function groupDetails(details: UsageSummary['details']): ReadonlyMap<string, UsageSummary['details']> {
  const grouped = new Map<string, UsageSummary['details']>()
  for (const detail of details) {
    grouped.set(detail.name, [...(grouped.get(detail.name) ?? []), detail])
  }
  return grouped
}

export function renderDiscovery(sources: readonly DiscoveredSource[], home: string): string {
  if (sources.length === 0) return ''

  const rows = sources.map((source) => {
    if (source.agent === 'codex') return `        ${short(source.path, home)}  ->  needs review by hand`
    const target = source.scope ?? 'needs a --scope, its repository is gone'
    return `  ${String(source.items).padStart(4)}  ${short(source.path, home)}  ->  ${target}`
  })

  return ['Found on this machine:', ...rows].join('\n')
}

function short(path: string, home: string): string {
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path
}

export function renderResearchList(summaries: readonly ResearchSummary[]): string {
  if (summaries.length === 0) return 'No research recorded yet.'
  return summaries.map((summary) => `- ${summary.id}  ${summary.updated}  ${rounds(summary.rounds)}  ${summary.title}`).join('\n')
}

export function renderResearchHits(hits: readonly ResearchHit[]): string {
  if (hits.length === 0) return 'No research matches. Record one with research_write once you have an answer.'
  return hits
    .map((hit) => `- ${hit.score.toFixed(2)}  ${researchId(hit.doc)}  ${hit.doc.updated}  ${hit.doc.title}`)
    .join('\n')
}

export function renderResearchDocs(docs: readonly ResearchDoc[]): string {
  return docs.map((doc) => `# ${doc.title}\n_${researchId(doc)}, ${rounds(doc.sections.length)}, last ${doc.updated}_\n\n${doc.body}`).join('\n\n---\n\n')
}

export function renderResearchOutcome(outcome: ResearchOutcome): string {
  return outcome.status === 'created'
    ? `Recorded ${researchId(outcome.doc)}.`
    : `Appended a ${outcome.doc.updated} round to ${researchId(outcome.doc)}, now ${rounds(outcome.rounds)}.`
}

function rounds(count: number): string {
  return `${count} round${count === 1 ? '' : 's'}`
}
