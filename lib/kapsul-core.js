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
    "chat.openai.com": "chatgpt",
    "gemini.google.com": "gemini",
    "chat.deepseek.com": "deepseek",
  };

  // ── URL helpers ─────────────────────────────────────────────────────────────
  // One chat == one normalized URL (no query, no hash, no trailing slash).
  function sourceFromUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === "https:" ? HOSTS[u.hostname.replace(/^www\./, "")] || null : null;
    } catch { return null; }
  }

  // Provider-specific routes; IDs are opaque, not necessarily numeric/UUIDs.
  function chatRoute(url) {
    try {
      const u = new URL(url);
      const source = sourceFromUrl(url);
      const path = u.pathname.replace(/\/+$/, "");
      const patterns = {
        claude: /^\/chat\/([\w-]+)$/,
        chatgpt: /^\/(?:g\/[^/]+\/)?c\/([\w-]+)$/,
        gemini: /^\/app\/([\w-]+)$/,
        deepseek: /^\/a\/chat\/s\/([\w-]+)$/,
      };
      const match = patterns[source]?.exec(path);
      if (!match) return null;
      const canonical = {claude: "https://claude.ai/chat/", chatgpt: "https://chatgpt.com/c/", gemini: "https://gemini.google.com/app/", deepseek: "https://chat.deepseek.com/a/chat/s/"};
      return canonical[source] + match[1];
    } catch { return null; }
  }

  function normalizeUrl(url) {
    const route = chatRoute(url);
    if (route) return route;
    try { const u = new URL(url); return u.origin + u.pathname.replace(/\/+$/, ""); }
    catch { return String(url || ""); }
  }

  function isConvUrl(url) { return !!chatRoute(url); }

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
    return hash(JSON.stringify(messages.map(m => [m.type, m.messageId || "", m.content])));
  }

  // Merge so a partial / lazy-loaded scrape never wipes a fuller saved chat.
  function mergeMessages(oldM = [], newM = []) {
    if (!newM.length) return oldM;
    if (!oldM.length) return newM;
    const same = (a,b) => a.type === b.type &&
      (a.messageId && b.messageId ? a.messageId === b.messageId : a.content === b.content);
    const compatible = (a,b) => same(a,b) || (a.type === "assistant" && b.type === "assistant" &&
      (!a.messageId || !b.messageId || a.messageId === b.messageId) &&
      (a.content.startsWith(b.content) || b.content.startsWith(a.content)));
    // Align by contiguous overlap, not global text deduplication (repeated prompts are valid).
    let best = null;
    const checked = new Set();
    for (let i=0; i<oldM.length; i++) for (let j=0; j<newM.length; j++) {
      if (!same(oldM[i],newM[j])) continue;
      const offset = i-j;
      if (checked.has(offset)) continue;
      checked.add(offset);
      const start = Math.max(0,offset), end = Math.min(oldM.length,offset+newM.length);
      let score = 0, matches = 0;
      for (let k=start;k<end;k++) {
        const a=oldM[k], b=newM[k-offset];
        if (!compatible(a,b)) continue;
        score += a.messageId && a.messageId === b.messageId ? 10 : same(a,b) ? 3 : 1;
        matches++;
      }
      if (!best || score>best.score || (score===best.score && matches>best.matches) ||
          (score===best.score && matches===best.matches && Math.abs(offset)<Math.abs(best.offset))) best={offset,score,matches};
    }
    if (!best) return newM.length >= oldM.length && newM[0].type === "user" ? newM : oldM;
    const {offset} = best;
    const out=[];
    for(let k=Math.min(0,offset); k<Math.max(oldM.length,offset+newM.length);k++) {
      const a=oldM[k], b=newM[k-offset];
      if (!a || !b) { out.push(a||b); continue; }
      // A shorter streaming/partially rendered reply must not erase saved text.
      out.push(a.type==="assistant" && b.type==="assistant" && a.content.startsWith(b.content) && a.content.length>b.content.length ? a : b);
    }
    return out;
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

  function elementToText(root, options = {}) {
    if (!root) return "";
    try {
      const code = [];
      const out = walk(root, { depth: 0, code, preserveWhitespace: !!options.preserveWhitespace });
      const text = out.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      return text.replace(/\uE000(\d+)\uE001/g, (_, i) => code[Number(i)] ?? "");
    } catch (e) { /* fall through to plain text */ }
    return ""; // never fall back to unfiltered UI text
  }

  function inlineText(node, ctx) {
    let s = "";
    for (const c of node.childNodes) s += walk(c, ctx);
    return s;
  }

  function walk(node, ctx) {
    if (node.nodeType === 3) {
      const value=node.nodeValue;
      if (ctx.preserveWhitespace && value.trim() && /[\r\n]/.test(value)) return "\uE000" + (ctx.code.push(value) - 1) + "\uE001";
      return value.replace(/\s+/g," ");
    }
    if (node.nodeType !== 1) return "";
    const tag = node.tagName.toUpperCase();
    if (SKIP.has(tag) || node.matches('[hidden], [aria-hidden="true"], [role="toolbar"], [role="button"], [role="navigation"], [contenteditable="true"], .sr-only, .visually-hidden, message-actions, [data-testid*="action"], [data-testid*="feedback"], [data-testid="copy-turn-action-button"], nav, footer, form')) return "";
    const css = getComputedStyle(node);
    if (css.display === "none" || css.visibility === "hidden") return "";
    if (node.classList && node.classList.contains("katex")) {
      const ann = node.querySelector('annotation[encoding="application/x-tex"]');
      return ann ? "$" + ann.textContent + "$" : node.textContent;
    }

    switch (tag) {
      case "BR": return "\n";
      case "HR": return "\n\n---\n\n";
      case "PRE": return "\n\n\uE000" + (ctx.code.push(codeBlock(node, "").trim()) - 1) + "\uE001\n\n";
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
          const body = walkLi(li, { ...ctx, depth: ctx.depth + 1 }).trim().split("\n");
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
    const longest = Math.max(2, ...[...code.textContent.matchAll(/`+/g)].map(m=>m[0].length));
    const fence="`".repeat(longest+1);
    return "\n\n" + fence + lang + "\n" + code.textContent + "\n" + fence + "\n\n";
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
    const st = {key: normalizeUrl(location.href), timer:null, firstScheduled:0,
      lastDomSig:"", staleSig:"", savedSig:"", dead:false, generation:0};
    let queue = Promise.resolve();
    function stop() { st.dead=true; clearInterval(st.poll); clearTimeout(st.timer); st.obs.disconnect(); }
    function schedule(delay=700) {
      if (st.dead) return;
      const now=Date.now();
      if (!st.timer) st.firstScheduled=now;
      clearTimeout(st.timer);
      st.timer=setTimeout(() => {st.timer=null; run(false);}, now-st.firstScheduled>3000?0:delay);
    }
    function syncRoute() {
      const key=normalizeUrl(location.href);
      if (key===st.key) return false;
      const wasConv=isConvUrl(st.key);
      st.staleSig=wasConv?st.lastDomSig:"";
      st.key=key; st.generation++; st.savedSig=""; st.lastDomSig="";
      clearTimeout(st.timer); st.timer=null;
      if (wasConv || !isConvUrl(key)) opts.setAttached?.([]);
      restoreAttached();
      try {opts.onNavigate?.();} catch (_) {}
      schedule(600);
      return true;
    }
    async function restoreAttached() {
      if (!isConvUrl(st.key)) return;
      const generation=st.generation, id=convId(opts.source,st.key);
      const res=await sendBg({action:"kapsul:get",id});
      if (generation===st.generation && normalizeUrl(location.href)===st.key && res.conv) {
        opts.setAttached?.(mergeKnowledge(res.conv.attached_knowledge,opts.getAttached?.() || []));
        schedule();
      }
    }
    async function save(force) {
      if (st.dead) return {ok:false,reason:"Capture stopped. Reload this tab."};
      syncRoute();
      const href=location.href, key=st.key;
      if (!isConvUrl(href)) return {ok:false,reason:"Open a conversation with a saved chat URL first."};
      const messages=opts.scrape() || [], sig=listSig(messages);
      const attached=opts.getAttached?.() || [];
      if (!messages.length && !attached.length) return {ok:false,reason:"No rendered messages found. Open a chat or let it finish loading."};
      if (st.staleSig && (!sig || sig===st.staleSig)) return {ok:false,reason:"Waiting for the new conversation to render."};
      st.staleSig=""; st.lastDomSig=sig;
      const title=pageTitle() || inferTitle(messages), project=detectProject(opts.source);
      const signature=JSON.stringify([sig,title,project,attached]);
      if (!force && signature===st.savedSig) return {ok:true,unchanged:true};
      const entry={id:convId(opts.source,href),source:opts.source,url:href,title,project,messages,
        attached_knowledge:attached,savedAt:new Date().toISOString(),version:2};
      if (normalizeUrl(location.href)!==key) return {ok:false,reason:"Chat changed; retry."};
      const res=await sendBg({action:"kapsul:upsert",conv:entry});
      if (res.dead) stop();
      if ((res.ok || res.reason==="deleted by user") && st.key===key) st.savedSig=signature;
      return {...res,messages:messages.length};
    }
    function run(force) {
      const result=queue.then(() => save(force)).catch(e => ({ok:false,error:String(e)}));
      queue=result.then(() => {});
      return result;
    }
    st.obs=new MutationObserver(muts => {
      if (syncRoute()) return;
      if (muts.some(m => !m.target.parentElement?.closest('#cc-ask-ai-panel, #cc-banner, #cc-toast') &&
          (m.type!=="childList" || m.addedNodes.length || m.removedNodes.length))) schedule();
    });
    st.obs.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,
      attributeFilter:["data-message-author-role","data-message-id","data-is-streaming","hidden","aria-hidden"]});
    let ticks=0;
    st.poll=setInterval(() => { if (!syncRoute() && ++ticks%5===0 && !document.hidden && !st.timer) schedule(0); },600);
    const flush=() => {clearTimeout(st.timer);st.timer=null;return run(true);};
    window.addEventListener("pagehide",() => run(false));
    document.addEventListener("visibilitychange",() => {if(document.hidden) run(false); else schedule(0);});
    st.lastDomSig=listSig(opts.scrape() || []);
    restoreAttached(); schedule(0);
    const api={schedule,flush,stop}; globalThis.__kapsulAuto=api;return api;
  }

  // Context is claimed only by the destination tab, and never submitted automatically.
  async function receiveContext(source, findInput, insert, notify) {
    if (globalThis.__kapsulReceiving) return;
    globalThis.__kapsulReceiving=true;
    try {
      const result=await sendBg({action:"kapsul:pending",source});
      if (!result.ok || !result.pending) return;
      const pending=result.pending;
      let input;
      for(let i=0;i<60;i++) {input=findInput();if(input) break;await new Promise(r=>setTimeout(r,300));}
      if (!input || !input.isConnected || sourceFromUrl(location.href)!==source || isConvUrl(location.href)) {
        notify("Context not inserted: open a new chat and retry from Kapsul.",true);return;
      }
      if ((input.value ?? input.innerText ?? "").trim()) {notify("Composer already contains text. Copy context from Kapsul instead.",true);return;}
      insert(input,pending.context);
      const actual=input.value ?? input.innerText ?? "";
      const normalized=t=>t.replace(/\s+/g," ").trim();
      if (normalized(actual)!==normalized(pending.context)) {notify("Context may be incomplete. Copy it from Kapsul instead.",true);return;}
      await sendBg({action:"kapsul:pendingDone",source,token:pending.token});
      notify("Context inserted — review and press Send.");
    } catch(e) {notify("Could not insert context. Copy it from Kapsul instead.",true);}
    finally {globalThis.__kapsulReceiving=false;}
  }

  globalThis.Kapsul = {
    STORAGE_KEY, TOMB_KEY, MAX_CONVERSATIONS, LABELS, HOSTS,
    normalizeUrl, sourceFromUrl, isConvUrl, convId,
    msgSig, listSig, mergeMessages, mergeKnowledge, mergeConversation,
    pageTitle, inferTitle, detectProject,
    elementToText, toPlainText, toMarkdown, safeName, download,
    sendBg, startAutoSave, receiveContext,
  };
})();
