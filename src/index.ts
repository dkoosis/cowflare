/**
 * @file src/index.ts
 * @description Main entry point for the Cowflare RTM MCP worker.
 * This file sets up the Hono web server, configures middleware for logging and
 * CORS, and defines all the necessary routes for the MCP protocol,
 * authentication, health checks, and debugging.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { RtmMCP } from './rtm-mcp';
import { withDebugLogging, DebugLogger, createDebugDashboard } from './debug-logger';
import { createRtmHandler } from './rtm-handler';
import type { Env } from './types';
import type { DebugEvent } from './debug-logger';

// --- Constants and Configuration ---

/**
 * A type definition for Hono's context variables, ensuring type safety
 * for custom middleware values like the debug logger.
 */
type Variables = {
  debugLogger: DebugLogger;
  debugSessionId: string;
};

/**
 * Generates a memorable, human-readable name for each deployment instance
 * based on the current time, aiding in identifying specific worker versions.
 * @returns A string in the format "adjective-animal".
 */
const generateDeploymentName = (): string => {
  const adjectives = ['swift', 'bright', 'calm', 'bold', 'wise', 'clean', 'sharp', 'quick', 'brave', 'clear', 'fresh', 'cool', 'smart', 'strong', 'kind', 'gentle', 'happy', 'lively', 'neat', 'eager', 'zesty', 'vivid', 'radiant', 'charming', 'graceful'];
  const animals = ['Holstein', 'Jersey', 'Angus', 'Guernsey', 'milk', 'butter', 'cheese', 'cream', 'moo', 'Elsie', 'Clarabelle', 'Ayrshire', 'Brown Swiss', 'Hereford', 'Wagyu', 'Babe the Blue Ox', 'Ferdinand', 'Minnie Moo', 'Pauline Wayne', "Mrs. O'Leary", 'Simmental'];
  const now = Date.now();
  const adjIndex = Math.floor((now / 1000) % adjectives.length);
  const animalIndex = Math.floor((now / 100000) % animals.length);
  return `${adjectives[adjIndex]}-${animals[animalIndex]}`;
};

let deploymentName: string | null = null;
let deploymentTime: string | null = null;

const getDeploymentInfo = () => {
  // Only generate the name and time on the first call
  if (!deploymentName || !deploymentTime) {
    deploymentName = generateDeploymentName();
    deploymentTime = new Date().toISOString();
    console.log(`🚀 Initialized Deployment: ${deploymentName} at ${deploymentTime}`);
  }
  return { deploymentName, deploymentTime };
};

// --- Hono App Initialization ---

/**
 * The main Hono application instance.
 * It's typed with the environment bindings (`Env`) and custom variables (`Variables`)
 * to provide end-to-end type safety.
 */
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// --- Middleware Configuration ---

// Apply the debug logging middleware to all incoming requests.
app.use('*', withDebugLogging);

// Apply CORS middleware to allow requests from authorized origins like Claude.ai.
app.use('*', cors({
  origin: ['http://localhost:*', 'https://*.claude.ai', 'https://claude.ai'],
  credentials: true,
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id'],
  exposeHeaders: ['Mcp-Session-Id', 'Location']
}));

// --- Route Definitions ---

/**
 * Mounts the RTM-specific authentication handler, which provides the
 * necessary endpoints for our custom, non-OAuth authentication flow.
 */
const rtmHandler = createRtmHandler();
app.route('/', rtmHandler);

/**
 * MCP (Model Context Protocol) Handler
 * This is the core of the worker, handling all communication with the MCP client.
 * It uses `serve` to correctly implement the streaming transport
 * required by the protocol.
 */
const mcpHandler = RtmMCP.serve('/mcp', {
    binding: 'MCP_OBJECT', // The name of the Durable Object binding in wrangler.toml
    corsOptions: {
        origin: 'http://localhost:*, https://*.claude.ai, https://claude.ai',
        methods: 'GET, POST, OPTIONS',
        headers: 'Content-Type, Authorization, Mcp-Session-Id',
        exposeHeaders: 'Mcp-Session-Id, Location'
    }
});

/**
 * The MCP route endpoint. All requests to `/mcp/*` are forwarded to the
 * McpAgent's fetch handler, which manages the connection lifecycle.
 */
// In src/index.ts, update the MCP handler section (around line 40-60)

// MCP endpoint - this is what Claude.ai connects to after OAuth
app.all('/mcp', async (c) => {
  const logger = c.get('debugLogger');
  
  // Log all MCP requests for debugging
  await logger.log('mcp_request', {
    method: c.req.method,
    headers: Object.fromEntries(c.req.raw.headers.entries()),
    url: c.req.url,
    hasAuth: !!c.req.header('Authorization')
  });
  
  // Extract token from Authorization header
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    await logger.log('mcp_no_auth', {
      authHeader: authHeader || 'none'
    });
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  const token = authHeader.substring(7);
  
  // Verify token exists in our store
  const tokenDataJSON = await c.env.AUTH_STORE.get(`token:${token}`);
  if (!tokenDataJSON) {
    await logger.log('mcp_invalid_token', {
      token_prefix: token.substring(0, 8)
    });
    return c.json({ error: 'Invalid token' }, 401);
  }
  
  const tokenData = JSON.parse(tokenDataJSON);
  
  await logger.log('mcp_token_valid', {
    userId: tokenData.userId,
    userName: tokenData.userName,
    token_prefix: token.substring(0, 8)
  });
  
  // Create Durable Object ID from token
  const doId = c.env.RTM_MCP.idFromName(token);
  const stub = c.env.RTM_MCP.get(doId, {
    locationHint: 'enam'
  });
  
  // Pass the auth data as props to the Durable Object
  const doRequest = new Request(c.req.raw, {
    headers: new Headers(c.req.raw.headers)
  });
  
  // Add auth data to headers so DO can access it
  doRequest.headers.set('X-RTM-Token', token);
  doRequest.headers.set('X-RTM-UserId', tokenData.userId);
  doRequest.headers.set('X-RTM-UserName', tokenData.userName);
  
  await logger.log('mcp_forwarding_to_do', {
    doId: doId.toString(),
    hasToken: !!token,
    userName: tokenData.userName
  });
  
  try {
    // Forward to Durable Object
    const response = await stub.fetch(doRequest);
    
    await logger.log('mcp_do_response', {
      status: response.status,
      contentType: response.headers.get('content-type'),
      hasBody: response.headers.get('content-length') !== '0'
    });
    
    return response;
  } catch (error) {
    await logger.log('mcp_do_error', {
      error: error instanceof Error ? error.message : String(error)
    });
    
    return c.json({
      error: 'MCP server error',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

/**
 * The debug dashboard endpoint.
 * Provides a web interface to view live logs and transaction history.
 */
app.get('/debug', (c) => {
  // Get the lazily-initialized deployment info
  const { deploymentName, deploymentTime } = getDeploymentInfo();
  // Pass deployment info to the dashboard for display in the banner.
  return createDebugDashboard(deploymentName, deploymentTime)(c);
});

// Add this route to src/index.ts after the existing /debug route

/**
 * Debug endpoint to view ALL logs (not just OAuth flows)
 * Temporary endpoint for debugging
 */
// Add this route to src/index.ts after the existing /debug route

/**
 * Debug endpoint to view ALL logs (not just OAuth flows)
 * Temporary endpoint for debugging
 */
// Then update the /debug/all endpoint to be simpler:
app.get('/debug/all', async (c) => {
  const { DebugLogger } = await import('./debug-logger');
  const logs = await DebugLogger.getRecentLogs(c.env, 50); // Get last 50 logs
  
  // Group by session ID
  const grouped = logs.reduce((acc, log) => {
    if (!acc[log.sessionId]) {
      acc[log.sessionId] = [];
    }
    acc[log.sessionId].push(log);
    return acc;
  }, {} as Record<string, DebugEvent[]>);
  
  return c.json({
    total: logs.length,
    sessions: Object.keys(grouped).length,
    logs: grouped
  });
});

/**
 * The health check endpoint.
 * Provides metadata about the running service, including its version, deployment
 * name, and a check of which McpAgent methods are available.
 */
app.get('/health', (c) => {
  // Get the lazily-initialized deployment info
  const { deploymentName, deploymentTime } = getDeploymentInfo();

  const mcpMethods = {
    hasServe: typeof (RtmMCP as any).serve === 'function',
    hasServeSSE: typeof (RtmMCP as any).serveSSE === 'function',
    hasMount: typeof (RtmMCP as any).mount === 'function',
    hasFetch: typeof (RtmMCP as any).fetch === 'function'
  };
  
  return c.json({ 
    status: 'ok',
    service: 'rtm-mcp-server',
    version: '2.5.0',
    deployment_name: deploymentName,
    transport: 'streamable-http',
    mcp_compliant: mcpMethods.hasServe, // Dynamically check compliance
    deployed_at: deploymentTime,
    mcp_methods: mcpMethods
  });
});

/**
 * Debug log deletion endpoint.
 * Handles deletion of debug logs for specified session IDs.
 */
app.post('/debug/delete', async (c) => {
  try {
    const { sessionIds } = await c.req.json();
    
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
      return c.json({ error: 'Invalid request body - sessionIds must be a non-empty array' }, 400);
    }
    
    // Call the static method from DebugLogger
    const result = await DebugLogger.deleteFlowLogs(c.env, sessionIds);
    
    // Log the deletion action
    const logger = c.get('debugLogger');
    await logger.log('debug_flows_deleted', {
      sessionIds,
      deletedCount: result.deleted
    });
    
    return c.json(result);
  } catch (e) {
    console.error('Failed to delete logs:', e);
    return c.json({ error: 'Failed to delete logs' }, 500);
  }
});

// Add this to src/index.ts after other routes

/**
 * Test endpoint to verify logging is working
 */
app.get('/test-log', async (c) => {
  const logger = c.get('debugLogger');
  const sessionId = c.get('debugSessionId');
  
  // Log a test event
  await logger.log('test_manual_log', {
    test: true,
    timestamp: new Date().toISOString(),
    sessionId: sessionId,
    message: 'Manual test log entry'
  });
  
  return c.json({
    message: 'Test log created',
    sessionId: sessionId,
    timestamp: new Date().toISOString()
  });
});

// Add this to src/index.ts after other routes

/**
 * Debug endpoint to check KV storage directly
 */
app.get('/debug/kv', async (c) => {
  try {
    // List all keys with debug prefix
    const debugList = await c.env.AUTH_STORE.list({ prefix: 'debug:', limit: 10 });
    
    // Get a few sample values
    const samples: any[] = [];
    for (const key of debugList.keys.slice(0, 3)) {
      const value = await c.env.AUTH_STORE.get(key.name);
      if (value) {
        samples.push({
          key: key.name,
          data: JSON.parse(value)
        });
      }
    }
    
    return c.json({
      totalKeys: debugList.keys.length,
      complete: debugList.list_complete,
      keys: debugList.keys.map(k => k.name),
      samples: samples
    });
  } catch (error) {
    return c.json({
      error: 'Failed to read KV',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Add this to src/index.ts after the /debug/kv endpoint

/**
 * Debug endpoint to check token storage
 */
app.get('/debug/tokens', async (c) => {
  try {
    // List all token keys
    const tokenList = await c.env.AUTH_STORE.list({ prefix: 'token:', limit: 100 });
    
    // Get sample token data
    const samples: any[] = [];
    for (const key of tokenList.keys.slice(0, 5)) {
      const value = await c.env.AUTH_STORE.get(key.name);
      if (value) {
        const data = JSON.parse(value);
        samples.push({
          key: key.name,
          token_prefix: key.name.split(':')[1]?.substring(0, 8) + '...',
          data: {
            ...data,
            // Redact sensitive info
            userName: data.userName,
            userId: data.userId,
            client_id: data.client_id,
            created_at: data.created_at,
            age_minutes: Math.floor((Date.now() - data.created_at) / 60000)
          }
        });
      }
    }
    
    // Also check for auth codes
    const codeList = await c.env.AUTH_STORE.list({ prefix: 'auth_code:', limit: 10 });
    
    return c.json({
      tokens: {
        total: tokenList.keys.length,
        complete: tokenList.list_complete,
        keys: tokenList.keys.map(k => k.name.replace(/token:(.{8}).*/, 'token:$1...')),
        samples
      },
      auth_codes: {
        total: codeList.keys.length,
        complete: codeList.list_complete,
        keys: codeList.keys.map(k => k.name)
      }
    });
  } catch (error) {
    return c.json({
      error: 'Failed to read tokens',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Add this endpoint to src/index.ts after the existing debug endpoints

/**
 * Emergency cleanup endpoint for when KV limits are hit
 * Deletes old debug logs while preserving recent auth data
 */
app.get('/debug/cleanup', async (c) => {
  try {
    const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
    let deletedCount = 0;
    
    // List all debug entries
    const debugList = await c.env.AUTH_STORE.list({ prefix: 'debug:', limit: 1000 });
    
    for (const key of debugList.keys) {
      // Extract timestamp from key: debug:${timestamp}_${sessionId}_${event}
      const parts = key.name.split(':')[1]?.split('_');
      if (parts && parts[0]) {
        const timestamp = parseInt(parts[0]);
        
        // Delete if older than cutoff
        if (timestamp < cutoffTime) {
          await c.env.AUTH_STORE.delete(key.name);
          deletedCount++;
        }
      }
    }
    
    // Also clean up old protocol logs
    const protocolList = await c.env.AUTH_STORE.list({ prefix: 'protocol:', limit: 500 });
    for (const key of protocolList.keys) {
      // Protocol logs can be more aggressively cleaned
      await c.env.AUTH_STORE.delete(key.name);
      deletedCount++;
    }
    
    return c.json({
      success: true,
      deleted: deletedCount,
      message: `Deleted ${deletedCount} old log entries`,
      cutoff: new Date(cutoffTime).toISOString()
    });
  } catch (error) {
    return c.json({
      error: 'Cleanup failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Add these to src/index.ts to debug the MCP connection

// Check what tokens we have and their MCP status
app.get('/debug/tokens', async (c) => {
  const list = await c.env.AUTH_STORE.list({ prefix: 'token:' });
  const tokens = [];
  
  for (const key of list.keys) {
    const data = await c.env.AUTH_STORE.get(key.name);
    if (data) {
      const tokenData = JSON.parse(data);
      tokens.push({
        token_prefix: key.name.substring(6, 14) + '...',
        ...tokenData,
        mcp_url: `${c.env.SERVER_URL || `https://${c.req.header('host')}`}/mcp`
      });
    }
  }
  
  return c.json({
    tokens,
    count: tokens.length,
    server_url: c.env.SERVER_URL || `https://${c.req.header('host')}`
  });
});

// Test what Claude.ai should be calling
app.post('/debug/mcp-test', async (c) => {
  const body = await c.req.text();
  const headers = Object.fromEntries(c.req.raw.headers.entries());
  
  return c.json({
    received: {
      body,
      headers,
      method: c.req.method
    },
    expected_format: {
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "1.0",
        capabilities: {}
      },
      id: 1
    }
  });
});

// Manual MCP initialization test
app.get('/test/init-mcp', async (c) => {
  // Get the most recent token
  const list = await c.env.AUTH_STORE.list({ prefix: 'token:', limit: 1 });
  if (list.keys.length === 0) {
    return c.json({ error: 'No tokens found' }, 404);
  }
  
  const tokenKey = list.keys[0].name;
  const token = tokenKey.substring(6); // Remove 'token:' prefix
  const tokenDataJSON = await c.env.AUTH_STORE.get(tokenKey);
  const tokenData = JSON.parse(tokenDataJSON!);
  
  // Create DO and test initialization
  const doId = c.env.RTM_MCP.idFromName(token);
  const stub = c.env.RTM_MCP.get(doId);
  
  // Test the initialization
  const testRequest = new Request('https://do.test/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-RTM-Token': token,
      'X-RTM-UserId': tokenData.userId,
      'X-RTM-UserName': tokenData.userName
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '1.0',
        capabilities: {}
      },
      id: 1
    })
  });
  
  try {
    const response = await stub.fetch(testRequest);
    const result = await response.json();
    
    return c.json({
      token_info: {
        token_prefix: token.substring(0, 8) + '...',
        userName: tokenData.userName,
        userId: tokenData.userId
      },
      do_id: doId.toString(),
      init_response: {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: result
      }
    });
  } catch (error) {
    return c.json({
      error: 'DO initialization failed',
      message: error instanceof Error ? error.message : String(error),
      token_prefix: token.substring(0, 8) + '...'
    }, 500);
  }
});

// Add this to src/index.ts after the /test/rtm endpoint

// Test MCP initialization with a token
app.get('/test/mcp/:token', async (c) => {
  const token = c.req.param('token');
  const logger = c.get('debugLogger');
  
  await logger.log('mcp_test_start', {
    token_prefix: token.substring(0, 8),
    endpoint: '/test/mcp'
  });
  
  try {
    // Check if token exists in KV
    const tokenDataJSON = await c.env.AUTH_STORE.get(`token:${token}`);
    
    if (!tokenDataJSON) {
      return c.json({
        error: 'Token not found',
        token_prefix: token.substring(0, 8)
      }, 404);
    }
    
    const tokenData = JSON.parse(tokenDataJSON);
    
    // Try to create a Durable Object with this token
    const doId = c.env.RTM_MCP.idFromName(token);
    const stub = c.env.RTM_MCP.get(doId);
    
    // Initialize the DO with auth data
    const initResponse = await stub.fetch('https://do.test/init', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        rtmToken: token,
        userName: tokenData.userName,
        userId: tokenData.userId
      })
    });
    
    const initResult = await initResponse.text();
    
    // Test the MCP endpoint
    const mcpTestResponse = await stub.fetch('https://do.test/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '1.0',
          capabilities: {}
        },
        id: 1
      })
    });
    
    const mcpResult = await mcpTestResponse.json();
    
    await logger.log('mcp_test_success', {
      token_data: tokenData,
      init_status: initResponse.status,
      init_result: initResult,
      mcp_status: mcpTestResponse.status,
      mcp_result: mcpResult
    });
    
    return c.json({
      token_valid: true,
      token_data: {
        userName: tokenData.userName,
        userId: tokenData.userId,
        created_at: tokenData.created_at
      },
      durable_object: {
        id: doId.toString(),
        init_status: initResponse.status,
        init_result: initResult
      },
      mcp_test: {
        status: mcpTestResponse.status,
        result: mcpResult
      }
    });
    
  } catch (error) {
    await logger.log('mcp_test_error', {
      error: error instanceof Error ? error.message : String(error),
      token_prefix: token.substring(0, 8)
    });
    
    return c.json({
      error: 'MCP test failed',
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// Also add an endpoint to check what Claude expects
app.get('/mcp/capabilities', async (c) => {
  return c.json({
    mcp_version: '1.0',
    server_info: {
      name: 'rtm-mcp-server',
      version: '2.5.0'
    },
    capabilities: {
      tools: true,
      resources: false,
      prompts: false
    },
    transport: {
      type: 'http',
      supports_streaming: true
    }
  });
});
// --- Exports ---

/**
 * The default export is the Hono app instance, which is what Cloudflare Workers
 * will use to handle incoming requests.
 */
export default app;

/**
 * The RtmMCP class is also exported, which is required by the Cloudflare
 * Worker runtime for Durable Object instantiation.
 */
export { RtmMCP };