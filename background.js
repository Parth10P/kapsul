// background.js

importScripts("lib/kapsul-core.js");

const STORAGE_KEY = Kapsul.STORAGE_KEY;
const TOMB_KEY = Kapsul.TOMB_KEY;
const PENDING_INJECT_KEY = "pending_context_inject";

// ── AI target URLs ──────────────────────────────────────────────
const AI_URLS = {
  claude:   "https://claude.ai/new",
  gemini:   "https://gemini.google.com/app",
  chatgpt:  "https://chatgpt.com/",
  deepseek: "https://chat.deepseek.com/",
};

// ── Serialized storage access ───────────────────────────────────
// Every read-modify-write runs through ONE queue, so two tabs (or a tab and
// the popup) can never overwrite each other's data.
let _queue = Promise.resolve();
function enqueue(fn) {
  const run = _queue.then(fn);
  _queue = run.catch(() => {});
  return run;
}

async function readAll() {
  const res = await chrome.storage.local.get([STORAGE_KEY, TOMB_KEY]);
  return { all: res[STORAGE_KEY] || [], tombs: res[TOMB_KEY] || {} };
}

function sameChat(c, incoming) {
  if (c.id === incoming.id) return true;
  const src = c.source || Kapsul.sourceFromUrl(c.url);
  return src === incoming.source && Kapsul.normalizeUrl(c.url) === Kapsul.normalizeUrl(incoming.url);
}

function stableId(c) {
  return Kapsul.convId(c.source || Kapsul.sourceFromUrl(c.url) || "ai", c.url);
}

function upsertConversation(incoming) {
  return enqueue(async () => {
    const { all, tombs } = await readAll();

    // user deleted this chat: only come back when the chat really grew
    const tomb = tombs[incoming.id];
    if (tomb != null) {
      if ((incoming.messages || []).length <= tomb) return { ok: false, reason: "deleted by user" };
      delete tombs[incoming.id];
    }

    const idx = all.findIndex((c) => sameChat(c, incoming));
    if (idx >= 0) all[idx] = Kapsul.mergeConversation(all[idx], incoming);
    else all.push({ ...incoming, firstSavedAt: incoming.savedAt });

    // merge duplicates created by older versions (same chat saved many times)
    const seen = new Map();
    const deduped = [];
    for (const c of all) {
      const src = c.source || Kapsul.sourceFromUrl(c.url);
      const key = src + "|" + Kapsul.normalizeUrl(c.url);
      if (seen.has(key)) {
        const i = seen.get(key);
        deduped[i] = Kapsul.mergeConversation(deduped[i], c);
      } else {
        seen.set(key, deduped.length);
        deduped.push(c);
      }
    }
    for (const c of deduped) c.id = stableId(c); // old random Claude ids → stable id

    deduped.sort((a, b) => new Date(a.savedAt) - new Date(b.savedAt));
    const trimmed = deduped.slice(-Kapsul.MAX_CONVERSATIONS);
    await chrome.storage.local.set({ [STORAGE_KEY]: trimmed, [TOMB_KEY]: tombs });
    return { ok: true, count: trimmed.length };
  });
}

function deleteConversation(id) {
  return enqueue(async () => {
    const { all, tombs } = await readAll();
    const target = all.find((c) => c.id === id);
    if (target) tombs[stableId(target)] = (target.messages || []).length;
    await chrome.storage.local.set({
      [STORAGE_KEY]: all.filter((c) => c.id !== id),
      [TOMB_KEY]: tombs,
    });
    return { ok: true };
  });
}

function clearAll() {
  return enqueue(async () => {
    const { all, tombs } = await readAll();
    for (const c of all) tombs[stableId(c)] = (c.messages || []).length;
    await chrome.storage.local.set({ [STORAGE_KEY]: [], [TOMB_KEY]: tombs });
    return { ok: true };
  });
}

function getConversation(id) {
  return enqueue(async () => {
    const { all } = await readAll();
    return { ok: true, conv: all.find((c) => c.id === id || stableId(c) === id) || null };
  });
}

// ── Message listener ────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {

    // ── Storage API used by content scripts + popup ───────────────
    case "kapsul:upsert":
      upsertConversation(message.conv).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    case "kapsul:get":
      getConversation(message.id).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    case "kapsul:delete":
      deleteConversation(message.id).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    case "kapsul:clear":
      clearAll().then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
      return true;

    // ── Scrape active tab (any supported AI site) ─────────────────
    case "scrapeActiveTab": {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab?.url) { sendResponse({ ok: false, error: "No active tab" }); return; }

        const supported = ["claude.ai", "gemini.google.com", "chatgpt.com", "chat.deepseek.com"];
        const isSupported = supported.some(h => tab.url.includes(h));
        if (!isSupported) { sendResponse({ ok: false, error: "Unsupported site" }); return; }

        chrome.tabs.sendMessage(tab.id, { action: "scrapeNow" }, (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          sendResponse({ ok: true, response });
        });
      });
      return true;
    }

    // ── Open target AI with context injected ─────────────────────
    case "openAIWithContext": {
      const { target, context } = message;

      if (!AI_URLS[target]) {
        sendResponse({ ok: false, error: "Unknown AI target" });
        return true;
      }

      // Store the pending context so the injector content script can pick it up
      // Using chrome.storage.local (not .session) for reliable cross-context access in MV3
      chrome.storage.local.set({ [PENDING_INJECT_KEY]: { target, context, ts: Date.now() } }, () => {
        chrome.tabs.create({ url: AI_URLS[target] }, (tab) => {
          sendResponse({ ok: true, tabId: tab.id });
        });
      });

      return true;
    }

    // ── Update extension toolbar icon based on theme ─────────────
    case "updateThemeIcon": {
      const { isDark } = message;
      chrome.action.setIcon({
        path: {
          "16": isDark ? "icons/icon16_white.png" : "icons/icon16.png",
          "48": isDark ? "icons/icon48_white.png" : "icons/icon48.png",
          "128": isDark ? "icons/icon128_white.png" : "icons/icon128.png"
        }
      });
      sendResponse({ ok: true });
      return true;
    }

    default:
      break;
  }
});
