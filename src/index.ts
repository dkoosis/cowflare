// File: src/index.ts
/**
 * @file Main entry point for RTM MCP Server
 * @description Handles web UI routes for authentication and MCP server mounting
 * Exports both the Hono app (default) and RtmMCP Durable Object (named)
 */

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Hono } from "hono";
import { html } from "hono/html";
import { layout, renderAuthScreen } from "./utils";
import { RtmApi } from "./rtm-api";
import * as schemas from "./schemas";
import { toInputSchema } from "./schemas/index";

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
  }
}

// Homepage with auth link
app.get("/", async (c) => {
  const authToken = c.req.query('auth');
  
  const content = authToken ? html`
    <div class="max-w-4xl mx-auto">
      <h1 class="text-3xl font-bold mb-6">Remember The Milk MCP Server</h1>
      
      <div class="bg-green-50 border border-green-200 p-6 rounded-lg shadow-md mb-6">
        <h2 class="text-xl font-semibold mb-4 text-green-800">Authentication Successful!</h2>
        <p class="mb-4">Your RTM authentication token:</p>
        <code class="block bg-gray-100 p-4 rounded font-mono text-sm break-all">${authToken}</code>
        <p class="mt-4 text-sm text-gray-600">
          Copy this token and use it in Claude.ai when adding the remote MCP server.
        </p>
      </div>

      <div class="bg-white p-6 rounded-lg shadow-md">
        <h2 class="text-xl font-semibold mb-4">Next Steps</h2>
        <ol class="list-decimal list-inside space-y-2">
          <li>Copy your authentication token above</li>
          <li>In Claude.ai, click "Add Remote Server"</li>
          <li>Server URL: <code class="bg-gray-100 px-2 py-1 rounded">${c.env.SERVER_URL}/sse</code></li>
          <li>Authentication: Bearer token (paste your token)</li>
        </ol>
      </div>
    </div>
  ` : html`
    <div class="max-w-4xl mx-auto">
      <h1 class="text-3xl font-bold mb-6">Remember The Milk MCP Server</h1>
      
      <div class="bg-white p-6 rounded-lg shadow-md mb-6">
        <h2 class="text-xl font-semibold mb-4">Getting Started</h2>
        <p class="mb-4">To use this MCP server with Claude.ai, you need to authenticate with Remember The Milk first.</p>
        <a href="/auth" class="inline-block bg-blue-600 text-white px-6 py-3 rounded-md font-medium hover:bg-blue-700 transition-colors">
          Authenticate with Remember The Milk
        </a>
      </div>

      <div class="bg-white p-6 rounded-lg shadow-md">
        <h2 class="text-xl font-semibold mb-4">Available Tools</h2>
        <ul class="space-y-2">
          <li><code class="bg-gray-100 px-2 py-1 rounded">rtm_get_lists</code> - Get all your lists</li>
          <li><code class="bg-gray-100 px-2 py-1 rounded">rtm_add_task</code> - Add a new task</li>
          <li><code class="bg-gray-100 px-2 py-1 rounded">rtm_complete_task</code> - Complete a task</li>
          <li><code class="bg-gray-100 px-2 py-1 rounded">rtm_get_tasks</code> - Get tasks from lists</li>
          <li><code class="bg-gray-100 px-2 py-1 rounded">rtm_search_tasks</code> - Search tasks with RTM queries</li>
        </ul>
      </div>
    </div>
  `;
  
  return c.html(layout(content, "RTM MCP Server"));
});

// Auth initiation - shows instructions
app.get("/auth", async (c) => {
  const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);
  
  try {
    // Get frob from RTM
    const frob = await api.getFrob();
    
    // Store frob in KV with 5 minute expiration
    await c.env.AUTH_STORE.put(`frob:${frob}`, "pending", { 
      expirationTtl: 300 // 5 minutes
    });
    
    // Generate auth URL
    const authUrl = await api.getAuthUrl(frob, 'delete');
    
    // Render instruction page
    const content = await renderAuthScreen(authUrl, frob);
    return c.html(layout(content, "RTM Authentication"));
    
  } catch (error) {
    return c.text(`Error initiating authentication: ${error.message}`, 500);
  }
});

// Auth callback - exchanges frob for token
app.get("/auth/callback", async (c) => {
  const frob = c.req.query('frob');
  
  if (!frob) {
    return c.text("Missing frob parameter", 400);
  }
  
  // Verify frob exists in KV
  const frobStatus = await c.env.AUTH_STORE.get(`frob:${frob}`);
  if (!frobStatus) {
    return c.text("Invalid or expired frob. Please start authentication again.", 400);
  }
  
  const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);
  
  try {
    // Exchange frob for token
    const authToken = await api.getToken(frob);
    
    // Store auth token in KV
    await c.env.AUTH_STORE.put(`token:${authToken}`, "active", {
      // Optional: set expiration if you want tokens to expire
      // expirationTtl: 86400 * 30 // 30 days
    });
    
    // Clean up frob
    await c.env.AUTH_STORE.delete(`frob:${frob}`);
    
    // Redirect to homepage with token
    return c.redirect(`/?auth=${authToken}`);
    
  } catch (error) {
    return c.text(`Authentication failed: ${error.message}`, 401);
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