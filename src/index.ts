// File: src/index.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createRtmHandler } from "./rtm-handler";
import { RtmMCP } from "./rtm-mcp";
import type { Env } from "./types";

// Create the main app
const app = new Hono<{ Bindings: Env }>();

// Add CORS middleware for browser-based clients
app.use('/*', cors({
  origin: ['https://claude.ai', 'http://localhost:*'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Mount the OAuth2 adapter endpoints
const rtmHandler = createRtmHandler();
app.route('/', rtmHandler);

// Create a separate app for the MCP/SSE endpoint
const sseApp = new Hono<{ Bindings: Env }>();

// Add bearer token authentication middleware for SSE endpoint
sseApp.use('/*', async (c, next) => {
  console.log('[SSE Auth] Request:', {
    method: c.req.method,
    url: c.req.url,
    headers: Object.fromEntries(c.req.header()),
    hasAuth: !!c.req.header('Authorization')
  });

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('[SSE Auth] Missing or invalid auth header');
    return c.text('Unauthorized', 401);
  }

  const token = authHeader.substring(7);
  console.log('[SSE Auth] Token extracted, checking store...');
  
  // Validate token exists in our store
  const tokenData = await c.env.AUTH_STORE.get(`token:${token}`);
  if (!tokenData) {
    console.log('[SSE Auth] Token not found in store');
    return c.text('Invalid token', 401);
  }

  // Parse token data and add to context for the Durable Object
  const { userName, userId } = JSON.parse(tokenData);
  console.log('[SSE Auth] Token valid:', { userName, userId });
  
  c.set('rtmToken', token);
  c.set('userName', userName);
  c.set('userId', userId);
  
  await next();
});

// Mount the Durable Object handler for MCP connections
sseApp.all('/*', async (c) => {
  const rtmToken = c.get('rtmToken');
  const userName = c.get('userName');
  const userId = c.get('userId');
  
  console.log('[SSE Handler] Creating/getting DO instance:', { userId, userName });
  
  // Get or create a Durable Object instance for this user
  const id = c.env.RTM_MCP.idFromName(userId);
  const stub = c.env.RTM_MCP.get(id);
  
  // Add props to URL for the DO to parse
  const url = new URL(c.req.raw.url);
  url.searchParams.set('props', JSON.stringify({
    rtmToken,
    userName
  }));
  
  const newRequest = new Request(url.toString(), {
    method: c.req.raw.method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
    duplex: 'half'
  });
  
  console.log('[SSE Handler] Forwarding to DO');
  return stub.fetch(newRequest);
});

// Mount SSE app at /sse
app.route('/sse', sseApp);

// Health check endpoint
app.get('/health', (c) => {
  return c.json({ 
    status: 'ok',
    service: 'rtm-mcp-server',
    version: '2.4.0'
  });
});

// Debug endpoint to check token status
app.get('/debug/token/:token', async (c) => {
  const token = c.req.param('token');
  const tokenData = await c.env.AUTH_STORE.get(`token:${token}`);
  
  return c.json({
    token: token.substring(0, 8) + '...',
    exists: !!tokenData,
    data: tokenData ? JSON.parse(tokenData) : null,
    timestamp: new Date().toISOString()
  });
});

// Debug endpoint to test MCP connection directly
app.post('/debug/test-mcp', async (c) => {
  const { token } = await c.req.json();
  
  if (!token) {
    return c.json({ error: 'Token required' }, 400);
  }
  
  // Try to connect to MCP with this token
  const response = await fetch(`${c.env.SERVER_URL}/sse`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'text/event-stream'
    }
  });
  
  return c.json({
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries())
  });
});

// Root endpoint with instructions
app.get('/', (c) => {
  const baseUrl = c.env.SERVER_URL || `https://${c.req.header('host')}`;
  
  return c.html(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>RTM MCP Server</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 2rem;
            line-height: 1.6;
          }
          code {
            background: #f4f4f4;
            padding: 0.2rem 0.4rem;
            border-radius: 3px;
            font-family: 'SF Mono', Monaco, 'Courier New', monospace;
          }
          pre {
            background: #f4f4f4;
            padding: 1rem;
            border-radius: 5px;
            overflow-x: auto;
          }
          .warning {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            padding: 1rem;
            border-radius: 5px;
            margin: 1rem 0;
          }
        </style>
      </head>
      <body>
        <h1>RTM MCP Server</h1>
        <p>This is an OAuth2-compatible MCP server for Remember The Milk.</p>
        
        <h2>Integration with Claude.ai</h2>
        <p>To add this integration to Claude.ai:</p>
        <ol>
          <li>Go to Claude.ai settings</li>
          <li>Navigate to "Integrations" or "MCP Servers"</li>
          <li>Click "Add Integration"</li>
          <li>Enter this URL: <code>${baseUrl}</code></li>
          <li>Follow the authentication flow</li>
        </ol>
        
        <h2>Endpoints</h2>
        <ul>
          <li><code>GET /authorize</code> - OAuth2 authorization endpoint</li>
          <li><code>GET /callback</code> - RTM callback endpoint</li>
          <li><code>POST /token</code> - OAuth2 token exchange endpoint</li>
          <li><code>* /sse</code> - MCP Server-Sent Events endpoint</li>
          <li><code>GET /.well-known/oauth-authorization-server</code> - OAuth2 metadata</li>
        </ul>
        
        <div class="warning">
          <strong>Important:</strong> Make sure your RTM app's callback URL is set to:
          <code>${baseUrl}/callback</code>
        </div>
        
        <h2>Debug Tools</h2>
        <ul>
          <li><code>GET /debug/token/{token}</code> - Check token status</li>
          <li><code>POST /debug/test-mcp</code> - Test MCP connection</li>
        </ul>
      </body>
    </html>
  `);
});

// Export the app as the default Worker fetch handler
export default app;

// Export the Durable Object class
export { RtmMCP };