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
echo ✨ 3. IDE Skill Configuration
echo Which IDE are you using?
echo 1) Antigravity IDE (Global Skill)
echo 2) Cursor (Project-level Rule)
echo 3) Windsurf / Codeium (Project-level Rule)
echo 4) Claude Desktop / Other (No rule needed)
choice /c 1234 /m "Enter a number"
if errorlevel 4 goto ide_claude
if errorlevel 3 goto ide_windsurf
if errorlevel 2 goto ide_cursor
if errorlevel 1 goto ide_antigravity

:ide_antigravity
echo ⚙️ Configuring for Antigravity IDE...
if not exist "%USERPROFILE%\.gemini\config\skills\kapsul\" mkdir "%USERPROFILE%\.gemini\config\skills\kapsul"
copy /Y SKILL.md "%USERPROFILE%\.gemini\config\skills\kapsul\SKILL.md" >nul
echo ✅ Success! The /kapsul skill was installed globally.
goto end_ide

:ide_cursor
echo ⚙️ Configuring for Cursor...
copy /Y SKILL.md kapsul_cursorrules.txt >nul
echo ✅ Success! We created 'kapsul_cursorrules.txt' in this directory.
echo 👉 Please copy its contents into the .cursorrules file of any project where you want to use Kapsul.
goto end_ide

:ide_windsurf
echo ⚙️ Configuring for Windsurf...
copy /Y SKILL.md kapsul_windsurfrules.txt >nul
echo ✅ Success! We created 'kapsul_windsurfrules.txt' in this directory.
echo 👉 Please copy its contents into the .windsurfrules file of any project where you want to use Kapsul.
goto end_ide

:ide_claude
echo ⚙️ No local rule file needed for Claude Desktop.
echo 👉 Just ask Claude: 'Use the get_recent_ai_chats MCP tool' to read your synced chats!
goto end_ide

:end_ide
echo.
echo 🎉 Setup complete! Restart your IDE to apply the MCP configuration.
echo ===============================================
pause
