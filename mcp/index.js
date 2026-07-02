import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// --- 1. Storage Setup ---
// Define the directory where chat capsules will be saved
const DATA_DIR = path.join(os.homedir(), '.kapsul-data');

// Create the data directory on startup if it doesn't already exist
if (!existsSync(DATA_DIR)) {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

// --- 2. Express HTTP Server Setup ---
const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS so the Chrome extension can communicate with this server
app.use(cors());

// Parse JSON bodies with a 10mb limit for large chat capsules
app.use(express.json({ limit: '10mb' }));

// POST endpoint to receive data from the Chrome extension
app.post('/save-chat', async (req, res) => { // Notice the 'async' here
  try {
    const chatData = req.body;

    // Clean filename to prevent folder errors
    const safeId = String(chatData.id || Date.now()).replace(/[\/\\:?="<>|]/g, '_');
    const filename = `${safeId}.json`;

    const filePath = path.join(DATA_DIR, filename);

    // Using the async writeFile that matches Antigravity's setup
    await fs.writeFile(filePath, JSON.stringify(chatData, null, 2));
    console.log(`[Express] Chat saved successfully: ${filename}`);

    res.status(200).json({ success: true, message: "Chat saved locally" });
  } catch (error) {
    console.error("Error saving chat:", error);
    res.status(500).json({ error: "Failed to save chat" });
  }
});

app.listen(PORT, () => {
  console.error(`Express server running on http://localhost:${PORT}`);
  console.error(`Data directory: ${DATA_DIR}`);
});

// --- 3. MCP Server Setup ---
// Initialize the MCP SDK Server
const server = new Server(
  {
    name: 'kapsul-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register the tool with the MCP server
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_recent_ai_chats',
        description: 'Retrieves the most recently saved AI conversation histories from the user\'s Kapsul extension.',
        inputSchema: {
          type: 'object',
          properties: {}, // No input arguments needed for this tool
        },
      },
    ],
  };
});

// Implement the tool logic
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'get_recent_ai_chats') {
    try {
      // Read all files in the data directory
      const files = await fs.readdir(DATA_DIR);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      // Get file stats to sort by modification time (most recent first)
      const fileStats = await Promise.all(
        jsonFiles.map(async (file) => {
          const filePath = path.join(DATA_DIR, file);
          const stat = await fs.stat(filePath);
          return { file, filePath, mtimeMs: stat.mtimeMs };
        })
      );

      // Sort in descending order (newest first)
      fileStats.sort((a, b) => b.mtimeMs - a.mtimeMs);

      // Take the top 5 most recent files
      const recentFiles = fileStats.slice(0, 5);

      // Read and parse their contents
      const chats = await Promise.all(
        recentFiles.map(async (fileStat) => {
          const content = await fs.readFile(fileStat.filePath, 'utf-8');
          try {
            return JSON.parse(content);
          } catch (e) {
            return { error: `Failed to parse ${fileStat.file}` };
          }
        })
      );

      // Return the chats as a stringified JSON array
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(chats, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error('MCP Tool Error:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error reading chats: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  throw new Error(`Tool not found: ${request.params.name}`);
});

// Connect the MCP server using StdioServerTransport
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('MCP Server connected over stdio and ready for local AI agents.');
