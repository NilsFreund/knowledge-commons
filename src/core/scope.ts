import { resolve, sep } from 'node:path'
import { DEFAULT_SCOPE, type ScopeRule, type StoreConfig } from './types.ts'

export interface ScopeMatch {
  readonly scopes: readonly string[]
  /** The configured repository the path sits in, which is where its own agent instructions live. */
  readonly root?: string
}

export function resolveScope(cwd: string, config: StoreConfig): ScopeMatch {
  const match = bestMatch(cwd, config)
  if (match === undefined) return { scopes: [DEFAULT_SCOPE] }
  return { scopes: [...new Set([match.rule.scope, ...match.rule.inherits])], root: match.path }
}

function bestMatch(cwd: string, config: StoreConfig): { path: string; rule: ScopeRule } | undefined {
  const target = resolve(cwd)
  return Object.entries(config.scopes)
    .map(([path, rule]) => ({ path: resolve(path), rule }))
    .filter(({ path }) => isWithin(path, target))
    .sort((a, b) => b.path.length - a.path.length)
    .at(0)
}

export function isWithin(parent: string, child: string): boolean {
  if (child === parent) return true
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep)
}
