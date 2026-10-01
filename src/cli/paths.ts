import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { ServerInvocation } from './install.ts'

const DEFAULT_STORE_DIR = '.knowledge'

export function resolveStoreRoot(explicit: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  const chosen = explicit ?? env['KN_HOME']
  return chosen ? resolve(chosen) : join(homedir(), DEFAULT_STORE_DIR)
}

/** Installed, the binary runs itself; from source it needs the runtime that is running it now. */
export function serverInvocation(argv: readonly string[] = process.argv): ServerInvocation {
  const [runtime, script] = argv
  if (script === undefined || runtime === undefined) {
    throw new Error('cannot determine how this command was started')
  }
  const scriptPath = isAbsolute(script) ? script : resolve(script)
  return scriptPath.endsWith('.ts')
    ? { command: runtime, args: [scriptPath, 'mcp'] }
    : { command: scriptPath, args: ['mcp'] }
}
