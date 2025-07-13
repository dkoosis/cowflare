import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { RtmMCP } from './rtm-mcp';
import { withDebugLogging } from './debug-logger';
import { createRtmHandler } from './rtm-handler';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

// Apply debug logging middleware globally
app.use('*', withDebugLogging);

// Enable CORS for MCP clients
app.use('*', cors({
  origin: ['http://localhost:*', 'https://*.claude.ai', 'https://claude.ai'],
  credentials: true,
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id'],
  exposeHeaders: ['Mcp-Session-Id', 'Location']
}));

// Mount RTM OAuth handler for authentication endpoints
const rtmHandler = createRtmHandler();
app.route('/', rtmHandler);

/**
 * OAuth Discovery Endpoints
 * Required by MCP clients for OAuth 2.0 discovery (RFC 9728, RFC 8414)
 */

// Protected resource metadata endpoint
app.get('/.well-known/oauth-protected-resource', (c) => {
  const logger = c.get('debugLogger');
  logger.log('oauth_discovery_resource', {
    endpoint: '/.well-known/oauth-protected-resource'
  });

  const baseUrl = c.env.SERVER_URL || `https://${c.req.header('host')}`;
  
  return c.json({
    authorization_servers: [baseUrl],
    resource: `${baseUrl}/mcp`
  });
});

// Authorization server metadata endpoint
app.get('/.well-known/oauth-authorization-server', (c) => {
  const logger = c.get('debugLogger');
  logger.log('oauth_discovery_server', {
    endpoint: '/.well-known/oauth-authorization-server'
  });

  const baseUrl = c.env.SERVER_URL || `https://${c.req.header('host')}`;
  
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

// Dynamic client registration endpoint
app.post('/register', (c) => {
  const logger = c.get('debugLogger');
  logger.log('client_registration', {
    endpoint: '/register'
  });
  
  const clientId = crypto.randomUUID();
  return c.json({
    client_id: clientId,
    client_secret: '',
    client_id_issued_at: Math.floor(Date.now() / 1000),
    grant_types: ['authorization_code'],
    response_types: ['code'],
    redirect_uris: ['https://claude.ai/auth/callback'],
    token_endpoint_auth_method: 'none'
  });
});

/**
 * MCP Protocol Handler
 * Uses McpAgent.serve() for proper protocol handling
 */
app.all('/mcp', async (c) => {
  const logger = c.get('debugLogger');
  
  // Log MCP request for debugging
  await logger.log('mcp_request', {
    method: c.req.method,
    path: c.req.path,
    sessionId: c.req.header('Mcp-Session-Id'),
    hasAuth: !!c.req.header('Authorization')
  });

  try {
    // Use static serve method for proper MCP protocol handling
    const response = await RtmMCP.serve(c.req.raw, c.env, c.executionCtx);
    
    // Log successful response
    await logger.log('mcp_response', {
      status: response.status,
      hasSessionId: !!response.headers.get('Mcp-Session-Id')
    });
    
    return response;
  } catch (error) {
    // Log MCP errors for debugging
    await logger.log('mcp_error', {
      error: error.message,
      stack: error.stack
    });
    
    return new Response('Internal Server Error', { status: 500 });
  }
});

/**
 * Debug and Health Endpoints
 */

// Debug dashboard
app.get('/debug', async (c) => {
  const { createDebugDashboard } = await import('./debug-logger');
  return createDebugDashboard()(c);
});

// Health check endpoint
app.get('/health', (c) => {
  return c.json({ 
    status: 'ok',
    service: 'rtm-mcp-server',
    version: '2.5.0',
    transport: 'streamable-http',
    mcp_compliant: true,
    deployed_at: new Date().toISOString(),
    has_serve_method: typeof RtmMCP.serve === 'function'
  });
});

export default app;
export { RtmMCP };