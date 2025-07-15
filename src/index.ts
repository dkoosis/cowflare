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

app.use('*', withDebugLogging); //
app.use('*', cors({ //
  origin: ['http://localhost:*', 'https://*.claude.ai', 'https://claude.ai'],
  credentials: true,
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id'],
  exposeHeaders: ['Mcp-Session-Id', 'Location']
}));

// --- Route Definitions ---

// ADDED: A root handler to prevent 404 errors at the base URL.
app.get('/', (c) => {
    const { deploymentName, deploymentTime } = getDeploymentInfo();
    return c.json({
        message: 'RTM MCP Server is running.',
        deployment: deploymentName,
        deployed_at: deploymentTime
    });
});

/**
 * Mounts the RTM-specific authentication handler, which provides the
 * necessary endpoints for our custom, non-OAuth authentication flow.
 */
const rtmHandler = createRtmHandler();
app.route('/auth', rtmHandler); // Changed from '/' to '/auth' for clarity

// REMOVED: The unused mcpHandler created with RtmMCP.serve().
// This code was dead and conflicted with our final architecture.

// REFACTORED: The entire /mcp handler is restructured to be safer and clearer.
app.all('/mcp', async (c) => {
  const logger = c.get('debugLogger');
  let doId: DurableObjectId;
  let token: string | undefined;
  let tokenData: { userId: string; userName: string } | undefined;

  // MCP requests must be POST
  if (c.req.method !== 'POST') {
    return c.text('Method Not Allowed', 405);
  }

  // FIXED: The critical bug where the body was read twice is resolved here.
  // We read the body ONCE and use the resulting text for all subsequent operations.
  const bodyText = await c.req.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch (e) {
    await logger.log('mcp_body_parse_error', { error: e instanceof Error ? e.message : String(e) });
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }

  await logger.log('mcp_request', {
    method: body.method,
    url: c.req.url,
  });
  
  // Logic for the unauthenticated 'initialize' handshake
  if (body.method === 'initialize') {
    const sessionId = crypto.randomUUID();
    doId = c.env.MCP_OBJECT.idFromName(`mcp-session-${sessionId}`);
    await logger.log('mcp_initialize_request', { doId: doId.toString() });
  } else {
    // Logic for all other, authenticated methods
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      await logger.log('mcp_no_auth', { method: body.method });
      return c.json({ error: 'Unauthorized' }, 401);
    }
    
    token = authHeader.substring(7);
    const tokenDataJSON = await c.env.AUTH_STORE.get(`token:${token}`);
    
    if (!tokenDataJSON) {
      await logger.log('mcp_invalid_token', { token_prefix: token.substring(0, 8) });
      return c.json({ error: 'Invalid token' }, 401);
    }

    tokenData = JSON.parse(tokenDataJSON);
    doId = c.env.MCP_OBJECT.idFromName(token);
    await logger.log('mcp_token_valid', { userId: tokenData.userId, doId: doId.toString() });
  }

  // Common logic to forward the request to the correct Durable Object
  const stub = c.env.MCP_OBJECT.get(doId);
  const doRequest = new Request(c.req.url, {
    method: 'POST',
    headers: new Headers(c.req.headers),
    body: bodyText, // Always use the preserved body text
  });

  // Add user context to headers for authenticated requests
  if (tokenData && token) {
    doRequest.headers.set('X-RTM-Token', token);
    doRequest.headers.set('X-RTM-UserId', tokenData.userId);
    doRequest.headers.set('X-RTM-UserName', tokenData.userName);
  }

  try {
    const response = await stub.fetch(doRequest);
    await logger.log('mcp_do_response', { status: response.status });
    return response;
  } catch (error) {
    await logger.log('mcp_do_error', { error: error instanceof Error ? error.message : String(error) });
    return c.json({ jsonrpc: '2.0', id: body.id || null, error: { code: -32000, message: 'MCP server error' } }, 500);
  }
});

// ADDED: The debug dashboard route is restored.
app.get('/debug', (c) => {
    const logger = c.get('debugLogger');
    const { deploymentName, deploymentTime } = getDeploymentInfo();
    return createDebugDashboard(logger, deploymentName, deploymentTime);
});

app.get('/debug/tokens', async (c) => { //
  const list = await c.env.AUTH_STORE.list({ prefix: 'token:' });
  const tokens = [];
  
  for (const key of list.keys) {
    const data = await c.env.AUTH_STORE.get(key.name);
    if (data) {
      tokens.push({
        token_prefix: key.name.substring(6, 14) + '...',
        ...JSON.parse(data),
      });
    }
  }
  return c.json({ tokens, count: tokens.length });
});

// --- Exports ---
export default app; //
export { RtmMCP }; //