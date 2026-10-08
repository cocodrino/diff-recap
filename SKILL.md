---
name: diff-recap
description: >-
  Turn a git range, branch, or PR diff into a single self-contained,
  fully-local interactive recap HTML — diagrams, annotated side-by-side diffs,
  per-file and per-hunk AI explanations of WHY the code changed. No external
  service, no server, no CDN: the output opens offline via file://.
metadata:
  visibility: exported
---

# Local Recap

`/diff-recap` builds an interactive visual recap **from a diff**, like a
code-review summary that a reviewer scans before reading raw lines — but the
deliverable is a single `recap.html` file that opens in any browser over
`file://`. Nothing is uploaded, no localhost bridge, no hosted viewer. Diagrams
(Mermaid), the side-by-side diffs, and the AI prose are all embedded in that one
file.

## Orchestration — Ask The Model, Then Delegate

This skill runs in TWO roles. The **orchestrator** (the agent that received the
`/diff-recap` request) does only two things: pick the model, then hand the work
to a **sub-agent**. The sub-agent does the actual recap (collect → analysis →
generate). Do NOT run the recap procedure in the main thread.

### Step 0 — Ask which model to run with

Before anything else, ask the user which model the recap sub-agent should use.
How you ask depends on the host:

- **In Claude Code** (you have the `AskUserQuestion` tool): present a model
  selector with these options — the user can always pick "Other" to type a name:
  - `Current` — keep the session's model (recommended). Maps to: omit the
    Agent `model` param.
  - `Opus` — highest quality. Maps to `model: "opus"`.
  - `Sonnet` — balanced. Maps to `model: "sonnet"`.
  - `Haiku` — fastest/cheapest. Maps to `model: "haiku"`.
- **In any other harness** (no `AskUserQuestion`): ask in plain text — present
  exactly two choices: `(1) current model`, or `(2) type a model name`. Use
  whatever model-selection mechanism that harness exposes for the typed name.

Cache the answer for the session; do not re-ask on a follow-up recap unless the
user wants to change it.

### Step 1 — Delegate the recap to a sub-agent

Launch ONE sub-agent (in Claude Code, the `Agent` / Task tool with the chosen
`model`). Give it everything it needs to run headless:

- the repo working directory and the resolved git range (`--base`/`--head` or
  `--range`),
- the absolute `<skill-dir>` so it can call the scripts,
- the language you are conversing in with the user (so it sets `lang`),
- the instruction to **follow "## Recap Procedure (sub-agent)" in this
  `SKILL.md`** and to return the absolute path of the generated `recap.html`.

When the sub-agent returns, report that `recap.html` path to the user. That path
IS the deliverable.

## How It Works — Four Stages

The pipeline cleanly separates **facts** (extracted mechanically from git) from
**explanation** (written by the sub-agent). Facts are true by construction;
prose is the only thing the sub-agent authors, and it is checked against the
facts before anything is rendered.

```
1. collect.mjs   git range  ──▶  recap-data.json   (facts: files, hunks, full files, stats, commits)
2. SUB-AGENT     analyze     ──▶  analysis.json     (changes, flow, steps, per-file & per-hunk WHY)
3. validate.mjs  check       ──▶  0 errors          (every reference real, every changed line explained)
4. generate.mjs  merge       ──▶  recap.html        (one self-contained file)  ──▶ open
```

## Recap Procedure (sub-agent)

These steps run inside the sub-agent launched in Step 1.

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
the full NEW content of each changed file (`fullLines`, capped at 5000 lines —
longer files get `fullTruncated: true`), and the commits in range. **Never edit
this file** — it is the source of truth.

**Tracked files only.** This is a `git diff`, so it only sees changes git
tracks: committed changes between the two refs, or — with `--working` —
uncommitted edits to already-tracked files. Brand-new files that have never been
`git add`ed do NOT show up. If `collect.mjs` reports 0 files or a file the user
expected is missing, the likely cause is untracked/unstaged work — tell the user
to `git add` (or commit) those files and re-run. Do not try to recap untracked
files by reading them directly; keep the recap grounded in the real diff.

### 2. Read the facts and author `analysis.json`

Read `recap-data.json` and write `analysis.json` next to it (same
`.recap/<branch>/` folder). This is where you add value: the narrative and the
WHY. Ground everything in the actual diff — real symbols, real behavior. **If
the diff does not contain a fact, do not invent it.** A confidently wrong recap
is dangerous in review.

**Language.** Write ALL prose — `title`, `summary`, diagram labels, file
`purpose`, and hunk explanations — in the language the orchestrator passed you
(the language the user is conversing in). Set `"lang"` to the matching code
(`"es"`, `"en"`, …) so the viewer's own chrome (buttons, section titles) is
localized to match. English and Spanish chrome are built in; other codes keep
English chrome but your prose stays in whatever language you wrote.

Schema (all fields optional except where noted — omit what does not apply):

```jsonc
{
  "lang": "es",
  "title": "Short outcome-focused title (≤70 chars)",
  "summary": "Markdown. EXHAUSTIVE: what changed, why it matters, compatibility/risk, decisions. Use ## headings, lists, `code`, **bold**, > quotes.",
  "changes": {
    "problem": "Markdown. The concrete problem the change addresses, in plain words (what went wrong, to whom, with real numbers when the diff or PR gives them).",
    "points": [
      {
        "title": "Plain-language name of this part of the change (e.g. 'The send to the bank')",
        "file": "<exact path from recap-data.json>",
        "hunk": 0,
        "bullets": [
          { "text": "Markdown. ONE idea: what this part now does, consequence first.", "hunk": 4, "lines": [3311, 3317] },
          { "text": "Another idea, in another file of the same point.", "file": "<exact path>", "hunk": 0 },
          "A bullet with no code behind it (a plain string) is not clickable."
        ]
      }
    ],
    "notCovered": ["Markdown. Something the change deliberately leaves out, and where it is handled instead."]
  },
  "overview": {
    "diagramTitle": "Architecture / data-flow after the change",
    "diagram": "Mermaid source (flowchart/sequenceDiagram/erDiagram/etc.) of the architecture or flow the diff produces",
    "links": { "<node id>": { "file": "<exact path>", "hunk": 0 } }
  },
  "flow": {
    "title": "Code flow",
    "diagram": "Mermaid flowchart tracing the runtime path through functions, with file:line labels on each step (see 'Code-flow diagram' below)",
    "links": { "<node id>": { "file": "<exact path>", "hunk": 0 } }
  },
  "files": {
    "<exact path from recap-data.json>": {
      "purpose": "Markdown. What role this file plays in the change and why it changed.",
      "steps": [
        { "from": 3311, "to": 3317, "text": "Markdown. What this stretch of code ACHIEVES, in plain words (e.g. 'Sets this charge attempt aside; if it was already set aside, does not call the bank again')." }
      ],
      "hunks": {
        "0": "Simple block → a one-line Markdown string: WHY this hunk was made.",
        "1": {
          "note": "One-line intent (WHY the change was made), always shown above the diff.",
          "detail": "Markdown. Explains a tricky detail: WHY it is implemented this way — the edge case, constraint, or gotcha that forced it. Use lists / ### sub-headings.",
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
  - **Mermaid must not throw "Syntax error" (renderer is Mermaid v11+).** In
    EVERY diagram (`overview.diagram` and `flow.diagram`), follow these rules:
    - ALWAYS double-quote EVERY node label and EVERY edge label:
      `A["Label text"]` and `B -->|"edge text"| C`.
    - For line breaks inside a label, use the literal `<br/>` tag INSIDE the
      quotes. NEVER emit a raw `\n` (backslash-n) inside the diagram — Mermaid 11
      does not interpret it and the parse fails.
    - Keep special characters (`@`, `+`, `/`, `.`, parentheses) INSIDE quoted
      labels, or omit them. Unquoted special chars break the parser.
    - Every node id must be a bare identifier; every label must be quoted.
    - Golden rule: in Mermaid 11, always quote, and never use `\n`.
- **Code-flow diagram (`flow.diagram`).** In ADDITION to the architecture
  diagram, add a Mermaid `flowchart` that traces how the code actually RUNS
  through the change — the execution/data path, step by step, anchored to real
  `file:line` locations. Each node is a function or step labeled with what it
  does AND its `path:line`; each edge says what is passed to the next step. Read
  the diff (and, when needed, the surrounding tracked code) to follow the real
  call chain. Example shape for "generate 10 URLs, fetch each, collect images":
  ```
  flowchart TD
    A["buildUrls() — makes 10 page URLs<br/>generate_url.ts:20"] -->|"each url"| B["fetchPage(url)<br/>fetch_api.ts:45"]
    B -->|"HTML response"| C["parseImages(html)<br/>parser.ts:12"]
    C -->|"image list"| D["collect + return<br/>index.ts:88"]
  ```
  Ground every `file:line` in the real diff/code — never invent a line number.
  Put the label text and the `file:line` INSIDE the quotes (Mermaid 11 rules
  above). Skip the flow diagram only when the change has no meaningful runtime
  path (pure config/rename/docs).
- **"What changes" (`changes`) — the reviewer's map of the change, in plain words.**
  It answers "what does this change do, part by part" for someone who has not
  opened the code. Every point and bullet is CLICKABLE: it opens a modal on the
  exact hunk, with a button to see the whole file. Write it like this:
  - `problem`: the concrete failure or need, with real facts (who, what, how
    many) — never "improves robustness".
  - `points`: one per part of the change, numbered by the viewer, ordered the way
    data moves through the system (entry point first). `title` is a plain name
    ("The send to the bank"), not a symbol; `file` + `hunk` is where clicking the
    title lands.
  - `bullets`: ONE idea each, consequence before mechanism ("If the step repeats,
    it reuses the recorded answer and does not charge again"), with the symbol in
    `code` only after the plain sentence. Nest the decision branches of a rule as
    separate bullets rather than one long sentence. Each bullet that describes
    code carries `hunk` (and `file` when it is not the point's file).
  - `notCovered`: what the change deliberately leaves out and where that lives
    instead. Omit it only when nothing was left out.
  - **`lines: [from, to]` on every bullet that talks about part of a hunk.** Two
    bullets about different lines of the same hunk must NOT open the same view:
    `lines` narrows the modal to the code the sentence describes — those lines stay
    bright and the rest of the hunk is dimmed — and scrolls to them. Numbers are
    NEW-file line numbers (the `newNum` of the lines in `recap-data.json`, the ones
    the diff gutter shows) and must fall inside the referenced hunk. Points and
    `flow.links` / `overview.links` entries accept `lines` too.
  - **Every `file` must be an exact path from `recap-data.json` and every `hunk`
    a real index of that file's `hunks` array.** A reference that does not
    resolve renders as plain text and logs a console warning — it never guesses.
    Re-read `recap-data.json` to pick the hunk; do not estimate it from line
    numbers you remember.
- **Clickable flow (`flow.links`, also `overview.links`).** Map each diagram node
  id to the hunk that implements that step: `{ "B": { "file": "…", "hunk": 3 } }`.
  Clicking the node opens the same modal as "What changes". Link every node that
  corresponds to changed code; leave unchanged steps (context the flow passes
  through) unlinked rather than pointing them at an unrelated hunk. Node ids must
  be the bare ids used in the Mermaid source (`B`, not `B["label"]`).
- **Plain-language steps (`files[path].steps`) — the "what it does" column.** For
  every meaningful changed file, cut its CHANGED code into steps of a few lines
  (typically 3-15) and say what each one achieves. The viewer renders them as a
  column beside the code, each cell spanning the rows it explains — in the diff,
  in the modal and in the whole-file view.
  - Abstraction level is the whole point: write what the code ACHIEVES for the
    business or the system, not what it does mechanically. "Checks whether any of
    these users is banned" — never "loops over users checking `permission ===
    false`". "Writes down the bank's answer before moving on" — never "calls
    settleChargeSend with the response".
  - One idea per step, a sentence or two. A symbol in `code` only when the reader
    needs it to recognise the step.
  - `from` / `to` are NEW-file line numbers (`newNum`). Cover the added and
    modified code; context lines may be included when they belong to the step.
    Steps must not overlap. Leave trivial lines (imports, closing braces) out.
  - Skip `steps` for test files, generated files and pure renames.
- **Per-file `purpose`** for every meaningful file: why it exists in this change.
- **Comment EVERY hunk**, keyed by the hunk's array index (`"0"`, `"1"`, …) as
  ordered in `recap-data.json`. Do not cherry-pick only the load-bearing hunks —
  every hunk gets at least a one-line `note` answering **why the change was
  made** (the intent, not a restatement of the code). This is the headline
  feature: the reviewer reads intent before code, on every hunk.
- **Tricky hunks also get the "why it's like this".** When a hunk has a
  non-obvious detail — clever algorithms, regex, bit manipulation,
  async/concurrency edge cases, framework "magic", dense one-liners, a workaround
  for a constraint or bug — use the object form `{ note, detail, complexity:
  "high" }`. The `detail` explains **why it is implemented that way**: the edge
  case, constraint, or gotcha that forced this shape, in plain language a reader
  who does not know the codebase can follow. It renders as an expandable
  "Detailed explanation" (open by default for `complexity: "high"`) and the hunk
  gets a "Complex" badge. Simple hunks keep just the one-line `note` — the note
  is still required, but do not pad obvious code with a `detail`.
- **Security:** never transcribe secrets (API keys, tokens, `.env` values) into
  prose. Redact (`sk-•••`).

### 3. Validate until it is clean — mandatory

```bash
node <skill-dir>/scripts/validate.mjs
```

It checks `analysis.json` against `recap-data.json` and exits 1 on any error:

- every point, bullet and diagram link points at a real file and hunk, and its
  `lines` fall inside that hunk;
- every changed non-test file has `steps`, and **every changed line that needs
  explaining is inside a step** (blank lines, lone punctuation, comments and
  imports are exempt). A generated file may be exempted only explicitly, with
  `"stepsSkip": "<reason>"`;
- steps do not overlap and have text.

Warnings (two bullets opening the same hunk with no `lines`, a step that covers
no changed line) are not fatal but almost always mean a wrong number — fix them.

**Fix and re-run until it reports 0 errors.** `generate.mjs` runs the same
checks and refuses to write `recap.html` while any error remains; do not reach
for `--allow-incomplete` to get past it — that flag is for a draft the user
explicitly asked for. A recap with a file the reader cannot follow in plain
words is the exact defect this step exists to stop.

### 4. Generate and open the recap

```bash
node <skill-dir>/scripts/generate.mjs --open
```

With no flags it reads `.recap/<branch>/recap-data.json` and
`.recap/<branch>/analysis.json` and writes `.recap/<branch>/recap.html`.
`--open` launches the default browser. Override any path with `--data`,
`--analysis`, or `--out` if needed. The result is one self-contained HTML
(~3 MB, mostly the inlined Mermaid engine). **Return the absolute path of
`recap.html`** as the sub-agent's result — the orchestrator reports it to the
user. That path IS the deliverable.

## What The Viewer Gives The Reviewer

- **Overview**: the exhaustive summary, **What changes** (problem, numbered
  points, what it does not cover), the **code flow** and architecture diagrams,
  **Decisions made** (from the decision log, see below) and the commit list.
- **Decisions made**: one card per logged decision — who decided (user or
  agent), the context, every option weighed with the chosen one marked, the
  reason, and the files it landed in (hover → tree, click → file view).
- **"What it does" column**: beside the code, each step of the change explained
  in plain words (`files[path].steps`). Clicking a step focuses its lines (the
  rest of that diff and the other steps recede); clicking it again clears it.
- **Change modal**: clicking a point, a bullet, or a linked diagram node opens a
  modal focused on that hunk (with its AI note) as a one-column diff — when the
  reference carries `lines`, only those lines stay bright and the rest of the
  hunk is dimmed — a "Show the whole file" toggle
  that renders the new version with changed lines marked and scrolls to the
  hunk, and a jump to the file view. Close with ✕, Esc, or a click outside.
  Files over 5000 lines keep only the hunk (`fullTruncated` in the data).
- **Per-file detail** (click a file or open `recap.html#file/<n>`): the file's
  status, the AI "why this file changed" note, then each hunk with its AI
  annotation above a **side-by-side diff** (old vs. new, line-numbered).
- **File tree sidebar** (GitHub review style): only the changed files, grouped
  by folder, single-child folders merged (`backend/app`), folders collapsible,
  search filters files and folders. Test files (same rule as `validate.mjs`'s
  `TEST_FILE`) are toned down so the code under review stands out. The sidebar
  stays fixed while the content pane scrolls; drag its border to resize
  (double-click resets, arrow keys work on the focused handle) and hide it with
  the ☰ button. Width and hidden state are remembered per browser.
- **Hover a file reference → highlight it in the tree.** Every mention of a
  changed file — a path or bare file name in the prose (`schema.ts`,
  `daily.function.ts:148`), the file beside a point, a change link, a file card,
  a diagram node — lights that file and its folders up in the tree, scrolling the
  sidebar to it. A name shared by two changed files resolves to none (never a guess).
- **Diagram pan & zoom**: pinch (trackpad or touch), Ctrl + wheel, drag, scroll,
  plus −/+/Fit/100%/full-screen buttons. The first view never shrinks a wide
  diagram below 75%, so labels stay readable.
- **Controls**: Split/Unified diff toggle, light/dark theme toggle.
- **Global → detail navigation** with deep links — `#file/2` opens straight to
  the third file, so a specific view is shareable inside the artifact. Each view
  is a history entry: the browser's Back button and the "← Overview" link return
  to the overview at the scroll position the reader left.

## Decision Log (`.recap/choices/<branch>.md`)

A committed Markdown file, one per branch, that records every decision taken
while building the change: which alternatives were weighed, which one won, why,
and **who decided** (`user` or `agent`). It travels in the PR, so reviewers read
it on GitHub too, and the recap renders it as the **Decisions made** block.

**Who writes it — and who never does.** The `diff-recap-choices` skill
(in this same repo, `diff-recap-choices/SKILL.md`) owns the format and the
rules for writing it: the agent working on the branch logs each decision the
moment it closes. That skill is the single source of truth for the format; the
parser is `scripts/decisions.mjs`.

The recap **never** writes or edits the log. A recap sub-agent reads only the
diff and would invent plausible alternatives and authors — exactly what this
skill forbids. If the file is missing, the block is simply omitted.

- `validate.mjs` / `generate.mjs` refuse a malformed log, naming the decision;
  files it names that are not in the diff are shown unlinked (warning).
- `collect.mjs` excludes `.recap/choices/` from the diff, so the log shows as
  its own block, not as a changed file.

## Notes

- Requires Node.js and `git`. Must be run inside a git repository.
- Recap artifacts land in `<repo-root>/.recap/`. Ignore the generated recaps but
  keep the decision logs committed — git cannot re-include a file under an
  ignored directory, so the rule must ignore the directory's CONTENTS:
  ```gitignore
  .recap/*
  !.recap/choices/
  ```
- `assets/mermaid.min.js` is vendored so diagrams render offline. If it is
  missing, the recap still generates but diagrams are skipped (the generator
  warns).
- Skip a recap for a tiny single-file diff — it reviews faster as plain diff.
