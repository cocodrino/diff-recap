# local-recap

A fully-local alternative to `visual-recap`: turn a git diff into a single
self-contained interactive `recap.html` — architecture diagram, annotated
side-by-side diffs, and per-file / per-hunk AI explanations of **why** the code
changed. No external service, no server, no CDN. It opens offline via `file://`.

## Why

`visual-recap` (and its "local-files mode") still depends on the
`@agent-native/core` package and the hosted Plan UI reading through a localhost
bridge — your code shape leaves the machine and the viewer is not yours. This
skill produces one HTML file that contains everything (viewer + Mermaid engine +
data) and opens in any browser, offline.

## Pipeline

```
1. scripts/collect.mjs   git range  ──▶  recap-data.json   (facts, true by construction)
2. the agent authors     analysis   ──▶  analysis.json     (summary, diagram, WHY per file/hunk)
3. scripts/generate.mjs  merge       ──▶  recap.html        (one self-contained file)
```

## Quick start

```bash
# inside the repo you want to recap
node /path/to/scripts/collect.mjs --base main --head HEAD --out recap-data.json
# ...author analysis.json (see SKILL.md for the schema)...
node /path/to/scripts/generate.mjs --data recap-data.json --analysis analysis.json --open
```

## Layout

- `SKILL.md` — agent instructions (the entry point when invoked as a skill).
- `scripts/collect.mjs` — extracts the diff into deterministic `recap-data.json`.
- `scripts/generate.mjs` — inlines the viewer + Mermaid + data into `recap.html`.
- `assets/viewer.css`, `assets/viewer.js` — the embedded viewer (vanilla, no deps).
- `assets/mermaid.min.js` — vendored Mermaid for offline diagram rendering.

## Requirements

Node.js and `git`. Run inside a git repository.
