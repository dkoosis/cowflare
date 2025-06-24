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
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.text('Unauthorized', 401);
  }

  const token = authHeader.substring(7);
  
  // Validate token exists in our store
  const tokenData = await c.env.AUTH_STORE.get(`token:${token}`);
  if (!tokenData) {
    return c.text('Invalid token', 401);
  }

  // Parse token data and add to context for the Durable Object
  const { userName, userId } = JSON.parse(tokenData);
  c.set('rtmToken', token);
  c.set('userName', userName);
  c.set('userId', userId);
  
  await next();
});

// Mount the Durable Object handler for MCP connections
sseApp.all('/*', async (c) => {
  const rtmToken = c.get('rtmToken');
  const userName = c.get('userName');
  
  // Get or create a Durable Object instance for this connection
  const id = c.env.RTM_MCP.idFromName(rtmToken);
  const stub = c.env.RTM_MCP.get(id);
  
  // Pass the request to the Durable Object with props
  return stub.fetch(c.req.raw, {
    rtmToken,
    userName
  });
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
      </body>
    </html>
  `);
});

// Export the app as the default Worker fetch handler
export default app;

// Export the Durable Object class
export { RtmMCP };