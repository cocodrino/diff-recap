---
name: diff-recap-choices
description: >-
  Record every decision taken while building a branch — the alternatives weighed,
  the one chosen, why, and whether the user or the agent decided — in a committed
  log at .recap/choices/<branch>.md that travels in the PR and that diff-recap
  renders as "Decisions made". Trigger: the moment a choice between real
  alternatives closes (the user picks an option you offered, or you choose one
  yourself between genuine alternatives), and whenever the user says "log this
  decision", "record the decision", "anota la decisión", "guarda la decisión",
  "bitácora de decisiones" or "choices".
metadata:
  visibility: exported
---

# diff-recap-choices — the branch's decision log

A reviewer sees WHAT changed in the diff. This log keeps what the diff cannot
show: which alternatives existed, which one won, why, and who chose. It is a
committed file per branch, so it reaches the PR and survives the worktree.

**You write it during the work, never after.** Only the conversation where a
decision happened knows the options and who decided. Reconstructing it later
from the code produces plausible inventions — the exact failure this log exists
to prevent. (That is why `diff-recap` only reads the log and never writes it.)

## When to log

Log a decision the moment it closes, before you move on:

- **The user chose**: you offered alternatives and the user picked one ("dale con
  la A", "prefiero B", "sí, esa"). Also when the user overrides your
  recommendation — that is the most valuable entry.
- **You chose**: you picked between genuine alternatives without asking (a data
  model, an approach, a library, where something lives, a scope cut, a tradeoff).

Do NOT log:

- Choices with one sensible answer (a variable name, following an existing
  convention, a bug fix with no alternative).
- Decisions still open. Log when it closes, not when it is raised.
- Anything outside this branch's change.

When unsure whether something is a decision: would a reviewer ask "why not the
other way?" If yes, log it.

## Who decided

- `user` — the user made the final call, even if you recommended it.
- `agent` — you made the call yourself. Say so plainly; a reviewer needs to know
  which choices nobody else looked at.

Put your recommendation in **Reason** when the user chose differently, so the
disagreement stays on record.

## Where

```bash
node ~/.claude/skills/diff-recap/scripts/decisions.mjs
```

Prints the log path for the current branch
(`<repo-root>/.recap/choices/<branch-slug>.md`, e.g. `feature/x` →
`feature-x.md`) and validates the log if it exists. Run it from inside the repo.
Never compute the path by hand: the slug rule lives in `paths.mjs`.

**The repo must not ignore the folder.** Generated recaps under `.recap/` are
ignored; the choices folder must not be. Check once per repo:

```bash
git check-ignore -v .recap/choices/x.md   # prints a rule → it IS ignored → fix
```

If it is ignored, tell the user and propose this replacement for the `.recap/`
line in `.gitignore` (git cannot re-include a file under an ignored directory,
so the directory's CONTENTS must be ignored instead):

```gitignore
.recap/*
!.recap/choices/
```

Do not edit the `.gitignore` without the user's go-ahead.

## Format

Field keys and section headings are fixed English (the parser does not depend
on the prose language); everything else is Markdown in the language of the
conversation. Create the file with a `# Decisions — <branch>` title, then
APPEND one entry per decision, oldest first:

```markdown
## <short title: what was decided>
- date: 2026-10-08
- decided_by: user
- chosen: A
- files: backend/app/billing/clock.ts, backend/database/drizzle/schema.ts

### Context
What had to be decided and why it came up — the constraint, the bug, the request.

### Options
#### A — <option name>
What it is.
- Pro: …
- Con: …
#### B — <option name>
- Pro: …
- Con: …

### Reason
Why A won over B, in plain words. If the user chose against your
recommendation, say what you recommended and why.
```

Rules (the validator enforces the first four):

1. `decided_by` is `user` or `agent` — nothing else.
2. At least two options; `chosen` is one of their keys (`A`, `B`, …).
3. **Reason** is never empty — the why is the point of the log.
4. Only the sections `Context`, `Options`, `Reason` and the fields `date`,
   `decided_by`, `chosen`, `files`.
5. `files` (optional) are repo paths where the decision landed; they must be
   part of the branch's diff to link in the recap. Add them when known; update
   the entry's `files` line later if the code lands after the decision.
6. Append-only. Edit a past entry only to fix a mistake the user points out.
   A reversed decision is a NEW entry that says what it replaces.
7. Never transcribe secrets.

## After writing

1. Validate: `node ~/.claude/skills/diff-recap/scripts/decisions.mjs` — exit 0 or fix it.
2. Tell the user in one line that the decision was logged (title + who decided).
3. Do not commit unless the user asked. The log is committed with the rest of the
   branch's work, by the usual rules of the repo.
