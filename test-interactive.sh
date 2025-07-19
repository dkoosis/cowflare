#!/bin/bash

# MCP Server Test Helper
# Usage: source test-interactive.sh

export MCP_URL="http://localhost:8787"

# Register a new client
mcp_register() {
  curl -s -X POST $MCP_URL/register \
    -H "Content-Type: application/json" \
    -d '{"redirect_uris": ["http://localhost:8080/callback"]}' | jq
}

# Get auth URL
mcp_auth_url() {
  CLIENT_ID=$1
  echo "$MCP_URL/authorize?client_id=$CLIENT_ID&redirect_uri=http://localhost:8080/callback&response_type=code"
}

# Exchange code for token
mcp_token() {
  CLIENT_ID=$1
  CLIENT_SECRET=$2
  CODE=$3
  
  curl -s -X POST $MCP_URL/token \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -u "$CLIENT_ID:$CLIENT_SECRET" \
    -d "grant_type=authorization_code&code=$CODE&redirect_uri=http://localhost:8080/callback" | jq
}

# Test SSE connection
mcp_connect() {
  TOKEN=$1
  curl -N $MCP_URL/sse \
    -H "Authorization: Bearer $TOKEN" \
    -H "Accept: text/event-stream"
}

# Call add tool
mcp_add() {
  TOKEN=$1
  SESSION_ID=$2
  A=$3
  B=$4
  
  curl -s -X POST "$MCP_URL/sse/message?sessionId=$SESSION_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"jsonrpc\": \"2.0\",
      \"method\": \"tools/call\",
      \"params\": {
        \"name\": \"add\",
        \"arguments\": {\"a\": $A, \"b\": $B}
      },
      \"id\": 1
    }" | jq
}

echo "MCP test helpers loaded. Available commands:"
echo "  mcp_register              - Register new OAuth client"
echo "  mcp_auth_url CLIENT_ID    - Get authorization URL"
echo "  mcp_token ID SECRET CODE  - Exchange code for token"
echo "  mcp_connect TOKEN         - Test SSE connection"
echo "  mcp_add TOKEN SESSION A B - Call add tool"
