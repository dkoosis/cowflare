import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { RtmMCP } from './rtm-mcp';
import { withDebugLogging, DebugLogger } from './debug-logger';
import { createRtmHandler } from './rtm-handler';
import type { Env } from './types';

// Generate friendly deployment identifier
const adjectives = ['swift', 'bright', 'calm', 'bold', 'wise', 'clean', 'sharp', 'quick', 'brave', 'clear', 'fresh', 'cool', 'smart', 'strong', 'kind', 'gentle', 'happy', 'lively', 'neat', 'eager', 'zesty', 'vivid', 'radiant', 'charming', 'graceful'];
const animals = ['tiger', 'eagle', 'wolf', 'hawk', 'fox', 'bear', 'frog', 'lion', 'owl', 'deer', 'lynx', 'bear', 'puma', 'otter', 'seal', 'whale', 'dolphin', 'shark', 'penguin', 'rabbit', 'squirrel'];


// Extend context type to include debugLogger
type Variables = {
  debugLogger: DebugLogger;
  debugSessionId: string;
};

const generateDeploymentName = () => {
  const now = Date.now();
  const adjIndex = Math.floor((now / 1000) % adjectives.length);
  const animalIndex = Math.floor((now / 100000) % animals.length);
  return `${adjectives[adjIndex]}-${animals[animalIndex]}`;
};

const DEPLOYMENT_NAME = generateDeploymentName();
const DEPLOYMENT_TIME_MODULE = new Date().toISOString(); // Will be epoch, but we'll fix in handlers

console.log(`🚀 Deployment: ${DEPLOYMENT_NAME} at ${DEPLOYMENT_TIME_MODULE}`);

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
 * Fixed to use proper McpAgent serve pattern for streamable HTTP
 */
app.all('/mcp/*', async (c) => {
  const logger = c.get('debugLogger');
  
  logger.log('mcp_request', {
    method: c.req.method,
    path: c.req.path,
    has_session_id: !!c.req.header('Mcp-Session-Id')
  });

  // Check if McpAgent has the expected static serve methods
  const hasServeStreamableHttp = typeof (RtmMCP as any).serveStreamableHttp === 'function';
  const hasServe = typeof (RtmMCP as any).serve === 'function';
  
  logger.log('mcp_serve_methods', {
    hasServeStreamableHttp,
    hasServe,
    availableMethods: Object.getOwnPropertyNames(RtmMCP).filter(m => m.includes('serve'))
  });

  try {
    if (hasServeStreamableHttp) {
      // Use the streamable HTTP serve method if available
      const handler = (RtmMCP as any).serveStreamableHttp('/mcp', {
        binding: 'MCP_OBJECT',
        corsOptions: {
          origin: ['http://localhost:*', 'https://*.claude.ai', 'https://claude.ai'],
          methods: 'GET, POST, OPTIONS',
          headers: 'Content-Type, Authorization, Mcp-Session-Id',
          exposeHeaders: 'Mcp-Session-Id, Location'
        }
      });
      
      return await handler.fetch(c.req.raw, c.env, c.executionCtx);
    } else if (hasServe) {
      // Try generic serve method with transport type
      const handler = (RtmMCP as any).serve('/mcp', {
        binding: 'MCP_OBJECT',
        transportType: 'streamable-http',
        corsOptions: {
          origin: ['http://localhost:*', 'https://*.claude.ai', 'https://claude.ai'],
          methods: 'GET, POST, OPTIONS',
          headers: 'Content-Type, Authorization, Mcp-Session-Id',
          exposeHeaders: 'Mcp-Session-Id, Location'
        }
      });
      
      return await handler.fetch(c.req.raw, c.env, c.executionCtx);
    } else {
      // Fallback to direct fetch if no serve methods exist
      logger.log('mcp_fallback_direct_fetch', {
        warning: 'No McpAgent serve methods found, using direct fetch'
      });
      
      // For direct fetch, we need to ensure the Durable Object is properly initialized
      const id = c.env.MCP_OBJECT.idFromName('rtm-mcp-default');
      const stub = c.env.MCP_OBJECT.get(id);
      
      // Set transport type in the request if possible
      const request = new Request(c.req.raw.url, {
        method: c.req.raw.method,
        headers: c.req.raw.headers,
        body: c.req.raw.body
      });
      
      return await stub.fetch(request);
    }
  } catch (error) {
    logger.log('mcp_error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    
    return c.json({ 
      error: 'internal_server_error',
      message: 'Failed to process MCP request'
    }, 500);
  }
});

/**
 * Debug and Health Endpoints
 */

// Debug dashboard
app.get('/debug', async (c) => {
  const { createDebugDashboard } = await import('./debug-logger');
  return createDebugDashboard(DEPLOYMENT_NAME, new Date().toISOString())(c);
});

// Health check endpoint
app.get('/health', (c) => {
  // Check available McpAgent methods
  const mcpMethods = {
    hasServe: typeof (RtmMCP as any).serve === 'function',
    hasServeSSE: typeof (RtmMCP as any).serveSSE === 'function',
    hasServeStreamableHttp: typeof (RtmMCP as any).serveStreamableHttp === 'function',
    hasMount: typeof (RtmMCP as any).mount === 'function',
    hasFetch: typeof (RtmMCP as any).fetch === 'function'
  };
  
  return c.json({ 
    status: 'ok',
    service: 'rtm-mcp-server',
    version: '2.5.0',
    deployment_name: DEPLOYMENT_NAME,
    transport: 'streamable-http',
    mcp_compliant: true,
    deployed_at: new Date().toISOString(),
    mcp_methods: mcpMethods
  });
});

export default app;
export { RtmMCP };