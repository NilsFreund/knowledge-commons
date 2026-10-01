import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { writeFileAtomic } from './write.ts'

export const STATS_FILE = '.usage.jsonl'

export const usageEventSchema = z.object({
  at: z.iso.datetime(),
  source: z.enum(['mcp', 'cli']),
  name: z.string().min(1),
  ok: z.boolean(),
  ms: z.number().int().min(0),
  detail: z.string().optional(),
})

export type UsageEvent = z.infer<typeof usageEventSchema>

export interface UsageCount {
  readonly source: UsageEvent['source']
  readonly name: string
  readonly calls: number
  readonly errors: number
  readonly medianMs: number
}

export interface UsageSummary {
  readonly total: number
  readonly errors: number
  readonly first?: string
  readonly last?: string
  readonly byName: readonly UsageCount[]
  readonly byDay: readonly { readonly day: string; readonly calls: number }[]
  readonly details: readonly { readonly name: string; readonly detail: string; readonly calls: number }[]
  readonly unreadable: number
}

/** Appended, never rewritten: several agents run a server at once and an append does not race. */
export async function recordUsage(root: string, event: UsageEvent): Promise<void> {
  try {
    await appendFile(join(root, STATS_FILE), `${JSON.stringify(event)}\n`, 'utf8')
  } catch {
    // Counting usage must never be the reason a call fails.
  }
}

export async function readUsage(root: string, since?: Date): Promise<{ events: UsageEvent[]; unreadable: number }> {
  let raw: string
  try {
    raw = await readFile(join(root, STATS_FILE), 'utf8')
  } catch {
    return { events: [], unreadable: 0 }
  }

  const events: UsageEvent[] = []
  let unreadable = 0

  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue

    const parsed = parseLine(line)
    if (parsed === undefined) {
      unreadable += 1
      continue
    }
    if (since === undefined || new Date(parsed.at) >= since) events.push(parsed)
  }

  return { events, unreadable }
}

export async function pruneUsage(root: string, since: Date): Promise<number> {
  const { events } = await readUsage(root)
  const kept = events.filter((event) => new Date(event.at) >= since)
  await writeFileAtomic(join(root, STATS_FILE), kept.map((event) => `${JSON.stringify(event)}\n`).join(''))
  return events.length - kept.length
}

export function summarize(events: readonly UsageEvent[], unreadable = 0): UsageSummary {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at))
  const first = sorted[0]
  const last = sorted.at(-1)

  return {
    total: events.length,
    errors: events.filter((event) => !event.ok).length,
    ...(first ? { first: first.at } : {}),
    ...(last ? { last: last.at } : {}),
    byName: countByName(events),
    byDay: countByDay(events),
    details: countDetails(events),
    unreadable,
  }
}

function countByName(events: readonly UsageEvent[]): readonly UsageCount[] {
  const groups = new Map<string, UsageEvent[]>()
  for (const event of events) {
    const key = JSON.stringify([event.source, event.name])
    groups.set(key, [...(groups.get(key) ?? []), event])
  }

  return [...groups.values()]
    .flatMap((group) => {
      const head = group[0]
      if (head === undefined) return []
      return [
        {
          source: head.source,
          name: head.name,
          calls: group.length,
          errors: group.filter((event) => !event.ok).length,
          medianMs: median(group.map((event) => event.ms)),
        },
      ]
    })
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
}

function countByDay(events: readonly UsageEvent[]): readonly { day: string; calls: number }[] {
  const days = new Map<string, number>()
  for (const event of events) {
    const day = event.at.slice(0, 10)
    days.set(day, (days.get(day) ?? 0) + 1)
  }

  return [...days].map(([day, calls]) => ({ day, calls })).sort((a, b) => a.day.localeCompare(b.day))
}

function countDetails(events: readonly UsageEvent[]): readonly { name: string; detail: string; calls: number }[] {
  const counts = new Map<string, { name: string; detail: string; calls: number }>()
  for (const event of events) {
    if (event.detail === undefined) continue

    const key = JSON.stringify([event.name, event.detail])
    const current = counts.get(key)
    if (current) current.calls += 1
    else counts.set(key, { name: event.name, detail: event.detail, calls: 1 })
  }

  return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name) || b.calls - a.calls)
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0

  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const lower = sorted[middle - 1] ?? 0
  const upper = sorted[middle] ?? 0
  return sorted.length % 2 === 0 ? Math.round((lower + upper) / 2) : upper
}

function parseLine(line: string): UsageEvent | undefined {
  try {
    const parsed = usageEventSchema.safeParse(JSON.parse(line))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}
