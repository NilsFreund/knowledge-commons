import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withWriteLock, writeFileAtomic } from '../src/core/index.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kn-write-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('writeFileAtomic', () => {
  test('writes the content and leaves no temporary behind', async () => {
    const path = join(root, 'entry.md')
    await writeFileAtomic(path, 'hello')

    expect(await readFile(path, 'utf8')).toBe('hello')
    expect((await readdir(root)).filter((file) => file.endsWith('.tmp'))).toEqual([])
  })

  test('replaces an existing file rather than appending to it', async () => {
    const path = join(root, 'entry.md')
    await writeFileAtomic(path, 'first')
    await writeFileAtomic(path, 'second')

    expect(await readFile(path, 'utf8')).toBe('second')
  })
})

describe('withWriteLock', () => {
  test('releases the lock when the work is done', async () => {
    await withWriteLock(root, async () => undefined)
    expect((await readdir(root)).includes('.write.lock')).toBe(false)
  })

  test('releases the lock even when the work throws', async () => {
    await expect(
      withWriteLock(root, async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect((await readdir(root)).includes('.write.lock')).toBe(false)
  })

  test('runs overlapping work one at a time', async () => {
    const order: string[] = []
    const work = (name: string) =>
      withWriteLock(root, async () => {
        order.push(`${name}:start`)
        await new Promise((resolve) => setTimeout(resolve, 10))
        order.push(`${name}:end`)
      })

    await Promise.all([work('a'), work('b')])
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
  })

  test('breaks a lock whose holder died rather than blocking forever', async () => {
    const lock = join(root, '.write.lock')
    await writeFile(lock, '99999\n', 'utf8')
    const longAgo = new Date(Date.now() - 60_000)
    await utimes(lock, longAgo, longAgo)

    await expect(withWriteLock(root, async () => 'done')).resolves.toBe('done')
  })
})

describe('a lock that cannot be created', () => {
  test('reports why instead of waiting for a holder that does not exist', async () => {
    const missing = join(root, 'no', 'such', 'directory')
    const started = Date.now()

    await expect(withWriteLock(missing, async () => undefined)).rejects.toThrow(/ENOENT/)
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})
