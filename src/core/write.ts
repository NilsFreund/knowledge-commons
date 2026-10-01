import { open, rename, rm, stat, writeFile } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { serialize } from './serialize.ts'

const LOCK_FILE = '.write.lock'
const POLL_MS = 25
const TIMEOUT_MS = 5_000

/** A lock whose holder crashed would otherwise block every later write for good. */
const STALE_MS = 30_000

/** Renaming over the target is atomic, so a crash leaves either the old file or the new one. */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`
  try {
    await writeFile(temporary, content, 'utf8')
    await rename(temporary, path)
  } catch (cause) {
    await rm(temporary, { force: true })
    throw cause
  }
}

/** Writing is read-then-write, so overlapping calls would both read the state before either wrote. */
export async function withWriteLock<T>(root: string, run: () => Promise<T>): Promise<T> {
  return await serialize(root, async () => {
    const lock = join(root, LOCK_FILE)
    await acquire(lock)
    try {
      return await run()
    } finally {
      await rm(lock, { force: true })
    }
  })
}

async function acquire(lock: string): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS
  let taken = await take(lock)

  while (!taken) {
    await yieldToHolder(lock, deadline)
    taken = await take(lock)
  }
}

async function take(lock: string): Promise<boolean> {
  const handle = await openExclusive(lock)
  if (handle === undefined) return false

  await handle.writeFile(`${process.pid}\n`, 'utf8')
  await handle.close()
  return true
}

/** Only EEXIST means someone else holds it; a missing directory has to surface as a missing directory. */
async function openExclusive(lock: string): Promise<FileHandle | undefined> {
  try {
    return await open(lock, 'wx')
  } catch (cause) {
    if (isAlreadyHeld(cause)) return undefined
    throw cause
  }
}

function isAlreadyHeld(cause: unknown): boolean {
  return cause instanceof Error && 'code' in cause && cause.code === 'EEXIST'
}

async function yieldToHolder(lock: string, deadline: number): Promise<void> {
  if (await isStale(lock)) {
    await rm(lock, { force: true })
    return
  }
  if (Date.now() >= deadline) {
    throw new Error(`another process is holding ${lock}; gave up after ${TIMEOUT_MS}ms`)
  }
  await new Promise((resolve) => setTimeout(resolve, POLL_MS))
}

async function isStale(lock: string): Promise<boolean> {
  try {
    return Date.now() - (await stat(lock)).mtimeMs > STALE_MS
  } catch {
    return false
  }
}
