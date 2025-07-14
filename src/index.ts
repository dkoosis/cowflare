// File: src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getCookie, setCookie } from 'hono/cookie';
import { RtmMCP } from './rtm-mcp';
import { createRtmHandler } from './rtm-handler';
import { withDebugLogging, createDebugDashboard } from './debug-logger';
import type { Env } from './types';

// --- Variable Declarations ---

/**
 * The deployment name and timestamp, displayed in various locations
 * such as the debug dashboard and health check endpoint.
 * These values are replaced at build time.
 */
const DEPLOYMENT_NAME = '__DEPLOYMENT_NAME__';
const DEPLOYMENT_TIME_MODULE = '__DEPLOYMENT_TIME__';

// --- Type Definitions ---

/**
 * Define custom variables available in Hono context.
 * This ensures TypeScript knows about our custom properties.
 */
type Variables = {
  debugLogger: any;
  debugSessionId: string;
};

// --- Application Setup ---

/**
 * Main Hono application instance with proper typing.
 * This handles all HTTP routing for our MCP server.
 */
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// --- Middleware Setup ---

/**
 * Apply debug logging middleware to all routes.
 * This creates a debug session and logger for each request.
 */
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
app.all('/mcp/*', (c) => {
    const logger = c.get('debugLogger');
    logger.log('mcp_request_handling', {
        method: c.req.method,
        path: c.req.path,
        handler: 'serve'
    });
    // Forward the request to the McpAgent's fetch method for processing.
    return mcpHandler.fetch(c.req.raw, c.env, c.executionCtx);
});

/**
 * The debug dashboard endpoint.
 * Provides a web interface to view live logs and transaction history.
 */
app.get('/debug', (c) => {
  // Pass deployment info to the dashboard for display in the banner.
  return createDebugDashboard(DEPLOYMENT_NAME, DEPLOYMENT_TIME_MODULE)(c);
});

/**
 * The health check endpoint.
 * Provides metadata about the running service, including its version, deployment
 * name, and a check of which McpAgent methods are available.
 */
app.get('/health', (c) => {
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
    deployment_name: DEPLOYMENT_NAME,
    transport: 'streamable-http',
    mcp_compliant: mcpMethods.hasServe, // Dynamically check compliance
    deployed_at: DEPLOYMENT_TIME_MODULE,
    mcp_methods: mcpMethods
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