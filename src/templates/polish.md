Review every uncommitted change in the current repository, including both staged and unstaged changes.

First, call the `knowledge_context` tool with the current working directory, and read what it returns. It is the authoritative guidance for this repository: coding standards, conventions, past decisions and the user's stated preferences. Apply it before proposing anything. If an index entry looks relevant but its body was not inlined, fetch it with `knowledge_read`.

The goal is production-quality code with no AI slop. Prefer the smallest, most idiomatic solution that fits the codebase. Remove or avoid generic abstractions, speculative features, redundant comments, unnecessary fallback logic, dead code, placeholder names, and inconsistent formatting. Do not introduce dependencies, patterns, or complexity unless the existing architecture or concrete requirements justify them.

Assess the changes against:

- The knowledge entries returned for this repository
- Existing architecture, implementation patterns, and conventions in the surrounding codebase
- Clean TypeScript: precise types, safe narrowing, no unnecessary `any`, sound nullability, and readable type design
- General software-engineering best practices: correctness, maintainability, readability, error handling, security, and performance where relevant
- Consistency with established UI, API, backend, testing, and i18n patterns when those areas are affected

Use the current diff and relevant nearby code as evidence. Do not make unrelated refactors or modify user-owned configuration, generated files, secrets, or lockfiles unless the diff itself requires it.

Then:

1. Summarize the issues you found, ordered by severity, with file and line references. When an issue violates a knowledge entry, name that entry by its id so it is clear which rule applied.
2. Fix all clear, in-scope issues directly.
3. Explain any issue that needs a product, architectural, or user decision instead of guessing.
4. Verify the edited files with the most relevant existing checks, unless repository instructions say not to run them.
5. Finish with a concise summary of what changed and what, if anything, remains.
