#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Test MCP connection
async function testMCP() {
  console.log("Testing MCP connection to http://localhost:8787/sse");
  
  try {
    // For now, just test that the endpoint responds
    const response = await fetch("http://localhost:8787/");
    console.log("Home page status:", response.status);
    
    const authResponse = await fetch("http://localhost:8787/authorize");
    console.log("Authorize page status:", authResponse.status);
    
    // Test MCP endpoint (will get 401 without auth)
    const mcpResponse = await fetch("http://localhost:8787/sse", {
      headers: { "Accept": "text/event-stream" }
    });
    console.log("MCP endpoint status:", mcpResponse.status);
    
  } catch (error) {
    console.error("Error:", error);
  }
}

testMCP();
