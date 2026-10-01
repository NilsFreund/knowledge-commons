import { recordUsage, type UsageEvent } from './core/index.ts'

/** `init` picks its store from a positional argument and `mcp` never returns, so neither has one call to attribute. */
const UNTRACKED = new Set(['init', 'mcp'])

export async function record(root: string, event: UsageEvent): Promise<void> {
  if (process.env['KN_NO_USAGE'] !== undefined) return
  if (event.source === 'cli' && UNTRACKED.has(event.name)) return
  await recordUsage(root, event)
}
