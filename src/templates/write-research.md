Record what this research found, so it does not have to be done again.

## Name it after the question, not the answer

The name is a stable kebab-case slug for the question being answered: `pool-behaviour-on-restart`
rather than `pool-reopens-lazily`. The answer is the part that changes, and a later round has to
land on the same name to be appended instead of scattered across near-duplicates.

Call `research_search` first with the topic. If something close already exists, reuse its exact name.

## What goes in

Write up the findings rather than a transcript of how you got there. Say what is true, what it rests
on, and where it stops.

- Lead with the answer to the question in a few lines. If there is no clean answer, say what blocks it.
- Then the detail that justifies it: numbers, names, file paths, API behaviour, quoted limits.
- Say explicitly what you did not establish, so the next reader does not assume you checked it.
- Put every source in `sources`: URLs, file paths, dashboards, the person who told you. A finding
  without a source cannot be rechecked later.

Do not pad it. Write it so that someone can rely on it in six months, which has little to do with
how long it is.

## Then

Call `research_write` with `name`, `title`, `scope`, `body` and `sources`. Use the repository scope
when the finding only holds for that codebase, and `global` when it holds generally.

Recording a name that already exists appends a new dated round and keeps the old one. Do not restate
what an earlier round already said: write what is new, and say plainly where it corrects or
supersedes what was there before.

Report the result in one line: recorded or appended, which id, how many rounds.
