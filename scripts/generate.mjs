#!/usr/bin/env node
// generate.mjs — Merge recap-data.json (facts) + analysis.json (AI prose) into
// a single self-contained recap.html. No CDN, no server: everything (viewer
// CSS/JS and Mermaid) is inlined so the output opens offline via file://.
//
// Usage:
//   node generate.mjs [--data recap-data.json] [--analysis analysis.json]
//                     [--out recap.html] [--open]
//
//   --data      Facts file from collect.mjs.   Default: recap-data.json
//   --analysis  AI analysis file (optional).    Default: analysis.json
//   --out       Output HTML.                    Default: recap.html
//   --open      Open the result in the default browser when done.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import path from "node:path";
import { recapDir } from "./paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(__dirname, "..", "assets");

// U+2028 / U+2029 are valid in JSON strings but illegal as raw chars in a JS
// string literal, so they must be escaped before embedding JSON in a <script>.
const LINE_SEP = new RegExp("[  ]", "g");

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--data") a.data = argv[++i];
    else if (k === "--analysis") a.analysis = argv[++i];
    else if (k === "--out") a.out = argv[++i];
    else if (k === "--open") a.open = true;
    else if (k === "--help" || k === "-h") a.help = true;
  }
  return a;
}

function readJSON(file, fallback) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf8"));
}

function readAsset(name) {
  const p = path.join(ASSETS, name);
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8");
}

// Safe-embed a JS string/JSON into a <script> tag: neutralize "</script>",
// "<!--", and the line/paragraph separators that break inline JSON.
function safeForScript(text) {
  return text
    .replace(/<\/script>/gi, "<\\/script>")
    .replace(/<!--/g, "<\\!--")
    .replace(LINE_SEP, (c) => (c === " " ? "\\u2028" : "\\u2029"));
}

function openInBrowser(file) {
  const abs = path.resolve(file);
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", abs] : [abs];
  execFile(cmd, args, () => {});
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node generate.mjs [--data f] [--analysis f] [--out f] [--open]");
    return;
  }

  // Defaults follow the per-branch recap dir; analysis and output sit next to
  // the data file so everything for one recap lives together.
  const dir = recapDir();
  const dataPath = args.data || path.join(dir, "recap-data.json");
  const dataDir = path.dirname(dataPath);
  const analysisPath = args.analysis || path.join(dataDir, "analysis.json");
  const outPath = args.out || path.join(dataDir, "recap.html");

  const data = readJSON(dataPath, null);
  if (!data) {
    console.error(`Error: data file not found: ${dataPath}. Run collect.mjs first.`);
    process.exit(1);
  }
  const analysis = readJSON(analysisPath, {});
  data.analysis = analysis;
  const lang = (analysis.lang || "en").replace(/[^a-zA-Z-]/g, "") || "en";

  const css = readAsset("viewer.css");
  const viewerJs = readAsset("viewer.js");
  const mermaidJs = readAsset("mermaid.min.js");
  if (!mermaidJs) {
    console.warn("Warning: assets/mermaid.min.js not found — diagrams will not render.");
  }

  const title = (analysis.title || data.meta?.repo || "Recap").replace(/</g, "&lt;");
  const payload = safeForScript(JSON.stringify(data));

  const html = `<!DOCTYPE html>
<html lang="${lang}" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Recap</title>
<style>${css}</style>
</head>
<body>
<div class="app">
  <header class="topbar">
    <div>
      <div class="title" id="rc-title">Recap</div>
      <div class="meta" id="rc-meta"></div>
    </div>
    <div class="spacer"></div>
    <div class="stat-badges">
      <span class="badge" id="rc-files"></span>
      <span class="badge add" id="rc-add"></span>
      <span class="badge del" id="rc-del"></span>
    </div>
    <button class="icon-btn" id="rc-mode" title="Toggle split / unified diff">Split</button>
    <button class="icon-btn" id="rc-theme" title="Toggle light / dark">&#9680;</button>
  </header>
  <div class="body">
    <nav class="sidebar" id="sidebar"></nav>
    <main class="content" id="content"></main>
  </div>
</div>
<script>${mermaidJs ? safeForScript(mermaidJs) : ""}</script>
<script>window.__RECAP__ = ${payload};</script>
<script>${safeForScript(viewerJs)}</script>
</body>
</html>`;

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, html);
  const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
  console.log(`Wrote ${outPath} (${kb} KB, self-contained).`);

  if (args.open) {
    openInBrowser(outPath);
    console.log(`Opening ${path.resolve(outPath)} …`);
  } else {
    console.log(`Open it with: open ${path.resolve(outPath)}`);
  }
}

main();
