Record what the user just taught you as a knowledge entry, so every agent picks it up from now on.

## What counts as one entry

One entry holds exactly one durable fact. If the user said several things, write several entries, one call each. Skip anything that is already obvious from the code, the git history or the repository's own documentation, and anything that only matters inside this conversation.

Pick the type:

- `feedback`: how the user wants you to work (corrections, confirmed approaches). Include why, and how to apply it.
- `project`: ongoing work, goals or constraints that are not derivable from the code.
- `reference`: a pointer to an external resource: a dashboard, a runbook, a ticket.
- `user`: who the user is: role, expertise, standing preferences.

Pick the scope: use the repository scope from `knowledge_context` for anything tied to this codebase, and `global` for how the user works in general. When in doubt, prefer `global` for working style and the repository scope for technical facts.

## How to write it

State the fact in the body as a standing instruction, not as a report of this conversation: "Commit messages are a single Conventional-Commits subject line, no body", never "The user said today that...". Convert relative dates to absolute ones. Link related entries with `[[their-name]]`.

Name it `<type>-<subject>` in kebab-case, for example `feedback-never-commit`. Write a one-line description that says what the entry decides, since that line is what future agents scan.

## How to write it down

1. Call `knowledge_write` with name, description, type, scope and body.
2. If it comes back with duplicate candidates, read them with `knowledge_read` and decide:
   - the same rule, differently worded -> call again with `updateName` set to that entry and a body that merges both, keeping what the existing one already got right
   - genuinely different -> call again with `confirm: true`
3. Report the result in one line: created or merged, which scope, which id.
