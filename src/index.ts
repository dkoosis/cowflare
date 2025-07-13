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

const DEPLOYMENT_NAME = generateDeploymentName();
const DEPLOYMENT_TIME = new Date().toISOString();

console.log(`🚀 Deployment: ${DEPLOYMENT_NAME} at ${DEPLOYMENT_TIME}`);

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
  const logger = c.get('debugLogger') as DebugLogger;
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
  const logger = c.get('debugLogger') as DebugLogger;
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
  const logger = c.get('debugLogger') as DebugLogger;
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
 * Uses RtmMCP Durable Object serve method
 */
app.all('/mcp', (c) => {
  // Use the Durable Object's fetch method directly
  return RtmMCP.fetch(c.req.raw, c.env, c.executionCtx);
});

/**
 * Debug and Health Endpoints
 */

// Debug dashboard
app.get('/debug', async (c) => {
  const { createDebugDashboard } = await import('./debug-logger');
  return createDebugDashboard(DEPLOYMENT_NAME, DEPLOYMENT_TIME)(c);
});

// Health check endpoint
app.get('/health', (c) => {
  return c.json({ 
    status: 'ok',
    service: 'rtm-mcp-server',
    version: '2.5.0',
    deployment_name: DEPLOYMENT_NAME,
    transport: 'streamable-http',
    mcp_compliant: true,
    deployed_at: DEPLOYMENT_TIME,
    has_serve_method: typeof RtmMCP.serve === 'function'
  });
});

export default app;
export { RtmMCP };