/* viewer.js — renders window.__RECAP__ into the local recap UI.
   Pure vanilla DOM. Code lines use textContent (never innerHTML) so a diff can
   never inject markup. Markdown from the analysis is rendered through a small
   built-in converter. No external dependencies except the inlined Mermaid. */

(function () {
  "use strict";

  const DATA = window.__RECAP__ || { meta: {}, stats: {}, commits: [], files: [], analysis: {} };
  const analysis = DATA.analysis || {};
  const analysisFiles = analysis.files || {};

  // ---------- i18n: chrome labels follow analysis.lang (AI prose is already
  // authored in that language). Unknown langs fall back to English chrome. ----------
  const LABELS = {
    en: {
      overview: "Overview", files: "Files", commits: "Commits",
      changedFiles: "Changed files", whyFile: "Why this file changed", ai: "AI",
      complex: "Complex", detailed: "Detailed explanation",
      searchPlaceholder: "Search files & code…",
      filesCount: "files", split: "Split", unified: "Unified",
      noChanges: "No changes found in this range.",
      binary: "Binary file — diff not shown.",
      noHunks: "No textual hunks (mode/metadata change only).",
      renamedFrom: "renamed from", toggleDiff: "Toggle split / unified diff",
      toggleTheme: "Toggle light / dark",
    },
    es: {
      overview: "Resumen", files: "Archivos", commits: "Commits",
      changedFiles: "Archivos modificados", whyFile: "Por qué cambió este archivo", ai: "IA",
      complex: "Complejo", detailed: "Explicación detallada",
      searchPlaceholder: "Buscar archivos y código…",
      filesCount: "archivos", split: "Lado a lado", unified: "Unificado",
      noChanges: "No se encontraron cambios en este rango.",
      binary: "Archivo binario — no se muestra el diff.",
      noHunks: "Sin cambios de texto (solo cambió el modo/metadata).",
      renamedFrom: "renombrado de", toggleDiff: "Alternar lado a lado / unificado",
      toggleTheme: "Alternar claro / oscuro",
    },
  };
  const langBase = String(analysis.lang || "en").toLowerCase().split("-")[0];
  const T = LABELS[langBase] || LABELS.en;

  // ---------- tiny helpers ----------
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === "class") node.className = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k.startsWith("on") && typeof attrs[k] === "function") node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      }
    }
    for (const c of [].concat(children || [])) {
      if (c == null) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- minimal markdown -> html (for AI prose only) ----------
  function md(src) {
    if (!src) return "";
    const lines = String(src).replace(/\r\n/g, "\n").split("\n");
    let out = "";
    let i = 0;
    const inline = (t) =>
      esc(t)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    while (i < lines.length) {
      const line = lines[i];
      if (/^```/.test(line)) {
        let code = "";
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { code += lines[i] + "\n"; i++; }
        i++;
        out += "<pre><code>" + esc(code) + "</code></pre>";
        continue;
      }
      const h = line.match(/^(#{1,4})\s+(.*)/);
      if (h) { out += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; i++; continue; }
      if (/^>\s?/.test(line)) {
        let q = "";
        while (i < lines.length && /^>\s?/.test(lines[i])) { q += lines[i].replace(/^>\s?/, "") + " "; i++; }
        out += "<blockquote>" + inline(q.trim()) + "</blockquote>";
        continue;
      }
      if (/^\s*[-*+]\s+/.test(line)) {
        let items = "";
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items += "<li>" + inline(lines[i].replace(/^\s*[-*+]\s+/, "")) + "</li>"; i++; }
        out += "<ul>" + items + "</ul>";
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        let items = "";
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items += "<li>" + inline(lines[i].replace(/^\s*\d+\.\s+/, "")) + "</li>"; i++; }
        out += "<ol>" + items + "</ol>";
        continue;
      }
      if (line.trim() === "") { i++; continue; }
      let para = "";
      while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,4}\s|```|>\s?|\s*[-*+]\s|\s*\d+\.\s)/.test(lines[i])) {
        para += lines[i] + " "; i++;
      }
      out += "<p>" + inline(para.trim()) + "</p>";
    }
    return out;
  }

  // ---------- diff: build side-by-side rows ----------
  function sideBySide(lines) {
    const rows = [];
    let dels = [], adds = [];
    const flush = () => {
      const n = Math.max(dels.length, adds.length);
      for (let k = 0; k < n; k++) rows.push({ left: dels[k] || null, right: adds[k] || null });
      dels = []; adds = [];
    };
    for (const l of lines) {
      if (l.type === "del") dels.push(l);
      else if (l.type === "add") adds.push(l);
      else { flush(); rows.push({ left: l, right: l, context: true }); }
    }
    flush();
    return rows;
  }

  // ---------- intra-line (word-level) diff ----------
  // Split into words, whitespace runs, and single symbols so highlighting lands
  // on meaningful tokens instead of whole lines.
  function tokenize(s) {
    return s.match(/\s+|\w+|[^\s\w]/g) || [];
  }
  // Longest common subsequence over token arrays -> per-token changed flags.
  function tokenDiff(a, b) {
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const left = [], right = [];
    let i = 0, j = 0, common = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { left.push({ t: a[i], c: false }); right.push({ t: b[j], c: false }); common++; i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { left.push({ t: a[i], c: true }); i++; }
      else { right.push({ t: b[j], c: true }); j++; }
    }
    while (i < n) left.push({ t: a[i++], c: true });
    while (j < m) right.push({ t: b[j++], c: true });
    // similarity = shared tokens vs. total; below threshold the lines are
    // unrelated and a token diff would be noise, so signal "no intra-line".
    const sim = (2 * common) / (n + m || 1);
    return sim >= 0.3 ? { left, right } : null;
  }
  // Fill a cell either with plain text, or with highlighted changed tokens.
  function fillCell(cell, text, segments, wordClass) {
    if (!segments) { cell.textContent = text; return; }
    for (const s of segments) {
      if (s.c) cell.appendChild(el("span", { class: wordClass, text: s.t }));
      else cell.appendChild(document.createTextNode(s.t));
    }
  }

  function renderDiffSplit(hunk) {
    const table = el("table", { class: "diff" });
    for (const row of sideBySide(hunk.lines)) {
      const tr = el("tr");
      // A modified pair (both sides present, not context) gets a word-level diff.
      const modified = !row.context && row.left && row.right;
      const seg = modified ? tokenDiff(tokenize(row.left.content), tokenize(row.right.content)) : null;
      // left (old)
      const lg = el("td", { class: "gutter", text: row.left && row.left.oldNum != null ? String(row.left.oldNum) : "" });
      const lc = el("td", { class: "code split-cell" + (row.context ? "" : row.left ? " del" : " empty") });
      fillCell(lc, row.left ? row.left.content : "", seg && seg.left, "word-del");
      tr.appendChild(lg); tr.appendChild(lc);
      tr.appendChild(el("td", { class: "split-divider" }));
      // right (new)
      const rg = el("td", { class: "gutter", text: row.right && row.right.newNum != null ? String(row.right.newNum) : "" });
      const rc = el("td", { class: "code split-cell" + (row.context ? "" : row.right ? " add" : " empty") });
      fillCell(rc, row.right ? row.right.content : "", seg && seg.right, "word-add");
      tr.appendChild(rg); tr.appendChild(rc);
      table.appendChild(tr);
    }
    return table;
  }

  function renderDiffUnified(hunk) {
    const table = el("table", { class: "diff" });
    for (const l of hunk.lines) {
      const tr = el("tr", { class: l.type });
      tr.appendChild(el("td", { class: "gutter", text: l.oldNum != null ? String(l.oldNum) : "" }));
      tr.appendChild(el("td", { class: "gutter", text: l.newNum != null ? String(l.newNum) : "" }));
      const code = el("td", { class: "code" + (l.type === "add" ? " add" : l.type === "del" ? " del" : "") });
      code.textContent = l.content;
      tr.appendChild(code);
      table.appendChild(tr);
    }
    return table;
  }

  let splitMode = true;

  // ---------- views ----------
  const content = () => document.getElementById("content");

  function show(node) {
    const c = content();
    c.innerHTML = "";
    c.appendChild(node);
    c.scrollTop = 0;
  }

  function renderOverview() {
    current = -1;
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    const view = el("div", { class: "view" });
    const prose = el("div", { class: "prose" });
    prose.appendChild(el("h1", { text: analysis.title || "Recap" }));
    if (analysis.summary) prose.appendChild(el("div", { html: md(analysis.summary) }));
    view.appendChild(prose);

    // architecture diagram
    if (analysis.overview && analysis.overview.diagram && window.mermaid) {
      const card = el("div", { class: "diagram-card" });
      if (analysis.overview.diagramTitle) card.appendChild(el("h3", { text: analysis.overview.diagramTitle }));
      const holder = el("div", { class: "mermaid", text: analysis.overview.diagram });
      card.appendChild(holder);
      view.appendChild(card);
      try { window.mermaid.run({ nodes: [holder] }); } catch (e) { holder.textContent = "Diagram error: " + e.message; }
    }

    // commits
    if (DATA.commits && DATA.commits.length) {
      view.appendChild(el("h2", { class: "", text: T.commits }, []));
      const list = el("div", { class: "commit-list" });
      for (const c of DATA.commits) {
        list.appendChild(el("div", { class: "commit" }, [
          el("span", { class: "hash", text: c.hash || "" }),
          el("span", { class: "subject", text: c.subject || "" }),
          el("span", { class: "author", text: c.author || "" }),
        ]));
      }
      view.appendChild(list);
    }

    // changed-files grid
    const h = el("h2"); h.textContent = T.changedFiles; view.appendChild(h);
    const grid = el("div", { class: "overview-files" });
    DATA.files.forEach((f, idx) => {
      const card = el("div", { class: "ov-card", onclick: () => selectFile(idx) }, [
        el("div", { class: "ov-path", text: f.path }),
        el("div", { class: "ov-meta" }, [
          el("span", { class: "chip " + f.status, text: f.status[0].toUpperCase() }),
          el("span", { class: "nstat" }, [
            el("span", { class: "add", text: "+" + (f.insertions || 0) }),
            document.createTextNode(" "),
            el("span", { class: "del", text: "−" + (f.deletions || 0) }),
          ]),
        ]),
      ]);
      grid.appendChild(card);
    });
    view.appendChild(grid);
    show(view);
    setActiveNav(-1);
  }

  function renderFile(idx) {
    const f = DATA.files[idx];
    const af = analysisFiles[f.path] || {};
    const view = el("div", { class: "view" });

    const head = el("div", { class: "file-head" }, [
      el("div", { class: "file-path" }, [
        el("span", { class: "chip " + f.status, text: f.status[0].toUpperCase() }),
        document.createTextNode(f.path),
      ]),
      el("div", { class: "nstat" }, [
        el("span", { class: "add", text: "+" + (f.insertions || 0) }),
        document.createTextNode("  "),
        el("span", { class: "del", text: "−" + (f.deletions || 0) }),
        document.createTextNode(f.oldPath ? "  (" + T.renamedFrom + " " + f.oldPath + ")" : ""),
      ]),
    ]);
    view.appendChild(head);

    if (af.purpose) {
      view.appendChild(el("div", { class: "file-purpose" }, [
        el("span", { class: "ai-tag", text: T.whyFile }),
        el("div", { html: md(af.purpose) }),
      ]));
    }

    if (f.binary) {
      view.appendChild(el("div", { class: "binary-note", text: T.binary }));
      show(view); setActiveNav(idx); return;
    }
    if (!f.hunks.length) {
      view.appendChild(el("div", { class: "binary-note", text: T.noHunks }));
      show(view); setActiveNav(idx); return;
    }

    const hunkNotes = af.hunks || {};
    f.hunks.forEach((hunk, hi) => {
      const box = el("div", { class: "hunk" });
      box.appendChild(el("div", { class: "hunk-header" }, [
        document.createTextNode(hunk.header),
        hunk.section ? el("span", { text: "  " + hunk.section }) : null,
      ]));
      // A hunk note is either a plain string (simple block) or an object
      // { note, detail, complexity } for a harder block that needs an extensive
      // explanation. Both forms are supported for backward compatibility.
      const raw = hunkNotes[hi] != null ? hunkNotes[hi] : hunkNotes[String(hi)];
      if (raw) {
        const note = typeof raw === "string" ? raw : raw.note || "";
        const detail = typeof raw === "object" && raw ? raw.detail : "";
        const complex = typeof raw === "object" && raw && raw.complexity === "high";
        const ann = el("div", { class: "hunk-annotation" + (complex ? " complex" : "") });
        ann.appendChild(el("div", { class: "ann-head" }, [
          el("span", { class: "ai-tag", text: T.ai }),
          complex ? el("span", { class: "cx-badge", text: T.complex }) : null,
          note ? el("span", { html: md(note).replace(/^<p>|<\/p>$/g, "") }) : null,
        ]));
        if (detail) {
          const det = el("details", { class: "ann-detail" });
          if (complex) det.setAttribute("open", "");
          det.appendChild(el("summary", { text: T.detailed }));
          det.appendChild(el("div", { class: "prose ann-prose", html: md(detail) }));
          ann.appendChild(det);
        }
        box.appendChild(ann);
      }
      box.appendChild(splitMode ? renderDiffSplit(hunk) : renderDiffUnified(hunk));
      view.appendChild(box);
    });

    show(view);
    setActiveNav(idx);
  }

  let current = -1;
  function selectFile(idx) {
    current = idx;
    // Deep link: #file/<idx> so a specific file view is shareable within the artifact.
    if (location.hash !== "#file/" + idx) history.replaceState(null, "", "#file/" + idx);
    renderFile(idx);
  }
  function setActiveNav(idx) {
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.toggle("active", Number(n.dataset.idx) === idx));
  }

  // ---------- sidebar ----------
  // Per-file search haystack (path + all diff line content), lowercased once.
  const haystacks = DATA.files.map(
    (f) => (f.path + "\n" + (f.oldPath || "") + "\n" +
      f.hunks.map((h) => h.lines.map((l) => l.content).join("\n")).join("\n")).toLowerCase()
  );

  function buildSidebar() {
    const sb = document.getElementById("sidebar");

    // search box
    const search = el("input", {
      class: "sidebar-search", type: "search", placeholder: T.searchPlaceholder, "aria-label": T.searchPlaceholder,
    });
    sb.appendChild(el("div", { class: "search-wrap" }, [search]));

    sb.appendChild(el("div", { class: "nav-item", "data-idx": "-1", onclick: renderOverview }, [
      el("span", { text: "📋" }),
      el("span", { class: "label", text: T.overview }),
    ]));
    const sectionTitle = el("div", { class: "section-title", text: T.files + " (" + DATA.files.length + ")" });
    sb.appendChild(sectionTitle);

    const items = [];
    DATA.files.forEach((f, idx) => {
      const slash = f.path.lastIndexOf("/");
      const dir = slash >= 0 ? f.path.slice(0, slash + 1) : "";
      const base = slash >= 0 ? f.path.slice(slash + 1) : f.path;
      const countBadge = el("span", { class: "match-count" });
      const item = el("div", { class: "nav-item", "data-idx": String(idx), onclick: () => selectFile(idx) }, [
        el("span", { class: "chip " + f.status, text: f.status[0].toUpperCase() }),
        el("span", { class: "label" }, [
          dir ? el("span", { class: "path-dir", text: dir }) : null,
          document.createTextNode(base),
        ]),
        countBadge,
        el("span", { class: "nstat" }, [
          el("span", { class: "add", text: "+" + (f.insertions || 0) }),
          document.createTextNode(" "),
          el("span", { class: "del", text: "−" + (f.deletions || 0) }),
        ]),
      ]);
      items.push({ item, countBadge });
      sb.appendChild(item);
    });

    // filter: show a file if its path or any diff line matches; badge = hits.
    function applyFilter() {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      items.forEach(({ item, countBadge }, idx) => {
        if (!q) {
          item.style.display = "";
          countBadge.textContent = "";
          shown++;
          return;
        }
        let from = 0, hits = 0;
        const hay = haystacks[idx];
        while ((from = hay.indexOf(q, from)) !== -1) { hits++; from += q.length; }
        if (hits > 0) { item.style.display = ""; countBadge.textContent = String(hits); shown++; }
        else { item.style.display = "none"; countBadge.textContent = ""; }
      });
      sectionTitle.textContent = q ? `${T.files} (${shown}/${DATA.files.length})` : `${T.files} (${DATA.files.length})`;
    }
    search.addEventListener("input", applyFilter);
  }

  // ---------- topbar controls ----------
  function buildTopbar() {
    document.getElementById("rc-title").textContent = analysis.title || DATA.meta.repo || "Recap";
    const m = DATA.meta || {};
    document.getElementById("rc-meta").textContent = `${m.repo || ""}  ${m.base || ""} → ${m.head || ""}`;
    document.getElementById("rc-files").textContent = (DATA.stats.filesChanged || 0) + " " + T.filesCount;
    document.getElementById("rc-add").textContent = "+" + (DATA.stats.insertions || 0);
    document.getElementById("rc-del").textContent = "−" + (DATA.stats.deletions || 0);

    const modeBtn = document.getElementById("rc-mode");
    modeBtn.textContent = splitMode ? T.split : T.unified;
    modeBtn.title = T.toggleDiff;
    document.getElementById("rc-theme").title = T.toggleTheme;

    document.getElementById("rc-theme").addEventListener("click", () => {
      const root = document.documentElement;
      const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      root.setAttribute("data-theme", next);
      reInitMermaid();
    });
    document.getElementById("rc-mode").addEventListener("click", (e) => {
      splitMode = !splitMode;
      e.target.textContent = splitMode ? T.split : T.unified;
      if (current >= 0) renderFile(current);
    });
  }

  function reInitMermaid() {
    if (!window.mermaid) return;
    const dark = document.documentElement.getAttribute("data-theme") !== "light";
    window.mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "default", securityLevel: "loose" });
    if (current < 0) renderOverview();
  }

  // ---------- boot ----------
  document.addEventListener("DOMContentLoaded", () => {
    if (window.mermaid) {
      const dark = document.documentElement.getAttribute("data-theme") !== "light";
      window.mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "default", securityLevel: "loose" });
    }
    buildTopbar();
    buildSidebar();
    if (!DATA.files.length) {
      show(el("div", { class: "empty", text: T.noChanges }));
      return;
    }
    // Honor a deep link like #file/2 on load; otherwise show the overview.
    const m = (location.hash || "").match(/^#file\/(\d+)$/);
    const idx = m ? Number(m[1]) : -1;
    if (idx >= 0 && idx < DATA.files.length) selectFile(idx);
    else renderOverview();
  });
})();
