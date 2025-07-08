// File: src/index.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createRtmHandler } from "./rtm-handler";
import { RtmMCP } from "./rtm-mcp";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

// Add CORS middleware
app.use('/*', cors({
  origin: ['https://claude.ai', 'http://localhost:*'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Mount the OAuth2 adapter endpoints
const rtmHandler = createRtmHandler();
app.route('/', rtmHandler);

// Create MCP app for Streamable HTTP endpoint
const mcpApp = new Hono<{ Bindings: Env }>();

// Add bearer token authentication middleware
mcpApp.use('/*', async (c, next) => {
  console.log('[MCP Auth] Request:', {
    method: c.req.method,
    url: c.req.url,
    hasAuth: !!c.req.header('Authorization')
  });

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('[MCP Auth] Missing or invalid auth header');
    return c.text('Unauthorized', 401);
  }

  const token = authHeader.substring(7);
  const tokenData = await c.env.AUTH_STORE.get(`token:${token}`);
  
  if (!tokenData) {
    console.log('[MCP Auth] Token not found in store');
    return c.text('Invalid token', 401);
  }

  const { userName, userId } = JSON.parse(tokenData);
  console.log('[MCP Auth] Token valid:', { userName, userId });
  
  c.set('rtmToken', token);
  c.set('userName', userName);
  c.set('userId', userId);
  
  await next();
});

// Mount Streamable HTTP handler
mcpApp.all('/*', async (c) => {
  const rtmToken = c.get('rtmToken');
  const userName = c.get('userName');
  const userId = c.get('userId');
  
  console.log('[MCP Handler] Creating/getting DO instance:', { userId, userName });
  
  const id = c.env.RTM_MCP.idFromName(userId);
  const stub = c.env.RTM_MCP.get(id);
  
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
  
  return stub.fetch(newRequest);
});

// Mount MCP app at /mcp (Streamable HTTP only)
app.route('/mcp', mcpApp);

// Health check endpoint
app.get('/health', (c) => {
  return c.json({ 
    status: 'ok',
    service: 'rtm-mcp-server',
    version: '2.4.0',
    transport: 'streamable-http'
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
        </style>
      </head>
      <body>
        <h1>RTM MCP Server</h1>
        <p>This is an OAuth2-compatible MCP server for Remember The Milk using Streamable HTTP.</p>
        
        <h2>Integration with Claude.ai</h2>
        <ol>
          <li>Go to Claude.ai settings</li>
          <li>Navigate to "Integrations"</li>
          <li>Click "Add Integration"</li>
          <li>Enter this URL: <code>${baseUrl}</code></li>
          <li>Follow the authentication flow</li>
        </ol>
        
        <h2>Endpoints</h2>
        <ul>
          <li><code>GET /authorize</code> - OAuth2 authorization</li>
          <li><code>POST /token</code> - OAuth2 token exchange</li>
          <li><code>* /mcp</code> - MCP Streamable HTTP endpoint</li>
        </ul>
      </body>
    </html>
  `);
});

export default app;
export { RtmMCP };