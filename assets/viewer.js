/* viewer.js — renders window.__RECAP__ into the local recap UI.
   Pure vanilla DOM. Code lines use textContent (never innerHTML) so a diff can
   never inject markup. Markdown from the analysis is rendered through a small
   built-in converter. No external dependencies except the inlined Mermaid. */

(function () {
  "use strict";

  const DATA = window.__RECAP__ || { meta: {}, stats: {}, commits: [], files: [], analysis: {} };
  const analysis = DATA.analysis || {};
  const analysisFiles = analysis.files || {};
  // The analysis references files by path; the viewer addresses them by index.
  const fileIndexByPath = new Map(DATA.files.map((f, i) => [f.path, i]));

  // ---------- i18n: chrome labels follow analysis.lang (AI prose is already
  // authored in that language). Unknown langs fall back to English chrome. ----------
  const LABELS = {
    en: {
      overview: "Overview", files: "Files", commits: "Commits",
      changedFiles: "Changed files", whyFile: "Why this file changed", ai: "AI",
      complex: "Complex", detailed: "Detailed explanation", codeFlow: "Code flow",
      searchPlaceholder: "Search files & code…",
      filesCount: "files", split: "Split", unified: "Unified",
      noChanges: "No changes found in this range.",
      binary: "Binary file — diff not shown.",
      noHunks: "No textual hunks (mode/metadata change only).",
      renamedFrom: "renamed from", toggleDiff: "Toggle split / unified diff",
      toggleTheme: "Toggle light / dark",
      whatChanges: "What changes", problem: "The problem it addresses",
      notCovered: "Not covered", flowHint: "Click a step to see the change behind it.",
      showFullFile: "Show the whole file", showChangeOnly: "Show only the change",
      openFileView: "Open in file view", close: "Close",
      fullTruncated: "File too long to show whole — only the change is shown.",
      fullUnavailable: "The whole file is not available for this change.",
      fullNote: "New version of the file. Changed lines are marked; removed lines are in the diff above.",
      changeOf: "change",
      stepHint: "Click to focus this step; click again to clear.",
    },
    es: {
      overview: "Resumen", files: "Archivos", commits: "Commits",
      changedFiles: "Archivos modificados", whyFile: "Por qué cambió este archivo", ai: "IA",
      complex: "Complejo", detailed: "Explicación detallada", codeFlow: "Flujo del código",
      searchPlaceholder: "Buscar archivos y código…",
      filesCount: "archivos", split: "Lado a lado", unified: "Unificado",
      noChanges: "No se encontraron cambios en este rango.",
      binary: "Archivo binario — no se muestra el diff.",
      noHunks: "Sin cambios de texto (solo cambió el modo/metadata).",
      renamedFrom: "renombrado de", toggleDiff: "Alternar lado a lado / unificado",
      toggleTheme: "Alternar claro / oscuro",
      whatChanges: "Qué cambia", problem: "El problema que ataca",
      notCovered: "Lo que no cubre", flowHint: "Haz clic en un paso para ver el cambio que lo hace.",
      showFullFile: "Ver el archivo completo", showChangeOnly: "Ver solo el cambio",
      openFileView: "Abrir en la vista del archivo", close: "Cerrar",
      fullTruncated: "El archivo es demasiado largo para mostrarlo entero: se muestra solo el cambio.",
      fullUnavailable: "El archivo completo no está disponible para este cambio.",
      fullNote: "Versión nueva del archivo. Las líneas cambiadas están marcadas; las borradas se ven en el diff de arriba.",
      changeOf: "cambio",
      stepHint: "Haz clic para enfocar este paso; otro clic lo quita.",
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
  // ---------- syntax highlighting (built in: the recap must stay self-contained) ----------
  // A line-level tokenizer, good enough to make code readable: comments, strings,
  // numbers, keywords, types and calls. It never parses, so a construct spanning
  // lines (a template literal, a block comment's middle line not starting with
  // "*") stays plain rather than being guessed. Code is still written with
  // textContent — highlighting only wraps tokens in spans.
  const HASH_COMMENT_LANGS = new Set(["python", "ruby", "bash", "yaml", "toml", "dockerfile", "makefile"]);
  const NO_HIGHLIGHT_LANGS = new Set(["plaintext", "markdown"]);
  const KEYWORDS = new Set((
    "abstract as async await break case catch class const continue debugger declare default delete do " +
    "else enum export extends false finally for from function get if implements import in infer instanceof " +
    "interface is keyof let namespace new null of private protected public readonly return satisfies set " +
    "static super switch this throw true try type typeof undefined var void while with yield " +
    "def elif except lambda None True False pass raise self fn impl mut pub use struct trait match " +
    "func go defer chan package select string number boolean any unknown never object bigint symbol"
  ).split(" "));
  const SQL_KEYWORDS = new Set((
    "select from where and or not null is in as join left right inner outer on group by order having " +
    "limit offset insert into values update set delete returning create table alter add drop index " +
    "case when then else end exists distinct coalesce"
  ).split(" "));

  function tokenRegex(lang) {
    const comment = HASH_COMMENT_LANGS.has(lang) ? "#.*" : lang === "sql" ? "--.*" : "\\/\\/.*|\\/\\*.*?(?:\\*\\/|$)";
    return new RegExp(
      `(${comment})|("(?:[^"\\\\]|\\\\.)*"?|'(?:[^'\\\\]|\\\\.)*'?|\`(?:[^\`\\\\]|\\\\.)*\`?)` +
        "|(\\b\\d[\\d_]*(?:\\.\\d+)?\\b)|([A-Za-z_$][\\w$]*)",
      "g",
    );
  }
  const regexByLang = new Map();

  // True for the inside of a block/doc comment: " * text", "/**", "*/".
  function isCommentLine(text, lang) {
    if (HASH_COMMENT_LANGS.has(lang) || lang === "sql") return false;
    const t = text.trimStart();
    return t.startsWith("*") || t.startsWith("/*");
  }

  function appendHighlighted(parent, text, lang) {
    if (NO_HIGHLIGHT_LANGS.has(lang)) { parent.appendChild(document.createTextNode(text)); return; }
    let re = regexByLang.get(lang);
    if (!re) { re = tokenRegex(lang); regexByLang.set(lang, re); }
    re.lastIndex = 0;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      let cls;
      if (m[1]) cls = "hl-com";
      else if (m[2]) cls = "hl-str";
      else if (m[3]) cls = "hl-num";
      else {
        const word = m[4];
        const kw = lang === "sql" ? SQL_KEYWORDS.has(word.toLowerCase()) : KEYWORDS.has(word);
        if (kw) cls = "hl-kw";
        else if (/^[A-Z]/.test(word)) cls = "hl-type";
        else if (text[re.lastIndex] === "(") cls = "hl-fn";
      }
      parent.appendChild(cls ? el("span", { class: cls, text: m[0] }) : document.createTextNode(m[0]));
      last = re.lastIndex;
      if (m[0] === "") re.lastIndex++;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  // One line of code into a cell: highlighted, and with the word-level diff on top
  // when `segments` is given (changed tokens keep their stronger background).
  function fillCode(cell, text, lang, segments, wordClass) {
    if (isCommentLine(text, lang)) { cell.appendChild(el("span", { class: "hl-com", text })); return; }
    if (!segments) { appendHighlighted(cell, text, lang); return; }
    for (const s of segments) {
      if (s.c) {
        const word = el("span", { class: wordClass });
        appendHighlighted(word, s.t, lang);
        cell.appendChild(word);
      } else appendHighlighted(cell, s.t, lang);
    }
  }

  // ---------- plain-language steps and focused lines ----------
  // Both are keyed on NEW-file line numbers, the same numbers the diff gutter shows.

  // A file's plain-language steps: [{ from, to, text }], invalid entries dropped.
  function stepsFor(f) {
    const raw = (analysisFiles[f.path] || {}).steps;
    if (!Array.isArray(raw)) return [];
    return raw.filter((s) => s && Number.isInteger(s.from) && Number.isInteger(s.to) && s.from <= s.to && s.text);
  }

  // The new-file line each rendered row stands for. A deleted line has none, so
  // it takes the next row's (it was replaced by what follows), else the previous'.
  function effectiveLines(newNums) {
    return newNums.map((n, i) => {
      if (n != null) return n;
      for (let j = i + 1; j < newNums.length; j++) if (newNums[j] != null) return newNums[j];
      for (let j = i - 1; j >= 0; j--) if (newNums[j] != null) return newNums[j];
      return null;
    });
  }

  // Dim every row outside `focus` ({ from, to }) and mark the ones inside.
  // Returns the first focused row, to scroll to.
  function applyFocus(rows, lines, focus) {
    if (!focus) return null;
    let first = null;
    rows.forEach((tr, i) => {
      const inside = lines[i] != null && lines[i] >= focus.from && lines[i] <= focus.to;
      tr.classList.add(inside ? "focus-line" : "dim");
      if (inside && !first) first = tr;
    });
    return first;
  }

  // Re-focus one code table on a step the reader picked, or clear the focus
  // (`step` null): the step's rows and its cell stay bright, everything else in
  // that table recedes.
  function setTableFocus(table, step, activeCell) {
    for (const tr of table._rows) tr.classList.remove("dim", "focus-line", "focus");
    for (const td of table.querySelectorAll("td.step")) {
      td.classList.toggle("step-active", td === activeCell);
      td.classList.toggle("step-dim", Boolean(activeCell) && td !== activeCell);
    }
    applyFocus(table._rows, table._lines, step ? { from: step.from, to: step.to } : null);
  }

  // The "what it does" column: one cell per run of rows sharing a step, spanning
  // those rows. Rows outside every step get an empty spanning cell so columns align.
  // Clicking a step focuses its code in this table; clicking it again clears it.
  function addStepColumn(table, rows, lines, steps) {
    table._rows = rows;
    table._lines = lines;
    if (!steps.length) return;
    const stepOf = lines.map((n) => (n == null ? null : steps.find((s) => n >= s.from && n <= s.to) || null));
    for (let i = 0; i < rows.length; ) {
      let j = i;
      while (j + 1 < rows.length && stepOf[j + 1] === stepOf[i]) j++;
      const s = stepOf[i];
      const td = el("td", { class: "step" + (s ? "" : " step-empty"), rowspan: String(j - i + 1) });
      if (s) {
        td.innerHTML = md(s.text).replace(/^<p>|<\/p>$/g, "");
        td.setAttribute("tabindex", "0");
        td.setAttribute("role", "button");
        td.title = T.stepHint;
        const toggle = () => {
          const active = td.classList.contains("step-active");
          setTableFocus(table, active ? null : s, active ? null : td);
        };
        td.addEventListener("click", toggle);
        td.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
        });
      }
      rows[i].appendChild(td);
      i = j + 1;
    }
  }

  // Shared tail of every code table: steps column, focus, and the scroll anchor.
  function finishCodeTable(table, rows, newNums, opts) {
    const lines = effectiveLines(newNums);
    addStepColumn(table, rows, lines, (opts && opts.steps) || []);
    table._anchor = applyFocus(rows, lines, opts && opts.focus);
    return table;
  }

  function renderDiffSplit(hunk, lang, opts) {
    const table = el("table", { class: "diff" });
    const rows = [], newNums = [];
    for (const row of sideBySide(hunk.lines)) {
      const tr = el("tr");
      // A modified pair (both sides present, not context) gets a word-level diff.
      const modified = !row.context && row.left && row.right;
      const seg = modified ? tokenDiff(tokenize(row.left.content), tokenize(row.right.content)) : null;
      // left (old)
      const lg = el("td", { class: "gutter", text: row.left && row.left.oldNum != null ? String(row.left.oldNum) : "" });
      const lc = el("td", { class: "code split-cell" + (row.context ? "" : row.left ? " del" : " empty") });
      fillCode(lc, row.left ? row.left.content : "", lang, seg && seg.left, "word-del");
      tr.appendChild(lg); tr.appendChild(lc);
      tr.appendChild(el("td", { class: "split-divider" }));
      // right (new)
      const rg = el("td", { class: "gutter", text: row.right && row.right.newNum != null ? String(row.right.newNum) : "" });
      const rc = el("td", { class: "code split-cell" + (row.context ? "" : row.right ? " add" : " empty") });
      fillCode(rc, row.right ? row.right.content : "", lang, seg && seg.right, "word-add");
      tr.appendChild(rg); tr.appendChild(rc);
      table.appendChild(tr);
      rows.push(tr);
      newNums.push(row.right && row.right.newNum != null ? row.right.newNum : null);
    }
    return finishCodeTable(table, rows, newNums, opts);
  }

  function renderDiffUnified(hunk, lang, opts) {
    const table = el("table", { class: "diff" });
    const rows = [], newNums = [];
    for (const l of hunk.lines) {
      const tr = el("tr", { class: l.type });
      tr.appendChild(el("td", { class: "gutter", text: l.oldNum != null ? String(l.oldNum) : "" }));
      tr.appendChild(el("td", { class: "gutter", text: l.newNum != null ? String(l.newNum) : "" }));
      const code = el("td", { class: "code" + (l.type === "add" ? " add" : l.type === "del" ? " del" : "") });
      fillCode(code, l.content, lang);
      tr.appendChild(code);
      table.appendChild(tr);
      rows.push(tr);
      newNums.push(l.newNum);
    }
    return finishCodeTable(table, rows, newNums, opts);
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

  // Render one Mermaid diagram card (title optional). No-op if empty/unavailable.
  // `links` maps a node id to a change ({ file, hunk }): those nodes open the
  // change modal once Mermaid has drawn them.
  function renderDiagram(view, title, source, links) {
    if (!source || !window.mermaid) return;
    const card = el("div", { class: "diagram-card" });
    if (title) card.appendChild(el("h3", { text: title }));
    const hasLinks = links && Object.keys(links).length > 0;
    if (hasLinks) card.appendChild(el("p", { class: "diagram-hint", text: T.flowHint }));
    const holder = el("div", { class: "mermaid", text: source });
    card.appendChild(holder);
    view.appendChild(card);
    try {
      const drawn = window.mermaid.run({ nodes: [holder] });
      if (hasLinks && drawn && typeof drawn.then === "function") {
        drawn.then(() => linkDiagramNodes(holder, links)).catch(() => {});
      }
    } catch (e) { holder.textContent = "Diagram error: " + e.message; }
  }

  // The Mermaid node id of a drawn node. Some renderers set data-id; the classic
  // flowchart (v11.15, the vendored one) only sets id="<svg id>-flowchart-<node id>-<n>".
  function diagramNodeId(node) {
    const dataId = node.getAttribute("data-id");
    if (dataId) return dataId;
    const m = (node.id || "").match(/-flowchart-(.+)-\d+$/);
    return m ? m[1] : null;
  }

  function linkDiagramNodes(holder, links) {
    holder.querySelectorAll("g.node").forEach((node) => {
      const id = diagramNodeId(node);
      const target = id && links[id] ? resolveTarget(links[id]) : null;
      if (!target) return;
      node.classList.add("clickable-node");
      node.setAttribute("role", "button");
      node.setAttribute("tabindex", "0");
      node.addEventListener("click", () => openChangeModal(target));
      node.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openChangeModal(target); }
      });
    });
  }

  function renderOverview() {
    current = -1;
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    const view = el("div", { class: "view" });
    const prose = el("div", { class: "prose" });
    prose.appendChild(el("h1", { text: analysis.title || "Recap" }));
    if (analysis.summary) prose.appendChild(el("div", { html: md(analysis.summary) }));
    view.appendChild(prose);

    // "What changes" and the flow are the two clickable maps into the code, so
    // they sit together; the architecture diagram follows (all optional).
    renderChanges(view);
    if (analysis.flow) renderDiagram(view, analysis.flow.title || T.codeFlow, analysis.flow.diagram, analysis.flow.links);
    if (analysis.overview) {
      renderDiagram(view, analysis.overview.diagramTitle, analysis.overview.diagram, analysis.overview.links);
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

    f.hunks.forEach((hunk, hi) => view.appendChild(renderHunkBox(f, hunk, hi)));

    show(view);
    setActiveNav(idx);
  }

  // One hunk: header, the AI annotation, then the diff. Shared by the file view
  // and the change modal so both read the same. The modal forces the one-column
  // (unified) diff: it reads like the file itself and fits without side scrolling.
  // `options.focus` ({ from, to }, new-file lines) dims the rest of the hunk; the
  // first focused row is exposed as `box._anchor` so the modal can scroll to it.
  function renderHunkBox(f, hunk, hi, options) {
    const unified = (options && options.unified) || !splitMode;
    const tableOpts = { steps: stepsFor(f), focus: options && options.focus };
    const hunkNotes = (analysisFiles[f.path] || {}).hunks || {};
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
    const table = unified ? renderDiffUnified(hunk, f.language, tableOpts) : renderDiffSplit(hunk, f.language, tableOpts);
    box.appendChild(table);
    box._anchor = table._anchor;
    return box;
  }

  // ---------- change modal: one hunk, focused, with the whole file on demand ----------

  // `lines: [from, to]` (new-file line numbers) narrows a reference to the exact
  // code it talks about. Kept only when it overlaps the hunk; otherwise dropped
  // with a warning and the whole hunk is shown, as without it.
  function focusFor(ref, hunk) {
    if (!ref.lines) return null;
    const [from, to] = Array.isArray(ref.lines) ? ref.lines.map(Number) : [];
    const hunkFrom = hunk ? hunk.newStart : 0;
    const hunkTo = hunk ? hunk.newStart + Math.max(hunk.newLines, 1) - 1 : 0;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from > to || !hunk || to < hunkFrom || from > hunkTo) {
      console.warn("[recap] lines outside the referenced hunk:", ref);
      return null;
    }
    return { from, to };
  }

  // Resolve an analysis reference { file, hunk, lines? } to indexes, or null when
  // it does not point at a real file/hunk of this diff (never guess a target).
  function resolveTarget(ref) {
    if (!ref || !ref.file) return null;
    const fileIdx = fileIndexByPath.get(ref.file);
    if (fileIdx == null) {
      console.warn("[recap] unknown file in analysis reference:", ref.file);
      return null;
    }
    const hunkCount = DATA.files[fileIdx].hunks.length;
    const hunkIdx = ref.hunk == null ? 0 : Number(ref.hunk);
    if (!Number.isInteger(hunkIdx) || hunkIdx < 0 || hunkIdx >= Math.max(hunkCount, 1)) {
      console.warn("[recap] hunk out of range in analysis reference:", ref);
      return null;
    }
    return { fileIdx, hunkIdx, focus: focusFor(ref, DATA.files[fileIdx].hunks[hunkIdx]) };
  }

  // The whole new file, changed lines marked, the steps column alongside, and the
  // focus (the referenced lines, else the whole hunk) outlined. Nothing is dimmed:
  // this view is for context.
  function renderFullFile(f, focusHunk, focusLines) {
    const added = new Set();
    for (const h of f.hunks) for (const l of h.lines) if (l.type === "add") added.add(l.newNum);
    const focus = focusLines || (focusHunk
      ? { from: focusHunk.newStart, to: focusHunk.newStart + Math.max(focusHunk.newLines, 1) - 1 }
      : null);
    const table = el("table", { class: "diff full-file" });
    const rows = [], newNums = [];
    let anchor = null;
    f.fullLines.forEach((text, i) => {
      const n = i + 1;
      const inFocus = focus && n >= focus.from && n <= focus.to;
      const tr = el("tr", { class: inFocus ? "focus" : "" });
      tr.appendChild(el("td", { class: "gutter", text: String(n) }));
      const code = el("td", { class: "code" + (added.has(n) ? " add" : "") });
      fillCode(code, text, f.language);
      tr.appendChild(code);
      table.appendChild(tr);
      rows.push(tr);
      newNums.push(n);
      if (inFocus && !anchor) anchor = tr;
    });
    addStepColumn(table, rows, newNums, stepsFor(f));
    return { table, anchor };
  }

  let modalReturnFocus = null;

  function closeModal() {
    const m = document.getElementById("rc-modal");
    if (m) m.remove();
    document.body.classList.remove("modal-open");
    if (modalReturnFocus) modalReturnFocus.focus();
    modalReturnFocus = null;
  }

  function openChangeModal(target) {
    closeModal();
    modalReturnFocus = document.activeElement;
    const f = DATA.files[target.fileIdx];
    const hunk = f.hunks[target.hunkIdx];

    const body = el("div", { class: "modal-body" });
    const focused = el("div", { class: "modal-focus" });
    const af = analysisFiles[f.path] || {};
    if (af.purpose) {
      focused.appendChild(el("div", { class: "file-purpose" }, [
        el("span", { class: "ai-tag", text: T.whyFile }),
        el("div", { html: md(af.purpose) }),
      ]));
    }
    let focusAnchor = null;
    if (hunk) {
      const box = renderHunkBox(f, hunk, target.hunkIdx, { unified: true, focus: target.focus });
      focusAnchor = box._anchor;
      focused.appendChild(box);
    } else focused.appendChild(el("div", { class: "binary-note", text: f.binary ? T.binary : T.noHunks }));
    body.appendChild(focused);

    const fullWrap = el("div", { class: "modal-full", hidden: "" });
    const toggle = el("button", { class: "icon-btn", type: "button", text: T.showFullFile });
    toggle.addEventListener("click", () => {
      const showingFull = !fullWrap.hasAttribute("hidden");
      if (showingFull) {
        fullWrap.setAttribute("hidden", "");
        focused.removeAttribute("hidden");
        toggle.textContent = T.showFullFile;
        return;
      }
      if (!fullWrap.childNodes.length) {
        if (f.fullLines) {
          const { table, anchor } = renderFullFile(f, hunk, target.focus);
          fullWrap.appendChild(el("div", { class: "full-note", text: T.fullNote }));
          fullWrap.appendChild(table);
          fullWrap._anchor = anchor;
        } else {
          fullWrap.appendChild(el("div", { class: "binary-note", text: f.fullTruncated ? T.fullTruncated : T.fullUnavailable }));
        }
      }
      focused.setAttribute("hidden", "");
      fullWrap.removeAttribute("hidden");
      toggle.textContent = T.showChangeOnly;
      if (fullWrap._anchor) fullWrap._anchor.scrollIntoView({ block: "center" });
    });
    body.appendChild(fullWrap);

    const closeBtn = el("button", { class: "icon-btn modal-close", type: "button", "aria-label": T.close, title: T.close, text: "✕" });
    closeBtn.addEventListener("click", closeModal);
    const toFile = el("button", { class: "icon-btn", type: "button", text: T.openFileView });
    toFile.addEventListener("click", () => { closeModal(); selectFile(target.fileIdx); });

    const position = f.hunks.length ? `${T.changeOf} ${target.hunkIdx + 1}/${f.hunks.length}` : "";
    const dialog = el("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": f.path }, [
      el("div", { class: "modal-head" }, [
        el("div", { class: "file-path" }, [
          el("span", { class: "chip " + f.status, text: f.status[0].toUpperCase() }),
          document.createTextNode(f.path),
        ]),
        el("span", { class: "modal-pos", text: position }),
        el("div", { class: "spacer" }),
        toggle,
        toFile,
        closeBtn,
      ]),
      body,
    ]);
    const backdrop = el("div", { class: "modal-backdrop", id: "rc-modal" }, [dialog]);
    // Close only on a click on the backdrop itself, not on one that bubbled up from the dialog.
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(); });
    document.body.appendChild(backdrop);
    document.body.classList.add("modal-open");
    closeBtn.focus();
    // Land on the lines the reference talks about, not on the top of the hunk.
    if (focusAnchor) focusAnchor.scrollIntoView({ block: "center" });
  }

  // A clickable reference to a change. Renders as plain content when the
  // reference does not resolve, so a bad analysis entry degrades instead of breaking.
  function changeLink(ref, children, cls) {
    const target = resolveTarget(ref);
    if (!target) return el("span", { class: cls || "" }, children);
    return el("button", {
      class: "change-link " + (cls || ""), type: "button",
      onclick: () => openChangeModal(target),
    }, children);
  }

  // ---------- "What changes": problem, numbered points, what it does not cover ----------
  function renderChanges(view) {
    const ch = analysis.changes;
    if (!ch) return;
    const sec = el("section", { class: "changes prose" });
    sec.appendChild(el("h2", { text: ch.title || T.whatChanges }));

    if (ch.problem) {
      sec.appendChild(el("h3", { text: T.problem }));
      sec.appendChild(el("div", { html: md(ch.problem) }));
    }

    const points = Array.isArray(ch.points) ? ch.points : [];
    if (points.length) {
      const list = el("ol", { class: "change-points" });
      points.forEach((p) => {
        const li = el("li");
        const head = el("div", { class: "point-head" }, [
          changeLink({ file: p.file, hunk: p.hunk, lines: p.lines }, [el("span", { class: "point-title", text: p.title || p.file || "" })], "point-link"),
          p.file ? el("code", { class: "point-file", text: p.file }) : null,
        ]);
        li.appendChild(head);
        const bullets = Array.isArray(p.bullets) ? p.bullets : [];
        if (bullets.length) {
          const ul = el("ul", { class: "point-bullets" });
          for (const b of bullets) {
            const text = typeof b === "string" ? b : b.text;
            const ref = typeof b === "object" && b && b.hunk != null
              ? { file: b.file || p.file, hunk: b.hunk, lines: b.lines }
              : null;
            const content = [el("span", { html: md(text).replace(/^<p>|<\/p>$/g, "") })];
            ul.appendChild(el("li", {}, [ref ? changeLink(ref, content, "bullet-link") : el("span", {}, content)]));
          }
          li.appendChild(ul);
        }
        list.appendChild(li);
      });
      sec.appendChild(list);
    }

    const notCovered = Array.isArray(ch.notCovered) ? ch.notCovered : [];
    if (notCovered.length) {
      sec.appendChild(el("h3", { text: T.notCovered }));
      sec.appendChild(el("ul", {}, notCovered.map((t) => el("li", { html: md(t).replace(/^<p>|<\/p>$/g, "") }))));
    }
    view.appendChild(sec);
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
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && document.getElementById("rc-modal")) closeModal();
    });
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
