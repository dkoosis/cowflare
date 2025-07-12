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

/**
 * Claude makes two RFC-compliant requests during MCP OAuth discovery:
 * 1. GET /.well-known/oauth-protected-resource (RFC 9728)
 * 2. GET /.well-known/oauth-authorization-server (RFC 8414)
 */

// OAuth well-known endpoint - RFC 9728 compliant
app.get('/.well-known/oauth-protected-resource', (c) => {
  const logger = c.get('debugLogger');
  logger.log('well_known_request', {
    endpoint: '/.well-known/oauth-protected-resource',
    host: c.req.header('host'),
    origin: c.req.header('origin')
  });

  const baseUrl = c.env.SERVER_URL || `https://${c.req.header('host')}`;
  
  // RFC 9728 requires authorization_servers array
  return c.json({
    authorization_servers: [`${baseUrl}`],
    resource: `${baseUrl}/mcp`
  });
});

// OAuth Authorization Server metadata - RFC 8414 compliant (already correct)
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


// MCP endpoint handler
// Add comprehensive logging to trace MCP connection attempts
app.all('/mcp', async (c) => {
  const logger = c.get('debugLogger');
  
  // Log EVERYTHING about the request
  await logger.log('mcp_request_full_trace', {
    method: c.req.method,
    headers: Object.fromEntries(c.req.raw.headers.entries()),
    url: c.req.url,
    hasBody: !!c.req.body,
    sessionId: c.req.header('Mcp-Session-Id'),
    authorization: c.req.header('Authorization')?.substring(0, 20) + '...'
  });

  // Log request body if present
  if (c.req.method === 'POST') {
    try {
      const body = await c.req.text();
      await logger.log('mcp_request_body', { 
        body: body.substring(0, 500),
        length: body.length 
      });
      // Re-parse for handler
      c.req.raw = new Request(c.req.raw, { body });
    } catch (e) {
      await logger.log('mcp_body_parse_error', { error: e.message });
    }
  }

  // ... rest of auth logic ...
  
  // After successful auth, log the response
  const response = await mcpHandler.fetch(c.req.raw, c.env, c.executionCtx);
  
  await logger.log('mcp_response_trace', {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    hasSessionId: !!response.headers.get('Mcp-Session-Id')
  });
  
  return response;
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