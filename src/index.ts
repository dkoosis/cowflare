// Updated src/index.ts with MCP spec-compliant implementation

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

// ===== MCP SPEC REQUIREMENT: Protected Resource Metadata =====
// This endpoint MUST be implemented according to RFC9728
app.get('/.well-known/oauth-protected-resource', (c) => {
  const baseUrl = c.env.SERVER_URL || `https://${c.req.header('host')}`;
  
  console.log('[Protected Resource Metadata] Request received');
  
  return c.json({
    // The canonical URI of the MCP server resource
    resource: `${baseUrl}/mcp`,
    
    // Authorization servers that can issue tokens for this resource
    authorization_servers: [baseUrl],
    
    // Additional metadata (optional but good practice)
    bearer_methods_supported: ['header'],
    resource_signing_alg_values_supported: ['none'],
    resource_documentation: baseUrl,
    
    // Optional: scopes supported by this resource
    scopes_supported: ['read', 'delete']
  });
});

// Create MCP app for Streamable HTTP endpoint
const mcpApp = new Hono<{ Bindings: Env }>();

// ===== MCP SPEC REQUIREMENT: Bearer Token Authentication with WWW-Authenticate =====
// This middleware MUST return proper WWW-Authenticate headers according to RFC9728
mcpApp.use('/*', async (c, next) => {
  console.log('[MCP Auth] Request:', {
    method: c.req.method,
    url: c.req.url,
    hasAuth: !!c.req.header('Authorization')
  });

  const authHeader = c.req.header('Authorization');
  const baseUrl = c.env.SERVER_URL || `https://${c.req.header('host')}`;
  
  // Check for missing or invalid authorization header
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('[MCP Auth] Missing or invalid auth header');
    
    // MCP SPEC: MUST return WWW-Authenticate header with resource_metadata
    c.header('WWW-Authenticate', 
      `Bearer realm="${baseUrl}/mcp", ` +
      `resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`
    );
    
    // Return 401 with proper error response body
    return c.json({ 
      error: 'unauthorized',
      error_description: 'Bearer token required' 
    }, 401);
  }

  // Extract and validate token
  const token = authHeader.substring(7);
  const tokenData = await c.env.AUTH_STORE.get(`token:${token}`);
  
  if (!tokenData) {
    console.log('[MCP Auth] Token not found in store');
    
    // MCP SPEC: MUST return WWW-Authenticate with error details for invalid tokens
    c.header('WWW-Authenticate', 
      `Bearer realm="${baseUrl}/mcp", ` +
      `error="invalid_token", ` +
      `error_description="The access token is invalid", ` +
      `resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`
    );
    
    // Return 401 with error details
    return c.json({ 
      error: 'invalid_token',
      error_description: 'The access token is invalid' 
    }, 401);
  }

  // Token is valid - parse user data
  const { userName, userId } = JSON.parse(tokenData);
  console.log('[MCP Auth] Token valid:', { userName, userId });
  
  // Set context for downstream handlers
  c.set('rtmToken', token);
  c.set('userName', userName);
  c.set('userId', userId);
  
  // Continue to MCP handler
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
    transport: 'streamable-http',
    mcp_compliant: true  // Now we're spec-compliant!
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
          .new-badge {
            background: #28a745;
            color: white;
            padding: 0.2rem 0.4rem;
            border-radius: 3px;
            font-size: 0.8rem;
            vertical-align: super;
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
          <li><code>GET /.well-known/oauth-protected-resource</code> <span class="new-badge">NEW</span> - MCP resource metadata</li>
          <li><code>* /mcp</code> - MCP Streamable HTTP endpoint (with proper WWW-Authenticate)</li>
        </ul>
        
        <h2>MCP Spec Compliance</h2>
        <p>This server now implements:</p>
        <ul>
          <li>✅ OAuth 2.0 Protected Resource Metadata (RFC9728)</li>
          <li>✅ WWW-Authenticate headers on 401 responses</li>
          <li>✅ Proper bearer token validation</li>
        </ul>
      </body>
    </html>
  `);
});

export default app;
export { RtmMCP };