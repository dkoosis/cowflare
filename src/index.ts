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
 * Initiates RTM authentication flow by serving a self-contained HTML page.
 * This page manages the non-standard RTM auth flow (which lacks an automatic redirect)
 * and bridges it to the standard OAuth2 flow expected by clients like Claude.ai.
 */
app.get("/oauth/authorize", async (c) => {
  const { response_type, client_id, redirect_uri, state, scope } = c.req.query();

  // Validate standard OAuth2 parameters
  if (response_type !== "code" || !client_id || !redirect_uri || !state) {
    return c.text("invalid_request: missing required parameters", 400);
  }

  const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);
  const frob = await api.getFrob();

  // Store the original request details, keyed by the frob.
  // This is crucial for retrieving the state and client's redirect_uri later.
  await c.env.AUTH_STORE.put(
    `frob_session:${frob}`,
    JSON.stringify({ state, redirect_uri, client_id }),
    { expirationTtl: 600 } // 10 minutes
  );

  const perms = scope === "read" ? "read" : "delete";
  const authUrl = await api.getAuthUrl(frob, perms);

  // This is the URL on our own server that the page will call once the RTM popup is closed.
  const ourCallbackUrl = new URL("/oauth/callback", c.req.url);
  ourCallbackUrl.searchParams.set("frob", frob);

  // Return the HTML page that will manage the popup and polling logic.
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Connect to Remember The Milk</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f0f2f5; display: grid; place-items: center; min-height: 100vh; margin: 0; }
          .container { background: white; padding: 2.5rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); max-width: 400px; text-align: center; }
          h1 { margin-top: 0; }
          .button { display: inline-block; background: #007aff; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500; border: none; font-size: 16px; cursor: pointer; transition: background-color 0.2s; }
          .button:hover { background: #0056b3; }
          .info { color: #666; margin: 1.5rem 0; line-height: 1.5; }
          .status { display: none; align-items: center; justify-content: center; margin-top: 1.5rem; }
          .spinner { border: 3px solid #f3f3f3; border-top: 3px solid #007aff; border-radius: 50%; width: 20px; height: 20px; animation: spin 1s linear infinite; margin-right: 10px; }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Connect to Remember The Milk</h1>
          <p class="info">Click below to open the RTM authorization window. After you grant access, please close that window to complete the connection.</p>
          <button id="authButton" class="button">Connect to RTM</button>
          <div id="status" class="status">
            <div class="spinner"></div>
            <span>Waiting for authorization...</span>
          </div>
        </div>
        <script>
          const authButton = document.getElementById('authButton');
          const statusDiv = document.getElementById('status');
          
          authButton.addEventListener('click', () => {
            const rtmAuthUrl = "${authUrl}";
            const ourCallbackUrl = "${ourCallbackUrl.toString()}";
            
            const authWindow = window.open(rtmAuthUrl, 'rtm_auth', 'width=800,height=600,scrollbars=yes');
            
            authButton.style.display = 'none';
            statusDiv.style.display = 'flex';
            
            const checkInterval = setInterval(() => {
              if (authWindow && authWindow.closed) {
                clearInterval(checkInterval);
                statusDiv.innerHTML = '<span>Finalizing connection...</span>';
                // The popup is closed, now we trigger our own callback to get the token and redirect.
                window.location.href = ourCallbackUrl;
              }
            }, 1000);
          });
        </script>
      </body>
    </html>
  `);
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


export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => 
    app.fetch(request, env, ctx)
};