// test/index.spec.ts - Test suite for RTM MCP Server with SDK

import { expect, it, describe, beforeAll, vi } from 'vitest';
import { Env } from '../src/rtm-api';

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

describe('RTM MCP Server v2', () => {
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

  it('handles initialize method correctly', async () => {
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
        },
        capabilities: expect.any(Object)
      }
    });
  });

  it('handles tools/list method correctly', async () => {
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
          }),
          expect.objectContaining({
            name: "rtm_get_lists"
          })
        ])
      }
    });
  });

  it('handles resources/list method correctly', async () => {
    const { default: worker } = await import('../src/index');
    
    const request = new Request('http://localhost:8787/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "resources/list",
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
        resources: expect.arrayContaining([
          expect.objectContaining({
            name: "rtm/user-profile"
          }),
          expect.objectContaining({
            name: "rtm/lists-summary"
          }),
          expect.objectContaining({
            name: "rtm/tags-summary"
          })
        ])
      }
    });
  });

  it('handles prompts/list method correctly', async () => {
    const { default: worker } = await import('../src/index');
    
    const request = new Request('http://localhost:8787/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "prompts/list",
        id: 4
      })
    });
    
    // Mock rate limit check
    (mockEnv.AUTH_STORE.get as any).mockResolvedValueOnce(null);
    (mockEnv.AUTH_STORE.put as any).mockResolvedValueOnce(undefined);
    
    const response = await worker.fetch(request, mockEnv, {} as any);
    const result = await response.json();
    
    expect(result).toMatchObject({
      jsonrpc: "2.0",
      id: 4,
      result: {
        prompts: expect.arrayContaining([
          expect.objectContaining({
            name: "daily_briefing"
          }),
          expect.objectContaining({
            name: "plan_my_day"
          }),
          expect.objectContaining({
            name: "find_and_update_task"
          })
        ])
      }
    });
  });

  it('validates tool arguments correctly', async () => {
    const { default: worker } = await import('../src/index');
    
    const request = new Request('http://localhost:8787/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "rtm_complete_task",
          arguments: {
            // Missing required fields
            auth_token: "test_token"
          }
        },
        id: 5
      })
    });
    
    // Mock rate limit check
    (mockEnv.AUTH_STORE.get as any).mockResolvedValueOnce(null);
    (mockEnv.AUTH_STORE.put as any).mockResolvedValueOnce(undefined);
    
    const response = await worker.fetch(request, mockEnv, {} as any);
    const result = await response.json();
    
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32602);
    expect(result.error.message).toContain("Invalid params");
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
        id: 6
      })
    });
    
    const response = await worker.fetch(request, mockEnv, {} as any);
    
    expect(response.status).toBe(429);
    const result = await response.json();
    expect(result.error.message).toContain("Rate limit exceeded");
  });

  it('handles test_connection tool correctly', async () => {
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
        id: 7
      })
    });
    
    // Mock rate limit check
    (mockEnv.AUTH_STORE.get as any).mockResolvedValueOnce(null);
    (mockEnv.AUTH_STORE.put as any).mockResolvedValueOnce(undefined);
    
    const response = await worker.fetch(request, mockEnv, {} as any);
    const result = await response.json();
    
    expect(result).toMatchObject({
      jsonrpc: "2.0",
      id: 7,
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
    
    const request = new Request('http://localhost:8787/auth/callback?session=test_session');
    const response = await worker.fetch(request, mockEnv, {} as any);
    
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Authentication Successful');
    expect(html).toContain('Test User');
  });
});