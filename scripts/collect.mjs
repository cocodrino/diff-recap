#!/usr/bin/env node
// collect.mjs — Gather a git range into a deterministic recap-data.json.
//
// Facts only. Everything here is extracted mechanically from git so the recap
// is "true by construction": real paths, real hunks, real before/after lines.
// The AI never touches this file — it only consumes it.
//
// Usage:
//   node collect.mjs [--base <ref>] [--head <ref>] [--range <gitspec>]
//                    [--working] [--out <file>]
//
//   --base     Base ref. Default: auto-detect main/master/develop, else first commit.
//   --head     Head ref. Default: HEAD.
//   --range    Raw git diff spec (e.g. "main...HEAD"). Overrides --base/--head.
//   --working  Include uncommitted working-tree changes (diff base against working tree).
//   --out      Output path. Default: recap-data.json
//   --context  Diff context lines. Default: 3.

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { recapDir, branchSlug, repoRoot } from "./paths.mjs";

// The viewer's "full file" view shows the NEW version of each changed file with
// the changed lines marked. Files longer than this keep only their hunks, so one
// generated file cannot bloat the self-contained HTML.
const MAX_FULL_FILE_LINES = 5000;

function parseArgs(argv) {
  const args = { context: 3 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") args.base = argv[++i];
    else if (a === "--head") args.head = argv[++i];
    else if (a === "--range") args.range = argv[++i];
    else if (a === "--working") args.working = true;
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--context") args.context = Number(argv[++i]);
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function git(cmd) {
  return execFileSync("git", cmd, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function gitSafe(cmd, fallback = "") {
  try {
    return git(cmd);
  } catch {
    return fallback;
  }
}

function detectBase() {
  for (const ref of ["main", "master", "develop"]) {
    const ok = gitSafe(["rev-parse", "--verify", "--quiet", ref], null);
    if (ok !== null && ok.trim()) return ref;
  }
  // Fallback: the very first commit, so we diff the whole history.
  const root = gitSafe(["rev-list", "--max-parents=0", "HEAD"]).trim().split("\n")[0];
  return root || "HEAD";
}

// Map common extensions to highlight.js-ish language ids used by the viewer.
const LANG_BY_EXT = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript",
  cjs: "javascript", json: "json", py: "python", rb: "ruby", go: "go",
  rs: "rust", java: "java", kt: "kotlin", swift: "swift", c: "c", h: "c",
  cpp: "cpp", cc: "cpp", hpp: "cpp", cs: "csharp", php: "php", sh: "bash",
  zsh: "bash", bash: "bash", sql: "sql", html: "html", css: "css",
  scss: "scss", sass: "sass", less: "less", vue: "vue", svelte: "svelte",
  md: "markdown", mdx: "markdown", yml: "yaml", yaml: "yaml", toml: "toml",
  xml: "xml", dockerfile: "dockerfile", makefile: "makefile",
};

function languageFor(filePath) {
  const base = path.basename(filePath).toLowerCase();
  if (base === "dockerfile") return "dockerfile";
  if (base === "makefile") return "makefile";
  const ext = base.includes(".") ? base.split(".").pop() : "";
  return LANG_BY_EXT[ext] || "plaintext";
}

// Parse a unified `git diff` into structured file/hunk/line objects.
function parseDiff(diffText) {
  const files = [];
  const lines = diffText.split("\n");
  let file = null;
  let hunk = null;

  const pushFile = () => {
    if (file) {
      if (hunk) { file.hunks.push(hunk); hunk = null; }
      files.push(file);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("diff --git ")) {
      pushFile();
      file = {
        path: null, oldPath: null, status: "modified",
        language: "plaintext", binary: false, hunks: [],
      };
      hunk = null;
      continue;
    }
    if (!file) continue;

    if (line.startsWith("new file mode")) { file.status = "added"; continue; }
    if (line.startsWith("deleted file mode")) { file.status = "removed"; continue; }
    if (line.startsWith("rename from ")) {
      file.status = "renamed";
      file.oldPath = line.slice("rename from ".length);
      continue;
    }
    if (line.startsWith("rename to ")) {
      file.path = line.slice("rename to ".length);
      continue;
    }
    if (line.startsWith("Binary files")) { file.binary = true; continue; }
    if (line.startsWith("--- ")) {
      const p = line.slice(4);
      if (p !== "/dev/null") file.oldPath = p.replace(/^a\//, "");
      continue;
    }
    if (line.startsWith("+++ ")) {
      const p = line.slice(4);
      if (p !== "/dev/null") file.path = p.replace(/^b\//, "");
      continue;
    }
    if (line.startsWith("@@")) {
      if (hunk) file.hunks.push(hunk);
      const m = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
      hunk = {
        header: line,
        section: m ? m[5].trim() : "",
        oldStart: m ? Number(m[1]) : 0,
        oldLines: m ? Number(m[2] ?? 1) : 0,
        newStart: m ? Number(m[3]) : 0,
        newLines: m ? Number(m[4] ?? 1) : 0,
        lines: [],
      };
      file._oldNum = hunk.oldStart;
      file._newNum = hunk.newStart;
      continue;
    }
    if (hunk) {
      const tag = line[0];
      if (tag === "+") {
        hunk.lines.push({ type: "add", content: line.slice(1), newNum: file._newNum++, oldNum: null });
      } else if (tag === "-") {
        hunk.lines.push({ type: "del", content: line.slice(1), oldNum: file._oldNum++, newNum: null });
      } else if (tag === " ") {
        hunk.lines.push({ type: "context", content: line.slice(1), oldNum: file._oldNum++, newNum: file._newNum++ });
      } else if (line.startsWith("\\")) {
        // "\ No newline at end of file" — ignore.
      }
    }
  }
  pushFile();

  // Finalize: resolve path, language, drop internal cursors.
  for (const f of files) {
    if (!f.path && f.oldPath) f.path = f.oldPath; // deleted file
    f.path = f.path || f.oldPath || "unknown";
    if (f.oldPath === f.path) f.oldPath = null;
    f.language = languageFor(f.path);
    delete f._oldNum;
    delete f._newNum;
  }
  return files;
}

// The ref whose file contents are "after" the change. A raw range's right side
// ("a...b" / "a..b"), else --head; null means the working tree.
function afterRef(args, head) {
  if (args.working) return null;
  if (args.range) {
    const parts = args.range.split(/\.{2,3}/);
    return parts.length > 1 && parts[1] ? parts[1] : "HEAD";
  }
  return head;
}

// Full NEW content of a changed file, or null when it has none to show (removed,
// binary) or is over the size cap. Read from git for a ref, from disk otherwise.
function fullContent(file, ref) {
  if (file.binary || file.status === "removed") return null;
  let text = null;
  if (ref === null) {
    const abs = path.join(repoRoot(), file.path);
    if (existsSync(abs)) text = readFileSync(abs, "utf8");
  } else {
    text = gitSafe(["show", `${ref}:${file.path}`], null);
  }
  if (text == null) return null;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.length > MAX_FULL_FILE_LINES ? { truncated: true } : { lines };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node collect.mjs [--base ref] [--head ref] [--range spec] [--working] [--out file] [--context n]");
    return;
  }

  // Confirm we are inside a git repo.
  const inside = gitSafe(["rev-parse", "--is-inside-work-tree"]).trim();
  if (inside !== "true") {
    console.error("Error: not inside a git repository.");
    process.exit(1);
  }

  const head = args.head || "HEAD";
  const base = args.base || detectBase();
  const ctx = `-U${Number.isFinite(args.context) ? args.context : 3}`;

  // Build the diff spec — `spec` is just the range/ref portion, kept separate
  // so the diff and numstat invocations share it cleanly.
  let spec;
  let logRange;
  if (args.range) {
    spec = [args.range];
    logRange = args.range.includes("..") ? args.range : `${args.range}..HEAD`;
  } else if (args.working) {
    spec = [base];
    logRange = `${base}..HEAD`;
  } else {
    // Three-dot: changes on head since the merge-base (what a PR shows).
    spec = [`${base}...${head}`];
    logRange = `${base}..${head}`;
  }

  // -M turns on rename detection so a moved file reads as one renamed entry
  // instead of an add+remove pair.
  const diffText = git(["diff", "--no-color", "-M", ctx, ...spec]);
  const files = parseDiff(diffText);

  // Per-file numstat for accurate insertion/deletion counts.
  const numstat = gitSafe(["diff", "--no-color", "-M", "--numstat", ...spec]);
  const numByPath = {};
  for (const row of numstat.split("\n")) {
    if (!row.trim()) continue;
    const [ins, del, ...rest] = row.split("\t");
    let p = rest.join("\t");
    // Renames look like "old => new" or "dir/{a => b}/file".
    const arrow = p.match(/\{(.*) => (.*)\}/);
    if (arrow) p = p.replace(/\{(.*) => (.*)\}/, "$2").replace(/\/\//g, "/");
    else if (p.includes(" => ")) p = p.split(" => ")[1];
    numByPath[p.trim()] = {
      insertions: ins === "-" ? null : Number(ins),
      deletions: del === "-" ? null : Number(del),
    };
  }
  for (const f of files) {
    const n = numByPath[f.path] || {};
    f.insertions = n.insertions ?? f.hunks.flatMap((h) => h.lines).filter((l) => l.type === "add").length;
    f.deletions = n.deletions ?? f.hunks.flatMap((h) => h.lines).filter((l) => l.type === "del").length;
  }

  // Full new content per file, for the viewer's "see the whole file" view.
  const ref = afterRef(args, head);
  for (const f of files) {
    const full = fullContent(f, ref);
    if (full?.lines) f.fullLines = full.lines;
    else if (full?.truncated) f.fullTruncated = true;
  }

  // Commits in range.
  const logRaw = gitSafe(["log", logRange, "--pretty=format:%H%x1f%an%x1f%ad%x1f%s", "--date=short"]);
  const commits = logRaw
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [hash, author, date, subject] = l.split("\x1f");
      return { hash: hash?.slice(0, 9), author, date, subject };
    });

  const stats = {
    filesChanged: files.length,
    insertions: files.reduce((s, f) => s + (f.insertions || 0), 0),
    deletions: files.reduce((s, f) => s + (f.deletions || 0), 0),
  };

  const repo = path.basename(gitSafe(["rev-parse", "--show-toplevel"]).trim() || process.cwd());
  const branch = branchSlug();

  const data = {
    meta: {
      repo,
      branch,
      base: args.range || base,
      head: args.working ? "working tree" : head,
      generatedAt: new Date().toISOString(),
    },
    stats,
    commits,
    files,
  };

  // Default output goes to <repo>/.recap/<branch>/recap-data.json.
  const out = args.out || path.join(recapDir(), "recap-data.json");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(data, null, 2));
  console.log(
    `Wrote ${out} — ${stats.filesChanged} files, +${stats.insertions} -${stats.deletions}, ${commits.length} commits.`
  );
}

main();
