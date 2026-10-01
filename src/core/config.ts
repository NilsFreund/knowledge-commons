import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { err, ok, type Result } from './result.ts'
import { configSchema, type StoreConfig } from './types.ts'
import { writeFileAtomic } from './write.ts'

export async function loadConfig(root: string): Promise<Result<StoreConfig>> {
  const path = join(root, 'config.json')

  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return ok(configSchema.parse({}))
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    return err('invalid_config', `${path} is not valid JSON`, [String(cause)])
  }

  const config = configSchema.safeParse(parsed)
  return config.success ? ok(config.data) : err('invalid_config', `${path} is invalid`, issues(config.error))
}

export async function saveConfig(root: string, config: StoreConfig): Promise<void> {
  await writeFileAtomic(join(root, 'config.json'), `${JSON.stringify(config, null, 2)}\n`)
}

function issues(error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }): readonly string[] {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
}
