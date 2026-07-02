#!/bin/bash

# Kapsul MCP Server Setup Script

echo "==============================================="
echo "🦞 Kapsul MCP Setup"
echo "==============================================="
echo ""

# Ensure we are in the root directory of the project
if [ ! -d "mcp" ]; then
  echo "❌ Error: 'mcp' directory not found. Please run this script from the root of the kapsul project."
  exit 1
fi

echo "📦 1. Installing MCP server dependencies..."
cd mcp || exit 1
npm install
cd ..

echo ""
echo "✅ Dependencies installed!"
echo ""

# Get the absolute path
ABSOLUTE_PATH="$(pwd)/mcp/index.js"

echo "🤖 2. MCP Client Configuration"
echo "To connect Kapsul to your IDE (Cursor, Antigravity, Claude, etc.),"
echo "add the following configuration to your IDE's MCP settings:"
echo ""
echo "-----------------------------------------------"
echo "{
  \"mcpServers\": {
    \"kapsul\": {
      \"command\": \"node\",
      \"args\": [
        \"$ABSOLUTE_PATH\"
      ]
    }
  }
}"
echo "-----------------------------------------------"
echo ""
echo "💡 Tip: You can also find a template in mcp/mcp_config.json"
echo ""
echo "🎉 Setup complete! Restart your IDE to apply the MCP configuration."
echo "==============================================="
