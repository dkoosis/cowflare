import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Hono } from "hono";
import { layout, homeContent, renderAuthScreen } from "./utils";
import { RtmApi } from "./rtm-api";
import * as schemas from "./schemas";

const app = new Hono<{ Bindings: Env }>();

type Props = {
  authToken: string;
  apiKey: string;
  sharedSecret: string;
};

type State = null;

export class RtmMCP extends McpAgent<Env, State, Props> {
  server = new McpServer({
    name: "Remember The Milk MCP Server",
    version: "1.0.0",
  });

  private api: RtmApi;

  constructor(env: Env, state: State | null, props: Props) {
    super(env, state, props);
    this.api = new RtmApi(props.apiKey, props.sharedSecret);
  }

  async init() {
    // Get Lists Tool
    this.server.tool(
      "rtm_get_lists",
      schemas.GetListsSchema.omit({ auth_token: true }),
      async () => {
        const response = await this.api.makeRequest('rtm.lists.getList', {
          auth_token: this.props.authToken
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
      schemas.AddTaskSchema.omit({ auth_token: true }),
      async ({ name, list_id, due, priority, tags, notes }) => {
        const timeline = await this.api.createTimeline(this.props.authToken);
        const response = await this.api.makeRequest('rtm.tasks.add', {
          auth_token: this.props.authToken,
          timeline,
          name,
          list_id,
          due,
          priority,
          tags,
          notes
        });
        return {
          content: [{
            type: "text",
            text: `Task added successfully: ${response.list.taskseries.name} (ID: ${response.list.taskseries.id})`
          }]
        };
      }
    );

    // Complete Task Tool
    this.server.tool(
      "rtm_complete_task",
      schemas.CompleteTaskSchema.omit({ auth_token: true }),
      async ({ list_id, taskseries_id, task_id }) => {
        const timeline = await this.api.createTimeline(this.props.authToken);
        await this.api.makeRequest('rtm.tasks.complete', {
          auth_token: this.props.authToken,
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
      schemas.GetTasksSchema.omit({ auth_token: true }),
      async ({ list_id, filter, last_sync }) => {
        const response = await this.api.makeRequest('rtm.tasks.getList', {
          auth_token: this.props.authToken,
          list_id,
          filter,
          last_sync
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
      schemas.SearchTasksSchema.omit({ auth_token: true }),
      async ({ query }) => {
        const response = await this.api.makeRequest('rtm.tasks.getList', {
          auth_token: this.props.authToken,
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

    // Add more tools as needed...
  }
}

// Homepage
app.get("/", async (c) => {
  const content = await homeContent();
  return c.html(layout(content, "RTM MCP Server"));
});

// Auth endpoint - initiates RTM auth flow
app.get("/auth", async (c) => {
  const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);
  const frob = await api.getFrob();
  const authUrl = api.getAuthUrl(frob, 'delete');
  
  // Store frob in KV for callback
  await c.env.AUTH_STORE.put(`frob:${frob}`, "pending", { expirationTtl: 300 });
  
  const content = await renderAuthScreen(authUrl, frob);
  return c.html(layout(content, "RTM Authentication"));
});

// Callback endpoint - completes RTM auth
app.get("/auth/callback", async (c) => {
  const frob = c.req.query('frob');
  if (!frob) {
    return c.text("Missing frob parameter", 400);
  }

  const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);
  
  try {
    const authToken = await api.getToken(frob);
    
    // Store auth token in KV
    await c.env.AUTH_STORE.put(`token:${authToken}`, "active");
    
    return c.redirect(`/?auth=${authToken}`);
  } catch (error) {
    return c.text("Authentication failed", 401);
  }
});

// Mount MCP endpoints with auth check
app.mount("/sse", async (req, env, ctx) => {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const token = authHeader.substring(7);
  
  // Verify token exists in KV
  const tokenStatus = await env.AUTH_STORE.get(`token:${token}`);
  if (!tokenStatus) {
    return new Response("Invalid token", { status: 401 });
  }

  ctx.props = {
    authToken: token,
    apiKey: env.RTM_API_KEY,
    sharedSecret: env.RTM_SHARED_SECRET
  };

  return RtmMCP.mount("/sse").fetch(req, env, ctx);
});

export default app;