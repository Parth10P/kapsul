// content.js — DOM Scraper + Send-to-AI button for Claude.ai


// ── Auto-save engine lives in lib/kapsul-core.js ─────────────────────────────
// Every chat is stored under its own key (source + chat URL). Writes go through
// the background worker, so chats never overwrite or mix with each other.
let _autoSave = null;
let _attachedKnowledge = [];

// ── Scraper ───────────────────────────────────────────────────────────────────
// Reads BOTH sides: what you sent + what Claude answered, in page order.
// Claude changes its DOM often, so assistant replies are found in 3 steps:
//   1) known reply selectors  2) turn-by-turn structural fallback
const USER_SEL = '[data-testid="user-message"]';
const AI_SEL = [
  ".font-claude-response",
  ".font-claude-message",
  '[data-testid="assistant-message"]',
  "[data-is-streaming]",
].join(", ");

function _cleanTurnText(turn) {
  // everything in a turn that is not the user's own bubble or UI chrome
  const clone = turn.cloneNode(true);
  clone.querySelectorAll(
    USER_SEL + ', button, form, fieldset, header, nav, [contenteditable], [role="toolbar"], [data-testid*="action"], [data-testid*="feedback"]'
  ).forEach((n) => n.remove());
  return Kapsul.elementToText(clone);
}

function _structuralScrape(users) {
  // climb until we reach the element whose children are the conversation "turns"
  let list = users[0].parentElement;
  for (let i = 0; i < 8 && list && list.parentElement; i++) {
    const hasReply = [...list.children].some(
      (k) => !k.matches(USER_SEL) && !k.querySelector(USER_SEL) && _cleanTurnText(k).length > 0);
    if (hasReply && users.every((u) => list.contains(u))) break;
    list = list.parentElement;
  }
  if (!list || list.matches("body, html") || list.querySelector('[contenteditable], fieldset')) {
    // too broad (reached composer/layout): use user bubbles + their following siblings only
    const out = [];
    for (const u of users) {
      out.push({ el: u, type: "user" });
      let n = u.closest("[data-test-render-count]") || u;
      while (n.parentElement && !n.nextElementSibling && n.parentElement !== document.body) n = n.parentElement;
      const sib = n.nextElementSibling;
      if (sib && !sib.querySelector(USER_SEL) && !sib.querySelector("[contenteditable]")) out.push({ el: sib, type: "assistant" });
    }
    return out;
  }
  const out = [];
  for (const kid of list.children) {
    if (kid.querySelector(USER_SEL) || kid.matches(USER_SEL)) {
      out.push({ el: kid.querySelector(USER_SEL) || kid, type: "user" });
      out.push({ el: kid, type: "assistant", stripUser: true });
    } else if (kid.textContent.trim()) {
      out.push({ el: kid, type: "assistant" });
    }
  }
  return out;
}

function scrapeMessages() {
  const messages = [];
  const now = new Date().toISOString();
  const push = (type, content) => {
    if (content) messages.push({ type, content, format: "text", timestamp: now });
  };

  const users = [...document.querySelectorAll(USER_SEL)];
  const aiRaw = [...document.querySelectorAll(AI_SEL)]
    .filter((el) => !el.querySelector(USER_SEL) && !el.matches(USER_SEL));
  const ai = aiRaw.filter((el) => !aiRaw.some((o) => o !== el && o.contains(el))); // outermost only

  let strategy = "selectors";
  if (ai.length) {
    const all = [...users.map((el) => ({ el, type: "user" })), ...ai.map((el) => ({ el, type: "assistant" }))]
      .sort((x, y) => (x.el.compareDocumentPosition(y.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    for (const { el, type } of all) {
      push(type, type === "user" ? el.innerText?.trim() : Kapsul.elementToText(el));
    }
  } else if (users.length) {
    strategy = "structural";
    for (const item of _structuralScrape(users)) {
      if (item.type === "user") push("user", item.el.innerText?.trim());
      else push("assistant", item.stripUser ? _cleanTurnText(item.el) : Kapsul.elementToText(item.el));
    }
  }

  // visible in DevTools console (F12) on claude.ai to see what was captured
  const nu = messages.filter((m) => m.type === "user").length;
  const sig = `${strategy}:${nu}:${messages.length - nu}`;
  if (window.__kapsulLastScrape !== sig) {
    window.__kapsulLastScrape = sig;
    console.log(`[Kapsul] captured ${nu} user + ${messages.length - nu} Claude messages (${strategy})`);
  }
  return messages;
}

// Live snapshot of the chat that is on screen right now (never from storage)
function buildLiveEntry() {
  const messages = scrapeMessages();
  return {
    id: Kapsul.convId("claude", location.href),
    source: "claude",
    url: location.href,
    title: Kapsul.pageTitle() || Kapsul.inferTitle(messages),
    project: Kapsul.detectProject("claude"),
    messages,
    attached_knowledge: _attachedKnowledge,
    savedAt: new Date().toISOString(),
    version: 2,
  };
}

function scheduleConversationSave(delay) { _autoSave?.schedule(delay); }

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
    scheduleConversationSave(300);
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
  const conv = buildLiveEntry();
  if (!conv.messages.length && !conv.attached_knowledge.length) { showToast("No messages found to copy."); return; }
  navigator.clipboard.writeText(Kapsul.toPlainText(conv)).then(
    () => showToast("✓ Conversation copied to clipboard"),
    () => showToast("⚠️ Copy failed — try again.")
  );
}

// ── Download current chat (JSON or Markdown) ─────────────────────────────────
function downloadCurrentChat(format = "json") {
  const conv = buildLiveEntry();
  if (!conv.messages.length && !conv.attached_knowledge.length) { showToast("No messages found to download."); return; }
  const name = Kapsul.safeName(conv.title);
  if (format === "md") Kapsul.download(`${name}.md`, Kapsul.toMarkdown(conv), "text/markdown");
  else Kapsul.download(`${name}.json`, JSON.stringify(conv, null, 2), "application/json");
  showToast(format === "md" ? "✓ Downloading Markdown…" : "✓ Downloading JSON…");
}

// ── Send to AI ────────────────────────────────────────────────────────────────
// Uses the chat that is open RIGHT NOW (not "the last saved one").
async function sendToAI(target) {
  const conversation = buildLiveEntry();
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
    svg: `<svg width="14" height="14" viewBox="0 0 24 24" fill="#10a37f"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>`,
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
      background: hsl(var(--bg-000)) !important;
      border: 1px solid hsl(var(--border-300) / 0.5) !important;
      border-radius: 14px !important;
      padding: 8px !important;
      box-shadow: 0 8px 32px rgba(0,0,0,0.14), 0 0 0 1px rgba(0,0,0,0.03) !important;
      z-index: 2147483647 !important;
      display: none !important;
      flex-direction: column !important;
      gap: 3px !important;
      min-width: 205px !important;
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
    .cc-action-btn:active { opacity: 0.75 !important; }
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
    JSON
  `;
  dlBtn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    closePanel();
    downloadCurrentChat("json");
  });

  const mdBtn = document.createElement("button");
  mdBtn.className = "cc-action-btn";
  mdBtn.type = "button";
  mdBtn.title = "Download conversation as Markdown";
  mdBtn.textContent = "MD";
  mdBtn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    closePanel();
    downloadCurrentChat("md");
  });

  actionRow.appendChild(copyBtn);
  actionRow.appendChild(dlBtn);
  actionRow.appendChild(mdBtn);
  panel.appendChild(actionRow);

  document.body.appendChild(panel);
  return panel;
}

let _panel = null;
let _panelOpen = false;

function openPanel(btn) {
  if (!_panel) _panel = buildPanel();
  const r = btn.getBoundingClientRect();
  const panelH = 215;
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

  slot.appendChild(btn);
}

// registered once (was added on every re-injection before)
document.addEventListener("click", (e) => {
  const btn = document.getElementById(CC_BTN_ID);
  if (_panelOpen && !_panel?.contains(e.target) && !btn?.contains(e.target)) closePanel();
});

// ── Message listener ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "scrapeNow") {
    // popup asked: save the open chat NOW, answer when it is really stored
    (_autoSave ? _autoSave.flush() : Promise.resolve({ ok: false })).then(sendResponse);
    return true;
  }
  if (message.action === "ping") { sendResponse({ ok: true, url: window.location.href }); }
  return false;
});

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
    // silently fail
  }
}

// ── Keep the Export button alive (React re-renders drop it) ───────────────────
let _injectAttempts = 0;
function retryInject() {
  if (document.getElementById(CC_BTN_ID)) return;
  if (_injectAttempts++ > 30) return;
  injectButton();
  if (!document.getElementById(CC_BTN_ID)) setTimeout(retryInject, 400);
}

let _btnTimer = null;
function watchButton() {
  new MutationObserver(() => {
    if (_btnTimer || document.getElementById(CC_BTN_ID)) return;
    _btnTimer = setTimeout(() => { _btnTimer = null; injectButton(); }, 300);
  }).observe(document.body, { childList: true, subtree: true });
}

function resetButton() {
  document.getElementById(CC_BTN_ID)?.remove();
  document.getElementById(CC_PANEL_ID)?.remove();
  _panel = null; _panelOpen = false;
  _injectAttempts = 0;
  retryInject();
}

// ── Init (runs ONCE; chat switches are handled inside the auto-save engine) ───
function init() {
  if (window.__kapsulInit) return;
  window.__kapsulInit = true;

  checkAndInjectPendingContext();
  setupFileInterception();

  _autoSave = Kapsul.startAutoSave({
    source: "claude",
    scrape: scrapeMessages,
    getAttached: () => _attachedKnowledge,
    setAttached: (arr) => { _attachedKnowledge = arr || []; },
    onNavigate: resetButton,
  });

  retryInject();
  watchButton();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

window.__contextClaw = { scrapeNow: scheduleConversationSave, scrapeMessages };
