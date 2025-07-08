#!/bin/bash
# MCP Server Compliance Test Script
# Run this after deploying your updates to verify MCP spec compliance

# Set your server URL here
SERVER_URL="https://rtm-mcp-server.vcto-6e7.workers.dev"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔍 MCP Server Compliance Test"
echo "Testing server: $SERVER_URL"
echo "================================"

# Test 1: Protected Resource Metadata
echo -e "\n${YELLOW}Test 1: Protected Resource Metadata${NC}"
echo "GET /.well-known/oauth-protected-resource"

RESOURCE_RESPONSE=$(curl -s "$SERVER_URL/.well-known/oauth-protected-resource")
RESOURCE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$SERVER_URL/.well-known/oauth-protected-resource")

if [ "$RESOURCE_STATUS" = "200" ]; then
    echo -e "${GREEN}✓ Status: 200 OK${NC}"
    
    # Check required fields
    if echo "$RESOURCE_RESPONSE" | jq -e '.resource' > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Has 'resource' field${NC}"
    else
        echo -e "${RED}✗ Missing 'resource' field${NC}"
    fi
    
    if echo "$RESOURCE_RESPONSE" | jq -e '.authorization_servers' > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Has 'authorization_servers' field${NC}"
    else
        echo -e "${RED}✗ Missing 'authorization_servers' field${NC}"
    fi
    
    echo "Response:"
    echo "$RESOURCE_RESPONSE" | jq '.' 2>/dev/null || echo "$RESOURCE_RESPONSE"
else
    echo -e "${RED}✗ Status: $RESOURCE_STATUS (expected 200)${NC}"
fi

# Test 2: Authorization Server Metadata
echo -e "\n${YELLOW}Test 2: Authorization Server Metadata${NC}"
echo "GET /.well-known/oauth-authorization-server"

AUTH_RESPONSE=$(curl -s "$SERVER_URL/.well-known/oauth-authorization-server")
AUTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$SERVER_URL/.well-known/oauth-authorization-server")

if [ "$AUTH_STATUS" = "200" ]; then
    echo -e "${GREEN}✓ Status: 200 OK${NC}"
    
    # Check required fields
    REQUIRED_FIELDS=("issuer" "authorization_endpoint" "token_endpoint" "response_types_supported" "grant_types_supported")
    
    for field in "${REQUIRED_FIELDS[@]}"; do
        if echo "$AUTH_RESPONSE" | jq -e ".$field" > /dev/null 2>&1; then
            echo -e "${GREEN}✓ Has '$field' field${NC}"
        else
            echo -e "${RED}✗ Missing '$field' field${NC}"
        fi
    done
else
    echo -e "${RED}✗ Status: $AUTH_STATUS (expected 200)${NC}"
fi

# Test 3: MCP Endpoint Without Auth
echo -e "\n${YELLOW}Test 3: MCP Endpoint Without Authentication${NC}"
echo "GET /mcp (no auth header)"

MCP_HEADERS=$(curl -s -I "$SERVER_URL/mcp")
MCP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$SERVER_URL/mcp")
WWW_AUTH=$(echo "$MCP_HEADERS" | grep -i "www-authenticate:" || echo "")

if [ "$MCP_STATUS" = "401" ]; then
    echo -e "${GREEN}✓ Status: 401 Unauthorized${NC}"
    
    if [ -n "$WWW_AUTH" ]; then
        echo -e "${GREEN}✓ Has WWW-Authenticate header${NC}"
        echo "  $WWW_AUTH"
        
        # Check for required components
        if echo "$WWW_AUTH" | grep -q "resource_metadata="; then
            echo -e "${GREEN}✓ Contains 'resource_metadata' parameter${NC}"
        else
            echo -e "${RED}✗ Missing 'resource_metadata' parameter${NC}"
        fi
        
        if echo "$WWW_AUTH" | grep -q "Bearer"; then
            echo -e "${GREEN}✓ Uses Bearer scheme${NC}"
        else
            echo -e "${RED}✗ Wrong auth scheme (expected Bearer)${NC}"
        fi
    else
        echo -e "${RED}✗ Missing WWW-Authenticate header${NC}"
    fi
else
    echo -e "${RED}✗ Status: $MCP_STATUS (expected 401)${NC}"
fi

# Test 4: MCP Endpoint With Invalid Token
echo -e "\n${YELLOW}Test 4: MCP Endpoint With Invalid Token${NC}"
echo "GET /mcp (invalid bearer token)"

INVALID_RESPONSE=$(curl -s "$SERVER_URL/mcp" -H "Authorization: Bearer invalid-token-12345")
INVALID_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$SERVER_URL/mcp" -H "Authorization: Bearer invalid-token-12345")
INVALID_HEADERS=$(curl -s -I "$SERVER_URL/mcp" -H "Authorization: Bearer invalid-token-12345")
INVALID_WWW_AUTH=$(echo "$INVALID_HEADERS" | grep -i "www-authenticate:" || echo "")

if [ "$INVALID_STATUS" = "401" ]; then
    echo -e "${GREEN}✓ Status: 401 Unauthorized${NC}"
    
    if [ -n "$INVALID_WWW_AUTH" ]; then
        echo -e "${GREEN}✓ Has WWW-Authenticate header${NC}"
        
        if echo "$INVALID_WWW_AUTH" | grep -q "error=\"invalid_token\""; then
            echo -e "${GREEN}✓ Contains error=\"invalid_token\"${NC}"
        else
            echo -e "${YELLOW}⚠ Missing error=\"invalid_token\" in WWW-Authenticate${NC}"
        fi
    else
        echo -e "${RED}✗ Missing WWW-Authenticate header${NC}"
    fi
    
    # Check error response body
    if echo "$INVALID_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Has JSON error response${NC}"
        echo "  Response: $INVALID_RESPONSE"
    else
        echo -e "${YELLOW}⚠ Response may not be proper JSON error format${NC}"
    fi
else
    echo -e "${RED}✗ Status: $INVALID_STATUS (expected 401)${NC}"
fi

# Test 5: CORS Headers
echo -e "\n${YELLOW}Test 5: CORS Support${NC}"
echo "OPTIONS /mcp"

CORS_RESPONSE=$(curl -s -I -X OPTIONS "$SERVER_URL/mcp" -H "Origin: https://claude.ai")
if echo "$CORS_RESPONSE" | grep -qi "access-control-allow-origin"; then
    echo -e "${GREEN}✓ CORS headers present${NC}"
    echo "$CORS_RESPONSE" | grep -i "access-control-" | sed 's/^/  /'
else
    echo -e "${YELLOW}⚠ No CORS headers found${NC}"
fi

# Summary
echo -e "\n${YELLOW}================================${NC}"
echo "📊 Compliance Summary"
echo -e "${YELLOW}================================${NC}"

echo -e "\nRequired MCP Spec Elements:"
echo "1. Protected Resource Metadata endpoint - Check above"
echo "2. WWW-Authenticate header on 401 - Check above"
echo "3. Bearer token in Authorization header - Implementation verified"
echo "4. Proper error responses - Check above"

echo -e "\n💡 Next Steps:"
echo "1. Fix any ✗ (failed) items above"
echo "2. Test OAuth flow end-to-end with Claude.ai"
echo "3. Monitor debug logs during connection"

echo -e "\n📝 Debug URL: $SERVER_URL/debug"