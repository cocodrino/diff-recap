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
      whyFile: "Why this file changed", ai: "AI",
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
      backToOverview: "← Overview", toggleFolder: "Collapse / expand folder",
      zoomIn: "Zoom in", zoomOut: "Zoom out", zoomFit: "Fit", zoomReset: "100%",
      fullscreen: "Full screen",
      toggleSidebar: "Show / hide the file tree", resizeSidebar: "Drag to resize · double-click to reset",
      testFile: "test",
      zoomHint: "Pinch or Ctrl + scroll to zoom · drag or scroll to move.",
      decisions: "Decisions made", decidedByUser: "Decided by the user", decidedByAgent: "Decided by the agent",
      decisionContext: "Context", decisionOptions: "Options", decisionChosen: "chosen",
      decisionReason: "Why", decisionFiles: "Where it landed",
    },
    es: {
      overview: "Resumen", files: "Archivos", commits: "Commits",
      whyFile: "Por qué cambió este archivo", ai: "IA",
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
      backToOverview: "← Resumen", toggleFolder: "Plegar / desplegar carpeta",
      zoomIn: "Acercar", zoomOut: "Alejar", zoomFit: "Ajustar", zoomReset: "100%",
      fullscreen: "Pantalla completa",
      toggleSidebar: "Mostrar / ocultar el árbol de archivos", resizeSidebar: "Arrastra para cambiar el ancho · doble clic lo restablece",
      testFile: "test",
      zoomHint: "Pellizca o usa Ctrl + rueda para ampliar · arrastra o desliza para moverte.",
      decisions: "Decisiones tomadas", decidedByUser: "La tomó el usuario", decidedByAgent: "La tomó el agente",
      decisionContext: "Contexto", decisionOptions: "Opciones", decisionChosen: "elegida",
      decisionReason: "Por qué", decisionFiles: "Dónde quedó",
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
    linkFileMentions(node);
  }

  // ---------- file references: anything that names a changed file ----------
  // A reference carries data-file-ref="<file index>"; hovering it highlights that
  // file in the sidebar tree (see the hover wiring at boot).
  function markFileRef(node, idx, isMention) {
    node.setAttribute("data-file-ref", String(idx));
    if (isMention) {
      node.classList.add("file-ref");
      if (!node.getAttribute("title")) node.setAttribute("title", DATA.files[idx].path);
    }
    return node;
  }

  // A path as prose writes it — full ("backend/x/y.ts"), partial ("x/y.ts") or
  // bare ("y.ts"), optionally with ":line" — to a file index. Only an exact path
  // or a suffix shared by exactly ONE changed file resolves: an ambiguous name
  // ("index.ts" in two folders) highlights nothing rather than the wrong file.
  const mentionCache = new Map();
  function resolveFileMention(raw) {
    const text = String(raw).trim().replace(/:\d+(?:-\d+)?$/, "").replace(/^\.\//, "");
    if (mentionCache.has(text)) return mentionCache.get(text);
    let idx = fileIndexByPath.has(text) ? fileIndexByPath.get(text) : null;
    if (idx == null && text) {
      const hits = [];
      DATA.files.forEach((f, i) => { if (f.path.endsWith("/" + text)) hits.push(i); });
      if (hits.length === 1) idx = hits[0];
    }
    mentionCache.set(text, idx);
    return idx;
  }

  const MENTION_RE = /[\w@[\]-][\w.@[\]-]*(?:\/[\w.@[\]-]+)*\.[A-Za-z]\w{0,5}(?::\d+(?:-\d+)?)?/g;
  // Code, line numbers and diagrams are not prose; an existing mention is not re-wrapped.
  const MENTION_SKIP = "td.code, td.gutter, pre, .mermaid, .hunk-header, .file-ref, .tree, script, style";

  // Mark every mention of a changed file inside `root`: a whole `code` span that
  // names one, and bare paths inside plain text (wrapped in a span).
  function linkFileMentions(root) {
    root.querySelectorAll("code").forEach((c) => {
      if (c.closest(MENTION_SKIP)) return;
      const idx = resolveFileMention(c.textContent);
      if (idx != null) markFileRef(c, idx, true);
    });
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.nodeType === 1) return n.matches(MENTION_SKIP + ", code") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        return /\.[A-Za-z]/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    texts.forEach(wrapMentions);
  }

  function wrapMentions(textNode) {
    const text = textNode.nodeValue;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(MENTION_RE)) {
      const idx = resolveFileMention(m[0]);
      if (idx == null) continue;
      frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      frag.appendChild(markFileRef(el("span", { text: m[0] }), idx, true));
      last = m.index + m[0].length;
    }
    if (!last) return;
    frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.replaceWith(frag);
  }

  // Render one Mermaid diagram card (title optional). No-op if empty/unavailable.
  // `links` maps a node id to a change ({ file, hunk }): those nodes open the
  // change modal once Mermaid has drawn them. Returns a promise that settles once
  // the diagram is drawn, so the caller can restore a scroll position after the
  // layout stops moving.
  function renderDiagram(view, title, source, links) {
    if (!source || !window.mermaid) return Promise.resolve();
    const card = el("div", { class: "diagram-card" });
    if (title) card.appendChild(el("h3", { text: title }));
    const hasLinks = links && Object.keys(links).length > 0;
    card.appendChild(el("p", { class: "diagram-hint", text: (hasLinks ? T.flowHint + " " : "") + T.zoomHint }));
    const holder = el("div", { class: "mermaid", text: source });
    const viewport = el("div", { class: "diagram-viewport" }, [el("div", { class: "diagram-stage" }, [holder])]);
    card.appendChild(viewport);
    view.appendChild(card);
    try {
      return Promise.resolve(window.mermaid.run({ nodes: [holder] }))
        .then(() => {
          wireDiagramNodes(holder, links || {});
          enablePanZoom(card, viewport);
        })
        .catch(() => {});
    } catch (e) {
      holder.textContent = "Diagram error: " + e.message;
      return Promise.resolve();
    }
  }

  // ---------- diagram pan & zoom ----------
  // The drawn SVG is laid out at its natural size inside a stage that is moved
  // and scaled with a CSS transform. Gestures: trackpad pinch / Ctrl + wheel
  // (Chrome, Firefox, Edge), Safari gesture events, two-finger touch pinch,
  // mouse drag, and plain wheel to pan. Plain wheel only pans while the diagram
  // can still move that way — at an edge the page scrolls, so a tall diagram
  // never traps the reader.
  const ZOOM_MIN = 0.2, ZOOM_MAX = 4, ZOOM_STEP = 1.25;
  // Below this the labels stop being readable, so the first view does not shrink
  // a wide diagram past it; the reader pans instead, or picks "Fit".
  const ZOOM_READABLE = 0.75;

  function enablePanZoom(card, viewport) {
    // The reader may have left the view while Mermaid was drawing: nothing to measure.
    if (!card.isConnected) return;
    const stage = viewport.firstChild;
    const svg = stage.querySelector("svg");
    if (!svg) return;
    const vb = svg.viewBox && svg.viewBox.baseVal;
    const natW = vb && vb.width ? vb.width : svg.getBoundingClientRect().width;
    const natH = vb && vb.height ? vb.height : svg.getBoundingClientRect().height;
    if (!natW || !natH) return;
    // Mermaid sizes the SVG to "100%" with a max-width; pin it to its natural size.
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.style.width = natW + "px";
    svg.style.height = natH + "px";
    svg.style.maxWidth = "none";

    let scale = 1, x = 0, y = 0;
    const size = () => ({ w: viewport.clientWidth, h: viewport.clientHeight });

    function clampPan() {
      const { w, h } = size();
      const cw = natW * scale, ch = natH * scale;
      // Smaller than the viewport: centered. Larger: no empty gap past either edge.
      x = cw <= w ? (w - cw) / 2 : Math.min(0, Math.max(w - cw, x));
      y = ch <= h ? (h - ch) / 2 : Math.min(0, Math.max(h - ch, y));
    }
    function apply() {
      clampPan();
      stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      zoomLabel.textContent = Math.round(scale * 100) + "%";
    }
    // Zoom keeping the diagram point under (px, py) — viewport coordinates — still.
    function zoomAt(next, px, py) {
      next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
      x = px - ((px - x) / scale) * next;
      y = py - ((py - y) / scale) * next;
      scale = next;
      apply();
    }
    const zoomCenter = (factor) => { const { w, h } = size(); zoomAt(scale * factor, w / 2, h / 2); };
    // Fit the diagram. `readableFloor` (the first view) never shrinks it below a
    // readable size; the "Fit" button does, so the whole diagram is visible.
    function fit(readableFloor) {
      const fullscreen = document.fullscreenElement === card;
      // Height of the viewport follows the diagram (capped); in full screen CSS fills it.
      viewport.style.height = "";
      const { w } = size();
      let s = Math.min(1, w / natW);
      if (readableFloor) s = Math.max(s, ZOOM_READABLE);
      if (!fullscreen) {
        const cap = Math.round(window.innerHeight * 0.7);
        viewport.style.height = Math.min(cap, Math.max(160, natH * s)) + "px";
      }
      const { h } = size();
      if (fullscreen || !readableFloor) s = Math.min(s, h / natH);
      scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));
      x = 0; y = 0;
      apply();
    }

    const btn = (text, title, onClick) => {
      const b = el("button", { class: "icon-btn zoom-btn", type: "button", title, "aria-label": title, text });
      b.addEventListener("click", onClick);
      return b;
    };
    const zoomLabel = el("span", { class: "zoom-level" });
    const toolbar = el("div", { class: "diagram-toolbar" }, [
      btn("−", T.zoomOut, () => zoomCenter(1 / ZOOM_STEP)),
      zoomLabel,
      btn("+", T.zoomIn, () => zoomCenter(ZOOM_STEP)),
      btn(T.zoomFit, T.zoomFit, () => fit(false)),
      btn(T.zoomReset, T.zoomReset, () => { const { w, h } = size(); zoomAt(1, w / 2, h / 2); }),
      card.requestFullscreen ? btn("⛶", T.fullscreen, () => {
        if (document.fullscreenElement === card) document.exitFullscreen();
        else card.requestFullscreen().catch(() => {});
      }) : null,
    ]);
    card.insertBefore(toolbar, viewport);

    viewport.addEventListener("wheel", (e) => {
      const r = viewport.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch arrives as a wheel event with ctrlKey set.
        e.preventDefault();
        zoomAt(scale * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
        return;
      }
      const beforeX = x, beforeY = y;
      x -= e.deltaX; y -= e.deltaY;
      apply();
      if (x !== beforeX || y !== beforeY) e.preventDefault();
    }, { passive: false });

    // Safari (macOS) reports trackpad pinch as gesture events, not ctrl + wheel.
    let gestureStart = 1;
    viewport.addEventListener("gesturestart", (e) => { e.preventDefault(); gestureStart = scale; });
    viewport.addEventListener("gesturechange", (e) => {
      e.preventDefault();
      const r = viewport.getBoundingClientRect();
      zoomAt(gestureStart * e.scale, e.clientX - r.left, e.clientY - r.top);
    });

    // Drag to pan (mouse, pen, one finger) and two-finger pinch on touch screens.
    // The pointer is captured only once it really moves, so a plain click still
    // reaches the diagram node under it and opens its change.
    const pointers = new Map();
    let drag = null, pinch = null, dragged = false;
    const DRAG_THRESHOLD = 4;
    viewport.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dragged = false;
      if (pointers.size === 1) drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x0: x, y0: y };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale0: scale };
        drag = null;
      }
    });
    viewport.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const r = viewport.getBoundingClientRect();
        dragged = true;
        zoomAt(pinch.scale0 * (Math.hypot(a.x - b.x, a.y - b.y) / (pinch.dist || 1)),
          (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        return;
      }
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!dragged) { dragged = true; viewport.setPointerCapture(e.pointerId); viewport.classList.add("dragging"); }
      x = drag.x0 + dx; y = drag.y0 + dy;
      apply();
    });
    const release = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (drag && drag.id === e.pointerId) drag = null;
      viewport.classList.remove("dragging");
    };
    viewport.addEventListener("pointerup", release);
    viewport.addEventListener("pointercancel", release);
    // A drag that ends on a node must not also count as a click on it.
    viewport.addEventListener("click", (e) => { if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; } }, true);

    // Refit on entering/leaving full screen. A re-render drops the card, so the
    // listener removes itself the first time it finds the card gone.
    const onFullscreen = () => {
      if (!card.isConnected) { document.removeEventListener("fullscreenchange", onFullscreen); return; }
      requestAnimationFrame(() => fit(document.fullscreenElement !== card));
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    fit(true);
  }

  // The Mermaid node id of a drawn node. Some renderers set data-id; the classic
  // flowchart (v11.15, the vendored one) only sets id="<svg id>-flowchart-<node id>-<n>".
  function diagramNodeId(node) {
    const dataId = node.getAttribute("data-id");
    if (dataId) return dataId;
    const m = (node.id || "").match(/-flowchart-(.+)-\d+$/);
    return m ? m[1] : null;
  }

  // The file a drawn node names in its label ("…<br/>billing-clock.service.ts:168").
  // Each label line is its own text node, so lines are matched one at a time.
  function fileNamedInNode(node) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      for (const m of walker.currentNode.nodeValue.matchAll(MENTION_RE)) {
        const idx = resolveFileMention(m[0]);
        if (idx != null) return idx;
      }
    }
    return null;
  }

  // Every node that maps to a changed file highlights it in the tree on hover —
  // through its link when it has one, else through the file its label names.
  // Linked nodes also open their change.
  function wireDiagramNodes(holder, links) {
    holder.querySelectorAll("g.node").forEach((node) => {
      const id = diagramNodeId(node);
      const target = id && links[id] ? resolveTarget(links[id]) : null;
      const fileIdx = target ? target.fileIdx : fileNamedInNode(node);
      if (fileIdx != null) {
        markFileRef(node, fileIdx, false);
        node.classList.add("file-node");
      }
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

  // `scrollTop` puts the reader back where they were (returning from a file, or a
  // re-render after a theme change). It is applied again once the diagrams are
  // drawn, because drawing them changes the page height.
  function renderOverview(scrollTop) {
    current = -1;
    const view = el("div", { class: "view" });
    const prose = el("div", { class: "prose" });
    prose.appendChild(el("h1", { text: analysis.title || "Recap" }));
    if (analysis.summary) prose.appendChild(el("div", { html: md(analysis.summary) }));
    view.appendChild(prose);

    // "What changes" and the flow are the two clickable maps into the code, so
    // they sit together; the architecture diagram follows (all optional).
    renderChanges(view);
    const drawn = [];
    if (analysis.flow) drawn.push(renderDiagram(view, analysis.flow.title || T.codeFlow, analysis.flow.diagram, analysis.flow.links));
    if (analysis.overview) {
      drawn.push(renderDiagram(view, analysis.overview.diagramTitle, analysis.overview.diagram, analysis.overview.links));
    }

    renderDecisions(view);

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

    show(view);
    setActiveNav(-1);
    if (scrollTop) {
      content().scrollTop = scrollTop;
      Promise.all(drawn).then(() => { if (current === -1) content().scrollTop = scrollTop; });
    }
  }

  function renderFile(idx) {
    const f = DATA.files[idx];
    const af = analysisFiles[f.path] || {};
    const view = el("div", { class: "view" });

    view.appendChild(el("button", { class: "back-link", type: "button", text: T.backToOverview, onclick: () => navigate(-1) }));
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
    toFile.addEventListener("click", () => { closeModal(); navigate(target.fileIdx); });

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
    linkFileMentions(dialog);
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
      "data-file-ref": String(target.fileIdx),
      onclick: () => openChangeModal(target),
    }, children);
  }

  // ---------- "Decisions": the branch's decision log, as written during the work ----------
  // One card per decision: who decided, the context, every option weighed (the
  // chosen one marked) and the reason. The data comes from
  // .recap/choices/<branch>.md, parsed by generate.mjs; nothing is inferred here.
  function renderDecisions(view) {
    const decisions = Array.isArray(DATA.decisions) ? DATA.decisions : [];
    if (!decisions.length) return;
    const sec = el("section", { class: "decisions" });
    sec.appendChild(el("h2", { text: `${T.decisions} (${decisions.length})` }));
    decisions.forEach((d, i) => {
      const byUser = d.decidedBy === "user";
      const card = el("article", { class: "decision" });
      card.appendChild(el("div", { class: "decision-head" }, [
        el("span", { class: "decision-num", text: String(i + 1) }),
        el("h3", { class: "decision-title", html: md(d.title).replace(/^<p>|<\/p>$/g, "") }),
        el("span", { class: "decided-by " + (byUser ? "by-user" : "by-agent"), text: byUser ? T.decidedByUser : T.decidedByAgent }),
        d.date ? el("span", { class: "decision-date", text: d.date }) : null,
      ]));
      if (d.context) {
        card.appendChild(el("h4", { text: T.decisionContext }));
        card.appendChild(el("div", { class: "prose", html: md(d.context) }));
      }
      card.appendChild(el("h4", { text: T.decisionOptions }));
      const opts = el("div", { class: "decision-options" });
      for (const o of d.options) {
        const chosen = o.key === d.chosen;
        opts.appendChild(el("div", { class: "decision-option" + (chosen ? " chosen" : "") }, [
          el("div", { class: "option-head" }, [
            el("span", { class: "option-key", text: o.key }),
            el("span", { class: "option-name", html: md(o.name).replace(/^<p>|<\/p>$/g, "") }),
            chosen ? el("span", { class: "option-chosen", text: "✓ " + T.decisionChosen }) : null,
          ]),
          o.body ? el("div", { class: "prose option-body", html: md(o.body) }) : null,
        ]));
      }
      card.appendChild(opts);
      card.appendChild(el("h4", { text: T.decisionReason }));
      card.appendChild(el("div", { class: "prose decision-reason", html: md(d.reason) }));
      if (d.files && d.files.length) {
        card.appendChild(el("div", { class: "decision-files" }, [
          el("span", { class: "decision-files-label", text: T.decisionFiles }),
          ...d.files.map((p) => decisionFile(p)),
        ]));
      }
      sec.appendChild(card);
    });
    view.appendChild(sec);
  }

  // A file a decision landed in: lights up in the tree on hover, opens on click.
  function decisionFile(path) {
    const idx = fileIndexByPath.get(path);
    if (idx == null) return el("code", { class: "decision-file", text: path });
    return markFileRef(el("button", {
      class: "decision-file change-link", type: "button", text: path, onclick: () => navigate(idx),
    }), idx, false);
  }

  // The path printed beside a point's title; a reference to its file when it resolves.
  function pointFile(path) {
    const node = el("code", { class: "point-file", text: path });
    const idx = fileIndexByPath.get(path);
    return idx == null ? node : markFileRef(node, idx, true);
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
          p.file ? pointFile(p.file) : null,
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

  // ---------- routing: the URL hash is the view ----------
  // "" is the overview, "#file/<n>" a file. Every navigation adds a history entry,
  // so the browser's Back button returns to the previous view, and a #file/<n>
  // link stays shareable inside the artifact.
  let current = null; // index of the file on screen, -1 for the overview, null before the first render
  let overviewScroll = 0;

  function viewFromHash() {
    const m = (location.hash || "").match(/^#file\/(\d+)$/);
    const idx = m ? Number(m[1]) : -1;
    return idx >= 0 && idx < DATA.files.length ? idx : -1;
  }

  function navigate(idx) {
    if (idx === current) return;
    history.pushState(null, "", idx >= 0 ? "#file/" + idx : location.pathname + location.search);
    route();
  }

  // Render whatever the URL names. Called on navigation and on Back/Forward; the
  // guard makes the duplicate event some browsers fire (popstate + hashchange) a no-op.
  function route() {
    const idx = viewFromHash();
    if (idx === current) return;
    closeModal();
    if (current === -1) overviewScroll = content().scrollTop;
    if (idx >= 0) {
      current = idx;
      renderFile(idx);
    } else renderOverview(overviewScroll);
  }

  function setActiveNav(idx) {
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.toggle("active", Number(n.dataset.idx) === idx));
    if (idx >= 0 && fileTree) fileTree.reveal(idx, true);
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

    sb.appendChild(el("div", { class: "nav-item", "data-idx": "-1", onclick: () => navigate(-1) }, [
      el("span", { text: "📋" }),
      el("span", { class: "label", text: T.overview }),
    ]));
    const sectionTitle = el("div", { class: "section-title", text: T.files + " (" + DATA.files.length + ")" });
    sb.appendChild(sectionTitle);

    fileTree = buildFileTree(sb);
    sb.appendChild(fileTree.root);

    // filter: show a file if its path or any diff line matches; badge = hits.
    // Folders with no matching file disappear; collapsed ones open while searching.
    function applyFilter() {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      fileTree.files.forEach(({ row, countBadge }, idx) => {
        let hits = 0;
        if (q) {
          let from = 0;
          const hay = haystacks[idx];
          while ((from = hay.indexOf(q, from)) !== -1) { hits++; from += q.length; }
        }
        const visible = !q || hits > 0;
        row.hidden = !visible;
        countBadge.textContent = q && hits ? String(hits) : "";
        if (visible) shown++;
      });
      fileTree.root.classList.toggle("searching", Boolean(q));
      fileTree.refreshFolders();
      sectionTitle.textContent = q ? `${T.files} (${shown}/${DATA.files.length})` : `${T.files} (${DATA.files.length})`;
    }
    search.addEventListener("input", applyFilter);
  }

  // ---------- file tree (GitHub review style) ----------
  // Only changed files, grouped by folder. A folder whose only child is another
  // folder is merged with it ("backend/app/engine"), as GitHub does, so a deep
  // path does not cost one indentation level per segment. Folders first, then
  // files, each alphabetical.
  let fileTree = null;

  function treeModel() {
    const root = { name: "", dirs: new Map(), files: [] };
    DATA.files.forEach((f, idx) => {
      const parts = f.path.split("/");
      let node = root;
      for (const part of parts.slice(0, -1)) {
        if (!node.dirs.has(part)) node.dirs.set(part, { name: part, dirs: new Map(), files: [] });
        node = node.dirs.get(part);
      }
      node.files.push({ name: parts[parts.length - 1], idx });
    });
    const compact = (dir) => {
      for (const child of dir.dirs.values()) compact(child);
      if (dir.name && dir.files.length === 0 && dir.dirs.size === 1) {
        const only = dir.dirs.values().next().value;
        dir.name += "/" + only.name;
        dir.dirs = only.dirs;
        dir.files = only.files;
      }
    };
    compact(root);
    return root;
  }

  const byName = (a, b) => a.name.localeCompare(b.name);
  const TREE_INDENT = 14;

  function buildFileTree(sidebar) {
    const files = []; // by file index: { row, countBadge, folders: [wrap…] outermost first }
    const folders = []; // every folder wrapper, outermost first
    const root = el("div", { class: "tree", role: "tree" });

    function addDir(dir, parent, depth, ancestors) {
      const children = el("div", { class: "tree-children", role: "group" });
      const wrap = el("div", { class: "tree-dir-wrap" });
      const row = el("div", {
        class: "tree-dir", role: "treeitem", tabindex: "0", "aria-expanded": "true", title: T.toggleFolder,
        style: `padding-left:${8 + depth * TREE_INDENT}px`,
      }, [
        el("span", { class: "tree-caret", "aria-hidden": "true", text: "▾" }),
        el("span", { class: "tree-folder", "aria-hidden": "true" }),
        el("span", { class: "tree-name", text: dir.name }),
      ]);
      const toggle = () => {
        const collapsed = wrap.classList.toggle("collapsed");
        row.setAttribute("aria-expanded", String(!collapsed));
      };
      row.addEventListener("click", toggle);
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
      });
      wrap._row = row;
      wrap.appendChild(row);
      wrap.appendChild(children);
      parent.appendChild(wrap);
      folders.push(wrap);
      addChildren(dir, children, depth + 1, ancestors.concat(wrap));
    }

    function addFile(file, parent, depth, ancestors) {
      const f = DATA.files[file.idx];
      const countBadge = el("span", { class: "match-count" });
      const row = el("div", {
        // Tests are toned down so the code under review stands out in the tree.
        class: "nav-item tree-file" + (f.isTest ? " is-test" : ""), role: "treeitem", "data-idx": String(file.idx),
        title: f.isTest ? `${f.path} (${T.testFile})` : f.path,
        style: `padding-left:${8 + depth * TREE_INDENT + 14}px`, onclick: () => navigate(file.idx),
      }, [
        el("span", { class: "chip " + f.status, text: f.status[0].toUpperCase() }),
        el("span", { class: "label", text: file.name }),
        countBadge,
        el("span", { class: "nstat" }, [
          el("span", { class: "add", text: "+" + (f.insertions || 0) }),
          document.createTextNode(" "),
          el("span", { class: "del", text: "−" + (f.deletions || 0) }),
        ]),
      ]);
      parent.appendChild(row);
      files[file.idx] = { row, countBadge, folders: ancestors };
    }

    function addChildren(dir, parent, depth, ancestors) {
      [...dir.dirs.values()].sort(byName).forEach((d) => addDir(d, parent, depth, ancestors));
      [...dir.files].sort(byName).forEach((f) => addFile(f, parent, depth, ancestors));
    }
    addChildren(treeModel(), root, 0, []);

    // A folder is hidden when the search filter hid every file inside it.
    function refreshFolders() {
      for (const wrap of folders) {
        wrap.hidden = !wrap.querySelector(".tree-file:not([hidden])");
      }
    }

    // The row that stands for a file on screen: the file itself, or the outermost
    // collapsed folder that hides it (unless searching, which opens every folder).
    function visibleRowFor(idx) {
      const entry = files[idx];
      if (!root.classList.contains("searching")) {
        const closed = entry.folders.find((w) => w.classList.contains("collapsed"));
        if (closed) return closed._row;
      }
      return entry.row;
    }

    // Scroll the sidebar (only the sidebar) so `row` sits in view below the
    // sticky search box. scrollIntoView is avoided: it also scrolls the content pane.
    function scrollToRow(row) {
      if (row.hidden || !row.offsetParent) return;
      const box = sidebar.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      const head = sidebar.querySelector(".search-wrap");
      const top = box.top + (head ? head.offsetHeight : 0);
      if (r.top >= top && r.bottom <= box.bottom) return;
      const visibleMiddle = top + (box.bottom - top) / 2;
      sidebar.scrollBy({ top: r.top + r.height / 2 - visibleMiddle, behavior: "smooth" });
    }

    // The file a reference points at, lit up in the tree: its row, and the
    // folders on its path, so its place in the structure is visible at a glance.
    function highlight(idx, on) {
      const entry = files[idx];
      if (!entry) return;
      entry.row.classList.toggle("tree-hl", on);
      entry.folders.forEach((w) => w._row.classList.toggle("tree-hl-path", on));
      if (on) scrollToRow(visibleRowFor(idx));
    }

    // The file on screen: open the folders that hide it and bring it into view.
    function reveal(idx, expand) {
      const entry = files[idx];
      if (!entry) return;
      if (expand) {
        entry.folders.forEach((w) => {
          w.classList.remove("collapsed");
          w._row.setAttribute("aria-expanded", "true");
        });
      }
      scrollToRow(visibleRowFor(idx));
    }

    return { root, files, refreshFolders, highlight, reveal };
  }

  // ---------- hover a reference → highlight its file in the tree ----------
  let hoveredFile = null;
  function setHoveredFile(idx) {
    if (idx === hoveredFile || !fileTree) return;
    if (hoveredFile != null) fileTree.highlight(hoveredFile, false);
    hoveredFile = idx;
    if (idx != null) fileTree.highlight(idx, true);
  }
  function fileRefAt(node) {
    const ref = node && node.closest ? node.closest("[data-file-ref]") : null;
    return ref ? Number(ref.getAttribute("data-file-ref")) : null;
  }
  // One delegated listener covers every reference, including the ones rendered
  // later (a re-render, the modal, diagram nodes drawn asynchronously).
  function wireFileRefHover() {
    document.addEventListener("mouseover", (e) => setHoveredFile(fileRefAt(e.target)));
    document.addEventListener("mouseout", (e) => { if (!e.relatedTarget) setHoveredFile(null); });
    document.addEventListener("focusin", (e) => setHoveredFile(fileRefAt(e.target)));
    document.addEventListener("focusout", (e) => { if (!e.relatedTarget) setHoveredFile(null); });
  }

  // ---------- topbar controls ----------
  // ---------- sidebar frame: hide/show and resize ----------
  // Both are reader conveniences, remembered per browser. Storage can be missing
  // or throw (private window, blocked site data, file:// in some browsers), so
  // every access is guarded and the defaults always render.
  const SIDEBAR_PREFS = "diff-recap:sidebar";
  const SIDEBAR_MIN = 200;
  const sidebarMax = () => Math.max(SIDEBAR_MIN, Math.round(window.innerWidth * 0.6));

  function readSidebarPrefs() {
    try { return JSON.parse(localStorage.getItem(SIDEBAR_PREFS)) || {}; } catch (_) { return {}; }
  }
  function writeSidebarPrefs(patch) {
    try { localStorage.setItem(SIDEBAR_PREFS, JSON.stringify(Object.assign(readSidebarPrefs(), patch))); } catch (_) { /* not remembered */ }
  }

  function wireSidebarFrame() {
    const app = document.querySelector(".app");
    const sidebar = document.getElementById("sidebar");
    const resizer = document.getElementById("rc-resizer");
    const toggleBtn = document.getElementById("rc-sidebar");
    const prefs = readSidebarPrefs();

    function setWidth(px, remember) {
      const w = Math.min(sidebarMax(), Math.max(SIDEBAR_MIN, Math.round(px)));
      sidebar.style.width = w + "px";
      resizer.setAttribute("aria-valuenow", String(w));
      if (remember) writeSidebarPrefs({ width: w });
    }
    function setHidden(hidden, remember) {
      app.classList.toggle("sidebar-hidden", hidden);
      toggleBtn.setAttribute("aria-expanded", String(!hidden));
      if (remember) writeSidebarPrefs({ hidden });
    }

    toggleBtn.title = T.toggleSidebar;
    toggleBtn.setAttribute("aria-label", T.toggleSidebar);
    toggleBtn.addEventListener("click", () => setHidden(!app.classList.contains("sidebar-hidden"), true));

    resizer.title = T.resizeSidebar;
    resizer.setAttribute("aria-label", T.resizeSidebar);
    resizer.setAttribute("aria-valuemin", String(SIDEBAR_MIN));
    resizer.setAttribute("aria-valuemax", String(sidebarMax()));
    if (Number.isFinite(prefs.width)) setWidth(prefs.width, false);
    else resizer.setAttribute("aria-valuenow", String(sidebar.offsetWidth));
    setHidden(prefs.hidden === true, false);

    // Drag the handle: the new width is the pointer's distance from the sidebar's left edge.
    resizer.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      resizer.setPointerCapture(e.pointerId);
      app.classList.add("resizing");
      const left = sidebar.getBoundingClientRect().left;
      const move = (ev) => setWidth(ev.clientX - left, false);
      const end = () => {
        resizer.removeEventListener("pointermove", move);
        resizer.removeEventListener("pointerup", end);
        resizer.removeEventListener("pointercancel", end);
        app.classList.remove("resizing");
        writeSidebarPrefs({ width: sidebar.offsetWidth });
      };
      resizer.addEventListener("pointermove", move);
      resizer.addEventListener("pointerup", end);
      resizer.addEventListener("pointercancel", end);
    });
    // Back to the stylesheet's default width.
    resizer.addEventListener("dblclick", () => {
      sidebar.style.width = "";
      resizer.setAttribute("aria-valuenow", String(sidebar.offsetWidth));
      writeSidebarPrefs({ width: null });
    });
    // Keyboard: arrows move it 16px (64px with Shift).
    resizer.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const step = (e.shiftKey ? 64 : 16) * (e.key === "ArrowLeft" ? -1 : 1);
      setWidth(sidebar.offsetWidth + step, true);
    });
    // A remembered width can exceed the cap on a narrower window.
    window.addEventListener("resize", () => {
      resizer.setAttribute("aria-valuemax", String(sidebarMax()));
      if (sidebar.offsetWidth > sidebarMax()) setWidth(sidebarMax(), false);
    });
  }

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
    // Redraw the diagrams in the new theme without losing the reader's place.
    if (current === -1) renderOverview(content().scrollTop);
  }

  // ---------- boot ----------
  document.addEventListener("DOMContentLoaded", () => {
    if (window.mermaid) {
      const dark = document.documentElement.getAttribute("data-theme") !== "light";
      window.mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "default", securityLevel: "loose" });
    }
    buildTopbar();
    buildSidebar();
    wireFileRefHover();
    wireSidebarFrame();
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && document.getElementById("rc-modal")) closeModal();
    });
    if (!DATA.files.length) {
      show(el("div", { class: "empty", text: T.noChanges }));
      return;
    }
    // Back/Forward and a hash typed into the address bar both land in route().
    window.addEventListener("popstate", route);
    window.addEventListener("hashchange", route);
    // Honors a deep link like #file/2 on load; otherwise shows the overview.
    route();
  });
})();
