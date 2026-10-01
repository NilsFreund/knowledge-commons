import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { formatError, Store } from '../core/index.ts'
import { importClaudeMemories } from '../importers/claude.ts'
import { extractCodexFacts } from '../importers/codex.ts'
import type { Options } from './options.ts'

export interface ClaudeImportOutcome {
  readonly imported: number
  readonly skipped: readonly { readonly name: string; readonly scope: string }[]
  readonly problems: readonly string[]
  readonly rewrittenLinks: number
  readonly total: number
}

export async function importClaudeInto(
  store: Store,
  from: string,
  scope: string,
  dryRun: boolean,
): Promise<ClaudeImportOutcome> {
  const { entries, problems, rewrittenLinks } = await importClaudeMemories(resolve(from))
  const existing = new Map((await store.load()).entries.map((entry) => [entry.name, entry]))
  const skipped: { name: string; scope: string }[] = []
  let imported = 0

  for (const entry of entries) {
    const clash = existing.get(entry.name)
    if (clash) {
      skipped.push({ name: entry.name, scope: clash.scope })
      continue
    }

    if (!dryRun) {
      const written = await store.write({
        name: entry.name,
        description: entry.description,
        type: entry.type,
        scope,
        body: entry.body,
        sources: [`claude:${scope}`],
        confirm: true,
      })
      if (!written.ok) throw new Error(formatError(written.error))
    }

    imported += 1
  }

  return { imported, skipped, problems, rewrittenLinks, total: entries.length + problems.length }
}

export async function importClaude(store: Store, options: Options): Promise<number> {
  const from = options.required('from', 'import claude needs --from <memory-dir>')
  const scope = options.required('scope', 'import claude needs --scope <name>')
  const dryRun = options.flag('dry-run')
  const outcome = await importClaudeInto(store, from, scope, dryRun)

  for (const entry of outcome.skipped) console.log(`skipped  ${entry.name} - already in scope \`${entry.scope}\``)
  for (const problem of outcome.problems) console.error(`warning: ${problem}`)

  console.log(
    `${outcome.imported} of ${outcome.total} files${dryRun ? ' would be' : ''} imported, ` +
      `${outcome.skipped.length} skipped, ${outcome.problems.length} unreadable.`,
  )
  if (outcome.rewrittenLinks > 0) console.log(`${outcome.rewrittenLinks} link(s) repointed at the importing entry names.`)
  console.log('Run `kn doctor` to see which of them say the same thing.')

  return outcome.problems.length > 0 ? 1 : 0
}

export async function importCodex(options: Options): Promise<number> {
  const from = options.required('from', 'import codex needs --from <MEMORY.md>')
  const { facts, problems } = extractCodexFacts(await readFile(resolve(from), 'utf8'))
  const lines = facts.map((fact) => JSON.stringify(fact)).join('\n')
  const out = options.string('out')

  if (out === undefined) console.log(lines)
  else {
    await writeFile(resolve(out), `${lines}\n`, 'utf8')
    console.log(`${facts.length} candidate facts written to ${resolve(out)}.`)
  }

  for (const problem of problems) console.error(`warning: ${problem}`)
  console.error('\nThese are candidates, not entries. Review them, then record the keepers with `knowledge_write`.')

  return 0
}
