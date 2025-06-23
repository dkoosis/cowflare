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
async function verifyPkceChallenge(codeVerifier: string, codeChallenge: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === codeChallenge;
}

/**
 * MCP Durable Object - Handles the actual MCP connection.
 */
export class RtmMCP extends McpAgent<Env, State, Props> {
  server = new McpServer({
    name: "Remember The Milk MCP Server",
    version: "2.4.0", // Version bump
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

  if (response_type !== "code" || !client_id || !redirect_uri || !state || !code_challenge) {
    return c.text("invalid_request: missing required parameters.", 400);
  }
  if (code_challenge_method !== 'S256') {
    return c.text("invalid_request: code_challenge_method must be S256.", 400);
  }

  const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);
  const frob = await api.getFrob();

  await c.env.AUTH_STORE.put(
    `frob_session:${frob}`,
    JSON.stringify({ state, redirect_uri, client_id, code_challenge, code_challenge_method, scope }),
    { expirationTtl: 600 }
  );

  const perms = scope === "read" ? "read" : "delete";
  const authUrl = await api.getAuthUrl(frob, perms);

  const ourCallbackUrl = new URL("/callback", c.req.url);
  ourCallbackUrl.searchParams.set("frob", frob);

  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Connect to Remember The Milk</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f0f2f5; display: grid; place-items: center; min-height: 100vh; margin: 0; }
          .container { background: white; padding: 2.5rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); max-width: 400px; text-align: center; }
          .button { display: inline-block; background: #007aff; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500; border: none; font-size: 16px; cursor: pointer; transition: background-color 0.2s; }
          .button:hover { background: #0056b3; }
          .info { color: #666; margin: 1.5rem 0; line-height: 1.5; }
          .error { color: #d93025; font-weight: 500; }
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
          const infoPara = document.querySelector('.info');
          
          authButton.addEventListener('click', () => {
            authButton.style.display = 'none';
            statusDiv.style.display = 'flex';
            infoPara.textContent = 'Waiting for authorization...';

            setTimeout(() => {
                const authWindow = window.open("${authUrl}", 'rtm_auth', 'width=800,height=600,scrollbars=yes');
                
                if (!authWindow || authWindow.closed || typeof authWindow.closed === 'undefined') {
                    statusDiv.style.display = 'none';
                    authButton.style.display = 'inline-block';
                    infoPara.innerHTML = '<strong class="error">Popup blocked!</strong> Please allow popups for this site and click the button again.';
                    return;
                }

                const checkInterval = setInterval(() => {
                if (authWindow.closed) {
                    clearInterval(checkInterval);
                    statusDiv.innerHTML = '<span>Finalizing connection...</span>';
                    window.location.href = "${ourCallbackUrl.toString()}";
                }
                }, 1000);
            }, 100);
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
  if (!frob) return c.text("Missing frob parameter", 400);

  const sessionJSON = await c.env.AUTH_STORE.get(`frob_session:${frob}`);
  if (!sessionJSON) return c.text("Invalid or expired session", 400);
  
  const session = JSON.parse(sessionJSON);
  const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);

  try {
    const authToken = await api.getToken(frob);
    const userInfo = await api.makeRequest('rtm.auth.checkToken', { auth_token: authToken });
    const code = crypto.randomUUID();

    await c.env.AUTH_STORE.put(
      `oauth_code:${code}`,
      JSON.stringify({
        auth_token: authToken,
        user_name: userInfo.auth.user.fullname || userInfo.auth.user.username,
        client_id: session.client_id,
        code_challenge: session.code_challenge,
        scope: session.scope,
      }),
      { expirationTtl: 600 }
    );

    await c.env.AUTH_STORE.delete(`frob_session:${frob}`);

    const redirectUrl = new URL(session.redirect_uri);
    redirectUrl.searchParams.set("code", code);
    redirectUrl.searchParams.set("state", session.state);
    
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
  console.log("[/token] endpoint hit. Processing token exchange.");

  try {
    const body: any = await c.req.parseBody();
    const { grant_type, code, client_id, code_verifier } = body;

    console.log(`[/token] Received body:`, { grant_type, code, client_id, code_verifier: code_verifier ? 'REDACTED' : 'MISSING' });

    if (grant_type !== "authorization_code") {
      console.error("[/token] Error: unsupported_grant_type. Received:", grant_type);
      return c.json({ error: "unsupported_grant_type" }, 400);
    }

    if (!code || !code_verifier) {
      console.error("[/token] Error: Missing code or code_verifier.", { hasCode: !!code, hasVerifier: !!code_verifier });
      return c.json({ error: "invalid_request", error_description: "Missing code or code_verifier" }, 400);
    }

    const codeMappingJSON = await c.env.AUTH_STORE.get(`oauth_code:${code}`);
    if (!codeMappingJSON) {
      console.error(`[/token] Error: Invalid or expired code. No entry found for oauth_code:${code}`);
      return c.json({ error: "invalid_grant", error_description: "Invalid or expired authorization code" }, 400);
    }
    console.log("[/token] Successfully retrieved session data from AUTH_STORE.");

    const codeMapping = JSON.parse(codeMappingJSON);
    
    await c.env.AUTH_STORE.delete(`oauth_code:${code}`);
    console.log(`[/token] Deleted oauth_code:${code} from AUTH_STORE.`);

    if (client_id && codeMapping.client_id !== client_id) {
      console.error(`[/token] Error: Invalid client_id. Expected ${codeMapping.client_id}, but received ${client_id}.`);
      return c.json({ error: "invalid_client" }, 400);
    }
    console.log("[/token] client_id validation passed.");

    const isPkceValid = await verifyPkceChallenge(code_verifier, codeMapping.code_challenge);
    if (!isPkceValid) {
      console.error("[/token] Error: PKCE verification failed. The provided code_verifier did not match the stored code_challenge.");
      return c.json({ error: "invalid_grant", error_description: "PKCE verification failed" }, 400);
    }
    console.log("[/token] PKCE verification successful.");

    const responsePayload = {
      access_token: codeMapping.auth_token,
      token_type: "Bearer",
      expires_in: 31536000, // 1 year in seconds
      scope: codeMapping.scope,
      metadata: { 
        user_name: codeMapping.user_name,
        client_id: codeMapping.client_id
      }
    };

    console.log("[/token] Successfully processed token exchange. Sending success response:", responsePayload);
    return c.json(responsePayload);

  } catch (error: any) {
    console.error("[/token] An unexpected error occurred:", error);
    return c.json({ error: "server_error", error_description: error.message }, 500);
  }
});

/**
 * SSE endpoint for MCP connection
 */
/**
 * SSE endpoint for MCP connection
 */
app.all("/sse", async (c) => {
  console.log("[/sse] Received request for SSE connection.");

  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) {
    console.error("[/sse] Unauthorized: Missing or invalid 'Authorization' header.");
    return c.text("Unauthorized", 401);
  }
  
  const token = auth.substring(7);
  if (!token || token.length < 20) {
    console.error("[/sse] Invalid token: Token is missing or too short.");
    return c.text("Invalid token", 401);
  }
  
  console.log("[/sse] Authorization header found, attempting to validate token with RTM.");
  const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);
  
  try {
    const userInfo = await api.makeRequest('rtm.auth.checkToken', { auth_token: token });
    console.log(`[/sse] RTM token validated for user: ${userInfo.auth.user.fullname || userInfo.auth.user.username}. Mounting Durable Object.`);
    
    return RtmMCP.mount("/sse", {
      rtmToken: token,
      userName: userInfo.auth.user.fullname || userInfo.auth.user.username
    })(c.req.raw, c.env, c.executionCtx);
    
  } catch (error) {
    console.error("[/sse] RTM token validation failed:", error);
    return c.text("Invalid token", 401);
  }
});

// Health check endpoint
app.get("/", (c) => {
  return c.json({
    name: "Remember The Milk MCP Server",
    version: "2.4.0",
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