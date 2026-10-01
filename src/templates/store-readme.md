# Knowledge store

Data for `knowledge-commons`. Every coding agent reads and writes these files over MCP, so a fact
only has to be correct here.

- `knowledge/<scope>/<name>.md` holds one fact per file. `global` applies everywhere, every other scope
  is a repository (see `config.json`).
- `commands/*.md` are the prompts agents run for `/polish` and `/write-knowledge`. Edit them here;
  nothing needs to be re-deployed.
- `config.json` says which directory maps to which scope, and the duplicate-detection threshold.

This directory is yours. Putting it under version control is a good idea; it is also the easiest way
to move it between machines.
