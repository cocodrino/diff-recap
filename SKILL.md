---
name: local-recap
description: >-
  Turn a git range, branch, or PR diff into a single self-contained,
  fully-local interactive recap HTML — diagrams, annotated side-by-side diffs,
  per-file and per-hunk AI explanations of WHY the code changed. No external
  service, no server, no CDN: the output opens offline via file://.
metadata:
  visibility: exported
---

# Local Recap

`/local-recap` builds an interactive visual recap **from a diff**, like a
code-review summary that a reviewer scans before reading raw lines — but the
deliverable is a single `recap.html` file that opens in any browser over
`file://`. Nothing is uploaded, no localhost bridge, no hosted viewer. Diagrams
(Mermaid), the side-by-side diffs, and the AI prose are all embedded in that one
file.

## How It Works — Three Stages

The pipeline cleanly separates **facts** (extracted mechanically from git) from
**explanation** (written by you, the model). Facts are true by construction;
prose is the only thing you author.

```
1. collect.mjs   git range  ──▶  recap-data.json   (facts: files, hunks, stats, commits)
2. YOU           analyze     ──▶  analysis.json     (summary, diagram, per-file & per-hunk WHY)
3. generate.mjs  merge       ──▶  recap.html        (one self-contained file)  ──▶ open
```

## Steps

### 1. Pick the range and collect the facts

Default scope is the whole work unit — the branch against its base. Resolve the
base/head, then run the collector (from the repo you are recapping):

```bash
node <skill-dir>/scripts/collect.mjs --base main --head HEAD
```

- `--base <ref>` / `--head <ref>` — explicit endpoints. If omitted, base
  auto-detects `main`/`master`/`develop`; head defaults to `HEAD`.
- `--range "<gitspec>"` — pass a raw spec instead (e.g. `"abc123...def456"`,
  `"v1.0..v1.1"`). Overrides base/head.
- `--working` — include uncommitted working-tree changes.
- `--context <n>` — diff context lines (default 3).
- `--out <file>` — override the output path (rarely needed).

**Output location.** By default everything for a recap lives together under
`<repo-root>/.recap/<branch>/` — so `collect.mjs` writes
`.recap/<branch>/recap-data.json` (branch = current branch slug, or `workspace`
when detached). You author `analysis.json` in that same folder, and
`generate.mjs` writes `recap.html` there too. The directory is created
automatically.

`recap-data.json` holds the facts: real paths, statuses (added/modified/removed/
renamed), per-file insertions/deletions, parsed hunks with before/after lines,
and the commits in range. **Never edit this file** — it is the source of truth.

### 2. Read the facts and author `analysis.json`

Read `recap-data.json` and write `analysis.json` next to it (same
`.recap/<branch>/` folder). This is where you add value: the narrative and the
WHY. Ground everything in the actual diff — real symbols, real behavior. **If
the diff does not contain a fact, do not invent it.** A confidently wrong recap
is dangerous in review.

**Language.** Write ALL prose — `title`, `summary`, diagram labels, file
`purpose`, and hunk explanations — in the SAME language you are conversing with
the user. If the user talks to you in Spanish, write the recap in Spanish; in
English, English. Set `"lang"` to the matching code (`"es"`, `"en"`, …) so the
viewer's own chrome (buttons, section titles) is localized to match. English and
Spanish chrome are built in; other codes keep English chrome but your prose
stays in whatever language you wrote.

Schema (all fields optional except where noted — omit what does not apply):

```jsonc
{
  "lang": "es",
  "title": "Short outcome-focused title (≤70 chars)",
  "summary": "Markdown. EXHAUSTIVE: what changed, why it matters, compatibility/risk, decisions. Use ## headings, lists, `code`, **bold**, > quotes.",
  "overview": {
    "diagramTitle": "Architecture / data-flow after the change",
    "diagram": "Mermaid source (flowchart/sequenceDiagram/erDiagram/etc.) of the architecture or flow the diff produces"
  },
  "files": {
    "<exact path from recap-data.json>": {
      "purpose": "Markdown. What role this file plays in the change and why it changed.",
      "hunks": {
        "0": "Simple block → a one-line Markdown string. What this hunk does and WHY.",
        "1": {
          "note": "One-line intent, always shown above the diff.",
          "detail": "Markdown. EXTENSIVE, plain-language walkthrough for a hard-to-understand block: what each step does, why it works, gotchas. Use lists / ### sub-headings.",
          "complexity": "high"
        }
      }
    }
  }
}
```

Authoring guidance:

- **Summary must be substantial.** Address the user's complaint about thin
  recaps: cover the objective, the key changes, the compatibility/risk read, and
  notable decisions. Multiple `##` sections are good.
- **One diagram that adds insight.** A Mermaid flow/sequence/ER diagram of the
  architecture or data flow the change produces — not a restatement of the file
  list. Skip it only when the change has no structural story.
- **Per-file `purpose`** for every meaningful file: why it exists in this change.
- **Per-hunk explanations** keyed by the hunk's array index (`"0"`, `"1"`, …) as
  ordered in `recap-data.json`. You do not need one per hunk — annotate the
  load-bearing ones. This is the headline feature: the reviewer reads intent
  before code.
- **Hard blocks get an extensive explanation.** When a hunk's code is
  non-obvious — clever algorithms, regex, bit manipulation, async/concurrency
  edge cases, framework "magic", dense one-liners, non-trivial data transforms —
  use the object form `{ note, detail, complexity: "high" }`. The `detail` is a
  thorough, plain-language walkthrough so a reader who does not know the codebase
  understands exactly what the block does and why it works (step the logic,
  name the gotchas). It renders as an expandable "Detailed explanation" (open by
  default for `complexity: "high"`) and the hunk gets a "Complex" badge. For
  genuinely simple hunks, keep the one-line string — do not pad obvious code.
- **Security:** never transcribe secrets (API keys, tokens, `.env` values) into
  prose. Redact (`sk-•••`).

### 3. Generate and open the recap

```bash
node <skill-dir>/scripts/generate.mjs --open
```

With no flags it reads `.recap/<branch>/recap-data.json` and
`.recap/<branch>/analysis.json` and writes `.recap/<branch>/recap.html`.
`--open` launches the default browser. Override any path with `--data`,
`--analysis`, or `--out` if needed. The result is one self-contained HTML
(~3 MB, mostly the inlined Mermaid engine). Report the absolute path of
`recap.html` to the user — that IS the deliverable.

## What The Viewer Gives The Reviewer

- **Overview**: the exhaustive summary, the architecture diagram, the commit
  list, and a clickable grid of changed files.
- **Per-file detail** (click a file or open `recap.html#file/<n>`): the file's
  status, the AI "why this file changed" note, then each hunk with its AI
  annotation above a **side-by-side diff** (old vs. new, line-numbered).
- **Controls**: Split/Unified diff toggle, light/dark theme toggle.
- **Global → detail navigation** with deep links — `#file/2` opens straight to
  the third file, so a specific view is shareable inside the artifact.

## Notes

- Requires Node.js and `git`. Must be run inside a git repository.
- Recap artifacts land in `<repo-root>/.recap/`. Suggest adding `.recap/` to
  `.gitignore` so generated recaps (and the ~3 MB HTML) are not committed.
- `assets/mermaid.min.js` is vendored so diagrams render offline. If it is
  missing, the recap still generates but diagrams are skipped (the generator
  warns).
- Skip a recap for a tiny single-file diff — it reviews faster as plain diff.
