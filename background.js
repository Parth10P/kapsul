// background.js

const STORAGE_KEY = "claude_conversations";
const PENDING_INJECT_KEY = "pending_context_inject";


// ── AI target URLs ──────────────────────────────────────────────
const AI_URLS = {
  claude:   "https://claude.ai/new",
  gemini:   "https://gemini.google.com/app",
  chatgpt:  "https://chatgpt.com/",
  deepseek: "https://chat.deepseek.com/",
};

// ── Message listener ────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {

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