#!/usr/bin/env node

const SERVER_URL = 'https://rtm-mcp-server.vcto-6e7.workers.dev';

async function testMCPMethod(method, params = {}) {
  const payload = {
    jsonrpc: "2.0",
    id: Date.now(),
    method: method,
    params: params
  };
  
  console.log(`\n🧪 Testing ${method}...`);
  console.log(`📤 Request:`, JSON.stringify(payload, null, 2));
  
  try {
    const response = await fetch(SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MCP-Debug/1.0'
      },
      body: JSON.stringify(payload)
    });
    
    console.log(`📥 Status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log(`❌ Error Response:`, errorText);
      return;
    }
    
    const data = await response.json();
    console.log(`✅ Response:`, JSON.stringify(data, null, 2));
    
    return data;
  } catch (error) {
    console.log(`❌ Network Error:`, error.message);
  }
}

async function debugMCPServer() {
  console.log(`🔍 Debugging MCP Server: ${SERVER_URL}`);
  
  // Test 1: Initialize
  const initResponse = await testMCPMethod('initialize', {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: {
      name: "debug-client",
      version: "1.0.0"
    }
  });
  
  // Test 2: List Tools
  await testMCPMethod('tools/list');
  
  // Test 3: List Resources
  await testMCPMethod('resources/list');
  
  // Test 4: List Prompts  
  await testMCPMethod('prompts/list');
  
  // Test 5: Try authentication tool
  await testMCPMethod('tools/call', {
    name: 'rtm_authenticate',
    arguments: {}
  });
  
  // Test 6: Try invalid method
  await testMCPMethod('invalid/method');
  
  console.log('\n🏁 Debug session complete!');
}

// Run if called directly
if (require.main === module) {
  debugMCPServer().catch(console.error);
}

module.exports = { testMCPMethod, debugMCPServer };