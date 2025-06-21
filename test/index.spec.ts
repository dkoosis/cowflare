// test/index.spec.ts - Updated test suite for refactored RTM MCP Server

import { expect, it, describe, beforeAll, vi } from 'vitest';
import { Env } from '../src/rtm-api';

// Mock the MCP SDK's createFetchHandler
vi.mock('@modelcontextprotocol/sdk/server/http.js', () => ({
  createFetchHandler: vi.fn((server: any) => {
    return async (request: Request, context: { env: Env }) => {
      const body = await request.json();
      
      // Simulate server response based on method
      if (body.method === 'initialize') {
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2024-11-05",
            serverInfo: {
              name: "rtm-mcp-server",
              version: "2.0.0"
            },
            capabilities: {
              tools: {},
              resources: {},
              prompts: {}
            }
          }
        });
      }
      
      if (body.method === 'tools/list') {
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [
              { name: "test_connection", description: "Test connection", inputSchema: {} },
              { name: "rtm_authenticate", description: "Authenticate", inputSchema: {} },
              { name: "rtm_get_lists", description: "Get lists", inputSchema: {} }
            ]
          }
        });
      }
      
      if (body.method === 'tools/call' && body.params.name === 'test_connection') {
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [{
              type: "text",
              text: "✅ MCP Server Connection Test\n\nStatus: healthy"
            }]
          }
        });
      }
      
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        error: {
          code: -32601,
          message: "Method not found"
        }
      });
    };
  })
}));

// Mock the Cloudflare Worker environment
const mockEnv: Env = {
  RTM_API_KEY: 'test_api_key',
  RTM_SHARED_SECRET: 'test_secret',
  SERVER_URL: 'http://localhost:8787',
  AUTH_STORE: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn()
  } as any
};

// Mock fetch for RTM API calls
global.fetch = vi.fn();

describe('RTM MCP Server v2 - Refactored', () => {
  beforeAll(() => {
    vi.clearAllMocks();
  });

  it('responds with correct version for GET requests', async () => {
    const { default: worker } = await import('../src/index');
    
    const request = new Request('http://localhost:8787/');
    const response = await worker.fetch(request, mockEnv, {} as any);
    
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe('RTM MCP Server v2.0.0 (SDK Version)');
  });

  it('handles health check endpoint', async () => {
    const { default: worker } = await import('../src/index');
    
    const request = new Request('http://localhost:8787/health');
    const response = await worker.fetch(request, mockEnv, {} as any);
    
    expect(response.status).toBe(200);
    const result = await response.json();
    
    expect(result).toMatchObject({
      status: 'healthy',
      timestamp: expect.any(String),
      version: '2.0.0',
      kv_connected: true,
      env_configured: true
    });
  });

  it('handles CORS preflight requests', async () => {
    const { default: worker } = await import('../src/index');
    
    const request = new Request('http://localhost:8787/', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type'
      }
    });
    
    const response = await worker.fetch(request, mockEnv, {} as any);
    
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('handles initialize method through MCP handler', async () => {
    const { default: worker } = await import('../src/index');
    
    const request = new Request('http://localhost:8787/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        id: 1
      })
    });
    
    // Mock rate limit check to pass
    (mockEnv.AUTH_STORE.get as any).mockResolvedValueOnce(null);
    (mockEnv.AUTH_STORE.put as any).mockResolvedValueOnce(undefined);
    
    const response = await worker.fetch(request, mockEnv, {} as any);
    const result = await response.json();
    
    expect(result).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: expect.any(String),
        serverInfo: {
          name: "rtm-mcp-server",
          version: "2.0.0"
        }
      }
    });
  });

  it('handles tools/list method', async () => {
    const { default: worker } = await import('../src/index');
    
    const request = new Request('http://localhost:8787/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/list",
        id: 2
      })
    });
    
    // Mock rate limit check
    (mockEnv.AUTH_STORE.get as any).mockResolvedValueOnce(null);
    (mockEnv.AUTH_STORE.put as any).mockResolvedValueOnce(undefined);
    
    const response = await worker.fetch(request, mockEnv, {} as any);
    const result = await response.json();
    
    expect(result).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: "test_connection"
          }),
          expect.objectContaining({
            name: "rtm_authenticate"
          })
        ])
      }
    });
  });

  it('handles test_connection tool call', async () => {
    const { default: worker } = await import('../src/index');
    
    const request = new Request('http://localhost:8787/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "test_connection",
          arguments: {}
        },
        id: 3
      })
    });
    
    // Mock rate limit check
    (mockEnv.AUTH_STORE.get as any).mockResolvedValueOnce(null);
    (mockEnv.AUTH_STORE.put as any).mockResolvedValueOnce(undefined);
    
    const response = await worker.fetch(request, mockEnv, {} as any);
    const result = await response.json();
    
    expect(result).toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      result: {
        content: expect.arrayContaining([
          expect.objectContaining({
            type: "text",
            text: expect.stringContaining("healthy")
          })
        ])
      }
    });
  });

  it('handles rate limiting correctly', async () => {
    const { default: worker } = await import('../src/index');
    
    // Mock rate limit exceeded
    (mockEnv.AUTH_STORE.get as any).mockResolvedValueOnce({
      count: 100,
      resetAt: Date.now() + 60000
    });
    
    const request = new Request('http://localhost:8787/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        id: 4
      })
    });
    
    const response = await worker.fetch(request, mockEnv, {} as any);
    
    expect(response.status).toBe(429);
    const result = await response.json();
    expect(result.error.message).toContain("Rate limit exceeded");
  });

  it('handles OAuth callback correctly', async () => {
    const { default: worker } = await import('../src/index');
    
    // Mock pending auth
    (mockEnv.AUTH_STORE.get as any).mockResolvedValueOnce({
      frob: 'test_frob',
      created_at: Date.now()
    });
    
    // Mock RTM API response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        rsp: {
          stat: 'ok',
          auth: {
            token: 'test_token',
            user: {
              id: 'user123',
              username: 'testuser',
              fullname: 'Test User'
            }
          }
        }
      })
    });
    
    // Mock cache operations
    (mockEnv.AUTH_STORE.put as any).mockResolvedValueOnce(undefined);
    (mockEnv.AUTH_STORE.delete as any).mockResolvedValueOnce(undefined);
    
    const request = new Request('http://localhost:8787/auth/callback?session=test_session');
    const response = await worker.fetch(request, mockEnv, {} as any);
    
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Authentication Successful');
    expect(html).toContain('Test User');
  });

  it('handles invalid OAuth callback session', async () => {
    const { default: worker } = await import('../src/index');
    
    // Mock no pending auth found
    (mockEnv.AUTH_STORE.get as any).mockResolvedValueOnce(null);
    
    const request = new Request('http://localhost:8787/auth/callback?session=invalid_session');
    const response = await worker.fetch(request, mockEnv, {} as any);
    
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toContain('Session expired or invalid');
  });

  it('handles internal server errors gracefully', async () => {
    const { default: worker } = await import('../src/index');
    
    // Mock an error in rate limit check
    (mockEnv.AUTH_STORE.get as any).mockRejectedValueOnce(new Error('KV Store error'));
    
    const request = new Request('http://localhost:8787/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        id: 5
      })
    });
    
    const response = await worker.fetch(request, mockEnv, {} as any);
    
    expect(response.status).toBe(500);
    const result = await response.json();
    expect(result.error.message).toBe('Internal server error');
  });
});