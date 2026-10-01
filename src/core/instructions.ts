import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const FILES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md']
const DIRECTORIES = ['.cursor/rules']

/** Each agent loads only its own convention, so Claude Code never sees `AGENTS.md` and Codex never sees `CLAUDE.md`. */
export async function findInstructionFiles(root: string): Promise<readonly string[]> {
  const found: string[] = []

  for (const file of FILES) {
    if (await isFile(join(root, file))) found.push(file)
  }
  for (const directory of DIRECTORIES) {
    if (await hasEntries(join(root, directory))) found.push(`${directory}/`)
  }

  return found
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function hasEntries(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).length > 0
  } catch {
    return false
  }
}
