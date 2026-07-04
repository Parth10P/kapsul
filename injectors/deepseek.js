// injectors/deepseek.js
// Runs on chat.deepseek.com
// Storage: chrome.storage.LOCAL (session is unreliable in content scripts)

const PENDING_INJECT_KEY = "pending_context_inject";
const CC_STORAGE_KEY = "claude_conversations";

let _attachedKnowledge = [];

async function restoreAttachedKnowledge() {
  try {
    const res = await chrome.storage.local.get([CC_STORAGE_KEY]);
    const all = res[CC_STORAGE_KEY] || [];
    const convId = `deepseek_${window.location.href}`;
    const current = all.find(c => c.id === convId);
    if (current?.attached_knowledge) {
      _attachedKnowledge = current.attached_knowledge;
      console.log(`[Kapsul] Restored ${_attachedKnowledge.length} attached knowledge document(s) on DeepSeek.`);
    }
  } catch (err) {
    console.error("[Kapsul] Failed to restore documents:", err);
  }
}

async function handleInterceptedPDF(file) {
  try {
    showBanner(`Extracting text from ${file.name}…`);
    if (typeof extractMarkdownFromPDF !== 'function') {
      console.error("extractMarkdownFromPDF not defined");
      return;
    }
    const markdown = await extractMarkdownFromPDF(file);
    
    const docObj = {
      name: file.name,
      content: markdown,
      timestamp: new Date().toISOString()
    };
    
    _attachedKnowledge = _attachedKnowledge.filter(doc => doc.name !== file.name);
    _attachedKnowledge.push(docObj);
    await scrapeAndSave();
    showBanner(`✓ PDF extracted & saved`);
  } catch (err) {
    console.error("PDF extraction failed:", err);
    showBanner(`⚠️ PDF extraction failed`, true);
  }
}

function setupFileInterception() {
  document.addEventListener('change', async (e) => {
    if (e.target.type === 'file' && e.target.files?.length > 0) {
      for (const file of e.target.files) {
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          await handleInterceptedPDF(file);
        }
      }
    }
  }, { capture: true });

  document.addEventListener('drop', async (e) => {
    if (e.dataTransfer?.files?.length > 0) {
      for (const file of e.dataTransfer.files) {
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          await handleInterceptedPDF(file);
        }
      }
    }
  }, { capture: true });
}

// ── Wait for DeepSeek's textarea to mount
async function waitForDeepSeekInput(maxRetries = 60) {
  for (let i = 0; i < maxRetries; i++) {
    const el = findDeepSeekInput();
    if (el) return el;
    await new Promise(r => setTimeout(r, 300));
  }
  return null;
}

function findDeepSeekInput() {
  // Primary: confirmed textarea selector
  const ta = document.querySelector("textarea#chat-input");
  if (ta && ta.offsetParent !== null) return ta;
  // Fallback 1: any visible textarea
  for (const el of document.querySelectorAll("textarea")) {
    if (el.offsetParent !== null) return el;
  }
  // Fallback 2: contenteditable (future DS changes)
  const ce = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
  if (ce && ce.offsetParent !== null) return ce;
  return null;
}

function injectIntoDeepSeek(el, context) {
  el.focus();
  if (el.tagName === "TEXTAREA") {
    // React requires native setter to bypass synthetic event wrapping
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    nativeSetter ? nativeSetter.call(el, context) : (el.value = context);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
    document.execCommand("insertText", false, context);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

async function submitDeepSeekInput() {
  for (let i = 0; i < 20; i++) {
    const btn = document.querySelector(
      'button[aria-label*="Send" i]:not([disabled]),' +
      'button[type="submit"]:not([disabled])'
    );
    if (btn) { btn.click(); return true; }
    await new Promise(r => setTimeout(r, 200));
  }
  const inp = findDeepSeekInput();
  if (inp) {
    inp.focus();
    inp.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 13,
      bubbles: true, cancelable: true, composed: true,
    }));
    return true;
  }
  return false;
}

async function tryInjectContext() {
  let pending;
  try {
    const result = await chrome.storage.local.get([PENDING_INJECT_KEY]);
    pending = result[PENDING_INJECT_KEY];
  } catch (e) { return; }

  if (!pending) return;
  if (pending.target !== "deepseek") return;
  if (Date.now() - pending.ts > 60000) {
    await chrome.storage.local.remove([PENDING_INJECT_KEY]); return;
  }

  const input = await waitForDeepSeekInput();
  if (!input) { showBanner("Could not find DeepSeek input field.", true); return; }

  try { await chrome.storage.local.remove([PENDING_INJECT_KEY]); } catch (_) { }

  injectIntoDeepSeek(input, pending.context);
  await new Promise(r => setTimeout(r, 500));
  showBanner("Sending context to DeepSeek…");
  const ok = await submitDeepSeekInput();
  if (!ok) showBanner("Injected — please press Send manually.", true);
}


function scrapeCurrentConversation() {
  let messages = [];
  const now = new Date().toISOString();

  const allMessages = document.querySelectorAll(
    ".fbb737a4, .f9bf7997, [class*='user-message'], [class*='assistant-message'], .ds-markdown"
  );

  if (!allMessages.length) {
    document.querySelectorAll("article, [role='listitem'], .message").forEach(el => {
      const text = el.innerText?.trim();
      if (text) messages.push({ type: "unknown", content: text, timestamp: now });
    });
    return messages;
  }

  allMessages.forEach(el => {
    const isUser = el.classList.contains("fbb737a4") ||
      el.closest("[class*='user']") !== null ||
      el.querySelector("textarea") !== null;
    const type = isUser ? "user" : "assistant";
    const content = el.innerText?.trim();
    if (content) messages.push({ type, content, format: "text", timestamp: now });
  });

  return messages;
}

// BLOCK C — Shared UI helpers
function showBanner(msg, isError = false) {
  document.getElementById("cc-banner")?.remove();
  const b = document.createElement("div");
  b.id = "cc-banner";
  Object.assign(b.style, {
    position: "fixed", top: "16px", left: "50%",
    transform: "translateX(-50%) translateY(-8px)",
    background: "#18181b", color: "#fafafa",
    fontFamily: "system-ui, sans-serif", fontSize: "13px", fontWeight: "500",
    padding: "10px 20px", borderRadius: "999px",
    border: `1px solid ${isError ? "#f43f5e" : "#3f3f46"}`,
    boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
    zIndex: "2147483647", display: "flex", alignItems: "center", gap: "8px",
    opacity: "0", transition: "opacity 0.2s, transform 0.2s", whiteSpace: "nowrap",
  });
  b.innerHTML = isError
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>${msg}`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>${msg}`;
  document.body.appendChild(b);
  requestAnimationFrame(() => { b.style.opacity = "1"; b.style.transform = "translateX(-50%) translateY(0)"; });
  setTimeout(() => { b.style.opacity = "0"; setTimeout(() => b.remove(), 300); }, 3500);
}

// ── Download current chat as JSON ──────────────────────────────────────────────
function downloadCurrentChat() {
  const messages = scrapeCurrentConversation();
  if (!messages.length && !_attachedKnowledge.length) { showToast("No messages found to download.", true); return; }
  
  const title = messages.find(m => m.type === "user")?.content?.slice(0, 60) || "conversation";
  const capsule = {
    id: `deepseek_${Date.now()}`,
    title, url: window.location.href, messages,
    attached_knowledge: _attachedKnowledge,
    savedAt: new Date().toISOString(), source: "deepseek", version: 1
  };
  
  const blob = new Blob([JSON.stringify(capsule, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^\w\d]+/g, "_").slice(0, 50)}.json`;
  document.body.appendChild(a); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); a.remove();
}

// ── Sync current chat to local DB (via background → localhost:8345) ─────────────
async function syncCurrentChat(btn) {
  const originalHtml = btn ? btn.innerHTML : "Sync to Local";
  if (btn) { btn.innerHTML = "Syncing..."; btn.disabled = true; }
  
  const messages = scrapeCurrentConversation();
  if (!messages.length && !_attachedKnowledge.length) { 
    if (btn) {
      btn.innerHTML = "No messages";
      btn.style.background = "rgba(239,68,68,0.15)";
      btn.style.color = "#ef4444";
      btn.style.border = "1px solid rgba(239,68,68,0.4)";
      btn.disabled = false;
      setTimeout(() => { closePanel(); btn.innerHTML = originalHtml; btn.style.background = ""; btn.style.color = "#4285F4"; btn.style.border = ""; }, 2000);
    }
    return; 
  }
  
  const title = messages.find(m => m.type === "user")?.content?.slice(0, 60) || "conversation";
  const capsule = {
    id: `deepseek_${Date.now()}`,
    title, url: window.location.href, messages,
    attached_knowledge: _attachedKnowledge,
    savedAt: new Date().toISOString(), source: "deepseek", version: 1
  };
  
  chrome.runtime.sendMessage({ action: "syncToLocalServer", data: capsule }, (res) => {
    btn.disabled = false;
    if (res?.ok) {
      btn.innerHTML = "✓ Synced!";
      btn.style.background = "rgba(16,163,127,0.15)";
      btn.style.color = "#10a37f";
      btn.style.border = "1px solid rgba(16,163,127,0.4)";
      setTimeout(() => { closePanel(); btn.innerHTML = originalHtml; btn.style.background = ""; btn.style.color = "#4285F4"; btn.style.border = ""; }, 1500);
    } else {
      btn.innerHTML = "Server offline";
      btn.style.background = "rgba(239,68,68,0.15)";
      btn.style.color = "#ef4444";
      btn.style.border = "1px solid rgba(239,68,68,0.4)";
      setTimeout(() => { closePanel(); btn.innerHTML = originalHtml; btn.style.background = ""; btn.style.color = "#4285F4"; btn.style.border = ""; }, 2500);
    }
  });
}

function copyCurrentChat() {
  const messages = scrapeCurrentConversation();
  if (!messages.length && !_attachedKnowledge.length) { showBanner("No conversation found to copy.", true); return; }
  const title = messages.find(m => m.type === "user")?.content?.slice(0, 60) || "conversation";
  const lines = [
    `[DeepSeek conversation: "${title}"]`,
    `[Copied: ${new Date().toLocaleString()}]`,
    "",
  ];
  
  if (_attachedKnowledge && _attachedKnowledge.length > 0) {
    lines.push(`--- Attached Documents ---`);
    for (const doc of _attachedKnowledge) {
      lines.push(`Here is the attached document context (${doc.name}):`, ``, doc.content, ``);
    }
    lines.push(`--- End of Attached Documents ---`, ``);
  }

  for (const msg of messages) {
    lines.push(`${msg.type === "user" ? "User" : "DeepSeek"}: ${msg.content}`, "");
  }
  navigator.clipboard.writeText(lines.join("\n")).then(
    () => showBanner("Conversation copied to clipboard"),
    () => showBanner("Copy failed — try again.", true)
  );
}

function sendFromThisPage(target) {
  const messages = scrapeCurrentConversation();
  if (!messages.length && !_attachedKnowledge.length) { showBanner("No conversation found on this page.", true); return; }
  const title = messages.find(m => m.type === "user")?.content?.slice(0, 60) || "Untitled";
  const lines = [
    `[Context from DeepSeek conversation: "${title}"]`,
    `[Scraped: ${new Date().toLocaleString()}]`,
    "",
  ];
  
  if (_attachedKnowledge && _attachedKnowledge.length > 0) {
    lines.push(`--- Attached Documents ---`);
    for (const doc of _attachedKnowledge) {
      lines.push(`Here is the attached document context (${doc.name}):`, ``, doc.content, ``);
    }
    lines.push(`--- End of Attached Documents ---`, ``);
  }

  for (const msg of messages) {
    lines.push(`${msg.type === "user" ? "User" : "DeepSeek"}: ${msg.content}`, "");
  }
  lines.push("---", "I'm continuing this conversation. What are your thoughts?");

  const context = lines.join("\n");
  const AI_URLS = {
    claude: "https://claude.ai/new",
    gemini: "https://gemini.google.com/app",
    chatgpt: "https://chatgpt.com/",
  };

  try {
    chrome.storage.local.set(
      { [PENDING_INJECT_KEY]: { target, context, ts: Date.now() } },
      () => window.open(AI_URLS[target], "_blank")
    );
  } catch (e) {
    window.open(AI_URLS[target], "_blank");
  }
}

// AI options for DeepSeek panel (excludes DeepSeek itself)
const CC_AI_OPTIONS = [
  {
    id: "claude", label: "Claude", color: "#D97757", bg: "rgba(217,119,87,0.12)",
    svg: `<svg width="14" height="14" viewBox="0 0 24 24" fill="#D97757"><path d="M12.7,2.2c-.3-.9-1.2-.9-1.5,0l-1.6,4.6c-.2.5-.6.9-1.1,1.1L3.9,9.5c-.9.3-.9,1.2,0,1.5l4.6,1.6c.5.2.9.6,1.1,1.1l1.6,4.6c.3.9,1.2.9,1.5,0l1.6-4.6c.2-.5.6-.9,1.1-1.1l4.6-1.6c.9-.3.9-1.2,0-1.5l-4.6-1.6c-.5-.2-.9-.6-1.1-1.1L12.7,2.2Z"/></svg>`
  },
  {
    id: "gemini", label: "Gemini", color: "#4285F4", bg: "rgba(66,133,244,0.12)",
    svg: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C9.5 7.5 6.5 9.5 2 12c4.5 2.5 7.5 4.5 10 10 2.5-5.5 5.5-7.5 10-10-4.5-2.5-7.5-4.5-10-10z" fill="#4285F4"/></svg>`
  },
  {
    id: "chatgpt", label: "ChatGPT", color: "#10a37f", bg: "rgba(16,163,127,0.12)",
    svg: `<svg width="14" height="14" viewBox="0 0 24 24" fill="#10a37f"><path d="M22.28 15.55c-.24-1.3-.9-2.45-1.9-3.32.7-1.35.8-2.88.27-4.32-.54-1.42-1.6-2.52-2.98-3.08-1.38-.56-2.9-.5-4.22.18-.85-1-2.02-1.66-3.3-1.85-1.3-.18-2.65.13-3.75.87-1.1.73-1.85 1.83-2.12 3.12-.66 1.35-.74 2.87-.23 4.28.53 1.4 1.58 2.5 2.95 3.05 1.36.55 2.87.48 4.17-.2.85 1 2.03 1.66 3.3 1.85 1.3.18 2.65-.13 3.76-.87 1.1-.73 1.85-1.83 2.12-3.12 1.36-.57 2.45-1.6 3.02-2.96.55-1.37.5-2.9-.17-4.23zM12 20.32c-1.66 0-3.15-.9-4-2.35l4-2.35c.2-.12.33-.33.33-.56v-4.7l4.08 2.36c.02 0 .04 0 .06.02v4.73c0 1.57-1.28 2.85-2.85 2.85zm-7.6-6.17c-.83-1.42-.83-3.26 0-4.68l4.08 2.36v4.7L4.4 14.15zm10.7-9.45c.83 1.42.83 3.26 0 4.68l-4.08-2.36v-4.7l4.08-2.35zm3.62 9.45l-4.08-2.36v-4.7l4 2.35c.83 1.43.83 3.27 0 4.7l-4.08 2.35-.06.03z"/></svg>`
  },
];

function ensureStyles() {
  if (document.getElementById("cc-styles")) return;
  const s = document.createElement("style");
  s.id = "cc-styles";
  s.textContent = `
    /* ── Export button: matches DeepSeek ds-toggle ── */
    #cc-ask-ai-btn {
      position: absolute !important;
      top: -40px !important;
      left: 10px !important;
      z-index: 100 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 4px !important;
      padding: 0 8px !important;
      height: 32px !important;
      min-width: 0 !important;
      background: #18181b !important;
      border: 1.5px solid var(--dsw-alias-border-secondary, rgba(255,255,255,0.12)) !important;
      border-radius: 8px !important;
      color: var(--dsw-alias-label-primary, rgba(255,255,255,0.7)) !important;
      cursor: pointer !important;
      font-family: var(--ds-font-family, system-ui, sans-serif) !important;
      font-size: 13px !important;
      font-weight: 500 !important;
      line-height: 1 !important;
      transition: background 0.15s !important;
      flex-shrink: 0 !important;
      white-space: nowrap !important;
      outline: none !important;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important;
      user-select: none !important;
    }
    #cc-ask-ai-btn:hover {
      background: rgba(255,255,255,0.06) !important;
    }
    #cc-ask-ai-btn.cc-active,
    #cc-ask-ai-btn[aria-expanded="true"] {
      background: rgba(255,255,255,0.06) !important;
      color: var(--dsw-alias-brand-text, #4d8eff) !important;
      border-color: transparent !important;
    }
    #cc-ask-ai-btn .cc-btn-icon {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 14px !important;
      height: 14px !important;
      font-size: 14px !important;
      color: inherit !important;
      flex-shrink: 0 !important;
    }
    #cc-ask-ai-btn .cc-btn-label {
      font-size: 13px !important;
      font-weight: 500 !important;
      color: inherit !important;
      line-height: 1 !important;
    }
    #cc-ask-ai-panel {
      position: fixed !important;
      background: hsl(var(--bg-000, 220 10% 12%) / 0.85) !important;
      backdrop-filter: blur(12px) !important;
      -webkit-backdrop-filter: blur(12px) !important;
      border: 1px solid hsl(var(--border-300, 220 10% 25%) / 0.3) !important;
      border-radius: 16px !important;
      padding: 10px !important;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.03) !important;
      z-index: 2147483647 !important;
      display: none !important;
      flex-direction: column !important;
      gap: 4px !important;
      min-width: 220px !important;
      font-family: system-ui, sans-serif !important;
    }
    #cc-ask-ai-panel.cc-open {
      display: flex !important;
      animation: cc-pop 0.16s cubic-bezier(0.16,1,0.3,1) !important;
    }
    @keyframes cc-pop {
      from { opacity:0; transform:translateY(6px) scale(0.97); }
      to   { opacity:1; transform:translateY(0) scale(1); }
    }
    .cc-panel-hdr {
      font-size: 10px !important;
      font-weight: 700 !important;
      color: rgba(255,255,255,0.35) !important;
      text-transform: uppercase !important;
      letter-spacing: 0.8px !important;
      padding: 3px 8px 8px !important;
      border-bottom: 1px solid rgba(255,255,255,0.07) !important;
      margin-bottom: 2px !important;
    }
    .cc-ai-opt {
      display: flex !important;
      align-items: center !important;
      gap: 10px !important;
      width: 100% !important;
      padding: 8px 10px !important;
      background: transparent !important;
      border: none !important;
      border-radius: 8px !important;
      cursor: pointer !important;
      font-family: system-ui, sans-serif !important;
      transition: background 0.12s, transform 0.1s !important;
      text-align: left !important;
    }
    .cc-ai-opt:hover { background: rgba(255,255,255,0.06) !important; transform: translateX(2px) !important; }
    .cc-ai-opt:active { transform: scale(0.97) !important; }
    .cc-ai-ico {
      width: 28px !important; height: 28px !important;
      border-radius: 8px !important;
      display: flex !important; align-items: center !important; justify-content: center !important;
      flex-shrink: 0 !important;
    }
    .cc-ai-lbl { font-size: 13px !important; font-weight: 600 !important; color: rgba(255,255,255,0.9) !important; display:block !important; }
    .cc-ai-sub { font-size: 10px !important; color: rgba(255,255,255,0.4) !important; display:block !important; margin-top:1px !important; }
    .cc-arr { margin-left: auto !important; color: rgba(255,255,255,0.35) !important; flex-shrink: 0 !important; }
    .cc-divider { height: 1px !important; background: rgba(255,255,255,0.07) !important; margin: 3px 0 !important; }
    .cc-action-row {
      display: flex !important;
      gap: 4px !important;
      padding: 2px 2px 2px !important;
    }
    .cc-action-btn {
      flex: 1 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 6px !important;
      padding: 7px 10px !important;
      background: transparent !important;
      border: 1px solid rgba(255,255,255,0.08) !important;
      border-radius: 8px !important;
      color: rgba(255,255,255,0.55) !important;
      cursor: pointer !important;
      font-family: system-ui, sans-serif !important;
      font-size: 11px !important;
      font-weight: 500 !important;
      transition: background 0.12s, color 0.12s, border-color 0.12s !important;
      white-space: nowrap !important;
    }
    .cc-action-btn:hover {
      background: hsl(var(--bg-100, 220 10% 16%)) !important;
      border-color: hsl(var(--border-200, 220 10% 30%)) !important;
      color: hsl(var(--text-200, 0 0% 90%)) !important;
    }
    .cc-action-btn:active { opacity: 0.75 !important; transform: scale(0.96) !important; }
  `;
  document.head.appendChild(s);
}

let _panel = null;
let _panelOpen = false;

function buildPanel() {
  const panel = document.createElement("div");
  panel.id = "cc-ask-ai-panel";

  const hdr = document.createElement("div");
  hdr.className = "cc-panel-hdr";
  hdr.textContent = "Send context to";
  panel.appendChild(hdr);

  for (const ai of CC_AI_OPTIONS) {
    const opt = document.createElement("button");
    opt.className = "cc-ai-opt";
    opt.type = "button";
    opt.innerHTML = `
      <span class="cc-ai-ico" style="background:${ai.bg}">${ai.svg}</span>
      <span>
        <span class="cc-ai-lbl">${ai.label}</span>
        <span class="cc-ai-sub">Open &amp; inject context</span>
      </span>
      <svg class="cc-arr" width="11" height="11" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
      </svg>
    `;
    opt.addEventListener("mousedown", (e) => {
      e.preventDefault();
      closePanel();
      sendFromThisPage(ai.id);
    });
    panel.appendChild(opt);
  }

  const divider = document.createElement("div");
  divider.className = "cc-divider";
  panel.appendChild(divider);

  // ── Copy + Download inline row ──────────────────────────────────────────
  const actionRow = document.createElement("div");
  actionRow.className = "cc-action-row";

  const copyBtn = document.createElement("button");
  copyBtn.className = "cc-action-btn";
  copyBtn.type = "button";
  copyBtn.title = "Copy conversation to clipboard";
  copyBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
    Copy
  `;
  copyBtn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    closePanel();
    copyCurrentChat();
  });

  const dlBtn = document.createElement("button");
  dlBtn.className = "cc-action-btn";
  dlBtn.type = "button";
  dlBtn.title = "Download conversation as JSON";
  dlBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3v12"/><path d="m7 10 5 5 5-5"/>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    </svg>
    Download
  `;
  dlBtn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    closePanel();
    downloadCurrentChat();
  });

  actionRow.appendChild(copyBtn);
  actionRow.appendChild(dlBtn);
  
  const syncRow = document.createElement("div");
  syncRow.className = "cc-action-row";
  
  const syncBtn = document.createElement("button");
  syncBtn.className = "cc-action-btn";
  syncBtn.type = "button";
  syncBtn.style.background = "rgba(66, 133, 244, 0.1)";
  syncBtn.style.color = "#4285F4";
  syncBtn.style.border = "1px solid rgba(66, 133, 244, 0.3)";
  syncBtn.title = "Sync to Local Database";
  syncBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
    Sync to Local
  `;
  syncBtn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    syncCurrentChat(syncBtn);
  });
  
  syncRow.appendChild(syncBtn);
  
  panel.appendChild(actionRow);
  panel.appendChild(syncRow);

  document.body.appendChild(panel);
  return panel;
}

function openPanel(btn) {
  if (!_panel) _panel = buildPanel();
  const r = btn.getBoundingClientRect();
  const panelH = 220;
  if (r.top > panelH + 10) {
    _panel.style.bottom = `${window.innerHeight - r.top + 8}px`;
    _panel.style.top = "auto";
  } else {
    _panel.style.top = `${r.bottom + 8}px`;
    _panel.style.bottom = "auto";
  }
  _panel.style.left = `${Math.min(r.left, window.innerWidth - 220)}px`;
  _panel.classList.add("cc-open");
  btn.classList.add("cc-active");
  _panelOpen = true;
}

function closePanel() {
  _panel?.classList.remove("cc-open");
  document.getElementById("cc-ask-ai-btn")?.classList.remove("cc-active");
  _panelOpen = false;
}

function createAskAIButton() {
  const btn = document.createElement("button");
  btn.id = "cc-ask-ai-btn";
  btn.type = "button";
  btn.title = "Send this conversation to another AI";
  btn.innerHTML = `
    <div class="cc-btn-icon">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
    </div>
    <span class="cc-btn-label">Export</span>
  `;
  btn.style.marginRight = "9px";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    _panelOpen ? closePanel() : openPanel(btn);
  });
  document.addEventListener("click", (e) => {
    if (_panelOpen && !_panel?.contains(e.target) && e.target !== btn) closePanel();
  });
  return btn;
}

function findDeepSeekSlot() {
  // Strategy 1: direct ID
  let input = document.getElementById("chat-input");

  // Strategy 2: any textarea on the page
  if (!input) {
    input = document.querySelector("textarea");
  }

  // Strategy 3: any visible contenteditable in the bottom half
  if (!input) {
    const allCe = document.querySelectorAll('[contenteditable="true"]');
    for (const el of allCe) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 100 && rect.bottom > window.innerHeight * 0.4 && el.offsetParent !== null) {
        input = el;
        break;
      }
    }
  }

  if (!input) return null;

  // Walk up to find a suitable wrapper
  const wrapper = input.closest('.ec4f5d61') || input.closest('.fad62c2f') || input.closest('form') || input.parentElement;
  if (wrapper) {
    wrapper.style.position = 'relative';
    wrapper.style.overflow = 'visible';
  }
  return wrapper;
}

function injectDeepSeekButton() {
  if (document.getElementById("cc-ask-ai-btn")) return;
  ensureStyles();
  const slot = findDeepSeekSlot();
  if (!slot) return;

  const btn = createAskAIButton();
  slot.appendChild(btn);
}

// BLOCK D — Keep button alive
let _deepseekObserver = null;
function watchForButtonRemoval() {
  if (_deepseekObserver) return;
  _deepseekObserver = new MutationObserver(() => {
    if (!document.getElementById("cc-ask-ai-btn")) {
      setTimeout(injectDeepSeekButton, 300);
    }
  });
  _deepseekObserver.observe(document.body, { childList: true, subtree: true });
}

let _injectAttempts = 0;
function retryInjectButton() {
  if (document.getElementById("cc-ask-ai-btn")) { watchForButtonRemoval(); return; }
  if (_injectAttempts++ > 30) return;
  injectDeepSeekButton();
  if (!document.getElementById("cc-ask-ai-btn")) {
    setTimeout(retryInjectButton, 500);
  } else {
    watchForButtonRemoval();
  }
}

// BLOCK E — Auto-save for popup display

function scrapeAndSave() {
  const messages = scrapeCurrentConversation();
  if (!messages.length && !_attachedKnowledge.length) return Promise.resolve({ ok: false, reason: "no messages" });
  const title = messages.find(m => m.type === "user")?.content?.slice(0, 60) || "DeepSeek conversation";
  const convId = `deepseek_${window.location.href}`;
  return new Promise((resolve) => {
    chrome.storage.local.get([CC_STORAGE_KEY], (res) => {
      const all = res[CC_STORAGE_KEY] || [];
      const idx = all.findIndex(c => c.id === convId);
      const entry = {
        id: convId, title, url: window.location.href,
        messages, attached_knowledge: _attachedKnowledge,
        savedAt: new Date().toISOString(),
        source: "deepseek", version: 1,
      };
      if (idx >= 0) all[idx] = entry; else all.unshift(entry);
      chrome.storage.local.set({ [CC_STORAGE_KEY]: all }, () => resolve({ ok: true }));
    });
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "scrapeNow") {
    scrapeAndSave().then(sendResponse);
    return true;
  }
});

// BLOCK F — Entry point
async function init() {
  setupFileInterception();
  await restoreAttachedKnowledge();
  tryInjectContext();
  retryInjectButton();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}