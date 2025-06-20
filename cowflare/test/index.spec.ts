import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('RTM MCP Server', () => {
  it('responds with correct server version (unit style)', async () => {
    const request = new IncomingRequest('http://example.com');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(await response.text()).toMatchInlineSnapshot(`"RTM MCP Server v1.1.0"`);
  });

  it('responds with correct server version (integration style)', async () => {
    const response = await SELF.fetch('https://example.com');
    expect(await response.text()).toMatchInlineSnapshot(`"RTM MCP Server v1.1.0"`);
  });

  it('returns correct server information on initialize', async () => {
    const request = new IncomingRequest('http://example.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
        id: 1
      })
    });
    
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    
    const result = await response.json();
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: {
          name: "rtm-mcp-server",
          version: "1.1.0"
        },
        capabilities: {
          tools: {}
        }
      }
    });
  });

  it('handles rtm_get_lists tool with valid input', async () => {
    const request = new IncomingRequest('http://example.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "rtm_get_lists",
          arguments: {
            auth_token: "valid_token_123"
          }
        },
        id: 2
      })
    });
    
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    
    const result = await response.json();
    
    // Should return an error due to invalid auth token, but structure should be correct
    expect(result.jsonrpc).toBe("2.0");
    expect(result.id).toBe(2);
    expect(result.error).toBeDefined();
    expect(result.error.message).toContain("RTM API Error");
  });

  it('validates rtm_get_lists tool arguments and rejects missing auth_token', async () => {
    const request = new IncomingRequest('http://example.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "rtm_get_lists",
          arguments: {} // Missing auth_token
        },
        id: 3
      })
    });
    
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    
    const result = await response.json();
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32602); // Validation error
    expect(result.error.message).toContain("auth_token");
  });

  it('handles rtm_add_task tool with valid input', async () => {
    const request = new IncomingRequest('http://example.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "rtm_add_task",
          arguments: {
            auth_token: "valid_token_123",
            timeline: "timeline_123",
            name: "Test task"
          }
        },
        id: 4
      })
    });
    
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    
    const result = await response.json();
    
    // Should return an error due to invalid auth token, but structure should be correct
    expect(result.jsonrpc).toBe("2.0");
    expect(result.id).toBe(4);
    expect(result.error).toBeDefined();
    expect(result.error.message).toContain("RTM API Error");
  });

  it('validates rtm_add_task tool arguments and rejects missing required fields', async () => {
    const request = new IncomingRequest('http://example.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "rtm_add_task",
          arguments: {
            auth_token: "valid_token_123"
            // Missing timeline and name
          }
        },
        id: 5
      })
    });
    
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    
    const result = await response.json();
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32602); // Validation error
    expect(result.error.message).toContain("required");
  });

  it('handles rtm_complete_task tool with valid input', async () => {
    const request = new IncomingRequest('http://example.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "rtm_complete_task",
          arguments: {
            auth_token: "valid_token_123",
            timeline: "timeline_123",
            list_id: "list_123",
            taskseries_id: "series_123",
            task_id: "task_123"
          }
        },
        id: 6
      })
    });
    
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    
    const result = await response.json();
    
    // Should return an error due to invalid auth token, but structure should be correct
    expect(result.jsonrpc).toBe("2.0");
    expect(result.id).toBe(6);
    expect(result.error).toBeDefined();
    expect(result.error.message).toContain("RTM API Error");
  });

  it('validates rtm_complete_task tool arguments and rejects missing IDs', async () => {
    const request = new IncomingRequest('http://example.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "rtm_complete_task",
          arguments: {
            auth_token: "valid_token_123",
            timeline: "timeline_123"
            // Missing list_id, taskseries_id, task_id
          }
        },
        id: 7
      })
    });
    
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    
    const result = await response.json();
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32602); // Validation error
    expect(result.error.message).toContain("required");
  });

  it('handles unknown tools with proper error', async () => {
    const request = new IncomingRequest('http://example.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "unknown_tool",
          arguments: {}
        },
        id: 8
      })
    });
    
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    
    const result = await response.json();
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32602); // Validation error
    expect(result.error.message).toContain("Unknown tool");
  });

  it('handles rate limiting correctly', async () => {
    // This test would need to be expanded with actual rate limit testing
    // For now, just verify the structure works
    const request = new IncomingRequest('http://example.com', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '192.168.1.1'
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
        id: 9
      })
    });
    
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    
    expect(response.status).toBe(200);
  });

  it('handles health check endpoint', async () => {
    const request = new IncomingRequest('http://example.com/health');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe('healthy');
    expect(result.timestamp).toBeDefined();
  });
});