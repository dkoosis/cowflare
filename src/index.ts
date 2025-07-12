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

// MCP endpoint with authentication
app.all('/mcp', async (c) => {
  const logger = c.get('debugLogger');
  
  // Debug log the serve method existence
  console.log('[Debug] RtmMCP.serve exists?', typeof RtmMCP.serve);
  
  // Create the handler
  const mcpHandler = RtmMCP.serve('/mcp');
  console.log('[Debug] mcpHandler created:', !!mcpHandler);
  
  await logger.log('mcp_request_start', {
    endpoint: '/mcp',
    method: c.req.method,
    hasAuth: !!c.req.header('Authorization'),
    sessionId: c.req.header('Mcp-Session-Id')
  });

  const authHeader = c.req.header('Authorization');
  const baseUrl = c.env.SERVER_URL || `https://${c.req.header('host')}`;
  
  // For MCP requests, we need to check auth
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('[MCP Auth] Missing or invalid auth header');
    
    c.header('WWW-Authenticate', 
      `Bearer realm="${baseUrl}/mcp", ` +
      `resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`
    );
    
    return c.json({ 
      error: 'unauthorized',
      error_description: 'Bearer token required' 
    }, 401);
  }

  const token = authHeader.substring(7);
  const tokenData = await c.env.AUTH_STORE.get(`token:${token}`);
  
  if (!tokenData) {
    console.log('[MCP Auth] Token not found in store');
    
    c.header('WWW-Authenticate', 
      `Bearer realm="${baseUrl}/mcp", ` +
      `error="invalid_token", ` +
      `error_description="The access token is invalid", ` +
      `resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`
    );
    
    return c.json({ 
      error: 'invalid_token',
      error_description: 'The access token is invalid' 
    }, 401);
  }

  const { userName, userId } = JSON.parse(tokenData);
  console.log('[MCP Auth] Token valid:', { userName, userId });
  
  // Debug log before setting props
  console.log('[Debug] About to set props on executionCtx:', {
    hasExecutionCtx: !!c.executionCtx,
    executionCtxType: typeof c.executionCtx,
    executionCtxKeys: Object.keys(c.executionCtx || {})
  });
  
  // Set props directly on execution context
  (c.executionCtx as any).props = { 
    rtmToken: token, 
    userName, 
    userId 
  };
  
  console.log('[Debug] Props set, calling mcpHandler.fetch');
  
  // Now delegate to McpAgent's handler with the authenticated context
  try {
    const response = await mcpHandler.fetch(c.req.raw, c.env, c.executionCtx);
    console.log('[Debug] mcpHandler.fetch returned:', {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries())
    });
    return response;
  } catch (error) {
    console.error('[MCP] Handler error:', error);
    return c.json({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: "Internal server error",
        data: error.message
      },
      id: null
    }, 500);
  }
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