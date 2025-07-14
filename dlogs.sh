#!/bin/bash

# --- Wrangler Deployment & Monitoring Script ---
# This script automates the process of deploying a Cloudflare Worker,
# tailing its logs, running the Model Context Protocol inspector,
# and opening relevant debugging tabs in your browser.
#
# It now redirects the output of the background processes to log files
# for subsequent analysis.

# Define log file names
TAIL_LOG_FILE="tail.log"
INSPECTOR_LOG_FILE="inspector.log"

echo "🚀 Starting deployment..."
# Step 1: Deploy the Worker using Wrangler.
# The script will wait for this command to complete before proceeding.
npx wrangler deploy

# Check if the deployment was successful before proceeding
if [ $? -ne 0 ]; then
  echo "❌ Deployment failed. Aborting script."
  exit 1
fi

echo "✅ Deployment successful!"
echo "📡 Starting background processes for logging and inspection..."

# Step 2: Start tailing the logs in a background process.
# The output (stdout & stderr) is redirected to the TAIL_LOG_FILE.
# '2>&1' redirects stderr to the same place as stdout.
npx wrangler tail > "$TAIL_LOG_FILE" 2>&1 &
TAIL_PID=$!

# Step 3: Start the MCP inspector in a background process.
# Its output is also redirected to its own log file.
npx @modelcontextprotocol/inspector "https://rtm-mcp-server.vcto-6e7.workers.dev" > "$INSPECTOR_LOG_FILE" 2>&1 &
INSPECTOR_PID=$!

# --- Cleanup Function ---
# This function will be called when the script exits (e.g., via Ctrl+C)
# to ensure the background processes are stopped cleanly.
cleanup() {
    echo -e "\n🛑 Stopping background processes..."
    kill $TAIL_PID > /dev/null 2>&1
    kill $INSPECTOR_PID > /dev/null 2>&1
    echo "👋 Goodbye!"
    exit 0
}

# Trap the SIGINT signal (what happens when you press Ctrl+C)
# and run the cleanup function.
trap cleanup SIGINT

echo "PID for 'wrangler tail' is $TAIL_PID"
echo "PID for 'inspector' is $INSPECTOR_PID"
echo -e "\n🪵 Logs are being written to:"
echo "   - Wrangler Tail:  $TAIL_LOG_FILE"
echo "   - Inspector:      $INSPECTOR_LOG_FILE"
echo -e "\n💡 To monitor a file in real-time, open a new terminal and run:"
echo "   tail -f $TAIL_LOG_FILE"
echo -e "\nPress Ctrl+C to stop all processes and exit."

# Give the background services a moment to initialize before opening tabs.
sleep 3

# Step 4: Open the debug and health URLs in the default browser.
# The script checks your operating system to use the correct command.
URL1="https://rtm-mcp-server.vcto-6e7.workers.dev/debug"
URL2="https://rtm-mcp-server.vcto-6e7.workers.dev/health"

echo "🌐 Opening browser tabs..."
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    xdg-open "$URL1"
    xdg-open "$URL2"
elif [[ "$OSTYPE" == "darwin"* ]]; then # macOS
    open "$URL1"
    open "$URL2"
elif [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then # Windows
    start "$URL1"
    start "$URL2"
else
    echo "Unsupported OS. Please open these URLs manually:"
    echo "- $URL1"
    echo "- $URL2"
fi

# The 'wait' command holds the script here, allowing the background
# processes to continue running until the script is terminated (Ctrl+C).
wait
