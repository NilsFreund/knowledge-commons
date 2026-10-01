import { describe, expect, test } from 'bun:test'
import { configSchema, isWithin, resolveScope, type StoreConfig } from '../src/core/index.ts'

const config: StoreConfig = configSchema.parse({
  scopes: {
    '/repos/shop': { scope: 'shop', inherits: ['global'] },
    '/repos/shop/services/billing': { scope: 'shop-billing', inherits: ['shop', 'global'] },
    '/repos/website': { scope: 'website', inherits: [] },
  },
})

describe('resolveScope', () => {
  test('falls back to the global scope outside any configured repository', () => {
    expect(resolveScope('/tmp/elsewhere', config).scopes).toEqual(['global'])
  })

  test('matches a repository from any directory inside it', () => {
    expect(resolveScope('/repos/shop/frontend/src', config).scopes).toEqual(['shop', 'global'])
  })

  test('prefers the most specific rule over an enclosing one', () => {
    expect(resolveScope('/repos/shop/services/billing/src', config).scopes).toEqual(['shop-billing', 'shop', 'global'])
  })

  test('honours a rule that inherits nothing', () => {
    expect(resolveScope('/repos/website', config).scopes).toEqual(['website'])
  })

  test('does not leak between repositories that share a name prefix', () => {
    expect(resolveScope('/repos/shop-archive', config).scopes).toEqual(['global'])
  })

  test('drops a scope repeated in inherits', () => {
    const withRepeat = configSchema.parse({ scopes: { '/repos/x': { scope: 'x', inherits: ['x', 'global'] } } })
    expect(resolveScope('/repos/x', withRepeat).scopes).toEqual(['x', 'global'])
  })
})

describe('isWithin', () => {
  test('accepts the directory itself and anything below it', () => {
    expect(isWithin('/repos/shop', '/repos/shop')).toBe(true)
    expect(isWithin('/repos/shop', '/repos/shop/src')).toBe(true)
  })

  test('rejects a sibling with the same prefix', () => {
    expect(isWithin('/repos/shop', '/repos/shop-archive')).toBe(false)
  })
})

describe('the matched repository root', () => {
  test('is the configured path, not the directory that was asked about', () => {
    expect(resolveScope('/repos/shop/frontend/src', config).root).toBe('/repos/shop')
  })

  test('is the most specific rule when several match', () => {
    expect(resolveScope('/repos/shop/services/billing/src', config).root).toBe('/repos/shop/services/billing')
  })

  test('is absent outside any configured repository', () => {
    expect(resolveScope('/tmp/elsewhere', config).root).toBeUndefined()
  })
})
