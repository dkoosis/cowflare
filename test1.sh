#!/bin/bash

# MCP Server Connection Test Script
# Replace YOUR_WORKER_URL with your actual Cloudflare Worker URL

WORKER_URL="https://cowflare.vcto-6e7.workers.dev"

echo "Testing MCP Server at: $WORKER_URL"
echo "================================"

# Test 1: Basic connectivity
echo -e "\n1. Testing basic connectivity..."
curl -s "$WORKER_URL" || echo "Failed to connect"

# Test 2: Health endpoint
echo -e "\n\n2. Testing health endpoint..."
curl -s "$WORKER_URL/health" | jq . || echo "Health check failed"

# Test 3: OPTIONS request (CORS preflight)
echo -e "\n\n3. Testing CORS preflight..."
curl -s -X OPTIONS "$WORKER_URL" \
  -H "Origin: http://localhost" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type" \
  -v 2>&1 | grep -E "(< HTTP|< Access-Control)"

# Test 4: Initialize method
echo -e "\n\n4. Testing initialize method..."
curl -s -X POST "$WORKER_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {},
    "id": 1
  }' | jq .

# Test 5: List tools
echo -e "\n\n5. Testing tools/list..."
curl -s -X POST "$WORKER_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "params": {},
    "id": 2
  }' | jq '.result.tools | length' | xargs -I {} echo "Found {} tools"

# Test 6: Connection test tool
echo -e "\n\n6. Testing connection diagnostic tool..."
curl -s -X POST "$WORKER_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "test_connection",
      "arguments": {}
    },
    "id": 3
  }' | jq .

# Test 7: Invalid request (should return proper error)
echo -e "\n\n7. Testing error handling..."
curl -s -X POST "$WORKER_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "invalid/method",
    "params": {},
    "id": 4
  }' | jq .

echo -e "\n\nTest complete!"