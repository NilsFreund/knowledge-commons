import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { err, ok, type Result } from './result.ts'

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
const EXTENSION = '.md'

export async function readPrompt(commandsDir: string, name: string): Promise<Result<string>> {
  if (!NAME_PATTERN.test(name)) return err('prompt_not_found', `invalid prompt name \`${name}\``)

  try {
    return ok(await readFile(join(commandsDir, `${name}${EXTENSION}`), 'utf8'))
  } catch {
    return err('prompt_not_found', `no prompt \`${name}\` in ${commandsDir}`)
  }
}

export async function listPrompts(commandsDir: string): Promise<readonly string[]> {
  try {
    return (await readdir(commandsDir))
      .filter((file) => file.endsWith(EXTENSION))
      .map((file) => file.slice(0, -EXTENSION.length))
      .sort()
  } catch {
    return []
  }
}
