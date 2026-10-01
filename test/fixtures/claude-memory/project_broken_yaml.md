---
name: project-broken-yaml
description: Order matters here: pass the options last, never first
metadata:
  node_type: memory
  type: project
  modified: 2026-07-20
---

The unquoted colon above makes this frontmatter invalid YAML, but the fields are still readable.
