# Contributing

```bash
bun install
bun test
bun run typecheck
bun run ./src/cli/index.ts --help
```

## How the pieces fit

`src/core` owns the store. It imports nothing from the other directories, does not read
`process.argv` or the environment, and does not write to stdout. The store path is passed in. Tests
run against it without mocks, and any transport can serve it.

Expected failures come back as a `Result`: a missing entry, invalid frontmatter, a store that is not
there, a write that ran into the lock. Unexpected I/O is not wrapped. If a scope directory cannot be
read, `load` and everything built on it will throw, and the frontends catch that at their boundary.

Inside `core`, each module has one job. `store.ts` does entry operations and `research.ts` does the
same for research documents. `entry-file.ts` handles a single file on disk. `similarity.ts` scores
duplicates, `search.ts` scores queries, and `duplicates.ts` serves both callers of similarity.
`doctor.ts` is a pure function over loaded entries. `write.ts` and `serialize.ts` hold the write lock
and the atomic rename. The smaller ones are `config.ts`, `prompts.ts`, `scope.ts`, `discover.ts`,
`instructions.ts`, `stats.ts` and `init.ts`, with `types.ts` and `result.ts` for the shared shapes
and `index.ts` as the public surface.

`src/usage.ts` sits with the frontends rather than in the core, because honouring `KN_NO_USAGE`
means reading the environment and the core does not do that.

Everything else is a thin layer on top:

- `src/mcp` serves the core over MCP for agents.
- `src/cli` serves the same operations to a person or a script, and installs the server.
- `src/importers` turns another tool's format into entries. These are pure parsers, and none of them
  touches the store.
- `src/render.ts` turns results into text. Both frontends go through it, so an agent sees the same
  wording whichever way it arrived.

Keep that direction. `core` knows nothing about its callers, and `cli` is the only layer allowed to
reach across to the others. A change that makes the core aware of how it is being called belongs in
a frontend instead.

## Style

Comments are rare and one line. The code should say what it does through names and types. A comment
earns its place by recording a why that the code cannot express, such as a measured trade-off or a
constraint from someone else's file format. The repository currently has 38 of them.

No type assertions. `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on,
and there are currently zero `as` casts outside `as const`. Reach for a type guard or a `Map`
instead of asserting past the checker.

A loop states its exit in the header. Split a condition into named helpers before it grows into a
multi-line predicate. Write a priority order of fallbacks as early returns instead of chaining
`??`.

## Writing an importer

An importer is a function from someone else's format to candidate entries. See
`src/importers/claude.ts` for one that produces entries directly, and `src/importers/codex.ts` for
one that produces candidates a human or an agent still has to review.

Be forgiving. These files are written by agents over months and they drift: frontmatter goes
missing, YAML stops parsing, naming conventions change halfway through a directory. Recover what you
can from filenames and headings and report the files you cannot read, but let the rest of the run
finish.

## Tests

`bun test` runs 239 of them across every layer. The core is tested directly, the MCP server through a
real client over an in-memory transport pair, and the CLI by calling `main()` and reading what it
prints. Fixtures are invented. No real knowledge stores, no real repository names and no
personal paths belong in the tests or anywhere else in this repository.

The duplicate-detection threshold is pinned by `test/similarity.test.ts`. It asserts that a reworded
duplicate and a merely similar entry stay on opposite sides of it with margin. If a change to
scoring brings them closer together, fix the scoring instead of the test.
