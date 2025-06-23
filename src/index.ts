/**
 * RTM MCP Server - Simplified OAuth2 Adapter Architecture
 * 
 * ARCHITECTURAL OVERVIEW:
 * This server provides an OAuth2-compatible interface for MCP clients (like Claude.ai)
 * while internally using Remember The Milk's custom frob-based authentication.
 * 
 * KEY PRINCIPLES:
 * 1. NO USER DATABASE - We only store temporary session data and tokens
 * 2. STATELESS OPERATION - Tokens are stored only for active MCP sessions
 * 3. OAUTH2 ADAPTER - We present standard OAuth2 endpoints but use RTM's flow internally
 * 
 * FLOW:
 * 1. MCP client requests /oauth/authorize
 * 2. We get RTM frob, store session temporarily, redirect to RTM
 * 3. User authorizes at RTM and returns to /oauth/callback
 * 4. We exchange frob for RTM token, generate OAuth code
 * 5. MCP client exchanges code for token at /oauth/token
 * 6. Token is passed to Durable Object for the session
 * 
 * STORAGE:
 * - AUTH_STORE KV: Temporary session data (expires in 10 min)
 * - Durable Object: Token for active MCP session only
 */
// File: srcs/index.ts

import { Hono } from "hono";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RtmApi } from "./rtm-api";
import * as schemas from "./schemas";
import { toInputSchema } from "./schemas/index";

// Props passed to MCP agent after OAuth
type Props = {
  rtmToken: string;
  userName: string;
};

type State = null;

/**
 * MCP Durable Object - Handles the actual MCP connection
 * Stores RTM token only for the duration of the active session
 */
export class RtmMCP extends McpAgent<Env, State, Props> {
  server = new McpServer({
    name: "Remember The Milk MCP Server",
    version: "2.0.0",
  });

  private api: RtmApi;

  async init() {
    if (!this.props?.rtmToken) {
      throw new Error('RTM token required');
    }

    this.api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);

    // Test Connection Tool
    this.server.tool(
      "test_connection",
      {
        description: "Test the MCP server connection",
        inputSchema: toInputSchema(z.object({}))
      },
      async () => ({
        content: [{
          type: "text",
          text: `✅ Connection successful! Connected as: ${this.props.userName}\n\nAvailable tools:
- rtm_get_lists: Get all your RTM lists
- rtm_add_task: Add new tasks
- rtm_complete_task: Mark tasks as complete
- rtm_get_tasks: Get tasks from lists
- rtm_search_tasks: Search tasks`
        }]
      })
    );

    // Get Lists Tool
    this.server.tool(
      "rtm_get_lists",
      {
        description: "Get all RTM lists",
        inputSchema: toInputSchema(z.object({}))
      },
      async () => {
        const response = await this.api.makeRequest('rtm.lists.getList', {
          auth_token: this.props.rtmToken
        });
        return {
          content: [{
            type: "text",
            text: this.api.formatLists(response.lists.list)
          }]
        };
      }
    );

    // Add Task Tool
    this.server.tool(
      "rtm_add_task",
      {
        description: "Add a new task to RTM",
        inputSchema: toInputSchema(schemas.AddTaskSchema.omit({ auth_token: true, timeline: true }))
      },
      async (args) => {
        const timeline = await this.api.createTimeline(this.props.rtmToken);
        const response = await this.api.makeRequest('rtm.tasks.add', {
          auth_token: this.props.rtmToken,
          timeline,
          ...args
        });
        return {
          content: [{
            type: "text",
            text: `Task added: ${response.list.taskseries.name} (ID: ${response.list.taskseries.id})`
          }]
        };
      }
    );

    // Complete Task Tool
    this.server.tool(
      "rtm_complete_task",
      {
        description: "Mark a task as complete",
        inputSchema: toInputSchema(schemas.CompleteTaskSchema.omit({ auth_token: true, timeline: true }))
      },
      async ({ list_id, taskseries_id, task_id }) => {
        const timeline = await this.api.createTimeline(this.props.rtmToken);
        await this.api.makeRequest('rtm.tasks.complete', {
          auth_token: this.props.rtmToken,
          timeline,
          list_id,
          taskseries_id,
          task_id
        });
        return {
          content: [{
            type: "text",
            text: `Task completed successfully`
          }]
        };
      }
    );

    // Get Tasks Tool
    this.server.tool(
      "rtm_get_tasks",
      {
        description: "Get tasks from RTM lists",
        inputSchema: toInputSchema(schemas.GetTasksSchema.omit({ auth_token: true }))
      },
      async (args) => {
        const response = await this.api.makeRequest('rtm.tasks.getList', {
          auth_token: this.props.rtmToken,
          ...args
        });
        return {
          content: [{
            type: "text",
            text: this.api.formatTasks(response.tasks.list)
          }]
        };
      }
    );

    // Search Tasks Tool
    this.server.tool(
      "rtm_search_tasks",
      {
        description: "Search tasks using RTM query syntax",
        inputSchema: toInputSchema(schemas.SearchTasksSchema.omit({ auth_token: true }))
      },
      async ({ query }) => {
        const response = await this.api.makeRequest('rtm.tasks.getList', {
          auth_token: this.props.rtmToken,
          filter: query
        });
        return {
          content: [{
            type: "text",
            text: this.api.formatTasks(response.tasks.list)
          }]
        };
      }
    );
  }
}

/**
 * Main HTTP handler - Provides OAuth2 adapter endpoints
 * NO USER DATABASE - Only temporary session management
 */
const app = new Hono<{ Bindings: Env }>();

/**
 * OAuth2 Authorization Endpoint
 * Initiates RTM authentication flow while presenting OAuth2 interface
 */
app.get("/oauth/authorize", async (c) => {
  try {
    const { RTM_API_KEY, RTM_SHARED_SECRET } = c.env;
    
    if (!RTM_API_KEY || !RTM_SHARED_SECRET) {
      console.error("Server configuration error: RTM_API_KEY or RTM_SHARED_SECRET is not set.");
      return c.text("Server is not configured correctly. Missing API credentials.", 500);
    }
    
    const { 
      response_type, 
      client_id, 
      redirect_uri, 
      state, 
      scope,
      code_challenge,
      code_challenge_method 
    } = c.req.query();
    
    if (response_type !== "code") {
      return c.text("unsupported_response_type", 400);
    }
    
    const api = new RtmApi(RTM_API_KEY, RTM_SHARED_SECRET);
    const frob = await api.getFrob();
    const sessionId = crypto.randomUUID();
    
    // Store OAuth session with PKCE parameters
    await c.env.AUTH_STORE.put(
      `oauth_session:${sessionId}`,
      JSON.stringify({
        frob,
        state,
        redirect_uri,
        client_id,
        code_challenge,
        code_challenge_method,
        created_at: Date.now()
      }),
      { expirationTtl: 600 }
    );
    
    await c.env.AUTH_STORE.put(
      `frob_session:${frob}`,
      sessionId,
      { expirationTtl: 600 }
    );
    
    const perms = scope === "read" ? "read" : "delete";
    const authUrl = await api.getAuthUrl(frob, perms);
    const callbackUrl = new URL("/oauth/callback", c.req.url);
    callbackUrl.searchParams.set("frob", frob);
    
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Connect to Remember The Milk</title>
          <style>
            body {
              font-family: system-ui, sans-serif;
              background: #f9fafb;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
            }
            .container {
              background: white;
              padding: 2rem;
              border-radius: 8px;
              box-shadow: 0 1px 3px rgba(0,0,0,0.1);
              max-width: 400px;
              text-align: center;
            }
            .button {
              display: inline-block;
              background: #0073e6;
              color: white;
              padding: 0.75rem 2rem;
              border-radius: 6px;
              text-decoration: none;
              margin: 0.5rem;
            }
            .button:hover { background: #005bb5; }
            .secondary { background: #6c757d; }
            .secondary:hover { background: #5a6268; }
            .info { color: #666; margin: 1rem 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Connect to Remember The Milk</h1>
            <p class="info">
              To use RTM tools in your MCP client, authorize access to your RTM account.
            </p>
            <p>
              <a href="${authUrl}" target="_blank" class="button">
                Authorize with RTM
              </a>
            </p>
            <p class="info">
              After authorizing in RTM, click below to complete setup:
            </p>
            <p>
              <a href="${callbackUrl.toString()}" class="button secondary">
                Complete Setup
              </a>
            </p>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("OAuth authorize error:", error);
    return c.text(`Authorization error: ${error.message}`, 500);
  }
});
/**
 * RTM Callback Handler
 * Completes the OAuth2 flow after RTM authorization
 */
app.get("/oauth/callback", async (c) => {
  const frob = c.req.query("frob");
  
  if (!frob) {
    return c.text("Missing frob parameter", 400);
  }
  
  // Retrieve session from temporary storage
  const sessionId = await c.env.AUTH_STORE.get(`frob_session:${frob}`);
  if (!sessionId) {
    return c.text("Invalid or expired session", 400);
  }
  
  const sessionData = await c.env.AUTH_STORE.get(`oauth_session:${sessionId}`);
  if (!sessionData) {
    return c.text("Session data not found", 400);
  }
  
  const session = JSON.parse(sessionData);
  const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);
  
  try {
    // Exchange frob for permanent RTM token
    const authToken = await api.getToken(frob);
    
    // Get user info
    const userInfo = await api.makeRequest('rtm.auth.checkToken', {
      auth_token: authToken
    });
    
    // Generate OAuth authorization code
    const code = crypto.randomUUID();
    
    // Store code->token mapping temporarily (10 minutes)
    // This allows the OAuth token exchange to work
    await c.env.AUTH_STORE.put(
      `oauth_code:${code}`,
      JSON.stringify({
        auth_token: authToken,
        user_name: userInfo.auth.user.fullname || userInfo.auth.user.username,
        client_id: session.client_id,
        created_at: Date.now()
      }),
      { expirationTtl: 600 }
    );
    
    // Clean up session data
    await c.env.AUTH_STORE.delete(`oauth_session:${sessionId}`);
    await c.env.AUTH_STORE.delete(`frob_session:${frob}`);
    
    // Redirect back to client with code
    const redirectUrl = new URL(session.redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (session.state) {
      redirectUrl.searchParams.set("state", session.state);
    }
    
    return c.redirect(redirectUrl.toString());
    
  } catch (error) {
    console.error("RTM authentication failed:", error);
    return c.text(`Authentication failed: ${error.message}`, 401);
  }
});

/**
 * OAuth2 Token Exchange Endpoint
 * Exchanges authorization code for access token
 */
app.post("/oauth/token", async (c) => {
  const contentType = c.req.header("content-type");
  let body: any;
  
  if (contentType?.includes("application/json")) {
    body = await c.req.json();
  } else {
    body = await c.req.parseBody();
  }
  
  const { grant_type, code, client_id } = body;
  
  if (grant_type !== "authorization_code") {
    return c.json({ error: "unsupported_grant_type" }, 400);
  }
  
  // Retrieve token from temporary storage
  const codeMappingData = await c.env.AUTH_STORE.get(`oauth_code:${code}`);
  if (!codeMappingData) {
    return c.json({ error: "invalid_grant" }, 400);
  }
  
  const codeMapping = JSON.parse(codeMappingData);
  
  // Validate client_id if provided
  if (client_id && codeMapping.client_id !== client_id) {
    return c.json({ error: "invalid_client" }, 400);
  }
  
  // Clean up code (one-time use)
  await c.env.AUTH_STORE.delete(`oauth_code:${code}`);
  
  // Return OAuth2 token response
  // The token is the RTM auth token, which will be passed to the Durable Object
  return c.json({
    access_token: codeMapping.auth_token,
    token_type: "Bearer",
    scope: "delete",
    // Include metadata for the MCP connection
    metadata: {
      user_name: codeMapping.user_name
    }
  });
});

/**
 * SSE endpoint for MCP connection
 * The 'agents' package handles extracting Bearer token and passing to DO
 */
app.all("/sse", async (c) => {
  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.text("Unauthorized", 401);
  }
  
  const token = auth.substring(7);
  
  // Quick validation that token looks like RTM token
  if (!token || token.length < 20) {
    return c.text("Invalid token", 401);
  }
  
  // Get user info from token for props
  const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);
  try {
    const userInfo = await api.makeRequest('rtm.auth.checkToken', {
      auth_token: token
    });
    
    // Mount DO with props
    return RtmMCP.mount("/sse", {
      rtmToken: token,
      userName: userInfo.auth.user.fullname || userInfo.auth.user.username
    })(c.req.raw, c.env, c.executionCtx);
    
  } catch (error) {
    return c.text("Invalid token", 401);
  }
});

// Health check endpoint
app.get("/", (c) => {
  return c.json({
    name: "Remember The Milk MCP Server",
    version: "2.0.0",
    endpoints: {
      oauth_authorize: "/oauth/authorize",
      oauth_token: "/oauth/token",
      mcp_sse: "/sse"
    }
  });
});

// OAuth2 Authorization Server Metadata (Discovery)
app.get("/.well-known/oauth-authorization-server", (c) => {
  const baseUrl = new URL(c.req.url).origin;
  
  return c.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"]
  });
});

// Dynamic Client Registration
app.post("/register", async (c) => {
  const body = await c.req.json();
  const { client_name, redirect_uris } = body;
  
  if (!client_name || !redirect_uris || !Array.isArray(redirect_uris)) {
    return c.json({ error: "invalid_client_metadata" }, 400);
  }
  
  // Generate client_id
  const client_id = crypto.randomUUID();
  
  // Store client registration (optional - you can skip this if accepting any client)
  await c.env.AUTH_STORE.put(
    `client:${client_id}`,
    JSON.stringify({
      client_name,
      redirect_uris,
      created_at: Date.now()
    }),
    { expirationTtl: 86400 * 30 } // 30 days
  );
  
  return c.json({
    client_id,
    client_name,
    redirect_uris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none"
  }, 201);
});

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => 
    app.fetch(request, env, ctx)
};