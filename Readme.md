# <img src="icons/icon48_white.png#gh-dark-mode-only" width="32" height="32" alt="Logo" valign="middle"><img src="icons/icon48.png#gh-light-mode-only" width="32" height="32" alt="Logo" valign="middle"> KAPSUL


![Chrome Extension](https://img.shields.io/badge/Platform-Chrome%20Extension-blue)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)
![License](https://img.shields.io/badge/License-MIT-yellow)
![Status](https://img.shields.io/badge/Status-Active-success)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)
![Version](https://img.shields.io/badge/Version-1.0-purple)

> **Never lose a conversation again.** Save, copy, download, and port your AI context across sessions, accounts, and any platform — Claude, ChatGPT, Gemini, or DeepSeek.


```text
                      ██╗  ██╗ █████╗ ██████╗ ███████╗██╗   ██╗██╗     
                      ██║ ██╔╝██╔══██╗██╔══██╗██╔════╝██║   ██║██║     
                      █████╔╝ ███████║██████╔╝███████╗██║   ██║██║     
                      ██╔═██╗ ██╔══██║██╔═══╝ ╚════██║██║   ██║██║     
                      ██║  ██╗██║  ██║██║     ███████║╚██████╔╝███████╗
                      ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚══════╝ ╚═════╝ ╚══════╝
```

---

## 📋 Table of Contents

1. [The Problem](#-the-problem)
2. [The Solution](#-the-solution)
3. [Features](#-features)
4. [Installation](#-installation)
5. [How to Use](#-how-to-use)
6. [Exporting & Porting Context to Other AIs](#-exporting--porting-context-to-other-ais)
7. [Local PDF Processing Pipeline](#-local-pdf-processing-pipeline)
8. [File Structure](#-file-structure)
9. [Roadmap](#-roadmap)
10. [Contributing](#-contributing)
11. [License](#-license)

---

## 😤 The Problem

You've spent **2 hours** on a deep technical session with an AI. You've:

- Debugged a gnarly auth flow
- Designed a full database schema together
- Made 12 architectural decisions
- Written 400 lines of code collaboratively

Then — **BAM.** You hit your usage limit. Or your account gets switched. Or you want to continue on ChatGPT because Claude is down.

**Everything is gone.** The context, the decisions, the nuance. You have to start from scratch and re-explain everything to a fresh AI that has no idea what you've been building.

This is the problem **Kapsul** was built to solve.

---

## 💡 The Solution

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  Claude / ChatGPT / Gemini / DeepSeek  ──▶  Kapsul Extension             │
│                                                                              │
│  Extension ──▶ One click ──▶ Any Web AI (auto-injected & auto-submitted)     │
│       │                                                                      │
│       ▼                                                                      │
│  Local Node.js Server ──▶ Model Context Protocol (MCP) ──▶ Desktop AI Agents │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Kapsul** is a Chrome extension that:

1. **Silently watches** your conversations on Claude, ChatGPT, Gemini, and DeepSeek using DOM observers
2. **Automatically saves** every message as you chat — no manual action needed
3. **Injects a native Export button** into every supported AI's toolbar — open a panel, pick a target AI, and your context is auto-injected and auto-submitted
4. **Lets you Copy** the conversation to clipboard as plain text in one click
5. **Lets you Download** the conversation as a portable JSON capsule in one click
6. **Shows all conversations in a unified popup** with colour-coded source badges and per-card export/delete controls

No cloud servers. No sign-up. Everything runs locally in your browser.

---

## ✨ Features

### 🔌 Desktop MCP Integration
| Feature | Status |
|---|---|
| Local Express Server bridge (`mcp/index.js`) | ✅ Live |
| Model Context Protocol (MCP) SDK Server | ✅ Live |
| Sync chats directly to `~/.kapsul-data` | ✅ Live |
| `get_recent_ai_chats` tool for Desktop AI Agents | ✅ Live |

### 🖥️ Unified Popup
| Feature | Status |
|---|---|
| Auto-scrape active AI tab on popup open | ✅ Live |
| Conversations from all 4 AIs in one list | ✅ Live |
| Colour-coded source badges (Claude · ChatGPT · Gemini · DeepSeek) | ✅ Live |
| AI name labels on every message bubble | ✅ Live |
| Search across all saved conversations | ✅ Live |
| Per-card download as JSON | ✅ Live |
| Per-card delete with fade animation | ✅ Live |
| Export all conversations as one JSON | ✅ Live |
| Clear all conversations | ✅ Live |
| Conversation count in stats bar | ✅ Live |

### 💉 Injected Export Panel (on every AI page)
| Feature | Status |
|---|---|
| Native Export button injected into Claude toolbar | ✅ Live |
| Native Export button injected into ChatGPT toolbar | ✅ Live |
| Native Export button injected into Gemini toolbar | ✅ Live |
| Native Export button injected into DeepSeek toolbar | ✅ Live |
| Send context to another AI (opens tab + auto-injects + auto-submits) | ✅ Live |
| **Copy conversation to clipboard** (plain text) | ✅ Live |
| **Download conversation as JSON** directly from page | ✅ Live |
| Animated panel with smooth open/close | ✅ Live |
| MutationObserver keeps button alive after SPA re-renders | ✅ Live |

### 🧠 Scraping & Storage
| Feature | Status |
|---|---|
| Claude DOM scraper (MutationObserver + debounce) | ✅ Live |
| ChatGPT conversation scraper | ✅ Live |
| Gemini conversation scraper | ✅ Live |
| DeepSeek conversation scraper | ✅ Live |
| Unified `chrome.storage.local` across all AIs | ✅ Live |
| Up to 50 conversations stored locally | ✅ Live |
| SPA navigation detection (no page reload needed) | ✅ Live |
| Code blocks extracted and preserved verbatim | ✅ Live |

---

### How it works under the hood

**`content.js`** — Runs on every `claude.ai` page. Sets up a `MutationObserver` that watches the DOM for changes. When a new message appears, it triggers a debounced save (1.5 s delay to avoid saving mid-stream). Scrapes both user messages (`[data-testid="user-message"]`) and assistant responses (`.font-claude-response`), preserving code blocks. Injects the Export button with a panel offering send-to-AI, Copy, and Download.

**`injectors/chatgpt.js`** — Runs on `chatgpt.com`. Scrapes via `[data-message-author-role]`. Injects the Export button into ChatGPT's composer toolbar. On injection, fills the ProseMirror editor via `execCommand + insertText` and auto-clicks Send. Also exposes Copy and Download.

**`injectors/gemini.js`** — Runs on `gemini.google.com`. Scrapes from Angular's `user-query-content` and `model-response` elements. Injects the Export button near the toolbox drawer. Injects into the Quill editor by setting `innerHTML` and firing the full Angular event chain, then auto-submits. Triple-fires context check (0 ms / 1.5 s / 3 s) to survive Angular hydration delays. Exposes Copy and Download.

**`injectors/deepseek.js`** — Runs on `chat.deepseek.com`. Scrapes and saves DeepSeek conversations. Injects the Export button styled to match DeepSeek's native design. Handles context injection into the textarea and auto-submit. Exposes Copy and Download.

**`background.js`** — The service worker. Listens for `scrapeActiveTab` from the popup and routes `scrapeNow` to the correct content script.

**`popup.js / popup.html / popup.css`** — The extension popup. On open, auto-scrapes the active AI tab. Renders all saved conversations from all four platforms in one unified list, with colour-coded source badges, search, expand/collapse, per-card JSON export, and delete.

---

## 🚀 Installation

Since this extension is not yet on the Chrome Web Store, install it in **Developer Mode**:

### Step 1 — Download the extension files

```bash
git clone https://github.com/Parth10P/kapsul.git
cd kapsul
```

### Step 2 — Open Chrome Extensions

Go to `chrome://extensions` in your browser.

### Step 3 — Enable Developer Mode

Toggle **Developer Mode** on (top right corner).

### Step 4 — Load the extension

Click **"Load unpacked"** and select the folder containing `manifest.json`.

### Step 5 — Verify installation

You should see the Kapsul logo appear in your Chrome toolbar. If it's hidden, click the puzzle piece icon and pin it.

### Step 6 — Run the Setup Script (Optional: For IDE Context)

If you want to use Kapsul to sync context directly to your local IDE (like Antigravity, Cursor, or Claude Desktop) via the MCP Model Context Protocol, run the setup script:

**Mac / Linux:**
```bash
chmod +x setup.sh
./setup.sh
```

**Windows:**
Double-click the `setup.bat` file in your file explorer, or run it via command prompt:
```cmd
setup.bat
```

---

## 🛠️ How to Use

#### 1. Open any supported AI

Navigate to [claude.ai](https://claude.ai), [chatgpt.com](https://chatgpt.com), [gemini.google.com](https://gemini.google.com), or [chat.deepseek.com](https://chat.deepseek.com). The extension activates automatically.

#### 2. Chat normally

Just use the AI as you normally would. The extension silently captures every message in the background.

#### 3. Open the popup to view all conversations

Click the Kapsul icon in your toolbar. The popup auto-scrapes the active tab and immediately shows all saved conversations, sorted by most recent, with colour-coded source badges.

Each card shows:
- **Title** — inferred from your first message
- **Source badge** — CLAUDE / CHATGPT / GEMINI / DEEPSEEK
- **Date & time** saved
- **Message count** (tap to expand and read messages, with AI name on each bubble)
- **Download** — saves the conversation as a JSON capsule
- **Delete** — removes the conversation with a smooth fade

#### 4. Search conversations

Use the search bar to find any conversation by title or message content — across all platforms.

#### 5. Export all

Click **"Export all"** in the footer to download every saved conversation as a single JSON file.

---

## 🤖 MCP Setup (Auto-Spawn Server)

This repository includes a local Model Context Protocol (MCP) server in the `mcp/` directory. It exposes the `get_recent_ai_chats` tool, which retrieves your most recently saved AI conversation histories from the local sync directory (`~/.context-sync-data/`) and provides them to coding agents or MCP clients.

The server is designed to be **auto-spawned by the MCP client on demand**, rather than run manually as a persistent background service.

### IDE Integration: The `/kapsul` Skill

Once the MCP server is configured (see below), you can use Kapsul directly in IDEs like Antigravity, Cursor, or Windsurf. We provide a pre-made IDE Skill so your agent automatically fetches and reads your synced chats when you type `/kapsul`. 

To install the skill automatically for your specific IDE, just run the setup script:

```bash
./setup.sh
```
The script will ask you which IDE you are using and configure the skill accordingly!

To set this up for any general-purpose MCP client (like **Antigravity, Cursor, Codex, Claude Code, or Claude Desktop**), you need to register it in your IDE's MCP configuration settings.

Depending on your client, this might be a UI configuration menu or a JSON file (e.g., `claude_desktop_config.json`, `mcp.json`, etc.). Add the following to your config, ensuring you use the absolute path to `mcp/index.js` on your machine:

```json
{
  "mcpServers": {
    "kapsul": {
      "command": "node",
      "args": ["<ABSOLUTE_PATH_TO>/mcp/index.js"]
    }
  }
}
```
*(An example file is provided at `mcp/mcp_config.json` for reference.)*

> **Note:** After updating the configuration, you may need to fully restart your IDE or MCP client for it to detect the new server.

> **Note:** Because the server is auto-spawned by your IDE/client, the local Express endpoint (`/save-chat`, used by the popup's "Sync to Local" button) will **only be reachable while your IDE currently has this process spawned**. It is NOT a persistent background service under this setup.

---


### Cross-platform send matrix

| From ↓ / To → | Claude | ChatGPT | Gemini | DeepSeek |
|---|---|---|---|---|
| Claude | — | ✅ | ✅ | ✅ |
| ChatGPT | ✅ | — | ✅ | ✅ |
| Gemini | ✅ | ✅ | — | ✅ |
| DeepSeek | ✅ | ✅ | ✅ | — |

---

## 📤 Exporting & Porting Context to Other AIs

### The JSON Capsule Format

Every exported conversation follows this schema:

```json
{
  "id": "conv_1712345678_a3f2k",
  "title": "Building a React auth system with JWT...",
  "url": "https://claude.ai/chat/...",
  "savedAt": "2026-04-05T10:22:00.000Z",
  "source": "claude",
  "version": 2,
  "attached_knowledge": [
    {
      "filename": "Career_Mapping_Form.pdf",
      "extracted_text": "# Career Mapping Document\n\nThis form outlines the goals..."
    }
  ],
  "messages": [
    {
      "type": "user",
      "content": "How do I implement refresh token rotation?",
      "format": "text",
      "timestamp": "2026-04-05T10:00:00.000Z"
    },
    {
      "type": "assistant",
      "content": "Refresh token rotation works by...\n\n```javascript\nconst rotate = async (token) => { ... }\n```",
      "format": "text",
      "timestamp": "2026-04-05T10:00:00.000Z"
    }
  ]
}
```

The `source` field (`claude`, `chatgpt`, `gemini`, `deepseek`) drives the badge colour in the popup.

### Manual injection (works with any AI)

For AIs not supported natively, paste this into a new chat:

```
Here is the full context of a previous conversation. Please read it carefully 
and continue helping me as if you were already familiar with everything discussed.

[paste the JSON here]

Continuing from where we left off: [your next question]
```

### Context window compatibility

Because Kapsul now natively extracts and embeds PDF text directly into the JSON file offline, your payloads can become quite large.

| AI | Context Window | Works with export? |
|---|---|---|
| Claude 3.5 Sonnet | 200k tokens | ✅ Excellent |
| GPT-4o | 128k tokens | ✅ Great |
| Gemini 1.5 Pro | 1M+ tokens | ✅ Best for massive multi-PDF exports |
| DeepSeek V3 | 128k tokens | ✅ Good |
| Mistral Large | 128k tokens | ✅ Good |
| Llama 3 (local) | 8k–128k tokens | ⚠️ May struggle with embedded PDFs |

---

## 📄 Local PDF Processing Pipeline

> **Status:** Fully localized! We completely removed the need for an external backend or Gemini API compression.

Kapsul uses a lightweight, in-browser parsing engine (PDF.js) to extract text from your uploaded documents without ever sending your files to a 3rd-party server.

```
Raw Conversation + Uploaded PDF
      │
      ▼
1. DOM INTERCEPTION (Capture Phase)
   - Extension detects drag-and-drop or file upload events
   - Snatches the raw PDF before the web app's UI clears it

      │
      ▼
2. LOCAL PARSING (PDF.js offline)
   - The PDF is parsed natively inside the browser tab
   - Text, headers, and structure are converted to Markdown

      │
      ▼
3. JSON EMBEDDING
   - The raw markdown is appended to the `attached_knowledge` array
   - The original Base64 file is safely discarded to save memory

      │
      ▼
4. EXPORT
   - The fully self-contained JSON is sent to your local MCP server or clipboard
```

### Planned improvements

- [ ] TF-IDF sentence scoring for assistant explanations
- [ ] Type tagging (`question`, `code`, `explanation`, `decision`)
- [ ] Rolling window manager (10 sessions, tiered compression)
- [ ] Local NLP compression — zero API calls, zero data leaving your machine
- [ ] Token counter — real-time estimate vs. target AI's context window

---

## 📁 File Structure

```
kapsul/
├── manifest.json               ← MV3 config, host permissions for all 4 AIs
├── background.js               ← Service worker: Gemini API, routing, scrapeActiveTab
├── content.js                  ← Claude scraper + Export button + Copy/Download
├── injectors/
│   ├── chatgpt.js              ← ChatGPT scraper + Export panel + Copy/Download
│   ├── gemini.js               ← Gemini scraper + Export panel + Copy/Download
│   └── deepseek.js             ← DeepSeek scraper + Export panel + Copy/Download
├── mcp/                      ← Local Node.js Server & MCP integration
│   ├── index.js              ← Express API + MCP SDK Server
│   ├── package.json          ← Node dependencies
│   └── mcp_config.json       ← MCP configuration template
├── popup/
│   ├── popup.html              ← Popup markup
│   ├── popup.js                ← Unified list, source badges, search, export, delete
│   └── popup.css               ← Dark grayscale theme, Inter font
├── assets/
│   ├── Preview.png             ← Popup screenshot
│   └── InjectedUI.png          ← Injected Export panel screenshot
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```


### Host permissions

| Host | Purpose |
|---|---|
| `https://claude.ai/*` | Scraping + Export button injection |
| `https://gemini.google.com/*` | Scraping + Export button injection |
| `https://chatgpt.com/*` | Scraping + Export button injection |
| `https://chat.deepseek.com/*` | Scraping + Export button injection |

---

## 🗺️ Roadmap

### v1.2.0 — Coming Soon
- [ ] Storage size indicator in popup stats bar
- [ ] Visual compression ratio stats (e.g. "48k → 6k tokens, 87% reduction")
- [ ] Fallback selector config exposed in settings (for when AI sites update their DOM)
- [ ] Session fingerprinting to detect and deduplicate identical sessions

### v1.3.0
- [ ] IndexedDB upgrade for 100+ conversation projects
- [ ] Tag-based organisation (group conversations by project across AIs)
- [ ] Per-conversation compression toggle in the popup

### v1.4.0 — 🔧 Work in Progress
- [ ] **Local NLP compression** — browser-native pipeline, zero API calls, zero data leaving your machine
- [ ] **Downloads manager** — view, rename, re-download exported JSON capsules from inside the popup
- [ ] **Rolling 10-session context window** — automatic tiered compression for older sessions

### v2.0.0 — Future Vision
- [ ] Universal "Context Capsule" standard readable by all major LLMs
- [ ] Cross-device sync via optional encrypted cloud backup
- [ ] Firefox support (MV2/MV3 port)
- [ ] Context analytics dashboard

---

## 🤝 Contributing

Pull requests are welcome! Here's how to get started:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Test by loading the unpacked extension in Chrome
5. Commit: `git commit -m 'Add: my feature'`
6. Push: `git push origin feature/my-feature`
7. Open a Pull Request

### Areas we especially need help with

- **DOM selector resilience** — all four AI sites update their DOM; hardening selectors and adding fallbacks is ongoing
- **Compression heuristics** — better sentence scoring for explanation messages
- **Firefox port** — MV3 APIs; a Firefox-compatible port would help many users
- **Local NLP** — a browser-native compression pipeline with zero external API calls
- **New platforms** — Perplexity, Mistral, Grok, or any major AI chat interface

---

## 📄 License

MIT License — see [LICENSE](./LICENSE) for details.

---

<div align="center">

Built with passion and frustration by developers who kept hitting AI context limits.

**Stop losing context. Start syncing it.**

</div>
