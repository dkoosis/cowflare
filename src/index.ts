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

type Variables = {
  debugLogger: DebugLogger;
  debugSessionId: string;
};

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
  if (!deploymentName || !deploymentTime) {
    deploymentName = generateDeploymentName();
    deploymentTime = new Date().toISOString();
    console.log(`🚀 Initialized Deployment: ${deploymentName} at ${deploymentTime}`);
  }
  return { deploymentName, deploymentTime };
};

// --- Hono App Initialization ---

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// --- Middleware Configuration ---

app.use('*', withDebugLogging);
app.use('*', cors({
  origin: ['http://localhost:*', 'https://*.claude.ai', 'https://claude.ai'],
  credentials: true,
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id'],
  exposeHeaders: ['Mcp-Session-Id', 'Location']
}));

// --- Route Definitions ---

app.get('/health', (c) => {
    const { deploymentName, deploymentTime } = getDeploymentInfo();
    return c.json({
        status: "ok",
        service: "rtm-mcp-server",
        deployment: deploymentName,
        deployed_at: deploymentTime
    });
});

app.get('/', (c) => {
    const { deploymentName, deploymentTime } = getDeploymentInfo();
    return c.json({
        message: 'RTM MCP Server is running.',
        deployment: deploymentName,
        deployed_at: deploymentTime
    });
});

const rtmHandler = createRtmHandler();
app.route('/auth', rtmHandler);

app.all('/mcp', async (c) => {
  const logger = c.get('debugLogger');
  let doId: DurableObjectId;

  if (c.req.method !== 'POST') {
    return c.text('Method Not Allowed', 405);
  }

  const bodyText = await c.req.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch (e) {
    await logger.log('mcp_body_parse_error', { error: e instanceof Error ? e.message : String(e) });
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }

  await logger.log('mcp_request', { method: body.method, url: c.req.url });

  const doRequest = new Request(c.req.url, {
    method: 'POST',
    headers: new Headers(c.req.raw.headers),
    body: bodyText,
  });

  const isBypassRequest = body.method === 'initialize';

  if (isBypassRequest) {
    const sessionId = crypto.randomUUID();
    doId = c.env.MCP_OBJECT.idFromName(`mcp-session-${sessionId}`);
    
    // Check for auth header even in bypass mode to pass context if available
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const tokenDataJSON = await c.env.AUTH_STORE.get(`token:${token}`);
      if (tokenDataJSON) {
        const tokenData = JSON.parse(tokenDataJSON);
        doRequest.headers.set('X-RTM-Token', token);
        doRequest.headers.set('X-RTM-UserId', tokenData.userId);
        doRequest.headers.set('X-RTM-UserName', tokenData.userName);
      }
    }
  } else {
    // This else block handles all other, normally authenticated requests
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      await logger.log('mcp_no_auth', { method: body.method });
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    const token = authHeader.substring(7);
    const tokenDataJSON = await c.env.AUTH_STORE.get(`token:${token}`);
    if (!tokenDataJSON) {
      await logger.log('mcp_invalid_token', { token_prefix: token.substring(0, 8) });
      return c.json({ error: 'Invalid token' }, 401);
    }

    const tokenData = JSON.parse(tokenDataJSON);
    doId = c.env.MCP_OBJECT.idFromName(token);
    
    doRequest.headers.set('X-RTM-Token', token);
    doRequest.headers.set('X-RTM-UserId', tokenData.userId);
    doRequest.headers.set('X-RTM-UserName', tokenData.userName);

    await logger.log('mcp_token_valid', { userId: tokenData.userId, doId: doId.toString() });
  }

  const stub = c.env.MCP_OBJECT.get(doId);

  try {
    const response = await stub.fetch(doRequest);
    await logger.log('mcp_do_response', { status: response.status });
    return response;
  } catch (error) {
    await logger.log('mcp_do_error', { error: error instanceof Error ? error.message : String(error) });
    return c.json({ jsonrpc: '2.0', id: body.id || null, error: { code: -32000, message: 'MCP server error' } }, 500);
  }
});

const debugDashboardHandler = createDebugDashboard(
  getDeploymentInfo().deploymentName,
  getDeploymentInfo().deploymentTime
);
app.get('/debug', debugDashboardHandler);

app.get('/debug/tokens', async (c) => {
  const list = await c.env.AUTH_STORE.list({ prefix: 'token:' });
  const tokens = [];
  
  for (const key of list.keys) {
    const data = await c.env.AUTH_STORE.get(key.name);
    if (data) {
      const tokenData = JSON.parse(data);
      tokens.push({
        token_prefix: key.name.substring(6),
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
      params: { protocolVersion: "1.0", capabilities: {} },
      id: 1
    }
  });
});

app.get('/test/init-mcp', async (c) => {
  const list = await c.env.AUTH_STORE.list({ prefix: 'token:', limit: 1 });
  if (list.keys.length === 0) {
    return c.json({ error: 'No tokens found' }, 404);
  }
  
  const tokenKey = list.keys[0].name;
  const token = tokenKey.substring(6);
  const tokenDataJSON = await c.env.AUTH_STORE.get(tokenKey);
  const tokenData = JSON.parse(tokenDataJSON!);
  
  const doId = c.env.MCP_OBJECT.idFromName(token);
  const stub = c.env.MCP_OBJECT.get(doId);
  
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
      params: { protocolVersion: '1.0', capabilities: {} },
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

app.get('/test/mcp/:token', async (c) => {
  const token = c.req.param('token');
  const logger = c.get('debugLogger');
  
  await logger.log('mcp_test_start', {
    token_prefix: token.substring(0, 8),
    endpoint: '/test/mcp'
  });
  
  try {
    const tokenDataJSON = await c.env.AUTH_STORE.get(`token:${token}`);
    if (!tokenDataJSON) {
      return c.json({ error: 'Token not found', token_prefix: token.substring(0, 8) }, 404);
    }
    
    const tokenData = JSON.parse(tokenDataJSON);
    const doId = c.env.MCP_OBJECT.idFromName(token);
    const stub = c.env.MCP_OBJECT.get(doId);
    
    const mcpTestResponse = await stub.fetch('https://do.test/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: { protocolVersion: '1.0', capabilities: {} },
        id: 1
      })
    });
    
    const mcpResult = await mcpTestResponse.json();
    
    await logger.log('mcp_test_success', {
      token_data: tokenData,
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
      durable_object: { id: doId.toString() },
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
export default app;
export { RtmMCP };