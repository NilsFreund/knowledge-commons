import { parseArgs } from 'node:util'
import { COMMANDS, type Command } from './commands.ts'
import { Options, UsageError } from './options.ts'
import { resolveStoreRoot } from './paths.ts'
import { record as recordUsage } from '../usage.ts'

const HELP_FLAGS = ['help', '--help', '-h']

export async function main(argv: readonly string[]): Promise<number> {
  const [name, ...rest] = argv
  if (name === undefined || HELP_FLAGS.includes(name)) {
    console.log(usage())
    return 0
  }

  const command = COMMANDS[name]
  if (!command) {
    console.error(`Unknown command \`${name}\`.\n\n${usage()}`)
    return 1
  }

  if (rest.some((argument) => HELP_FLAGS.includes(argument))) {
    console.log(`${command.summary}\n\nUsage: ${command.usage}`)
    return 0
  }

  return await run(name, command, rest)
}

async function run(name: string, command: Command, args: readonly string[]): Promise<number> {
  const started = Date.now()
  let root: string | undefined

  try {
    const parsed = parseArgs({ args: [...args], options: { ...command.options }, allowPositionals: true, strict: true })
    const options = new Options(parsed.values)
    root = resolveStoreRoot(options.string('store'))

    const code = await command.run({ options, positionals: parsed.positionals })
    await record(root, name, true, started)
    return code
  } catch (cause) {
    await record(root ?? resolveStoreRoot(undefined), name, false, started)

    if (cause instanceof UsageError) {
      console.error(`${cause.message}\n\nUsage: ${command.usage}`)
      return 2
    }
    console.error(cause instanceof Error ? cause.message : String(cause))
    return 1
  }
}

async function record(root: string, name: string, ok: boolean, started: number): Promise<void> {
  await recordUsage(root, { at: new Date().toISOString(), source: 'cli', name, ok, ms: Date.now() - started })
}

function usage(): string {
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length))
  return [
    'kn - one knowledge store for every coding agent',
    '',
    'Usage: kn <command> [options]',
    '',
    ...Object.entries(COMMANDS).map(([name, command]) => `  ${name.padEnd(width)}  ${command.summary}`),
    '',
    'Every command takes --store <path> to pick a store; otherwise $KN_HOME, otherwise ~/.knowledge.',
    'Run `kn <command> --help` for that command\'s usage.',
  ].join('\n')
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2))
}
