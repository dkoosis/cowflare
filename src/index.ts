/**
 * @file index.ts
 * @description Main entry point for the RTM MCP server. Sets up routing and tool registration.
 */

import { Hono } from 'hono';
import { Server as McpServer, type CallToolResult } from '@modelcontextprotocol/sdk';
import { createFetchHandler } from '@modelcontextprotocol/sdk/server';
import { getSession } from './workers-oauth-utils';
import { rtm } from './rtm-handler';
import { makeRTMRequest, formatLists } from './rtm-api';
import * as schemas from './schemas';
import { toInputSchema } from './schemas';
import type { Env } from './types';
import type { z } from 'zod';

// Helper for extracting inferred types from Zod schemas
type InferSchema<T> = T extends z.ZodType<infer U> ? U : never;

// Initialize the Hono router
const app = new Hono<{ Bindings: Env }>();

// --- Public Authentication Routes ---
app.get('/login', rtm.login);
app.get('/callback', rtm.callback);
app.post('/logout', rtm.logout); // Can be app.get as well

// --- MCP Server and Tool Registration ---
const mcpServer = new McpServer({
  name: "rtm-mcp-server-refactored",
  version: "1.0.0",
});

// Helper function for creating success responses
function createSuccessResponse(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

// Example: Registering the 'rtm_get_lists' tool
mcpServer.registerTool(
  "rtm_get_lists",
  {
    annotations: {
      title: "Get RTM Lists",
      description: "Retrieves all task lists from your Remember The Milk account.",
      readOnlyHint: true,
    },
    // The input schema no longer needs an auth_token
    inputSchema: toInputSchema(schemas.GetListsSchema.omit({ auth_token: true }))
  },
  // The tool handler receives the Hono context `c`
  async (_args: Omit<InferSchema<typeof schemas.GetListsSchema>, 'auth_token'>, c: any) => {
    // The middleware guarantees the session and token exist here
    const session = c.get('session');
    const authToken = session.get('rtm_auth_token');

    const response = await makeRTMRequest(c.env, 'rtm.lists.getList', { auth_token: authToken });
    const formattedLists = formatLists(response.lists.list);

    return createSuccessResponse(formattedLists);
  }
);
// ... register your other RTM tools here in the same way ...

// --- Protected MCP Endpoint ---
const mcpHandler = createFetchHandler(mcpServer);

// Middleware to protect the /mcp endpoint
app.use('/mcp', async (c, next) => {
  const session = await getSession(c.req.raw, c.env.SESSION_KV, c.env.OAUTH_SESSION_SECRET);
  if (!session || !session.get('rtm_auth_token')) {
    return c.json({ jsonrpc: "2.0", error: { code: 401, message: "Unauthorized. Please log in via the /login endpoint." }}, 401);
  }
  // Make the validated session available to the tool handlers
  c.set('session', session);
  await next();
});

// The actual MCP route that handles tool calls
app.post('/mcp', async (c) => {
  return mcpHandler(c.req.raw, { env: c.env, ctx: c });
});

// --- Root and Health Check Routes ---
app.get('/', (c) => c.text('RTM MCP Server is running. Use /login to authenticate.'));
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

export default app;