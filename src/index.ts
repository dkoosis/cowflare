import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getCookie, setCookie } from 'hono/cookie';
import { RtmMCP } from './rtm-mcp';
import { withDebugLogging } from './debug-logger';
import { createRtmHandler } from './rtm-handler';
import type { Env } from './types';

// Create the Hono app
const app = new Hono<{ Bindings: Env }>();

// Apply debug logging middleware globally
app.use('*', withDebugLogging);

// Enable CORS for all routes
app.use('*', cors({
  origin: ['http://localhost:*', 'https://*.claude.ai', 'https://claude.ai'],
  credentials: true,
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id'],
  exposeHeaders: ['Mcp-Session-Id', 'Location']
}));

// Mount the RTM OAuth handler for all its routes
const rtmHandler = createRtmHandler();
app.route('/', rtmHandler);

// OAuth Authorization Server metadata - required by Claude.ai
app.get('/.well-known/oauth-authorization-server', (c) => {
  const baseUrl = c.env.SERVER_URL || `https://${c.req.header('host')}`;
  
  console.log('[OAuth AS Metadata] Request received');
  
  return c.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none']
  });
});

// Dynamic Client Registration - required by Claude.ai
app.post('/register', (c) => {
  const logger = c.get('debugLogger');
  logger.log('client_registration', {
    endpoint: '/register',
    body: c.req.body
  });
  
  // Return a mock client registration
  const clientId = crypto.randomUUID();
  return c.json({
    client_id: clientId,
    client_secret: '', // Public client
    client_id_issued_at: Math.floor(Date.now() / 1000),
    grant_types: ['authorization_code'],
    response_types: ['code'],
    redirect_uris: ['https://claude.ai/auth/callback'],
    token_endpoint_auth_method: 'none'
  });
});

// OAuth well-known endpoint - required by Claude.ai
app.get('/.well-known/oauth-protected-resource', (c) => {
  const logger = c.get('debugLogger');
  logger.log('well_known_request', {
    endpoint: '/.well-known/oauth-protected-resource',
    host: c.req.header('host'),
    origin: c.req.header('origin')
  });

  const baseUrl = c.env.SERVER_URL || `https://${c.req.header('host')}`;
  return c.json({
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`
  });
});

// MCP endpoint handler
app.all('/mcp', async (c) => {
  // Extract token from Authorization header
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '');

  logger.info('[MCP Auth] Headers received', {
    hasAuth: !!authHeader,
    authType: authHeader?.split(' ')[0],
    tokenLength: token?.length,
    contentType: c.req.header('Content-Type'),
    acceptHeader: c.req.header('Accept'),
    sessionId: c.req.header('Mcp-Session-Id')
  });

  if (!token) {
    logger.error('[MCP Auth] No token provided');
    return c.json({ error: 'No authorization token provided' }, 401);
  }

  // Validate token and get user info
  const validation = await rtmHandler.validateToken(token);
  if (!validation.isValid || !validation.userName || !validation.userId) {
    logger.error('[MCP Auth] Token validation failed', { 
      isValid: validation.isValid,
      hasUserName: !!validation.userName,
      hasUserId: !!validation.userId
    });
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  logger.info('[MCP Auth] Token valid', {
    userName: validation.userName,
    userId: validation.userId
  });

  // Get MCP handler
  const mcpHandler = c.env.MCP_OBJECT;
  logger.info('[MCP] Handler fetched', {
    handlerType: typeof mcpHandler,
    hasHandlerFetch: typeof mcpHandler?.fetch === 'function'
  });

  // Set props directly on execution context for McpAgent
  (c.executionCtx as any).props = {
    rtmToken: token,
    userName: validation.userName,
    userId: validation.userId
  };

  logger.info('Set props on execution context', {
    hasProps: true,
    userName: validation.userName,
    hasToken: !!token
  });

  return mcpHandler.fetch(c.req.raw, c.env, c.executionCtx);
});

// Debug endpoint with enhanced dashboard
app.get('/debug', async (c) => {
  const { createDebugDashboard } = await import('./debug-logger');
  return createDebugDashboard()(c);
});

// Health check endpoint
app.get('/health', (c) => {
  const deployedAt = new Date().toISOString();
  return c.json({ 
    status: 'ok',
    service: 'rtm-mcp-server',
    version: '2.5.0',
    transport: 'streamable-http',
    mcp_compliant: true,
    deployed_at: deployedAt,
    has_serve_method: typeof RtmMCP.serve === 'function',
    agents_version: '0.0.103'
  });
});

export default app;
export { RtmMCP };  // Export the Durable Object class