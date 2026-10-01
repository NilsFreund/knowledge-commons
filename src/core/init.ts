import { existsSync } from 'node:fs'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ok, type Result } from './result.ts'
import { saveConfig } from './config.ts'
import { STATS_FILE } from './stats.ts'
import { configSchema, DEFAULT_SCOPE } from './types.ts'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
/** `dist/templates` once bundled, `src/templates` when running from source. */
const TEMPLATE_DIR = existsSync(join(MODULE_DIR, 'templates'))
  ? join(MODULE_DIR, 'templates')
  : join(MODULE_DIR, '..', 'templates')

const PROMPTS = ['polish', 'write-knowledge', 'write-research', 'read-research'] as const

export interface InitResult {
  readonly root: string
  readonly created: readonly string[]
}

export async function initStore(root: string): Promise<Result<InitResult>> {
  const resolved = resolve(root)
  const created: string[] = []

  await mkdir(join(resolved, 'knowledge', DEFAULT_SCOPE), { recursive: true })
  await mkdir(join(resolved, 'commands'), { recursive: true })

  for (const prompt of PROMPTS) {
    const target = join(resolved, 'commands', `${prompt}.md`)
    if (await copyIfAbsent(join(TEMPLATE_DIR, `${prompt}.md`), target)) created.push(target)
  }

  const readme = join(resolved, 'README.md')
  if (await copyIfAbsent(join(TEMPLATE_DIR, 'store-readme.md'), readme)) created.push(readme)

  const config = join(resolved, 'config.json')
  if (!existsSync(config)) {
    await saveConfig(resolved, configSchema.parse({}))
    created.push(config)
  }

  const gitignore = join(resolved, '.gitignore')
  if (!existsSync(gitignore)) {
    await writeFile(gitignore, `.DS_Store\n${STATS_FILE}\n.write.lock\n*.tmp\n`, 'utf8')
    created.push(gitignore)
  }

  return ok({ root: resolved, created })
}

async function copyIfAbsent(source: string, target: string): Promise<boolean> {
  if (existsSync(target)) return false
  await copyFile(source, target)
  return true
}
