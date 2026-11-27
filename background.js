// background.js

importScripts("lib/kapsul-core.js");

const STORAGE_KEY = Kapsul.STORAGE_KEY;
const TOMB_KEY = Kapsul.TOMB_KEY;
const pendingKey = tabId => `kapsul_pending_${tabId}`;

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
  const tombs = res[TOMB_KEY] || {};
  for (const [id,count] of Object.entries(tombs)) {
    const sep=id.indexOf("_https://");
    if (sep<0) continue;
    const url=id.slice(sep+1), source=Kapsul.sourceFromUrl(url);
    if (!source) continue;
    const canonical=Kapsul.convId(source,url);
    if (canonical!==id) { tombs[canonical]=Math.max(tombs[canonical] || 0,count); delete tombs[id]; }
  }
  return { all: res[STORAGE_KEY] || [], tombs };
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
    if (!incoming || Kapsul.sourceFromUrl(incoming.url)!==incoming.source || !Kapsul.isConvUrl(incoming.url) || !Array.isArray(incoming.messages)) return {ok:false,error:"Invalid chat snapshot"};
    incoming.id=stableId(incoming);
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
      (async () => {
        const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
        if (!tab?.id || !Kapsul.sourceFromUrl(tab.url)) return {ok:false,reason:"Open Claude, ChatGPT, Gemini or DeepSeek to capture a chat."};
        if (!Kapsul.isConvUrl(tab.url)) return {ok:false,reason:"Open an existing chat or send a first message."};
        const result=await chrome.tabs.sendMessage(tab.id,{action:"scrapeNow"},{frameId:0});
        return result || {ok:false,reason:"Capture is not ready. Reload the AI tab."};
      })().then(sendResponse,e=>sendResponse({ok:false,error:String(e.message || e)}));
      return true;
    }

    // A handoff is created by an explicit action and scoped to the newly opened tab.
    // Use session storage so conversation text is not left in a persistent shared slot.
    case "openAIWithContext": {
      (async () => {
        const {target,context}=message;
        if (!Object.hasOwn(AI_URLS,target) || typeof context!=="string" || !context.trim()) return {ok:false,error:"Invalid AI target or empty context."};
        const tab=await chrome.tabs.create({url:"about:blank"});
        try {
          await chrome.storage.session.set({[pendingKey(tab.id)]:{target,context,token:crypto.randomUUID(),ts:Date.now()}});
          await chrome.tabs.update(tab.id,{url:AI_URLS[target]});
          return {ok:true,tabId:tab.id};
        } catch(e) {
          await chrome.storage.session.remove(pendingKey(tab.id));
          await chrome.tabs.remove(tab.id).catch(()=>{});
          throw e;
        }
      })().then(sendResponse,e=>sendResponse({ok:false,error:String(e.message || e)}));
      return true;
    }
    case "kapsul:pending":
    case "kapsul:pendingDone": {
      (async () => {
        if (!sender.tab?.id || sender.frameId!==0 || Kapsul.sourceFromUrl(sender.url)!==message.source || Kapsul.isConvUrl(sender.url)) return {ok:false};
        const key=pendingKey(sender.tab.id), pending=(await chrome.storage.session.get(key))[key];
        if (!pending || pending.target!==message.source) return {ok:true,pending:null};
        if (Date.now()-pending.ts>5*60*1000) {await chrome.storage.session.remove(key);return {ok:true,pending:null};}
        if (message.action==="kapsul:pendingDone") {
          if (pending.token!==message.token) return {ok:false};
          await chrome.storage.session.remove(key);return {ok:true};
        }
        return {ok:true,pending};
      })().then(sendResponse,e=>sendResponse({ok:false,error:String(e.message || e)}));
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

chrome.tabs.onRemoved.addListener(tabId => {chrome.storage.session.remove(pendingKey(tabId)).catch(()=>{});});
// Retire the old unscoped handoff slot on upgrade (saved conversations are unchanged).
chrome.runtime.onInstalled.addListener(() => {chrome.storage.local.remove("pending_context_inject").catch(()=>{});});
