// lib/kapsul-core.js
// Shared logic for Kapsul: per-chat keys, safe merge, auto-save, export helpers.
// Loaded in: background (importScripts), every content script, and the popup.

(function () {
  if (globalThis.Kapsul) return;

  const STORAGE_KEY = "claude_conversations";
  const TOMB_KEY = "kapsul_tombstones";
  const MAX_CONVERSATIONS = 2000;

  const LABELS = { claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini", deepseek: "DeepSeek" };
  const HOSTS = {
    "claude.ai": "claude",
    "chatgpt.com": "chatgpt",
    "gemini.google.com": "gemini",
    "chat.deepseek.com": "deepseek",
  };

  // ── URL helpers ─────────────────────────────────────────────────────────────
  // One chat == one normalized URL (no query, no hash, no trailing slash).
  function normalizeUrl(url) {
    try {
      const u = new URL(url);
      return u.origin + u.pathname.replace(/\/+$/, "");
    } catch {
      return String(url || "");
    }
  }

  function sourceFromUrl(url) {
    try {
      const h = new URL(url).hostname.replace(/^www\./, "");
      return HOSTS[h] || null;
    } catch {
      return null;
    }
  }

  // A real chat URL ends with an id (uuid / hex / long token containing a digit).
  const NON_CONV = /\/(project|projects|settings|library|recents|artifacts|customize|gpts|explore|new)(\/|$)/i;
  function isConvUrl(url) {
    try {
      const u = new URL(url);
      const path = u.pathname.replace(/\/+$/, "");
      const last = path.split("/").pop() || "";
      if (/\/g\/g-p-[^/]+\/project$/i.test(path)) return false;
      if (NON_CONV.test(path) && !/\/(chat|c)\/[\w-]{8,}$/i.test(path)) return false;
      return /^[\w-]{8,}$/.test(last) && /\d/.test(last);
    } catch {
      return false;
    }
  }

  function convId(source, url) {
    return `${source}_${normalizeUrl(url)}`;
  }

  // ── Message signature / merge ───────────────────────────────────────────────
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function msgSig(m) {
    return (m.type || "x") + ":" + hash(String(m.content || "").replace(/\s+/g, " ").trim());
  }

  function listSig(messages) {
    if (!messages || !messages.length) return "";
    return messages.length + "|" + msgSig(messages[0]) + "|" + msgSig(messages[messages.length - 1]);
  }

  // Merge so a partial / lazy-loaded scrape never wipes a fuller saved chat.
  function mergeMessages(oldM, newM) {
    oldM = oldM || [];
    newM = newM || [];
    if (!newM.length) return oldM;
    if (!oldM.length) return newM;

    const oldS = oldM.map(msgSig);
    const newS = newM.map(msgSig);

    // 1) new scrape starts somewhere inside old (lazy-loaded suffix, or normal growth)
    let bestI = -1, bestRun = 0;
    for (let i = 0; i < oldS.length; i++) {
      if (oldS[i] !== newS[0]) continue;
      let run = 0;
      while (i + run < oldS.length && run < newS.length && oldS[i + run] === newS[run]) run++;
      if (run > bestRun || (run === bestRun && run > 0)) { bestRun = run; bestI = i; }
    }
    if (bestI >= 0) {
      const merged = oldM.slice(0, bestI).concat(newM);
      return merged;
    }

    // 2) old starts somewhere inside new (new scrape loaded older messages too)
    const j = newS.indexOf(oldS[0]);
    if (j >= 0) return newM;

    // 3) no overlap: chat was edited/regenerated. Trust new only if not smaller.
    return newM.length >= oldM.length ? newM : oldM;
  }

  function mergeKnowledge(a, b) {
    const map = new Map();
    for (const d of a || []) map.set(d.name, d);
    for (const d of b || []) map.set(d.name, d);
    return [...map.values()];
  }

  function mergeConversation(existing, incoming) {
    if (!existing) return incoming;
    return {
      ...existing,
      ...incoming,
      id: existing.id,
      messages: mergeMessages(existing.messages, incoming.messages),
      attached_knowledge: mergeKnowledge(existing.attached_knowledge, incoming.attached_knowledge),
      project: incoming.project || existing.project || "",
      title: incoming.title || existing.title,
      firstSavedAt: existing.firstSavedAt || existing.savedAt || incoming.savedAt,
    };
  }

  // ── Title / project ─────────────────────────────────────────────────────────
  const GENERIC_TITLE = /^(claude|chatgpt|gemini|google gemini|deepseek.*|new chat|untitled|new conversation|conversation with gemini)$/i;

  function pageTitle() {
    try {
      let t = (document.title || "").trim();
      t = t.replace(/\s*[-–—|·]\s*(Claude|ChatGPT|Google Gemini|Gemini|DeepSeek)\s*$/i, "").trim();
      t = t.replace(/^[•●\u2022]\s*/, "");
      if (!t || GENERIC_TITLE.test(t)) return "";
      return t.slice(0, 120);
    } catch { return ""; }
  }

  function inferTitle(messages, fallback) {
    const first = (messages || []).find((m) => m.type === "user" && m.content);
    if (first) {
      const s = first.content.replace(/\s+/g, " ").trim();
      return s.slice(0, 60) + (s.length > 60 ? "…" : "");
    }
    return fallback || "Untitled conversation";
  }

  // Best effort. Selectors can change when the sites update their UI.
  function detectProject(source) {
    try {
      if (source === "claude") {
        const a = document.querySelector('header a[href^="/project/"], main a[href^="/project/"]');
        const t = a && (a.innerText || "").trim();
        if (t && t.length <= 80) return t;
      }
      if (source === "chatgpt") {
        const m = location.pathname.match(/\/g\/g-p-[a-z0-9]+-?([\w-]*)\//i);
        if (m && m[1]) return m[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      }
    } catch { /* ignore */ }
    return "";
  }

  // ── DOM → text (keeps lists, code, tables, headings) ────────────────────────
  const SKIP = new Set(["BUTTON", "SVG", "STYLE", "SCRIPT", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT"]);

  function elementToText(root) {
    if (!root) return "";
    try {
      const out = walk(root, { depth: 0 });
      const text = out.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      if (text) return text;
    } catch (e) { /* fall through to plain text */ }
    return (root.innerText || root.textContent || "").trim();
  }

  function inlineText(node, ctx) {
    let s = "";
    for (const c of node.childNodes) s += walk(c, ctx);
    return s;
  }

  function walk(node, ctx) {
    if (node.nodeType === 3) return node.nodeValue.replace(/\s+/g, " ");
    if (node.nodeType !== 1) return "";
    const tag = node.tagName.toUpperCase();
    if (SKIP.has(tag)) return "";
    if (node.classList && node.classList.contains("katex")) {
      const ann = node.querySelector('annotation[encoding="application/x-tex"]');
      return ann ? "$" + ann.textContent + "$" : node.textContent;
    }

    switch (tag) {
      case "BR": return "\n";
      case "HR": return "\n\n---\n\n";
      case "PRE": return codeBlock(node, "");
      case "CODE": return "`" + node.textContent + "`";
      case "STRONG": case "B": { const t = inlineText(node, ctx); return t.trim() ? "**" + t.trim() + "**" : t; }
      case "EM": case "I": { const t = inlineText(node, ctx); return t.trim() ? "*" + t.trim() + "*" : t; }
      case "A": {
        const t = inlineText(node, ctx).trim();
        const href = node.getAttribute("href");
        return t && href && /^https?:/.test(href) && t !== href ? `[${t}](${href})` : t;
      }
      case "H1": case "H2": case "H3": case "H4": case "H5": case "H6":
        return "\n\n" + "#".repeat(+tag[1]) + " " + inlineText(node, ctx).trim() + "\n\n";
      case "BLOCKQUOTE":
        return "\n\n" + inlineText(node, ctx).trim().split("\n").map((l) => "> " + l).join("\n") + "\n\n";
      case "UL": case "OL": {
        const items = [];
        let n = 0;
        for (const li of node.children) {
          if (li.tagName !== "LI") continue;
          n++;
          const bullet = tag === "OL" ? n + ". " : "- ";
          const body = walkLi(li, { depth: ctx.depth + 1 }).trim().split("\n");
          items.push(bullet + body[0] + body.slice(1).map((l) => "\n  " + l).join(""));
        }
        return "\n" + items.join("\n") + "\n";
      }
      case "TABLE": {
        const rows = [...node.querySelectorAll("tr")].map((tr) =>
          "| " + [...tr.children].map((c) => inlineText(c, ctx).replace(/\s+/g, " ").replace(/\|/g, "\\|").trim()).join(" | ") + " |");
        if (rows.length > 1) {
          const cols = (rows[0].match(/\|/g).length - 1);
          rows.splice(1, 0, "|" + " --- |".repeat(cols));
        }
        return "\n\n" + rows.join("\n") + "\n\n";
      }
      case "P": return "\n\n" + inlineText(node, ctx).trim() + "\n\n";
      case "DIV": case "SECTION": case "ARTICLE": case "FIGURE": case "DETAILS": case "SUMMARY": {
        const wrapped = tag === "DIV" ? codeWrapper(node) : null;
        if (wrapped) return wrapped;
        const t = inlineText(node, ctx);
        return /\n/.test(t) || node.children.length ? "\n" + t.trim() + "\n" : t;
      }
      default:
        return inlineText(node, ctx);
    }
  }

  function codeBlock(pre, labelHint) {
    const code = pre.querySelector("code") || pre;
    let lang = "";
    const m = ((code.className || "") + " " + (pre.className || "")).match(/language-([\w+#-]+)/);
    if (m) lang = m[1];
    if (!lang && labelHint && labelHint.length < 20 && !/\s/.test(labelHint)) lang = labelHint;
    return "\n\n```" + lang + "\n" + code.textContent.replace(/\n+$/, "") + "\n```\n\n";
  }

  // <div>[label][copy button]<pre>…</pre></div>  → one fenced block, label = language
  function codeWrapper(node) {
    const pres = node.querySelectorAll("pre");
    if (pres.length !== 1) return null;
    const pre = pres[0];
    if (node.textContent.length - pre.textContent.length > 40) return null;
    let label = "";
    const tw = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (tw.nextNode()) {
      const t = tw.currentNode;
      if (pre.contains(t) || t.parentElement.closest("button")) continue;
      const v = t.nodeValue.trim();
      if (v) { label = v; break; }
    }
    return codeBlock(pre, label);
  }

  function walkLi(li, ctx) {
    let s = "";
    for (const c of li.childNodes) {
      if (c.nodeType === 1 && (c.tagName === "UL" || c.tagName === "OL")) s += walk(c, ctx);
      else s += walk(c, ctx);
    }
    return s.replace(/^\n+/, "").replace(/\n{2,}/g, "\n");
  }

  // ── Export formats ──────────────────────────────────────────────────────────
  function sourceLabel(conv) {
    return LABELS[conv.source || sourceFromUrl(conv.url)] || "AI";
  }

  function toPlainText(conv) {
    const ai = sourceLabel(conv);
    const lines = [`[${ai} conversation: "${conv.title || "Untitled"}"]`];
    if (conv.project) lines.push(`[Project: ${conv.project}]`);
    if (conv.url) lines.push(`[URL: ${conv.url}]`);
    lines.push(`[Exported: ${new Date().toLocaleString()}]`, "");
    if (conv.attached_knowledge && conv.attached_knowledge.length) {
      lines.push("--- Attached Documents ---");
      for (const d of conv.attached_knowledge) lines.push(`Document (${d.name}):`, "", d.content, "");
      lines.push("--- End of Attached Documents ---", "");
    }
    for (const m of conv.messages || []) {
      lines.push(`${m.type === "user" ? "User" : ai}: ${m.content}`, "");
    }
    return lines.join("\n");
  }

  function toMarkdown(conv) {
    const ai = sourceLabel(conv);
    const lines = [`# ${conv.title || "Untitled"}`, ""];
    lines.push(`- **AI:** ${ai}`);
    if (conv.project) lines.push(`- **Project:** ${conv.project}`);
    if (conv.url) lines.push(`- **URL:** ${conv.url}`);
    lines.push(`- **Saved:** ${new Date(conv.savedAt || Date.now()).toLocaleString()}`, `- **Messages:** ${(conv.messages || []).length}`, "");
    for (const d of conv.attached_knowledge || []) lines.push(`<details><summary>Attached: ${d.name}</summary>\n\n${d.content}\n\n</details>`, "");
    for (const m of conv.messages || []) {
      lines.push(`## ${m.type === "user" ? "You" : ai}`, "", m.content, "");
    }
    return lines.join("\n");
  }

  function safeName(s) {
    return String(s || "conversation").replace(/[^\w\d]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50) || "conversation";
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── Background messaging (all writes go through the service worker queue) ───
  function sendBg(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) { resolve({ ok: false, error: chrome.runtime.lastError.message }); return; }
          resolve(res || { ok: false });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e && e.message || e), dead: true });
      }
    });
  }

  // ── Auto-save engine (content scripts) ──────────────────────────────────────
  // opts: { source, scrape(), getAttached(), setAttached(arr), onNavigate() }
  function startAutoSave(opts) {
    if (globalThis.__kapsulAuto) return globalThis.__kapsulAuto;

    const st = {
      key: normalizeUrl(location.href),
      timer: null,
      firstScheduled: 0,
      lastDomSig: "",
      staleSig: "",
      staleTries: 0,
      saving: null,
      dead: false,
    };

    function stop() {
      st.dead = true;
      clearInterval(st.poll);
      try { st.obs.disconnect(); } catch { /* ignore */ }
    }

    function schedule(delay) {
      if (st.dead) return;
      const now = Date.now();
      if (!st.timer) st.firstScheduled = now;
      clearTimeout(st.timer);
      // never starve: during long streaming, force a save at least every ~5s
      const wait = now - st.firstScheduled > 5000 ? 0 : (delay == null ? 1200 : delay);
      st.timer = setTimeout(() => { st.timer = null; save(); }, wait);
    }

    async function save() {
      if (st.dead) return { ok: false, reason: "stopped" };
      const href = location.href;
      const key = normalizeUrl(href);
      if (!isConvUrl(href)) return { ok: false, reason: "not a chat page" };

      const messages = opts.scrape() || [];
      const sig = listSig(messages);
      const attached = opts.getAttached ? opts.getAttached() : [];
      if (!messages.length && !attached.length) return { ok: false, reason: "no messages" };

      // right after SPA navigation the DOM may still show the PREVIOUS chat: wait
      if (st.staleSig && sig === st.staleSig && st.staleTries < 14) {
        st.staleTries++;
        schedule(700);
        return { ok: false, reason: "waiting for chat to load" };
      }
      st.staleSig = "";
      st.lastDomSig = sig;

      const entry = {
        id: convId(opts.source, href),
        source: opts.source,
        url: href,
        title: pageTitle() || inferTitle(messages),
        project: detectProject(opts.source),
        messages,
        attached_knowledge: attached,
        savedAt: new Date().toISOString(),
        version: 2,
      };

      if (normalizeUrl(location.href) !== key) return { ok: false, reason: "navigated" };
      const res = await sendBg({ action: "kapsul:upsert", conv: entry });
      if (res && res.dead) stop();
      return res;
    }

    async function restoreAttached() {
      const res = await sendBg({ action: "kapsul:get", id: convId(opts.source, location.href) });
      if (res && res.conv && opts.setAttached) {
        const local = opts.getAttached ? opts.getAttached() : [];
        opts.setAttached(mergeKnowledge(res.conv.attached_knowledge, local));
      }
    }

    function onUrlChange() {
      const prevKey = st.key;
      const wasConv = isConvUrl(prevKey);
      st.key = normalizeUrl(location.href);
      clearTimeout(st.timer);
      st.timer = null;
      st.staleSig = st.lastDomSig; // what the old chat looked like
      st.staleTries = 0;
      // moving between chats (or to home): never carry docs over.
      // Exception: home page -> its brand-new chat URL keeps docs attached on the home page.
      if (!(!wasConv && isConvUrl(location.href))) {
        if (opts.setAttached) opts.setAttached([]);
      }
      if (isConvUrl(location.href)) restoreAttached();
      if (opts.onNavigate) { try { opts.onNavigate(); } catch { /* ignore */ } }
      schedule(1000);
    }

    st.obs = new MutationObserver((muts) => {
      if (st.dead) return;
      if (muts.some((m) => m.addedNodes.length || m.type === "characterData")) schedule();
    });
    st.obs.observe(document.body, { childList: true, subtree: true, characterData: true });

    st.poll = setInterval(() => {
      if (st.dead) return;
      if (normalizeUrl(location.href) !== st.key) onUrlChange();
    }, 600);

    const flushNow = () => { clearTimeout(st.timer); st.timer = null; return save(); };
    window.addEventListener("pagehide", flushNow);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushNow(); });

    // initial
    restoreAttached().finally(() => schedule(800));
    st.lastDomSig = listSig(opts.scrape() || []);

    const api = { schedule, flush: flushNow, stop };
    globalThis.__kapsulAuto = api;
    return api;
  }

  globalThis.Kapsul = {
    STORAGE_KEY, TOMB_KEY, MAX_CONVERSATIONS, LABELS, HOSTS,
    normalizeUrl, sourceFromUrl, isConvUrl, convId,
    msgSig, listSig, mergeMessages, mergeKnowledge, mergeConversation,
    pageTitle, inferTitle, detectProject,
    elementToText, toPlainText, toMarkdown, safeName, download,
    sendBg, startAutoSave,
  };
})();
