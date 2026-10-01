const chains = new Map<string, Promise<unknown>>()

/** MCP servers answer requests concurrently, so same-process calls need ordering of their own. */
export function serialize<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve()
  const next = previous.then(run, run)
  chains.set(
    key,
    next.catch(() => undefined),
  )
  return next
}
