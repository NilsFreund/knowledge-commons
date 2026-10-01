# knowledge-commons

One knowledge store for every coding agent.

If you use more than one agent, you keep the same facts in more than one place. Claude Code has its
memory directory, Codex has its `MEMORY.md`, Cursor has its rules and commands, and each of them
learns the same thing separately. Often one of them learns it and the others never do.

`kn` keeps those facts in one store and serves it to all of them over MCP. The agents read and write
that store through tools, so correcting a fact once corrects it for all of them.

## Install

Not published yet. Clone it and install from the checkout:

```bash
git clone https://github.com/NilsFreund/knowledge-commons.git
cd knowledge-commons
bun install
npm install -g .
kn init
```

Bun builds it. The installed binary runs on plain Node 24 or newer and has its dependencies compiled
in, so npm installs nothing alongside it.

`kn init` creates `~/.knowledge` and tells you what is already on the machine:

```
Store ready at /Users/you/.knowledge.

Found on this machine:
    44  ~/.claude/projects/-Users-you-code-shop/memory  ->  shop
    21  ~/.claude/projects/-Users-you-code-site/memory  ->  site
        ~/.codex/memories/MEMORY.md  ->  needs review by hand

Take it with `kn init --import`, or start empty with `kn install`.
```

`kn init --import` takes the lot: every entry is imported and each repository is mapped to its scope,
so the store is useful from the first call. It does not scan the disk: the agents record their own
project paths, and `kn` reads those.

Set `KN_HOME` or pass `--store` to keep the store somewhere else. A private git repository is a good
choice, and the easiest way to move it between machines.

Then register the server with your agents:

```bash
kn install
```

This writes an `mcp_servers` entry for Claude Code, Codex and Cursor, plus one small command file per
agent. It never rewrites a server entry that is already there, and it keeps a copy of anything it
replaces. Use `--dry-run` to see what it would do first. Restart your agents afterwards.

## Using it

Four commands are set up, and they work the same way in every agent:

| | |
|---|---|
| `/polish` | Review the current diff against everything the store knows about this repository |
| `/write-knowledge` | Record what you just taught the agent, for all of them |
| `/write-research` | Record what a piece of research found, so it is not done twice |
| `/read-research` | Find out what is already established on a topic |

```
you: don't ever commit, I do all the git myself
you: /write-knowledge
agent: Created global/feedback-never-commit.
```

Open Codex tomorrow in a different repository and it already knows.

The command files in your agents' directories hold no instructions of their own. They ask the store
for the current version, so editing `~/.knowledge/commands/polish.md` changes what `/polish` does
everywhere without reinstalling anything.

A new store answers every question with nothing until you put something in it. It becomes useful at a
handful of entries, roughly a few days of saying "record that" when you correct something. The tools
report an empty store as empty, which is usually enough for an agent to offer to record the first
entry.

## What an entry looks like

```markdown
---
name: feedback-never-commit
description: The user performs all git operations themselves
type: feedback
created: 2026-07-15
updated: 2026-09-20
sources: [claude:shop]
---

Never run git commit, git push or git merge. Stage the changes and stop there.
Related: [[feedback-commit-messages]].
```

One fact per file, in `knowledge/<scope>/<name>.md`. The scope comes from the directory, so it
cannot drift out of sync with the frontmatter. `global` applies everywhere; every other scope is a
repository, and repositories inherit from `global` by default.

Four types, which decide how an entry is used: `feedback` (how you want the agent to work, always
loaded), `project` (constraints and decisions that are not visible in the code), `reference`
(pointers to dashboards, runbooks, tickets) and `user` (who you are).

## Not writing the same thing twice

`knowledge_write` is two-step, because a store that fills up with near-duplicates stops being worth
reading. If entries already say something similar, the call reports them and writes nothing:

```
Nothing was written. 1 existing entry looks like the same fact:

- 0.39  global/feedback-never-commit - The user performs all git operations themselves

Read them, then write again: pass updateName to merge into one, or confirm to add a separate entry.
```

The agent reads them and decides. When nothing similar exists it writes straight away, so the common
case stays one call.

Detection compares content words rather than character n-grams, because the case that matters is the
same rule in different words. It is tuned for recall, so it over-reports and leaves the judgement to
the agent. `kn doctor --dismiss a b` records a pair you have read and found different, which keeps
the report from listing it forever.

### Instructions the repository carries itself

A repository often has its own `AGENTS.md` or `CLAUDE.md`, and each agent loads only its own
convention: Claude Code never reads `AGENTS.md`, Codex never reads `CLAUDE.md`. `knowledge_context`
names whichever of them it finds, along with `.cursor/rules/`, so every agent knows they are there.
It names the paths rather than including the text, since the agent can open a file and its host may
have loaded it already.

## Research

Knowledge entries are short standing rules. Research is what you worked out once and do not want to
work out again. It lives in the same store, in its own directory, and is kept apart from the
knowledge side on purpose.

```bash
kn research list
kn research search connection pooling
kn research read pool-behaviour-on-restart
```

Name a document after the question it answers rather than the answer itself, since the answer is what
changes. Recording the same name again appends a dated round instead of overwriting:

```markdown
---
name: pool-behaviour-on-restart
title: What the connection pool does when the database restarts
created: 2026-09-23
updated: 2026-11-02
sources: [https://example.test/driver-docs]
---

## 2026-09-23

Idle connections are dropped and reopened lazily on the next query.

## 2026-11-02

Correction: the driver keeps them, so the first query after a restart fails.
```

Keeping the rounds means a reversal stays visible: you can see what changed and when, rather than
reading a document that was quietly rewritten.

Research is not loaded into `knowledge_context` and plays no part in `/polish`. An agent reaches it
by calling `research_search`.

## Bringing in what you already have

`kn init --import` covers the usual case. The importers can also be pointed at one directory at a
time:

```bash
kn import claude --from ~/.claude/projects/<project>/memory --scope shop
kn import codex  --from ~/.codex/memories/MEMORY.md --out candidates.jsonl
```

The Claude importer is direct, because that format is already one fact per file. It is deliberately
forgiving, since those directories drift over months: it recovers files with no frontmatter, files
whose frontmatter stopped being valid YAML, and files missing a type, and it repairs `[[wikilinks]]`
written against any of the naming conventions such a directory accumulates.

The Codex importer is not direct, because `MEMORY.md` is a session log rather than curated
knowledge. It lifts out the sections that are already written as standing statements and hands them
back as candidates for you or an agent to review, name and record.

Afterwards, run `kn doctor`.

## Knowing whether it is used

```bash
kn stats
```

```
1284 calls, 2026-09-14 to 2026-09-21, 3 errors

 calls  errors     p50  name               source
   812       0     4ms  knowledge_context  mcp
   311       2     3ms  knowledge_search   mcp
    48       1     6ms  knowledge_write    mcp

knowledge_context
     640  shop
     172  global

knowledge_write
      31  created
      12  updated
       5  candidates
```

Every tool and command call appends one line to `.usage.jsonl` in the store. The file never leaves
the machine, and it is gitignored so it does not churn a versioned store. The two breakdowns are
what you actually read: which repositories pull knowledge, and how often a write turns out to be
something the store already knew.

`--since <days>` narrows the window, `--prune <days>` trims the log, and setting `KN_NO_USAGE`
switches recording off entirely.

## Concurrent agents

Several agents run a server each, against one store, and they write to it while you work. Writes
take a lock on the store and land through an atomic rename, so two agents recording something at the
same moment produce two entries rather than one overwriting the other. A lock left behind by a
process that died is broken after 30 seconds.

Reads do not take the lock, and there is no cache. The store is re-read on every call, so an entry
you edit by hand takes effect at once.

## MCP tools

| Tool | What it does |
|---|---|
| `knowledge_context` | Everything recorded for a directory: an index, the always-relevant bodies, and any instruction files the repository carries |
| `knowledge_search` | Find entries by term |
| `knowledge_read` | Full text of entries by name |
| `knowledge_write` | Record a fact, with duplicate detection |
| `knowledge_prompt` | The current instructions for a stored command |
| `knowledge_index` | Everything in the store, across all scopes |
| `research_write` | Record a research result, appending a dated round if the question was asked before |
| `research_search` | Find research on a topic before doing it again |
| `research_read` | Full documents by name, every round included |
| `research_list` | Every recorded question, its rounds and when it was last revisited |

Search matches whole words and word prefixes, so `rec` finds `recording` while `art` does not find
`restart`.

## CLI

`kn <command> --help` for any of them.

| | |
|---|---|
| `kn init` | Create a store; `--import` also takes what it finds on the machine |
| `kn scope add\|list\|remove` | Map repositories to scopes (`kn init --import` does this for you) |
| `kn context` `search` `read` `list` | The same reads as the tools, for a terminal or a script (`--json` for pipes) |
| `kn write` | Record an entry from JSON on stdin |
| `kn research list\|search\|read` | Recorded research |
| `kn import claude\|codex` | Bring in what another agent already knows |
| `kn install` | Register the server and command stubs with your agents |
| `kn doctor` | Broken links, duplicate names, near-duplicates, unreadable files |
| `kn stats` | How often the tools and commands have been called |
| `kn mcp` | Serve over stdio; your agents run this, you normally do not |

## License

MIT. See [CONTRIBUTING.md](CONTRIBUTING.md) to work on it.
