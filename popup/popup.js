const STORAGE_KEY = Kapsul.STORAGE_KEY;

// ── AI source label config ─────────────────────────────────────────────────────
const AI_META = {
  claude:   { label: "Claude",   cls: "claude" },
  gemini:   { label: "Gemini",   cls: "gemini" },
  chatgpt:  { label: "ChatGPT",  cls: "chatgpt" },
  deepseek: { label: "DeepSeek", cls: "deepseek" },
};

// ── state ──────────────────────────────────────────────────────────────────────
let _all = [];              // everything in storage
let _activeKey = null;      // "<source>|<normalized url>" of the chat open in the current tab
let _filter = "all";        // AI filter chip
let _query = "";            // search text
const _open = new Set();    // ids of expanded cards (survive re-render)
let _clearArmed = null;     // timer for "click again to confirm"
const EL = {};              // cached DOM nodes (the empty-state node is detached on every render)

document.addEventListener("DOMContentLoaded", init);

function init() {
  EL.list = document.getElementById("conversations-list");
  EL.empty = document.getElementById("empty-state");
  EL.emptyTitle = document.getElementById("empty-title");
  EL.count = document.getElementById("conv-count");
  bindUI();

  // Ask the open AI tab to save right now, then render what is really stored.
  chrome.runtime.sendMessage({ action: "scrapeActiveTab" }, (res) => {
    if (chrome.runtime.lastError) { /* not a supported page */ }
    const err = res && res.ok === false && res.error || "";
    if (/Receiving end|Could not establish/i.test(err)) {
      showToast("Refresh this tab once (F5) so Kapsul can start saving", 4000);
    }
    refresh();
  });

  // Live update while popup is open (e.g. chat keeps streaming in the tab)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY]) refresh();
  });
}

function bindUI() {
  document.getElementById("export-btn").addEventListener("click", () => exportAll("json"));
  document.getElementById("export-md-btn").addEventListener("click", () => exportAll("md"));
  document.getElementById("clear-all-btn").addEventListener("click", clearAllHandler);

  const searchInput = document.getElementById("search-input");
  const clearSearch = document.getElementById("clear-search");

  searchInput.addEventListener("input", () => {
    _query = searchInput.value.trim();
    clearSearch.classList.toggle("visible", _query.length > 0);
    render();
  });

  clearSearch.addEventListener("click", () => {
    searchInput.value = "";
    _query = "";
    clearSearch.classList.remove("visible");
    render();
  });
}

// ── Load ───────────────────────────────────────────────────────────────────────
function refresh() {
  chrome.storage.local.get([STORAGE_KEY], (res) => {
    _all = res[STORAGE_KEY] || [];
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs && tabs[0] && tabs[0].url;
      const src = url && Kapsul.sourceFromUrl(url);
      _activeKey = src && Kapsul.isConvUrl(url) ? src + "|" + Kapsul.normalizeUrl(url) : null;
      render();
    });
  });
}

function srcOf(c) { return c.source || Kapsul.sourceFromUrl(c.url) || "unknown"; }
function keyOf(c) { return srcOf(c) + "|" + Kapsul.normalizeUrl(c.url); }

// ── Render ─────────────────────────────────────────────────────────────────────
function render() {
  renderChips();

  const q = _query.toLowerCase();
  let list = _all.filter((c) => _filter === "all" || srcOf(c) === _filter);
  if (q) {
    list = list.filter((c) =>
      (c.title || "").toLowerCase().includes(q) ||
      (c.project || "").toLowerCase().includes(q) ||
      (c.messages || []).some((m) => (m.content || "").toLowerCase().includes(q)));
  }

  list = list.slice().sort((a, b) => {
    const ac = keyOf(a) === _activeKey, bc = keyOf(b) === _activeKey;
    if (ac !== bc) return ac ? -1 : 1;
    return new Date(b.savedAt) - new Date(a.savedAt);
  });

  const box = EL.list;
  const empty = EL.empty;
  const scroll = box.scrollTop;
  box.replaceChildren();

  EL.count.textContent = `${list.length} conversation${list.length !== 1 ? "s" : ""}`;

  if (!list.length) {
    EL.emptyTitle.textContent =
      (q || _filter !== "all") ? "No matching conversations" : "No conversations yet";
    box.appendChild(empty);
    empty.style.display = "flex";
    return;
  }
  empty.style.display = "none";

  list.forEach((conv) => box.appendChild(createCard(conv, q)));
  box.scrollTop = scroll;
}

function renderChips() {
  const wrap = document.getElementById("filter-chips");
  const counts = { all: _all.length };
  for (const c of _all) counts[srcOf(c)] = (counts[srcOf(c)] || 0) + 1;

  const items = [["all", "All"], ...Object.keys(AI_META).map((k) => [k, AI_META[k].label])];
  wrap.innerHTML = "";
  for (const [id, label] of items) {
    if (id !== "all" && !counts[id] && _filter !== id) continue;
    const b = document.createElement("button");
    b.className = "chip" + (_filter === id ? " active" : "");
    b.textContent = `${label} ${counts[id] || 0}`;
    b.addEventListener("click", () => { _filter = id; render(); });
    wrap.appendChild(b);
  }
}

// ── Card ───────────────────────────────────────────────────────────────────────
function iconBtn(title, svg, onclick, extraCls = "") {
  const b = document.createElement("button");
  b.className = "btn-icon-only " + extraCls;
  b.title = title;
  b.innerHTML = svg;
  b.addEventListener("click", (e) => { e.stopPropagation(); onclick(b); });
  return b;
}

const SVG = {
  copy: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  download: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></svg>`,
  sync: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`,
  trash: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`,
};

function createCard(conv, q) {
  const card = document.createElement("div");
  const isActive = keyOf(conv) === _activeKey;
  card.className = "conv-card" + (isActive ? " is-active" : "");

  const src = srcOf(conv);
  const aiMeta = AI_META[src] || { label: src.charAt(0).toUpperCase() + src.slice(1), cls: "unknown" };
  const msgs = conv.messages || [];

  /* ── header ── */
  const header = document.createElement("div");
  header.className = "conv-header";

  const meta = document.createElement("div");
  meta.className = "conv-meta";

  const topRow = document.createElement("div");
  topRow.className = "conv-top-row";

  if (isActive) {
    const dot = document.createElement("span");
    dot.className = "live-dot";
    dot.title = "Open in this tab";
    topRow.appendChild(dot);
  }

  const titleEl = document.createElement("div");
  titleEl.className = "conv-title";
  titleEl.textContent = conv.title || "Untitled";
  titleEl.title = conv.title || "Untitled";

  const badge = document.createElement("span");
  badge.className = `ai-badge ${aiMeta.cls}`;
  badge.textContent = aiMeta.label;

  topRow.appendChild(titleEl);
  topRow.appendChild(badge);

  const sub = document.createElement("div");
  sub.className = "conv-date";
  sub.textContent = formatDate(conv.savedAt);
  if (conv.project) {
    const p = document.createElement("span");
    p.className = "project-chip";
    p.textContent = conv.project;
    p.title = "Project";
    sub.appendChild(p);
  }

  meta.appendChild(topRow);
  meta.appendChild(sub);

  /* ── actions ── */
  const actions = document.createElement("div");
  actions.className = "card-actions";

  actions.appendChild(iconBtn("Copy chat (both sides) to clipboard", SVG.copy, () => {
    navigator.clipboard.writeText(Kapsul.toPlainText(conv)).then(
      () => showToast("Copied conversation"),
      () => showToast("Copy failed"));
  }));
  actions.appendChild(iconBtn("Download as JSON", SVG.download, () => {
    Kapsul.download(`${Kapsul.safeName(conv.title)}.json`, JSON.stringify(conv, null, 2), "application/json");
  }));
  const md = iconBtn("Download as Markdown", "MD", () => {
    Kapsul.download(`${Kapsul.safeName(conv.title)}.md`, Kapsul.toMarkdown(conv), "text/markdown");
  }, "btn-text");
  actions.appendChild(md);
  actions.appendChild(iconBtn("Sync to Local", SVG.sync, (b) => syncToLocalServer(conv, b)));
  actions.appendChild(iconBtn("Delete", SVG.trash, () => deleteConversation(conv, card), "delete-btn"));

  header.appendChild(meta);
  header.appendChild(actions);
  card.appendChild(header);

  /* ── search snippet ── */
  if (q) {
    const hit = msgs.find((m) => (m.content || "").toLowerCase().includes(q));
    if (hit) {
      const i = hit.content.toLowerCase().indexOf(q);
      const snip = document.createElement("div");
      snip.className = "snippet";
      snip.textContent = (i > 30 ? "…" : "") + hit.content.slice(Math.max(0, i - 30), i + 70).replace(/\s+/g, " ");
      card.appendChild(snip);
    }
  }

  /* ── attached knowledge ── */
  if (conv.attached_knowledge && conv.attached_knowledge.length) {
    const box = document.createElement("div");
    box.className = "attached-knowledge-container";
    conv.attached_knowledge.forEach((doc) => {
      const cap = document.createElement("div");
      cap.className = "attachment-capsule";
      cap.title = "Local Document Context";
      cap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg><span class="attachment-name"></span>`;
      cap.querySelector(".attachment-name").textContent = doc.name;
      box.appendChild(cap);
    });
    card.appendChild(box);
  }

  /* ── toggle + messages (built lazily) ── */
  const userN = msgs.filter((m) => m.type === "user").length;
  const aiN = msgs.length - userN;
  const toggle = document.createElement("button");
  toggle.className = "conv-toggle";
  toggle.innerHTML = `<span class="arrow">▶</span> <span></span>`;
  toggle.lastElementChild.textContent =
    `${msgs.length} message${msgs.length !== 1 ? "s" : ""}  ·  ${userN} you  ·  ${aiN} ${aiMeta.label}`;

  const panel = document.createElement("div");
  panel.className = "messages-panel";

  const fill = () => {
    if (panel.childElementCount) return;
    msgs.forEach((msg) => {
      const bubble = document.createElement("div");
      bubble.className = `msg-bubble ${msg.type === "user" ? "user" : "assistant"}`;
      const label = document.createElement("div");
      label.className = "msg-label";
      label.textContent = msg.type === "user" ? "You" : aiMeta.label;
      const body = document.createElement("div");
      body.className = "msg-body";
      body.textContent = msg.content;
      bubble.appendChild(label);
      bubble.appendChild(body);
      panel.appendChild(bubble);
    });
  };

  const setOpen = (on) => {
    if (on) { fill(); _open.add(conv.id); } else { _open.delete(conv.id); }
    panel.classList.toggle("open", on);
    toggle.classList.toggle("open", on);
  };
  toggle.addEventListener("click", () => setOpen(!panel.classList.contains("open")));
  if (_open.has(conv.id)) setOpen(true);

  card.appendChild(toggle);
  card.appendChild(panel);
  return card;
}

/* =========================
   DELETE / CLEAR
========================= */

function deleteConversation(conv, cardEl) {
  chrome.runtime.sendMessage({ action: "kapsul:delete", id: conv.id }, () => {
    cardEl.style.transition = "opacity 0.15s, transform 0.15s";
    cardEl.style.opacity = "0";
    cardEl.style.transform = "translateX(6px)";
    _open.delete(conv.id);
    setTimeout(refresh, 150);
    showToast("Conversation deleted");
  });
}

// two-step: first click arms, second click (within 3s) deletes
function clearAllHandler() {
  const btn = document.getElementById("clear-all-btn");
  const label = document.getElementById("clear-label");

  if (!_all.length) { showToast("Nothing to clear"); return; }

  if (!_clearArmed) {
    label.textContent = `Delete ${_all.length}? Click again`;
    btn.classList.add("armed");
    _clearArmed = setTimeout(disarmClear, 3000);
    return;
  }
  disarmClear();
  chrome.runtime.sendMessage({ action: "kapsul:clear" }, () => {
    _open.clear();
    refresh();
    showToast("Cleared all conversations");
  });
}

function disarmClear() {
  clearTimeout(_clearArmed);
  _clearArmed = null;
  document.getElementById("clear-label").textContent = "Clear all";
  document.getElementById("clear-all-btn").classList.remove("armed");
}

/* =========================
   SYNC TO LOCAL SERVER
========================= */

async function syncToLocalServer(chatData, btnEl) {
  const originalHTML = btnEl.innerHTML;

  try {
    const response = await fetch("http://localhost:8345/save-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chatData)
    });
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    btnEl.style.width = "auto";
    btnEl.style.padding = "0 8px";
    btnEl.style.fontSize = "12px";
    btnEl.innerHTML = "Synced ✅";
  } catch (error) {
    console.error("Sync error:", error);
    btnEl.style.width = "auto";
    btnEl.style.padding = "0 8px";
    btnEl.style.fontSize = "12px";
    btnEl.innerHTML = "Server Offline ❌";
  }

  setTimeout(() => {
    btnEl.innerHTML = originalHTML;
    btnEl.style.width = "";
    btnEl.style.padding = "";
    btnEl.style.fontSize = "";
  }, 2000);
}

/* =========================
   EXPORT ALL
========================= */

function exportAll(format) {
  // export what is in storage, respecting the AI filter chip
  chrome.storage.local.get([STORAGE_KEY], (res) => {
    const all = (res[STORAGE_KEY] || []).filter((c) => _filter === "all" || srcOf(c) === _filter);
    if (!all.length) { showToast("Nothing to export"); return; }
    const stamp = new Date().toISOString().slice(0, 10);
    const tag = _filter === "all" ? "all" : _filter;
    if (format === "md") {
      const text = all.map((c) => Kapsul.toMarkdown(c)).join("\n\n---\n\n");
      Kapsul.download(`kapsul_${tag}_${stamp}.md`, text, "text/markdown");
    } else {
      Kapsul.download(`kapsul_${tag}_${stamp}.json`,
        JSON.stringify({ exportedAt: new Date().toISOString(), count: all.length, conversations: all }, null, 2),
        "application/json");
    }
    showToast(`Exported ${all.length} chat${all.length !== 1 ? "s" : ""}`);
  });
}

/* =========================
   UTILS
========================= */

function showToast(msg, duration = 2000) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), duration);
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}
