@echo off
setlocal

echo ===============================================
echo 🦞 Kapsul MCP Setup
echo ===============================================
echo.

:: Ensure we are in the root directory of the project
if not exist "mcp\" (
  echo ❌ Error: 'mcp' directory not found. Please run this script from the root of the kapsul project.
  exit /b 1
)

echo 📦 1. Installing MCP server dependencies...
cd mcp
call npm install
cd ..

echo.
echo ✅ Dependencies installed!
echo.

:: Get the absolute path
set "ABSOLUTE_PATH=%CD%\mcp\index.js"
:: Replace backslashes with forward slashes for JSON formatting
set "ABSOLUTE_PATH=%ABSOLUTE_PATH:\=/%"

echo 🤖 2. MCP Client Configuration
echo To connect Kapsul to your IDE (Cursor, Antigravity, Claude, etc.),
echo add the following configuration to your IDE's MCP settings:
echo.
echo -----------------------------------------------
echo {
echo   "mcpServers": {
echo     "kapsul": {
echo       "command": "node",
echo       "args": [
echo         "%ABSOLUTE_PATH%"
echo       ]
echo     }
echo   }
echo }
echo -----------------------------------------------
echo.
echo 💡 Tip: You can also find a template in mcp\mcp_config.json
echo.
echo 🎉 Setup complete! Restart your IDE to apply the MCP configuration.
echo ===============================================
pause
