#!/bin/bash

# RTM MCP Server Endpoint Test Script
# Tests all available endpoints and reports status

BASE_URL="https://rtm-mcp-server.vcto-6e7.workers.dev"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🧪 Testing RTM MCP Server Endpoints"
echo "=================================="
echo "Base URL: $BASE_URL"
echo ""

# Function to test endpoint
test_endpoint() {
    local method=$1
    local path=$2
    local description=$3
    local extra_args="${4:-}"
    
    echo -n "Testing $method $path - $description... "
    
    response=$(curl -s -o /dev/null -w "%{http_code}" -X $method "$BASE_URL$path" $extra_args)
    
    if [[ $response == 200 ]]; then
        echo -e "${GREEN}✓ $response${NC}"
    elif [[ $response == 302 ]] || [[ $response == 303 ]]; then
        echo -e "${YELLOW}↻ $response (redirect)${NC}"
    else
        echo -e "${RED}✗ $response${NC}"
    fi
}

# Function to test endpoint with response body
test_endpoint_body() {
    local method=$1
    local path=$2
    local description=$3
    
    echo ""
    echo "📋 Testing $method $path - $description"
    echo "Response:"
    curl -s "$BASE_URL$path" | head -20
    echo ""
}

# Basic health checks
echo "🏥 Health Checks"
echo "----------------"
test_endpoint "GET" "/" "Root endpoint"
test_endpoint "GET" "/health" "Basic health check (if exists)"
test_endpoint "GET" "/auth/health" "Auth health check"

echo ""
echo "🔍 Debug Endpoints"
echo "------------------"
test_endpoint "GET" "/debug" "Debug dashboard"
test_endpoint "GET" "/debug/tokens" "Debug tokens"

echo ""
echo "🔐 OAuth Endpoints (under /auth)"
echo "----------------------------------"
test_endpoint "GET" "/auth/authorize" "OAuth authorize"
test_endpoint "GET" "/auth/complete-auth" "Complete auth flow"
test_endpoint "POST" "/auth/token" "Token exchange" "-d 'grant_type=authorization_code&code=test'"
test_endpoint "POST" "/auth/introspect" "Token introspection" "-d 'token=test'"
test_endpoint "GET" "/auth/userinfo" "User info" "-H 'Authorization: Bearer test'"

echo ""
echo "🤖 MCP Protocol Endpoint"
echo "------------------------"
# Test MCP initialize request
test_endpoint "POST" "/mcp" "MCP initialize" \
    "-H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{\"roots\":{\"listChanged\":true}}},\"id\":1}'"

# Test MCP with Bearer token
test_endpoint "POST" "/mcp" "MCP with auth" \
    "-H 'Content-Type: application/json' -H 'Authorization: Bearer test-token' -d '{\"jsonrpc\":\"2.0\",\"method\":\"tools/list\",\"params\":{},\"id\":2}'"

echo ""
echo "📄 Response Body Samples"
echo "------------------------"
test_endpoint_body "GET" "/health" "Health response"
test_endpoint_body "GET" "/debug/tokens" "Tokens response"

echo ""
echo "🔍 MCP Inspector Test Command"
echo "-----------------------------"
echo "To test with MCP Inspector, run:"
echo "npx @modelcontextprotocol/inspector --url $BASE_URL/mcp"
echo ""

# Check if deployment info is available
echo "🚀 Deployment Info"
echo "------------------"
deployment_info=$(curl -s "$BASE_URL/debug" | grep -o 'Deployment:.*' | head -1)
if [[ ! -z "$deployment_info" ]]; then
    echo "$deployment_info"
else
    echo "Could not retrieve deployment info"
fi