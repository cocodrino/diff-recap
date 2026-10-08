// decisions.mjs — Read the branch's decision log (.recap/choices/<branch>.md).
//
// The log is written DURING the work, by the agent that took part in each
// decision, never by the recap: only the conversation knows which alternatives
// were weighed and who chose. The recap renders it as-is. Format (field keys and
// section headings are fixed English so parsing never depends on the prose
// language; everything else is free Markdown):
//
//   ## <decision title>
//   - date: 2026-10-08
//   - decided_by: user | agent
//   - chosen: A
//   - files: backend/a.ts, backend/b.ts        (optional)
//
//   ### Context
//   <markdown>
//
//   ### Options
//   #### A — <option name>
//   <markdown: what it is, pros, cons>
//   #### B — <option name>
//   <markdown>
//
//   ### Reason
//   <markdown>
//
// Anything before the first "## " (a "# title", an intro) is ignored.
// The writer's side (when to log, who counts as deciding) is the
// diff-recap-choices skill.
//
// CLI (used by that skill): prints the current branch's log path, then validates
// the log if it exists. Exit 1 when it is malformed.
//   node decisions.mjs [log-file]

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { choicesFile } from "./paths.mjs";

export const DECIDED_BY = ["user", "agent"];
const SECTIONS = { context: "context", options: "options", reason: "reason" };

// Parse the log. Never throws: malformed entries are reported in `errors` (each
// prefixed with the decision title) so validation can refuse them by name.
export function parseDecisions(markdown) {
  const decisions = [];
  const errors = [];
  const blocks = String(markdown).replace(/\r\n/g, "\n").split(/^## +/m).slice(1);

  for (const block of blocks) {
    const lines = block.split("\n");
    const title = lines.shift().trim();
    const d = { title, date: "", decidedBy: "", chosen: "", files: [], context: "", options: [], reason: "" };
    const where = `decision "${title || "(untitled)"}"`;

    let section = null;
    let option = null;
    const buf = { context: [], reason: [] };
    for (const line of lines) {
      const sec = line.match(/^### +(.+?)\s*$/);
      if (sec) {
        section = SECTIONS[sec[1].toLowerCase()] || null;
        if (!section) errors.push(`${where}: unknown section "### ${sec[1]}" (use Context, Options, Reason).`);
        option = null;
        continue;
      }
      if (!section) {
        const field = line.match(/^- *([a-z_]+) *: *(.*)$/);
        if (!field) continue;
        const [, key, value] = field;
        if (key === "date") d.date = value.trim();
        else if (key === "decided_by") d.decidedBy = value.trim().toLowerCase();
        else if (key === "chosen") d.chosen = value.trim();
        else if (key === "files") d.files = value.split(",").map((s) => s.trim().replace(/^`|`$/g, "")).filter(Boolean);
        else errors.push(`${where}: unknown field "${key}".`);
        continue;
      }
      if (section === "options") {
        const head = line.match(/^#### +([A-Za-z0-9]+)\s*(?:[—–-]+\s*(.*))?$/);
        if (head) {
          option = { key: head[1], name: (head[2] || "").trim(), body: [] };
          d.options.push(option);
        } else if (option) option.body.push(line);
        continue;
      }
      buf[section].push(line);
    }
    d.context = buf.context.join("\n").trim();
    d.reason = buf.reason.join("\n").trim();
    d.options = d.options.map((o) => ({ ...o, body: o.body.join("\n").trim() }));

    if (!title) errors.push(`${where}: missing title after "## ".`);
    if (!DECIDED_BY.includes(d.decidedBy)) errors.push(`${where}: decided_by must be one of ${DECIDED_BY.join(" | ")}.`);
    if (d.options.length < 2) errors.push(`${where}: a decision needs at least two options under "### Options".`);
    if (!d.options.some((o) => o.key === d.chosen)) errors.push(`${where}: chosen "${d.chosen}" is not one of the option keys.`);
    if (!d.reason) errors.push(`${where}: "### Reason" is empty — the why is the point of the log.`);
    decisions.push(d);
  }
  return { decisions, errors };
}

// Read and parse the log at `file`; a missing file is not an error (no decisions recorded).
export function readDecisions(file) {
  if (!existsSync(file)) return { decisions: [], errors: [], found: false };
  return { ...parseDecisions(readFileSync(file, "utf8")), found: true };
}

// Files a decision points at must be part of this diff, or the viewer cannot link them.
export function validateDecisionFiles(data, decisions) {
  const paths = new Set(data.files.map((f) => f.path));
  const warnings = [];
  for (const d of decisions) {
    for (const p of d.files) {
      if (!paths.has(p)) warnings.push(`decision "${d.title}": file "${p}" is not in this diff (shown unlinked).`);
    }
  }
  return warnings;
}

// CLI. Compared on REAL paths, like validate.mjs: the skill dir is usually
// reached through a symlink, and a plain comparison would silently skip the check.
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const file = process.argv[2] || choicesFile();
  console.log(file);
  const log = readDecisions(file);
  if (!log.found) {
    console.log("No log yet — create it with the first decision.");
    process.exit(0);
  }
  for (const e of log.errors) console.error(`  error: ${e}`);
  if (log.errors.length) process.exit(1);
  console.log(`${log.decisions.length} decision(s), well-formed.`);
}
