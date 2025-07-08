// src/index.ts - TEST VERSION
import { Hono } from "hono";
import { cors } from "hono/cors";
import { RtmMCP } from "./rtm-mcp";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.use('/*', cors({
  origin: ['https://claude.ai', 'http://localhost:*'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// ONLY Streamable HTTP endpoint - NO SSE
app.all('/mcp/*', async (c) => {
  console.log('[TEST] Streamable HTTP request:', c.req.url);
  
  // For initial test - no auth, just direct to MCP
  const id = c.env.RTM_MCP.idFromName("test-user");
  const stub = c.env.RTM_MCP.get(id);
  
  const url = new URL(c.req.raw.url);
  url.searchParams.set('props', JSON.stringify({
    rtmToken: 'test-token', // You'll need a real token
    userName: 'Test User'
  }));
  
  const newRequest = new Request(url.toString(), {
    method: c.req.raw.method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
    duplex: 'half'
  });
  
  return stub.fetch(newRequest);
});

// Health check
app.get('/health', (c) => {
  return c.json({ 
    status: 'ok',
    transport: 'streamable-http-only',
    endpoints: ['/mcp']
  });
});

export default app;
export { RtmMCP };