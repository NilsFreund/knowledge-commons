export type CodexFactKind = 'preference' | 'knowledge' | 'failure'

/** The sections of a Codex `MEMORY.md` written as standing statements rather than session log. */
const SECTION_KINDS = new Map<string, CodexFactKind>([
  ['User preferences', 'preference'],
  ['Reusable knowledge', 'knowledge'],
  ['Failures and how to do differently', 'failure'],
])

export interface CodexFact {
  readonly kind: CodexFactKind
  readonly group: string
  readonly cwd?: string
  readonly text: string
}

export interface CodexExtractResult {
  readonly facts: readonly CodexFact[]
  readonly problems: readonly string[]
}

const GROUP_HEADING = /^#\s+Task Group:\s*(.+?)\s*$/
const SECTION_HEADING = /^##\s+(.+?)\s*$/
const ANY_HEADING = /^#{1,6}\s/
const BULLET = /^[-*]\s+(.*)$/
const APPLIES_TO_CWD = /(?:^|;|\s)cwd=([^;]+?)(?:;|$)/
const TASK_REFERENCE = /\s*\[Task \d+\]/g

export function extractCodexFacts(markdown: string): CodexExtractResult {
  const facts: CodexFact[] = []
  const problems: string[] = []

  let group = '(ungrouped)'
  let cwd: string | undefined
  let section: CodexFactKind | undefined
  let sectionCount = 0
  let pending: string[] = []

  const flush = (): void => {
    if (pending.length === 0 || section === undefined) return
    const text = clean(pending.join(' '))
    pending = []
    if (text.length === 0) return
    facts.push({ kind: section, group, ...(cwd === undefined ? {} : { cwd }), text })
    sectionCount += 1
  }

  const closeSection = (): void => {
    flush()
    if (section !== undefined && sectionCount === 0) {
      problems.push(`${group}: section for ${section} had no entries`)
    }
    section = undefined
    sectionCount = 0
  }

  for (const line of markdown.split('\n')) {
    const groupHeading = GROUP_HEADING.exec(line)
    if (groupHeading?.[1]) {
      closeSection()
      group = groupHeading[1]
      cwd = undefined
      continue
    }

    if (cwd === undefined && line.startsWith('applies_to:')) {
      cwd = APPLIES_TO_CWD.exec(line)?.[1]?.trim()
      continue
    }

    const sectionHeading = SECTION_HEADING.exec(line)
    if (sectionHeading?.[1]) {
      closeSection()
      section = SECTION_KINDS.get(sectionHeading[1])
      continue
    }

    if (section === undefined) continue

    if (ANY_HEADING.test(line)) {
      closeSection()
      continue
    }

    const bullet = BULLET.exec(line)
    if (bullet) {
      flush()
      pending = [bullet[1] ?? '']
      continue
    }

    if (pending.length > 0 && line.trim().length > 0) pending.push(line.trim())
    else flush()
  }

  closeSection()
  return { facts, problems }
}

function clean(text: string): string {
  return text.replace(TASK_REFERENCE, '').replace(/\s+/g, ' ').trim()
}
