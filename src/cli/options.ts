import type { ParseArgsConfig } from 'node:util'

export type OptionDefs = NonNullable<ParseArgsConfig['options']>
type OptionValues = Record<string, string | boolean | (string | boolean)[] | undefined>

export class UsageError extends Error {}

export class Options {
  constructor(private readonly values: OptionValues) {}

  string(key: string): string | undefined {
    const value = this.values[key]
    return typeof value === 'string' ? value : undefined
  }

  required(key: string, message: string): string {
    const value = this.string(key)
    if (value === undefined) throw new UsageError(message)
    return value
  }

  flag(key: string): boolean {
    return this.values[key] === true
  }

  list(key: string): readonly string[] | undefined {
    const value = this.values[key]
    if (!Array.isArray(value)) return undefined
    return value.filter((item): item is string => typeof item === 'string')
  }

  commaList(key: string): readonly string[] | undefined {
    return this.string(key)
      ?.split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  }

  integer(key: string): number | undefined {
    const raw = this.string(key)
    if (raw === undefined) return undefined

    const value = Number(raw)
    if (!Number.isInteger(value) || value < 1) throw new UsageError(`--${key} must be a positive integer, got \`${raw}\``)
    return value
  }
}
