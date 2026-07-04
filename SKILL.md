---
name: kapsul
description: Triggers when the user mentions Kapsul, types /kapsul, or asks to reference recent AI chats.
---

When the user triggers this skill, you must immediately:
1. Call the `get_recent_ai_chats` tool from the `kapsul` MCP server.
2. Read the returned JSON array which contains the user's most recently synced AI conversations (from ChatGPT, Claude, etc).
3. Thoroughly read the context, code, and decisions discussed in those chats.
4. Use those exported conversations as the absolute source of truth and core context for answering the user's current request.
