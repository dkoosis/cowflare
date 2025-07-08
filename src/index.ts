// Updated src/index.ts - Properly integrating McpAgent.serve() with authentication
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie } from "hono/cookie";
import { createRtmHandler } from "./rtm-handler";
import { RtmMCP } from "./rtm-mcp";
import { McpAgent } from "agents/mcp";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

// Add CORS middleware
app.use('/*', cors({
  origin: ['https://claude.ai', 'http://localhost:*'],
  allowMethods: ['GET', 'POST', 'OPTIONS', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id'],
  credentials: true,
  exposedHeaders: ['Mcp-Session-Id']
}));

// Mount the OAuth2 adapter endpoints
const rtmHandler = createRtmHandler();
app.route('/', rtmHandler);

// MCP SPEC REQUIREMENT: Protected Resource Metadata
app.get('/.well-known/oauth-protected-resource', async (c) => {
  const baseUrl = c.env.SERVER_URL || `https://${c.req.header('host')}`;
  
  // Log this critical discovery request
  const { DebugLogger } = await import('./debug-logger');
  const logger = new DebugLogger(c.env);
  await logger.log('protected_resource_discovery', {
    endpoint: '/.well-known/oauth-protected-resource',
    user_agent: c.req.header('User-Agent'),
    referer: c.req.header('Referer'),
    authorization: !!c.req.header('Authorization')
  });
  
  console.log('[Protected Resource Metadata] Request received');
  
  const metadata = {
    resource: `${baseUrl}/mcp`,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ['header'],
    resource_signing_alg_values_supported: ['none'],
    resource_documentation: baseUrl,
    scopes_supported: ['read', 'delete']
  };
  
  return c.json(metadata);
});

// Create the MCP handler using McpAgent's built-in serve() method
const mcpHandler = McpAgent.serve('/mcp', {
  binding: 'MCP_OBJECT',  // This matches the Durable Object binding name in wrangler.toml
  corsOptions: {
    origin: '*', // CORS is already handled by Hono middleware
  }
});

// Handle MCP requests with authentication
app.all('/mcp', async (c) => {
  console.log('[MCP] Request:', {
    method: c.req.method,
    hasAuth: !!c.req.header('Authorization'),
    sessionId: c.req.header('Mcp-Session-Id')
  });

  const authHeader = c.req.header('Authorization');
  const baseUrl = c.env.SERVER_URL || `https://${c.req.header('host')}`;
  
  // For MCP requests, we need to check auth
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('[MCP Auth] Missing or invalid auth header');
    
    c.header('WWW-Authenticate', 
      `Bearer realm="${baseUrl}/mcp", ` +
      `resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`
    );
    
    return c.json({ 
      error: 'unauthorized',
      error_description: 'Bearer token required' 
    }, 401);
  }

  const token = authHeader.substring(7);
  const tokenData = await c.env.AUTH_STORE.get(`token:${token}`);
  
  if (!tokenData) {
    console.log('[MCP Auth] Token not found in store');
    
    c.header('WWW-Authenticate', 
      `Bearer realm="${baseUrl}/mcp", ` +
      `error="invalid_token", ` +
      `error_description="The access token is invalid", ` +
      `resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`
    );
    
    return c.json({ 
      error: 'invalid_token',
      error_description: 'The access token is invalid' 
    }, 401);
  }

  const { userName, userId } = JSON.parse(tokenData);
  console.log('[MCP Auth] Token valid:', { userName, userId });
  
  // Create an extended execution context with props
  const extendedCtx = {
    ...c.executionCtx,
    props: {
      rtmToken: token,
      userName,
      userId
    }
  };
  
  // Now delegate to McpAgent's handler with the authenticated context
  try {
    // The mcpHandler.fetch expects (request, env, ctx)
    const response = await mcpHandler.fetch(c.req.raw, c.env, extendedCtx);
    return response;
  } catch (error) {
    console.error('[MCP] Handler error:', error);
    return c.json({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: "Internal server error",
        data: error.message
      },
      id: null
    }, 500);
  }
});

// Debug endpoint with enhanced dashboard
app.get('/debug', async (c) => {
  const { createEnhancedDebugDashboard } = await import('./debug-logger');
  return createEnhancedDebugDashboard()(c);
});

// Health check endpoint
app.get('/health', (c) => {
  return c.json({ 
    status: 'ok',
    service: 'rtm-mcp-server',
    version: '2.4.0',
    transport: 'streamable-http',
    mcp_compliant: true
  });
});

export default app;
export { RtmMCP };  // Export the Durable Object class