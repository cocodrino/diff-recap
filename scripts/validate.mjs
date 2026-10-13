#!/usr/bin/env node
// validate.mjs — Check analysis.json against recap-data.json before a recap is
// generated. The viewer degrades quietly on a bad reference (plain text, a
// console warning) and shows no "what it does" column for a file without steps,
// so the only place to catch an incomplete recap is here, loudly.
//
// Usage:
//   node validate.mjs [--data recap-data.json] [--analysis analysis.json]
//
// Exit 0 when clean (warnings may still print), 1 when there are errors.
// generate.mjs runs the same checks and refuses to write the HTML on errors.

import { readFileSync, existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { recapDir, choicesFile } from "./paths.mjs";
import { readDecisions, validateDecisionFiles } from "./decisions.mjs";

// Files that do not need plain-language steps: tests describe themselves, and a
// reviewer reads them for coverage, not for intent. generate.mjs reuses it to
// tag test files for the viewer, so the two never disagree on what a test is.
export const TEST_FILE = /(^|\/)(__tests__|__mocks__|e2e)\/|\.(test|spec)\.[^/]+$/;

// A line with nothing to explain: blank, only punctuation, or a comment (the
// comment IS the explanation; steps describe what the code does).
const TRIVIAL_LINE = /^[\s{}()[\];,]*$/;
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|#(?!!))/;
// ---- import exemption, per language ----
// An import line has nothing to explain, but what an import LOOKS like depends
// on the language, so each source language gets its own shape:
//   start  — the line opens an import statement;
//   open   — that opening line leaves it unfinished (continues on later lines);
//   end    — the line that finishes a multi-line import;
//   member — a line that can sit INSIDE one (a name, a path, a comma).
// A multi-line import stays open only while its lines keep the member shape: the
// first line that is neither member nor end closes it and is judged as code. So
// an unterminated `import {` cannot swallow the rest of a hunk.
// Prose and data files (.md, .txt, .json, .yaml…) have no rule: an `import` in a
// Markdown code example is a line like any other.
// `end` and `member` accept ONLY import-shaped text, so a line of code
// (`const x = a + 1;`, `print(x)`) can neither continue nor close an import.
// Names, `as` aliases and commas only — `a,` / `type B as C, D` — no `=`, `(`, `.`.
const ID_LIST = /^[\s\w$*,]+$/;
const ENDS_SEMI = /;\s*$/;
const JS_IMPORT = {
  start: /^\s*import\b/,
  open: (c) => /[{,]\s*$/.test(c) && !/\bfrom\s+["'`]/.test(c),
  end: /^[\s\w$*,{}]*\bfrom\s+["'`][^"'`]*["'`]\s*;?\s*$/, // `} from "./x";`
  member: ID_LIST,
};
const PY_IMPORT = {
  start: /^\s*(import\s+[\w.]|from\s+[\w.]+\s+import\b)/,
  open: (c) => c.includes("(") && !c.includes(")"),
  end: /^[\s\w*,]*\)\s*$/, // `    c)` / `)`
  member: ID_LIST,
};
const GO_IMPORT = {
  start: /^\s*import\b/,
  open: (c) => /\(\s*$/.test(c),
  end: /^\s*\)/,
  member: /^\s*([\w.]+\s+)?"[^"]*"\s*$/,
};
const JVM_IMPORT = { start: /^\s*import\s+[\w.`]+/, open: () => false };
const CS_USING = { start: /^\s*(global\s+)?using\s+(static\s+)?[\w.]+(\s*=\s*[\w.<>,\s]+)?\s*;\s*$/, open: () => false };
const RUST_USE = {
  start: /^\s*(pub(\([^)]*\))?\s+)?use\s+[\w:{]/,
  open: (c) => !ENDS_SEMI.test(c),
  end: /^[\s\w:*{},]*;\s*$/, // `};`
  member: /^[\s\w:*{},]+$/, // `fmt::Display,` / `io::{self, Read},` / `},`
};
const PHP_USE = {
  start: /^\s*use\s+[\\\w]/,
  open: (c) => !ENDS_SEMI.test(c),
  end: /^[\s\\\w,{}]*;\s*$/, // `};`
  member: /^[\s\\\w,]+$/, // `Foo\Bar,` / `Baz as Qux,`
};
const IMPORT_RULES = {
  ts: JS_IMPORT, tsx: JS_IMPORT, js: JS_IMPORT, jsx: JS_IMPORT, mjs: JS_IMPORT,
  cjs: JS_IMPORT, mts: JS_IMPORT, cts: JS_IMPORT, vue: JS_IMPORT, svelte: JS_IMPORT,
  py: PY_IMPORT, go: GO_IMPORT,
  java: JVM_IMPORT, kt: JVM_IMPORT, kts: JVM_IMPORT, scala: JVM_IMPORT, cs: CS_USING,
  rs: RUST_USE, php: PHP_USE,
};

function importRuleFor(filePath) {
  const base = filePath.split("/").pop().toLowerCase();
  return base.includes(".") ? IMPORT_RULES[base.split(".").pop()] || null : null;
}

// The NEW line numbers of a file's added lines that need a step: not trivial,
// not a comment, and not part of an import statement of the file's language
// (multi-line ones tracked across the hunk's lines, see the rules above).
function explainableAddedLines(f) {
  const out = [];
  const rule = importRuleFor(f.path);
  for (const h of f.hunks) {
    let open = false;
    for (const l of h.lines) {
      if (l.type === "del") continue;
      const c = l.content;
      let isImport = false;
      if (open) {
        if (rule.end.test(c)) { isImport = true; open = false; }
        else if (rule.member.test(c) || TRIVIAL_LINE.test(c) || COMMENT_LINE.test(c)) isImport = true;
        else open = false; // shape broke: the import is over, this line is code
      }
      if (!isImport && rule && rule.start.test(c)) { isImport = true; open = rule.open(c); }
      if (l.type !== "add" || isImport) continue;
      if (TRIVIAL_LINE.test(l.content) || COMMENT_LINE.test(l.content)) continue;
      out.push(l.newNum);
    }
  }
  return out;
}

function lineRangeOf(hunk) {
  return { from: hunk.newStart, to: hunk.newStart + Math.max(hunk.newLines, 1) - 1 };
}

// Compress sorted line numbers into "12-15, 20" for a readable report.
function ranges(nums) {
  const out = [];
  for (const n of nums) {
    const last = out[out.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else out.push([n, n]);
  }
  return out.map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(", ");
}

/**
 * Validate one analysis against its facts. Returns { errors, warnings }, each a
 * list of human-readable strings naming the exact field to fix.
 */
export function validateAnalysis(data, analysis) {
  const errors = [];
  const warnings = [];
  const files = new Map((data.files || []).map((f) => [f.path, f]));
  const analysisFiles = analysis.files || {};

  // ---- references: points, bullets, diagram links ----
  function checkRef(where, ref) {
    if (!ref || !ref.file) return;
    const f = files.get(ref.file);
    if (!f) { errors.push(`${where}: file "${ref.file}" is not in recap-data.json`); return; }
    const hunkIdx = ref.hunk == null ? 0 : Number(ref.hunk);
    const hunk = f.hunks[hunkIdx];
    if (!Number.isInteger(hunkIdx) || !hunk) {
      errors.push(`${where}: hunk ${ref.hunk} does not exist in ${ref.file} (it has ${f.hunks.length})`);
      return;
    }
    if (ref.lines) {
      const [from, to] = Array.isArray(ref.lines) ? ref.lines.map(Number) : [];
      const h = lineRangeOf(hunk);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) {
        errors.push(`${where}: lines ${JSON.stringify(ref.lines)} must be [from, to] with from <= to`);
      } else if (to < h.from || from > h.to) {
        errors.push(`${where}: lines ${from}-${to} fall outside hunk ${hunkIdx} of ${ref.file} (new lines ${h.from}-${h.to})`);
      }
    }
  }

  const changes = analysis.changes || {};
  (changes.points || []).forEach((p, pi) => {
    const at = `changes.points[${pi}]`;
    if (p.file) checkRef(at, { file: p.file, hunk: p.hunk, lines: p.lines });
    (p.bullets || []).forEach((b, bi) => {
      if (!b || typeof b !== "object" || b.hunk == null) return;
      const where = `${at}.bullets[${bi}]`;
      // A bullet describes specific code; without `lines` the modal opens the
      // whole hunk with nothing highlighted, and the reader cannot tell which
      // lines the sentence is about.
      if (!b.lines) {
        errors.push(`${where}: no "lines" — give the [from, to] new-file lines this sentence describes, so the modal highlights them`);
      }
      checkRef(where, { file: b.file || p.file, hunk: b.hunk, lines: b.lines });
    });
  });
  for (const key of ["flow", "overview"]) {
    const links = (analysis[key] && analysis[key].links) || {};
    for (const [node, ref] of Object.entries(links)) checkRef(`${key}.links.${node}`, ref);
  }

  // ---- steps: valid, non-overlapping, and covering every changed line ----
  for (const [p] of Object.entries(analysisFiles)) {
    if (!files.has(p)) errors.push(`files["${p}"]: not a changed file in recap-data.json`);
  }

  // ---- whatItDoes: the translation of the file's own purpose header ----
  // A header the reader cannot see is a lost fact; a whatItDoes with no header
  // behind it is a purpose the recap made up.
  for (const f of data.files || []) {
    const what = (analysisFiles[f.path] || {}).whatItDoes;
    const hasWhat = typeof what === "string" && what.trim() !== "";
    if (f.purposeHeader && !hasWhat) {
      errors.push(`files["${f.path}"]: no "whatItDoes" — the file has a purpose header; translate it faithfully into the recap's lang (add nothing)`);
    } else if (!f.purposeHeader && what != null) {
      warnings.push(`files["${f.path}"].whatItDoes: the file has no purpose header — this would invent a purpose; remove it`);
    }
  }

  for (const f of data.files || []) {
    if (f.binary || f.status === "removed" || !f.hunks.length) continue;
    const af = analysisFiles[f.path] || {};
    const isTest = TEST_FILE.test(f.path);
    if (af.stepsSkip) continue; // explicitly exempted, with a reason
    if (isTest && !af.steps) continue;

    const steps = Array.isArray(af.steps) ? af.steps : [];
    const valid = [];
    steps.forEach((s, si) => {
      const at = `files["${f.path}"].steps[${si}]`;
      if (!s || !Number.isInteger(s.from) || !Number.isInteger(s.to) || s.from > s.to) {
        errors.push(`${at}: needs integer from <= to`);
      } else if (!s.text || !String(s.text).trim()) {
        errors.push(`${at}: empty text`);
      } else valid.push(s);
    });
    const sorted = [...valid].sort((a, b) => a.from - b.from);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].from <= sorted[i - 1].to) {
        errors.push(`files["${f.path}"].steps: ${sorted[i - 1].from}-${sorted[i - 1].to} overlaps ${sorted[i].from}-${sorted[i].to}`);
      }
    }

    const changed = explainableAddedLines(f);
    if (!changed.length) continue;
    const covered = (n) => valid.some((s) => n >= s.from && n <= s.to);
    const missing = changed.filter((n) => !covered(n));
    if (!steps.length) {
      errors.push(`files["${f.path}"]: no "steps" — ${changed.length} changed lines have no plain-language explanation (add steps, or "stepsSkip": "<reason>" for a generated file)`);
    } else if (missing.length) {
      errors.push(`files["${f.path}"].steps: changed lines not covered by any step: ${ranges(missing)}`);
    }

    const changedSet = new Set(changed);
    for (const s of valid) {
      let touches = false;
      for (let n = s.from; n <= s.to && !touches; n++) touches = changedSet.has(n);
      if (!touches) warnings.push(`files["${f.path}"].steps ${s.from}-${s.to}: covers no changed line — is the range right?`);
    }
  }

  return { errors, warnings };
}

function readJSON(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

// Everything the recap renders that is not a git fact: the analysis and the
// decision log (`log` from readDecisions). A malformed log fails like a
// malformed analysis — a decision without its reason is the defect the log
// exists to prevent.
export function validateRecap(data, analysis, log) {
  const result = validateAnalysis(data, analysis);
  return {
    errors: [...result.errors, ...log.errors.map((e) => `choices log: ${e}`)],
    warnings: [...result.warnings, ...validateDecisionFiles(data, log.decisions).map((w) => `choices log: ${w}`)],
  };
}

// Print a report; returns true when there are no errors.
export function report({ errors, warnings }) {
  for (const w of warnings) console.warn(`  warning: ${w}`);
  for (const e of errors) console.error(`  error:   ${e}`);
  if (errors.length) {
    console.error(`\nThe recap inputs have ${errors.length} error(s). Fix them and run again.`);
    return false;
  }
  console.log(`Recap inputs are complete${warnings.length ? ` (${warnings.length} warning(s))` : ""}.`);
  return true;
}

// CLI. Compared on REAL paths: the skill dir is usually reached through a
// symlink, and a plain path comparison would skip the checks and exit 0 — a
// silent green.
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const argv = process.argv.slice(2);
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const dataPath = arg("--data") || path.join(recapDir(), "recap-data.json");
  const analysisPath = arg("--analysis") || path.join(path.dirname(dataPath), "analysis.json");
  const data = readJSON(dataPath);
  if (!data) { console.error(`Error: data file not found: ${dataPath}`); process.exit(1); }
  const analysis = readJSON(analysisPath) || {};
  const log = readDecisions(arg("--decisions") || choicesFile());
  process.exit(report(validateRecap(data, analysis, log)) ? 0 : 1);
}
