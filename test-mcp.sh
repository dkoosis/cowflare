#!/bin/bash

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo "🚀 Testing MCP Server..."

# 1. Register client
echo -e "\n${GREEN}1. Registering OAuth client...${NC}"
CLIENT_RESPONSE=$(curl -s -X POST http://localhost:8787/register \
  -H "Content-Type: application/json" \
  -d '{
    "redirect_uris": ["http://localhost:8080/callback"]
  }')

CLIENT_ID=$(echo $CLIENT_RESPONSE | jq -r '.client_id')
CLIENT_SECRET=$(echo $CLIENT_RESPONSE | jq -r '.client_secret')

echo "Client ID: $CLIENT_ID"

# 2. Get authorization code (simulated)
echo -e "\n${GREEN}2. Getting authorization code...${NC}"
AUTH_URL="http://localhost:8787/authorize?client_id=$CLIENT_ID&redirect_uri=http://localhost:8080/callback&response_type=code"
echo "Visit: $AUTH_URL"
echo "Using mock auth code for testing..."

# For automated testing, we'll use the mock auth flow
AUTH_CODE="user@example.com:test:mock-auth-code"

# 3. Exchange code for token
echo -e "\n${GREEN}3. Exchanging code for token...${NC}"
TOKEN_RESPONSE=$(curl -s -X POST http://localhost:8787/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d "grant_type=authorization_code&code=$AUTH_CODE&redirect_uri=http://localhost:8080/callback")

ACCESS_TOKEN=$(echo $TOKEN_RESPONSE | jq -r '.access_token')
echo "Access Token: ${ACCESS_TOKEN:0:20}..."

# 4. Connect to SSE
echo -e "\n${GREEN}4. Testing SSE connection...${NC}"
SSE_RESPONSE=$(curl -s -N http://localhost:8787/sse \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Accept: text/event-stream" \
  --max-time 2)

SESSION_ID=$(echo "$SSE_RESPONSE" | grep -o 'sessionId=[^&]*' | cut -d= -f2)
echo "Session ID: $SESSION_ID"

# 5. Test add tool
echo -e "\n${GREEN}5. Testing add tool (5 + 3)...${NC}"
TOOL_RESPONSE=$(curl -s -X POST "http://localhost:8787/sse/message?sessionId=$SESSION_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "add",
      "arguments": {"a": 5, "b": 3}
    },
    "id": 1
  }')

RESULT=$(echo $TOOL_RESPONSE | jq -r '.result.content[0].text')
echo "Result: $RESULT"

if [ "$RESULT" = "8" ]; then
  echo -e "\n${GREEN}✅ All tests passed!${NC}"
else
  echo -e "\n${RED}❌ Test failed!${NC}"
  echo "Response: $TOOL_RESPONSE"
fi
