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

echo "✨ 3. IDE Skill Configuration"

# Define the IDE options
options=("Antigravity IDE (Global Skill)" "Cursor (Project-level Rule)" "Windsurf / Codeium (Project-level Rule)" "Claude Desktop / Other (No rule needed)")
selected=0

# Function to draw the interactive menu
draw_menu() {
    printf "\e[36m? \e[1mWhich IDE are you using?\e[0m\n"
    
    # Loop through the options and render them
    for i in "${!options[@]}"; do
        if [ "$i" -eq "$selected" ]; then
            # Selected item: Cyan dot and cyan text
            printf "\e[36m  ● ${options[$i]}\e[0m\n"
        else
            # Unselected item: Gray hollow circle and normal text
            printf "\e[90m  ○ \e[0m${options[$i]}\n"
        fi
    done
    
    # Print the navigation instructions at the bottom
    printf "\e[90m  ↑/↓ to navigate • Enter/Space: confirm\e[0m\n"
}

# Hide the cursor so it doesn't blink on the screen while navigating
tput civis

echo ""
draw_menu

# Infinite loop to capture keyboard inputs
while true; do
    read -rsn1 key
    
    if [[ $key == $'\x1b' ]]; then
        read -rsn2 key 
        
        if [[ $key == "[A" ]]; then
            ((selected--))
            if [ "$selected" -lt 0 ]; then selected=$((${#options[@]} - 1)); fi
        elif [[ $key == "[B" ]]; then
            ((selected++))
            if [ "$selected" -ge ${#options[@]} ]; then selected=0; fi
        fi
        
    elif [[ -z "$key" || "$key" == $'\n' || "$key" == $'\r' || "$key" == " " ]]; then
        break
    fi

    # Erase the current menu so we can redraw it
    lines=$((${#options[@]} + 2))
    tput cuu $lines
    tput ed
    
    draw_menu
done

# Show the cursor again before exiting
tput cnorm

echo ""
case $selected in
  0)
    echo "⚙️ Configuring for Antigravity IDE..."
    mkdir -p ~/.gemini/config/skills/kapsul
    cp SKILL.md ~/.gemini/config/skills/kapsul/
    echo "✅ Success! The /kapsul skill was installed globally."
    ;;
  1)
    echo "⚙️ Configuring for Cursor..."
    cat SKILL.md > kapsul_cursorrules.txt
    echo "✅ Success! We created 'kapsul_cursorrules.txt' in this directory."
    echo "👉 Please copy its contents into the .cursorrules file of any project where you want to use Kapsul."
    ;;
  2)
    echo "⚙️ Configuring for Windsurf..."
    cat SKILL.md > kapsul_windsurfrules.txt
    echo "✅ Success! We created 'kapsul_windsurfrules.txt' in this directory."
    echo "👉 Please copy its contents into the .windsurfrules file of any project where you want to use Kapsul."
    ;;
  3)
    echo "⚙️ No local rule file needed for Claude Desktop."
    echo "👉 Just ask Claude: 'Use the get_recent_ai_chats MCP tool' to read your synced chats!"
    ;;
esac

echo ""
echo "🎉 Setup complete! Restart your IDE to apply the MCP configuration."
echo "==============================================="
