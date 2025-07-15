#!/bin/bash

# Test MCP endpoint with proper JSON-RPC format

BASE_URL="https://rtm-mcp-server.vcto-6e7.workers.dev"

echo "🔍 Testing MCP Endpoint"
echo "======================="
echo ""

echo "1️⃣ Testing initialize (should work without auth):"
echo "Request:"
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{"roots":{"listChanged":true}}},"id":1}'
echo ""
echo "Response:"
curl -s -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{"roots":{"listChanged":true}},"clientInfo":{"name":"test-client","version":"1.0.0"}},"id":1}' | jq .

echo ""
echo "2️⃣ Testing tools/list (should fail without auth):"
echo "Response:"
curl -s -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}' | jq .

echo ""
echo "3️⃣ Testing with Bearer token (if available):"
# Get first token from /debug/tokens
TOKEN=$(curl -s "$BASE_URL/debug/tokens" | jq -r '.tokens[0]?.token_prefix' | sed 's/\.\.\.//')
if [ "$TOKEN" != "null" ] && [ -n "$TOKEN" ]; then
    # Try to find the full token from the prefix
    echo "Found token prefix: $TOKEN..."
    echo "Response:"
    curl -s -X POST "$BASE_URL/mcp" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${TOKEN}" \
      -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":3}' | jq .
else
    echo "No token found in /debug/tokens"
fi

echo ""
echo "4️⃣ Testing raw request body:"
curl -s -X POST "$BASE_URL/debug/mcp-test" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05"},"id":1}' | jq .

echo ""
echo "5️⃣ Testing with verbose output:"
curl -v -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}},"id":1}' 2>&1 | grep -E "(< HTTP|< |> )"