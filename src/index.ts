/**
 * RTM MCP Server - OAuth2 Adapter with PKCE
 *
 * This server provides a secure, OAuth2-compatible interface for clients like Claude.ai
 * while internally using Remember The Milk's custom frob-based authentication. It fully
 * supports the PKCE (Proof Key for Code Exchange) extension for enhanced security.
 */
import { Hono, ExecutionContext } from "hono";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RtmApi } from "./rtm-api";
import * as schemas from "./schemas";
import { toInputSchema } from "./schemas/index";

// Types
interface Env {
  RTM_API_KEY: string;
  RTM_SHARED_SECRET: string;
  AUTH_STORE: KVNamespace;
  RTM_MCP: DurableObjectNamespace;
}

type Props = {
  rtmToken: string;
  userName: string;
};

type State = null;

// --- PKCE Helper Function ---
/**
 * Verifies the PKCE code challenge.
 * @param codeVerifier The plain-text string from the client.
 * @param codeChallenge The hashed and encoded string from the initial auth request.
 * @returns {Promise<boolean>} True if the verifier matches the challenge.
 */
// --- PKCE Helper Function ---
async function verifyPkceChallenge(codeVerifier: string, codeChallenge: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === codeChallenge;
}

/**
 * MCP Durable Object - Handles the actual MCP connection.
 * Stores the RTM token only for the duration of the active session.
 */
export class RtmMCP extends McpAgent<Env, State, Props> {
  server = new McpServer({
    name: "Remember The Milk MCP Server",
    version: "2.0.0",
  });

  private api!: RtmApi;

  async init() {
    if (!this.props?.rtmToken) {
      throw new Error('RTM token is required to initialize the agent.');
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
 * Main HTTP handler - Provides OAuth2 adapter endpoints.
 */
const app = new Hono<{ Bindings: Env }>();

/**
 * OAuth2 Authorization Endpoint
 */
app.get("/authorize", async (c) => {
  const { response_type, client_id, redirect_uri, state, scope, code_challenge, code_challenge_method } = c.req.query();
  console.log("Authorization request received for /authorize");

  if (response_type !== "code" || !client_id || !redirect_uri || !state || !code_challenge) {
    console.error("[/authorize] Invalid request: missing required parameters.");
    return c.text("invalid_request: missing required parameters.", 400);
  }
  if (code_challenge_method !== 'S256') {
    console.error("[/authorize] Invalid request: code_challenge_method must be S256.");
    return c.text("invalid_request: code_challenge_method must be S256.", 400);
  }

  const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);
  const frob = await api.getFrob();

  await c.env.AUTH_STORE.put(
    `frob_session:${frob}`,
    JSON.stringify({ state, redirect_uri, client_id, code_challenge, code_challenge_method }),
    { expirationTtl: 600 }
  );

  const perms = scope === "read" ? "read" : "delete";
  const authUrl = await api.getAuthUrl(frob, perms);

  const ourCallbackUrl = new URL("/callback", c.req.url);
  ourCallbackUrl.searchParams.set("frob", frob);

  console.log("[/authorize] Successfully generated frob and redirecting user via HTML page.");
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Connect to Remember The Milk</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f0f2f5; display: grid; place-items: center; min-height: 100vh; margin: 0; }
          .container { background: white; padding: 2.5rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); max-width: 400px; text-align: center; }
          .spinner { border: 3px solid #f3f3f3; border-top: 3px solid #007aff; border-radius: 50%; width: 20px; height: 20px; animation: spin 1s linear infinite; margin-right: 10px; }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Connecting to Remember The Milk...</h1>
          <p>Your browser will open a new window to authorize access. After you grant access, please close the RTM window to complete the connection.</p>
          <div class="spinner"></div>
        </div>
        <script>
          document.addEventListener('DOMContentLoaded', () => {
            const authWindow = window.open("${authUrl}", 'rtm_auth', 'width=800,height=600,scrollbars=yes');
            const checkInterval = setInterval(() => {
              if (authWindow && authWindow.closed) {
                clearInterval(checkInterval);
                document.querySelector('.container h1').textContent = 'Finalizing Connection...';
                window.location.href = "${ourCallbackUrl.toString()}";
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
 */
app.get("/callback", async (c) => {
  const frob = c.req.query("frob");
  console.log(`[/callback] Received callback for frob: ${frob}`);
  if (!frob) return c.text("Missing frob parameter", 400);

  const sessionJSON = await c.env.AUTH_STORE.get(`frob_session:${frob}`);
  if (!sessionJSON) {
    console.error(`[/callback] No session found for frob: ${frob}`);
    return c.text("Invalid or expired session", 400);
  }
  
  const session = JSON.parse(sessionJSON);
  const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);

  try {
    const authToken = await api.getToken(frob);
    const userInfo = await api.makeRequest('rtm.auth.checkToken', { auth_token: authToken });
    const code = crypto.randomUUID();

    console.log(`[/callback] Successfully exchanged frob for RTM token. Generating auth code: ${code}`);
    await c.env.AUTH_STORE.put(
      `oauth_code:${code}`,
      JSON.stringify({
        auth_token: authToken,
        user_name: userInfo.auth.user.fullname || userInfo.auth.user.username,
        client_id: session.client_id,
        code_challenge: session.code_challenge,
      }),
      { expirationTtl: 600 }
    );

    await c.env.AUTH_STORE.delete(`frob_session:${frob}`);

    const redirectUrl = new URL(session.redirect_uri);
    redirectUrl.searchParams.set("code", code);
    redirectUrl.searchParams.set("state", session.state);
    
    console.log(`[/callback] Redirecting back to client at: ${redirectUrl.toString()}`);
    return c.redirect(redirectUrl.toString());

  } catch (error: any) {
    console.error("[/callback] RTM authentication failed:", error);
    return c.text(`Authentication failed: ${error.message}`, 401);
  }
});

/**
 * OAuth2 Token Exchange Endpoint
 */
app.post("/token", async (c) => {
  console.log("[/token] Received POST request to exchange token.");
  
  const body: any = await c.req.parseBody();
  console.log("[/token] Request body:", JSON.stringify(body));

  const { grant_type, code, client_id, code_verifier } = body;

  if (grant_type !== "authorization_code") {
    console.error("[/token] Invalid grant_type:", grant_type);
    return c.json({ error: "unsupported_grant_type" }, 400);
  }
  if (!code || !code_verifier) {
    console.error("[/token] Missing code or code_verifier.");
    return c.json({ error: "invalid_request", error_description: "Missing code or code_verifier" }, 400);
  }

  const codeMappingJSON = await c.env.AUTH_STORE.get(`oauth_code:${code}`);
  if (!codeMappingJSON) {
    console.error(`[/token] Invalid code provided: ${code}`);
    return c.json({ error: "invalid_grant" }, 400);
  }
  console.log("[/token] Found matching auth code in KV store.");

  const codeMapping = JSON.parse(codeMappingJSON);
  await c.env.AUTH_STORE.delete(`oauth_code:${code}`);

  if (client_id && codeMapping.client_id !== client_id) {
    console.error(`[/token] client_id mismatch. Expected ${codeMapping.client_id}, got ${client_id}`);
    return c.json({ error: "invalid_client" }, 400);
  }

  console.log("[/token] Verifying PKCE challenge...");
  const isPkceValid = await verifyPkceChallenge(code_verifier, codeMapping.code_challenge);
  
  if (!isPkceValid) {
    console.error("[/token] PKCE verification FAILED.");
    return c.json({ error: "invalid_grant", error_description: "PKCE verification failed" }, 400);
  }
  console.log("[/token] PKCE verification successful. Returning access token.");

  return c.json({
    access_token: codeMapping.auth_token,
    token_type: "Bearer",
    scope: "delete",
    user_name: codeMapping.user_name,
    metadata: { user_name: codeMapping.user_name }
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
      authorize: "/authorize",
      token: "/token",
      mcp_sse: "/sse"
    }
  });
});


export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => 
    app.fetch(request, env, ctx)
};
