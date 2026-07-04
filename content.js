// content.js — DOM Scraper + Send-to-AI button for Claude.ai


// ── Capsule ───────────────────────────────────────────────────────────────────
const Capsule = {
  build(messages, url) {
    const title = this._inferTitle(messages, url);
    return {
      id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title, url, messages,
      savedAt: new Date().toISOString(),
      source: "claude",
      version: 1,
    };
  },
  _inferTitle(messages, url) {
    const firstUser = messages.find((m) => m.type === "user");
    if (firstUser && firstUser.content.length > 0) {
      return firstUser.content.substring(0, 60).replace(/\n/g, " ").trim() +
        (firstUser.content.length > 60 ? "…" : "");
    }
    try {
      const u = new URL(url);
      const parts = u.pathname.split("/").filter(Boolean);
      return parts[parts.length - 1] || "Untitled Conversation";
    } catch { return "Untitled Conversation"; }
  },
};

// ── Storage ───────────────────────────────────────────────────────────────────
const STORAGE_KEY = "claude_conversations";
const MAX_CONVERSATIONS = 50;

function storageGetAll() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) { resolve([]); return; }
      resolve(result[STORAGE_KEY] || []);
    });
  });
}

async function storageSave(conversation) {
  const all = await storageGetAll();
  const last = all[all.length - 1];
  if (last && last.url === conversation.url && last.messages.length === conversation.messages.length) {
    const mergedKnowledge = conversation.attached_knowledge || last.attached_knowledge || [];
    all[all.length - 1] = { ...conversation, id: last.id, savedAt: last.savedAt, attached_knowledge: mergedKnowledge };
  } else {
    all.push(conversation);
  }
  const trimmed = all.slice(-MAX_CONVERSATIONS);
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: trimmed }, () => resolve());
  });
}

// ── Scraper ───────────────────────────────────────────────────────────────────
function scrapeMessages() {
  let messages = [];
  const now = new Date().toISOString();

  document.querySelectorAll('[data-testid="user-message"], .font-claude-response')
    .forEach((el) => {
      const isUser = el.matches('[data-testid="user-message"]');
      const type = isUser ? "user" : "assistant";

      if (isUser) {
        const content = el.innerText?.trim();
        if (content) messages.push({ type, content, format: "text", timestamp: now });
      } else {
        const parts = [];
        el.querySelectorAll('p, li, h1, h2, h3, pre.code-block__code, [role="group"] pre.code-block__code')
          .forEach((child) => {
            if (child.tagName === "PRE" && child.classList.contains("code-block__code")) {
              const code = child.querySelector("code");
              const lang = child.closest('[role="group"]')?.querySelector(".text-text-500")?.innerText?.trim() || "";
              const c = code?.innerText?.trim() || child.innerText?.trim();
              if (c) parts.push(`\`\`\`${lang}\n${c}\n\`\`\``);
            } else {
              const text = child.innerText?.trim();
              if (text) parts.push(text);
            }
          });
        if (parts.length) messages.push({ type, content: parts.join("\n\n"), format: "text", timestamp: now });
      }
    });

  return messages;
}

// ── Debounced save ────────────────────────────────────────────────────────────
let _debounceTimer = null;
let _attachedKnowledge = [];

async function restoreAttachedKnowledge() {
  try {
    const all = await storageGetAll();
    const current = all.find(c => c.url === window.location.href);
    if (current?.attached_knowledge) {
      _attachedKnowledge = current.attached_knowledge;
      console.log(`[Kapsul] Restored ${_attachedKnowledge.length} attached knowledge document(s) from storage.`);
    }
  } catch (err) {
    console.error("[Kapsul] Failed to restore attached knowledge:", err);
  }
}

async function scheduleConversationSave() {
  clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(async () => {
    const rawMessages = scrapeMessages();
    if (!rawMessages.length && !_attachedKnowledge.length) return;
    let messages = rawMessages;
    
    const capsule = Capsule.build(messages, window.location.href);
    capsule.attached_knowledge = _attachedKnowledge;
    try { await storageSave(capsule); }
    catch (err) { console.error("[ContextClaw] save failed:", err); }
  }, 1500);
}

// ── File Interception ─────────────────────────────────────────────────────────
async function handleInterceptedPDF(file) {
  try {
    showToast(`Extracting text from ${file.name}…`);
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
    scheduleConversationSave();
    showToast(`✓ PDF extracted & saved`);
  } catch (err) {
    console.error("PDF extraction failed:", err);
    showToast(`⚠️ PDF extraction failed`);
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


// ── Format context ────────────────────────────────────────────────────────────
function formatContextBlock(conversation) {
  if (!conversation?.messages?.length && (!conversation?.attached_knowledge || !conversation.attached_knowledge.length)) return null;
  const lines = [
    `[CONTEXT HANDOFF — Do NOT reply to this message]`,
    ``,
    `The following is the full context of a conversation I was having on Claude.`,
    `Please read and remember this context. Do not respond to it.`,
    `I will send my next message separately to continue the conversation.`,
    ``,
  ];

  if (conversation.attached_knowledge && conversation.attached_knowledge.length > 0) {
    lines.push(`--- Attached Documents ---`);
    for (const doc of conversation.attached_knowledge) {
      lines.push(`Here is the attached document context (${doc.name}):`, ``, doc.content, ``);
    }
    lines.push(`--- End of Attached Documents ---`, ``);
  }

  lines.push(
    `--- Conversation: "${conversation.title || "Untitled"}" ---`,
    `Saved: ${new Date(conversation.savedAt).toLocaleString()}`,
    ``
  );

  for (const msg of conversation.messages || []) {
    lines.push(`${msg.type === "user" ? "User" : "Claude"}: ${msg.content}`, "");
  }

  lines.push(
    `--- End of context ---`,
    ``,
    `(Please acknowledge you have read the above context by saying "Got it — context received." ` +
    `Then wait for my next message.)`
  );
  return lines.join("\n");
}


// ── Copy current chat to clipboard ──────────────────────────────────────────
function copyCurrentChat() {
  const messages = scrapeMessages();
  if (!messages.length && !_attachedKnowledge.length) { showToast("No messages found to copy."); return; }
  const firstUser = messages.find(m => m.type === "user");
  const title = firstUser?.content?.slice(0, 60) || "conversation";
  const lines = [
    `[Claude conversation: "${title}"]`,
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
    lines.push(`${msg.type === "user" ? "User" : "Claude"}: ${msg.content}`, "");
  }
  navigator.clipboard.writeText(lines.join("\n")).then(
    () => showToast("✓ Conversation copied to clipboard"),
    () => showToast("⚠️ Copy failed — try again.")
  );
}

// ── Download current chat as JSON ──────────────────────────────────────────────
function downloadCurrentChat() {
  const messages = scrapeMessages();
  if (!messages.length && !_attachedKnowledge.length) { showToast("No messages found to download."); return; }
  const capsule = Capsule.build(messages, window.location.href);
  capsule.attached_knowledge = _attachedKnowledge;
  const blob = new Blob([JSON.stringify(capsule, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${capsule.title.replace(/[^\w\d]+/g, "_").slice(0, 50)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Sync current chat to local DB (via background → localhost:8345) ─────────────
async function syncCurrentChat(btn) {
  const originalHtml = btn ? btn.innerHTML : "Sync to Local";
  if (btn) { btn.innerHTML = "Syncing..."; btn.disabled = true; }
  
  const messages = scrapeMessages();
  if (!messages.length && !_attachedKnowledge.length) { 
    if (btn) {
      btn.innerHTML = "No messages";
      btn.style.background = "rgba(239,68,68,0.15)";
      btn.style.color = "#ef4444";
      btn.style.border = "1px solid rgba(239,68,68,0.4)";
      btn.disabled = false;
      setTimeout(() => { closePanel(); btn.innerHTML = originalHtml; btn.style.background = ""; btn.style.color = "#D97757"; btn.style.border = ""; }, 2000);
    } else {
      showToast("No messages found to sync."); 
    }
    return; 
  }
  
  const capsule = Capsule.build(messages, window.location.href);
  capsule.attached_knowledge = _attachedKnowledge;
  
  chrome.runtime.sendMessage({ action: "syncToLocalServer", data: capsule }, (res) => {
    btn.disabled = false;
    if (res?.ok) {
      btn.innerHTML = "✓ Synced!";
      btn.style.background = "rgba(16,163,127,0.15)";
      btn.style.color = "#10a37f";
      btn.style.border = "1px solid rgba(16,163,127,0.4)";
      setTimeout(() => { closePanel(); btn.innerHTML = originalHtml; btn.style.background = ""; btn.style.color = "#D97757"; btn.style.border = ""; }, 1500);
    } else {
      btn.innerHTML = "Server offline";
      btn.style.background = "rgba(239,68,68,0.15)";
      btn.style.color = "#ef4444";
      btn.style.border = "1px solid rgba(239,68,68,0.4)";
      setTimeout(() => { closePanel(); btn.innerHTML = originalHtml; btn.style.background = ""; btn.style.color = "#D97757"; btn.style.border = ""; }, 2500);
    }
  });
}

// ── Send to AI ────────────────────────────────────────────────────────────────
async function sendToAI(target) {
  const all = await storageGetAll();
  if (!all.length) { showToast("⚠️ No saved conversations. Click Refresh in the popup first."); return; }

  const conversation = all.slice().reverse().find(c => c.url === window.location.href) || all[all.length - 1];
  const ctx = formatContextBlock(conversation);
  if (!ctx) { showToast("No messages to send."); return; }

  chrome.runtime.sendMessage({ action: "openAIWithContext", target, context: ctx }, (res) => {
    const names = { claude: "Claude", gemini: "Gemini", chatgpt: "ChatGPT", deepseek: "DeepSeek" };
    showToast(res?.ok ? `↗ Opening ${names[target]}…` : "Failed to open tab.");
  });
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg) {
  document.getElementById("cc-toast")?.remove();
  const t = document.createElement("div");
  t.id = "cc-toast";
  t.textContent = msg;
  Object.assign(t.style, {
    position: "fixed", bottom: "90px", left: "50%",
    transform: "translateX(-50%) translateY(6px)",
    background: "#18181b", color: "#fafafa",
    fontFamily: "system-ui, sans-serif", fontSize: "13px", fontWeight: "500",
    padding: "8px 16px", borderRadius: "999px",
    border: "1px solid #3f3f46", boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
    zIndex: "2147483647", pointerEvents: "none", opacity: "0",
    transition: "opacity 0.2s, transform 0.2s", whiteSpace: "nowrap",
  });
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = "1"; t.style.transform = "translateX(-50%) translateY(0)"; });
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 250); }, 2800);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── BUTTON INJECTION ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const CC_BTN_ID = "cc-ask-ai-btn";
const CC_PANEL_ID = "cc-ask-ai-panel";

const AI_OPTIONS = [
  {
    id: "gemini", label: "Gemini",
    color: "#4285F4", bg: "rgba(66,133,244,0.12)",
    svg: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C9.5 7.5 6.5 9.5 2 12c4.5 2.5 7.5 4.5 10 10 2.5-5.5 5.5-7.5 10-10-4.5-2.5-7.5-4.5-10-10z" fill="#4285F4"/>
    </svg>`,
  },
  {
    id: "chatgpt", label: "ChatGPT",
    color: "#10a37f", bg: "rgba(16,163,127,0.12)",
    svg: `<svg width="14" height="14" viewBox="0 0 24 24" fill="#10a37f"><path d="M22.28 15.55c-.24-1.3-.9-2.45-1.9-3.32.7-1.35.8-2.88.27-4.32-.54-1.42-1.6-2.52-2.98-3.08-1.38-.56-2.9-.5-4.22.18-.85-1-2.02-1.66-3.3-1.85-1.3-.18-2.65.13-3.75.87-1.1.73-1.85 1.83-2.12 3.12-.66 1.35-.74 2.87-.23 4.28.53 1.4 1.58 2.5 2.95 3.05 1.36.55 2.87.48 4.17-.2.85 1 2.03 1.66 3.3 1.85 1.3.18 2.65-.13 3.76-.87 1.1-.73 1.85-1.83 2.12-3.12 1.36-.57 2.45-1.6 3.02-2.96.55-1.37.5-2.9-.17-4.23zM12 20.32c-1.66 0-3.15-.9-4-2.35l4-2.35c.2-.12.33-.33.33-.56v-4.7l4.08 2.36c.02 0 .04 0 .06.02v4.73c0 1.57-1.28 2.85-2.85 2.85zm-7.6-6.17c-.83-1.42-.83-3.26 0-4.68l4.08 2.36v4.7L4.4 14.15zm10.7-9.45c.83 1.42.83 3.26 0 4.68l-4.08-2.36v-4.7l4.08-2.35zm3.62 9.45l-4.08-2.36v-4.7l4 2.35c.83 1.43.83 3.27 0 4.7l-4.08 2.35-.06.03z"/></svg>`,
  },
  {
    id: "deepseek", label: "DeepSeek",
    color: "#1A6BFF", bg: "rgba(26,107,255,0.12)",
    svg: `<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#1A6BFF"/><circle cx="12" cy="12" r="5" fill="white"/><circle cx="12" cy="12" r="2.5" fill="#1A6BFF"/></svg>`,
  },
];

function ensureStyles() {
  if (document.getElementById("cc-styles")) return;
  const s = document.createElement("style");
  s.id = "cc-styles";
  s.textContent = `
    #cc-ask-ai-btn {
      position: absolute !important;
      top: -40px !important;
      left: 0px !important;
      z-index: 100 !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 5px !important;
      padding: 0 10px !important;
      height: 32px !important;
      background: hsl(var(--bg-000)) !important;
      border: 1px solid hsl(var(--border-300) / 0.45) !important;
      border-radius: 8px !important;
      color: hsl(var(--text-400)) !important;
      cursor: pointer !important;
      font-family: inherit !important;
      font-size: 12px !important;
      font-weight: 600 !important;
      transition: background 0.15s, border-color 0.15s, color 0.15s !important;
      flex-shrink: 0 !important;
      white-space: nowrap !important;
      outline: none !important;
      box-shadow: 0 2px 8px rgba(0,0,0,0.05) !important;
    }
    #cc-ask-ai-btn:hover {
      background: hsl(var(--bg-200)) !important;
      border-color: hsl(var(--border-200)) !important;
      color: hsl(var(--text-200)) !important;
    }
    #cc-ask-ai-btn.active {
      background: hsl(var(--bg-200)) !important;
      border-color: hsl(var(--border-200)) !important;
      color: hsl(var(--text-100)) !important;
    }

    #cc-ask-ai-panel {
      position: fixed !important;
      background: hsl(var(--bg-000) / 0.85) !important;
      backdrop-filter: blur(12px) !important;
      -webkit-backdrop-filter: blur(12px) !important;
      border: 1px solid hsl(var(--border-300) / 0.3) !important;
      border-radius: 16px !important;
      padding: 10px !important;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.03) !important;
      z-index: 2147483647 !important;
      display: none !important;
      flex-direction: column !important;
      gap: 4px !important;
      min-width: 220px !important;
      font-family: inherit !important;
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
      color: hsl(var(--text-500)) !important;
      text-transform: uppercase !important;
      letter-spacing: 0.8px !important;
      padding: 3px 8px 8px !important;
      border-bottom: 1px solid hsl(var(--border-300) / 0.35) !important;
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
      font-family: inherit !important;
      transition: background 0.12s, transform 0.1s !important;
      text-align: left !important;
    }
    .cc-ai-opt:hover { background: hsl(var(--bg-100)) !important; transform: translateX(2px) !important; }
    .cc-ai-opt:active { transform: scale(0.97) !important; }
    .cc-ai-ico {
      width: 28px !important; height: 28px !important;
      border-radius: 8px !important;
      display: flex !important; align-items: center !important; justify-content: center !important;
      flex-shrink: 0 !important;
    }
    .cc-ai-lbl { font-size: 13px !important; font-weight: 600 !important; color: hsl(var(--text-100)) !important; display:block !important; }
    .cc-ai-sub { font-size: 10px !important; color: hsl(var(--text-500)) !important; display:block !important; margin-top:1px !important; }
    .cc-arr { margin-left: auto !important; color: hsl(var(--text-500)) !important; flex-shrink: 0 !important; }
    .cc-divider { height: 1px !important; background: hsl(var(--border-300) / 0.35) !important; margin: 3px 0 !important; }
    .cc-action-row {
      display: flex !important;
      gap: 4px !important;
      padding: 2px !important;
    }
    .cc-action-btn {
      flex: 1 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 6px !important;
      padding: 7px 10px !important;
      background: transparent !important;
      border: 1px solid hsl(var(--border-300) / 0.4) !important;
      border-radius: 8px !important;
      color: hsl(var(--text-400)) !important;
      cursor: pointer !important;
      font-family: inherit !important;
      font-size: 11px !important;
      font-weight: 500 !important;
      transition: background 0.12s, color 0.12s, border-color 0.12s !important;
      white-space: nowrap !important;
    }
    .cc-action-btn:hover {
      background: hsl(var(--bg-100)) !important;
      border-color: hsl(var(--border-200)) !important;
      color: hsl(var(--text-200)) !important;
    }
    .cc-action-btn:active { opacity: 0.75 !important; transform: scale(0.96) !important; }
  `;
  document.head.appendChild(s);
}

// ── Find exact injection point from real Claude DOM ───────────────────────────
function findSlot() {
  // Strategy 1: contenteditable div (conversation page)
  let editor = document.querySelector('div[contenteditable="true"]');

  // Strategy 2: any visible contenteditable in the bottom half of viewport (homepage)
  if (!editor) {
    const allCe = document.querySelectorAll('[contenteditable="true"]');
    for (const el of allCe) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 100 && rect.bottom > window.innerHeight * 0.4 && el.offsetParent !== null) {
        editor = el;
        break;
      }
    }
  }

  if (!editor) return null;

  const wrapper = editor.closest('fieldset') || editor.closest('form') || editor.parentElement;
  if (wrapper) {
    wrapper.style.position = 'relative';
    wrapper.style.overflow = 'visible';
  }
  return wrapper;
}

function buildPanel() {
  const panel = document.createElement("div");
  panel.id = CC_PANEL_ID;

  const hdr = document.createElement("div");
  hdr.className = "cc-panel-hdr";
  hdr.textContent = "Send context to";
  panel.appendChild(hdr);

  for (const ai of AI_OPTIONS) {
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
      e.preventDefault(); // prevent input blur
      closePanel();
      sendToAI(ai.id);
    });
    panel.appendChild(opt);
  }

  // ── Copy + Download inline row ──────────────────────────────────────────
  const divider = document.createElement("div");
  divider.className = "cc-divider";
  panel.appendChild(divider);

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

let _panel = null;
let _panelOpen = false;

function openPanel(btn) {
  if (!_panel) _panel = buildPanel();
  const r = btn.getBoundingClientRect();
  const panelH = 185;
  if (r.top > panelH + 10) {
    _panel.style.bottom = `${window.innerHeight - r.top + 8}px`;
    _panel.style.top = "auto";
  } else {
    _panel.style.top = `${r.bottom + 8}px`;
    _panel.style.bottom = "auto";
  }
  _panel.style.left = `${Math.min(r.left, window.innerWidth - 215)}px`;
  _panel.classList.add("cc-open");
  btn.classList.add("active");
  _panelOpen = true;
}

function closePanel() {
  _panel?.classList.remove("cc-open");
  document.getElementById(CC_BTN_ID)?.classList.remove("active");
  _panelOpen = false;
}

function injectButton() {
  if (document.getElementById(CC_BTN_ID)) return;

  ensureStyles();

  const slot = findSlot();
  if (!slot) return;

  const btn = document.createElement("button");
  btn.id = CC_BTN_ID;
  btn.type = "button";
  btn.title = "Send conversation context to another AI";
  btn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="22" y1="2" x2="11" y2="13"/>
      <polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
    Export
  `;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    _panelOpen ? closePanel() : openPanel(btn);
  });
  document.addEventListener("click", (e) => {
    if (_panelOpen && !_panel?.contains(e.target) && e.target !== btn) closePanel();
  });

  slot.appendChild(btn);
}

// ── Message listener ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "scrapeNow") { scheduleConversationSave(); sendResponse({ ok: true }); }
  if (message.action === "ping") { sendResponse({ ok: true, url: window.location.href }); }
  return false;
});

// ── MutationObserver ──────────────────────────────────────────────────────────
let _observer = null;

function startObserver() {
  if (_observer) return;
  _observer = new MutationObserver((mutations) => {
    if (mutations.some((m) => m.addedNodes.length > 0 || m.type === "characterData")) {
      scheduleConversationSave();
      if (!document.getElementById(CC_BTN_ID)) setTimeout(injectButton, 300);
    }
  });
  _observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

// ── Init ──────────────────────────────────────────────────────────────────────
function isConversationPage() {
  return (
    /\/chat\/|\/c\/|\/conversation/.test(window.location.pathname) ||
    /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(window.location.pathname)
  );
}

let _injectAttempts = 0;
function retryInject() {
  if (document.getElementById(CC_BTN_ID)) return;
  if (_injectAttempts++ > 30) return;
  injectButton();
  if (!document.getElementById(CC_BTN_ID)) setTimeout(retryInject, 400);
}

// ── Pending context injection (receive context from other AIs) ────────────────
function checkAndInjectPendingContext() {
  try {
    chrome.storage.local.get(["pending_context_inject"], (result) => {
      const pending = result["pending_context_inject"];
      if (!pending) return;
      if (pending.target !== "claude" || Date.now() - pending.ts > 60000) return;
      chrome.storage.local.remove(["pending_context_inject"]);

      const context = pending.context;
      let attempts = 0;
      const maxAttempts = 20;

      const poll = setInterval(() => {
        attempts++;
        const el = document.querySelector('div[data-testid="chat-input"][contenteditable="true"]');
        if (el) {
          clearInterval(poll);
          el.focus();
          document.execCommand("selectAll", false, null);
          document.execCommand("delete", false, null);
          document.execCommand("insertText", false, context);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          // Show success banner
          showToast("✓ Context injected — review and send!");
        } else if (attempts >= maxAttempts) {
          clearInterval(poll);
          showToast("⚠️ Could not find Claude input field.");
        }
      }, 500);
    });
  } catch (e) {
    // chrome.storage.session may not be available in all contexts — silently fail
  }
}

async function init() {
  checkAndInjectPendingContext();
  setupFileInterception();
  await restoreAttachedKnowledge();

  // Always try to inject the Export button (homepage or conversation)
  _injectAttempts = 0;
  retryInject();

  if (!isConversationPage()) {
    let last = window.location.href;
    const poll = setInterval(() => {
      if (window.location.href !== last) {
        last = window.location.href;
        if (isConversationPage()) { clearInterval(poll); startObserver(); scheduleConversationSave(); _injectAttempts = 0; retryInject(); }
      }
    }, 800);
    return;
  }
  startObserver();
  scheduleConversationSave();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// SPA nav
let _lastHref = window.location.href;
const _navObserver = new MutationObserver(() => {
  if (window.location.href !== _lastHref) {
    _lastHref = window.location.href;
    if (_observer) { _observer.disconnect(); _observer = null; }
    document.getElementById(CC_BTN_ID)?.remove();
    document.getElementById(CC_PANEL_ID)?.remove();
    _panel = null; _panelOpen = false;
_attachedKnowledge = [];
    init();
  }
});
_navObserver.observe(document.documentElement, { childList: true, subtree: false });

window.__contextClaw = { scrapeNow: scheduleConversationSave, scrapeMessages };