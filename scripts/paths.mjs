// paths.mjs — Shared path/branch helpers so collect.mjs and generate.mjs agree
// on where a recap lives: <repo-root>/.recap/<branch-or-workspace>/.

import { execFileSync } from "node:child_process";
import path from "node:path";

function gitSafe(args, fallback = "") {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return fallback;
  }
}

// Current branch as a filesystem-safe slug. Detached HEAD or no commits yet
// falls back to "workspace".
export function branchSlug() {
  let b = gitSafe(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!b || b === "HEAD") b = "workspace";
  return b.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
}

export function repoRoot() {
  return gitSafe(["rev-parse", "--show-toplevel"]) || process.cwd();
}

// Per-branch recap directory, anchored at the repo root so it is the same
// regardless of which subdirectory the command runs from.
export function recapDir() {
  return path.join(repoRoot(), ".recap", branchSlug());
}
