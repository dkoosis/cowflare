import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { RtmMCP } from './rtm-mcp';
import { withDebugLogging, DebugLogger } from './debug-logger';
import { createRtmHandler } from './rtm-handler';
import type { Env } from './types';

// Generate friendly deployment identifier
const adjectives = ['swift', 'bright', 'calm', 'bold', 'wise', 'clean', 'sharp', 'quick', 'brave', 'clear'];
const animals = ['tiger', 'eagle', 'wolf', 'hawk', 'fox', 'bear', 'lion', 'owl', 'deer', 'lynx'];

const generateDeploymentName = () => {
  const now = Date.now();
  const adjIndex = Math.floor((now / 1000) % adjectives.length);
  const animalIndex = Math.floor((now / 100000) % animals.length);
  return `${adjectives[adjIndex]}-${animals[animalIndex]}`;
};

// Store deployment info in a way that persists across requests
const DEPLOYMENT_INFO = {
  name: generateDeploymentName(),
  time: new Date().toISOString(),
  timestamp: Date.now()
};

console.log(`🚀 Deployment: ${DEPLOYMENT_INFO.name} at ${DEPLOYMENT_INFO.time}`);

// Define context variables type for Hono
type Variables = {
  debugLogger: DebugLogger;
  debugSessionId: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

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
 * Uses McpAgent's static serve method for proper protocol handling
 */
app.all('/mcp', async (c) => {
  const logger = c.get('debugLogger');
  logger.log('mcp_request', {
    endpoint: '/mcp',
    method: c.req.method,
    headers: {
      'mcp-session-id': c.req.header('mcp-session-id'),
      'content-type': c.req.header('content-type'),
      'authorization': c.req.header('authorization') ? 'Bearer [REDACTED]' : 'none'
    }
  });

  // Check if McpAgent has static serve method
  if (typeof RtmMCP.serve === 'function') {
    // Use the static serve method provided by McpAgent
    const handler = RtmMCP.serve('/mcp', {
      binding: 'MCP_OBJECT',
      corsOptions: {
        origin: '*',
        methods: 'GET, POST, OPTIONS',
        headers: 'Content-Type, mcp-session-id, mcp-protocol-version',
        exposeHeaders: 'mcp-session-id'
      }
    });
    
    // The serve method returns an object with a fetch method
    return handler.fetch(c.req.raw, c.env, c.executionCtx);
  } else {
    // Fallback: Manual handling if serve method not available
    const url = new URL(c.req.url);
    const sessionId = url.searchParams.get('sessionId') || c.req.header('mcp-session-id');

    if (!sessionId) {
      return c.json({ error: 'Missing sessionId' }, 400);
    }

    // Get or create Durable Object instance
    const id = c.env.MCP_OBJECT.idFromName(`streamable-http:${sessionId}`);
    const stub = c.env.MCP_OBJECT.get(id);

    // Forward the request to the Durable Object
    return stub.fetch(c.req.raw);
  }
});

/**
 * Debug and Health Endpoints
 */

// Debug dashboard
app.get('/debug', async (c) => {
  const { createDebugDashboard } = await import('./debug-logger');
  return createDebugDashboard(DEPLOYMENT_INFO.name, DEPLOYMENT_INFO.time)(c);
});

// Health check endpoint
app.get('/health', (c) => {
  return c.json({ 
    status: 'ok',
    service: 'rtm-mcp-server',
    version: '2.5.0',
    deployment_name: DEPLOYMENT_INFO.name,
    transport: 'streamable-http',
    mcp_compliant: true,
    deployed_at: DEPLOYMENT_INFO.time,
    has_serve_method: typeof RtmMCP.serve === 'function'
  });
});

export default app;
export { RtmMCP };