/**
 * @file index.ts
 * @description Main entry point for RTM MCP Server with OAuth
 * OAuth provider for MCP clients with RTM backend authentication
 */

import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RtmHandler } from "./rtm-handler";
import { RtmApi } from "./rtm-api";
import * as schemas from "./schemas";
import { toInputSchema } from "./schemas/index";

// Props passed to MCP agent after OAuth
type Props = {
  rtmToken: string;
  userEmail: string;
  userName: string;
};

type State = null;

export class RtmMCP extends McpAgent<Env, State, Props> {
  server = new McpServer({
    name: "Remember The Milk MCP Server",
    version: "2.0.0",
  });

  private api: RtmApi;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    console.log('[RtmMCP] Constructor called', {
      hasState: !!state,
      hasEnv: !!env,
      envKeys: Object.keys(env || {})
    });
  }

  async init() {
    console.log('[RtmMCP] Init called with props:', {
      props: this.props,
      hasRtmToken: !!this.props?.rtmToken,
      userName: this.props?.userName,
      userEmail: this.props?.userEmail
    });

    if (!this.props?.rtmToken) {
      console.error('[RtmMCP] No RTM token in props!');
      throw new Error('RTM token required');
    }

    this.api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);
    console.log('[RtmMCP] RTM API initialized');

    // Test Connection Tool
    this.server.tool(
      "test_connection",
      {
        description: "Test the MCP server connection",
        inputSchema: toInputSchema(z.object({}))
      },
      async () => {
        console.log('[RtmMCP] test_connection tool called');
        return {
          content: [{
            type: "text",
            text: `✅ Connection successful! Server is running RTM MCP Server v2.0.0.

Connected as: ${this.props.userName} (${this.props.userEmail})

The RTM MCP Server is ready to help you manage your tasks. Available tools include:
- rtm_get_lists: Get all your RTM lists
- rtm_add_task: Add new tasks with optional due dates, priorities, and tags
- rtm_complete_task: Mark tasks as complete
- rtm_get_tasks: Get tasks from specific lists with filters
- rtm_search_tasks: Search tasks using RTM's powerful query syntax`
          }]
        };
      }
    );

    // Get Lists Tool
    this.server.tool(
      "rtm_get_lists",
      {
        description: "Get all RTM lists",
        inputSchema: toInputSchema(schemas.GetListsSchema.omit({ auth_token: true }))
      },
      async () => {
        console.log('[RtmMCP] rtm_get_lists tool called');
        try {
          const response = await this.api.makeRequest('rtm.lists.getList', {
            auth_token: this.props.rtmToken
          });
          console.log('[RtmMCP] rtm_get_lists response:', response);
          return {
            content: [{
              type: "text",
              text: this.api.formatLists(response.lists.list)
            }]
          };
        } catch (error) {
          console.error('[RtmMCP] rtm_get_lists error:', error);
          throw error;
        }
      }
    );

    // Add Task Tool
    this.server.tool(
      "rtm_add_task",
      {
        description: "Add a new task to RTM",
        inputSchema: toInputSchema(schemas.AddTaskSchema.omit({ auth_token: true }))
      },
      async ({ name, list_id, due, priority, tags, notes }) => {
        console.log('[RtmMCP] rtm_add_task called with:', { name, list_id, due, priority, tags, notes });
        try {
          const timeline = await this.api.createTimeline(this.props.rtmToken);
          const response = await this.api.makeRequest('rtm.tasks.add', {
            auth_token: this.props.rtmToken,
            timeline,
            name,
            list_id,
            due,
            priority,
            tags,
            notes
          });
          console.log('[RtmMCP] rtm_add_task response:', response);
          return {
            content: [{
              type: "text",
              text: `Task added successfully: ${response.list.taskseries.name} (ID: ${response.list.taskseries.id})`
            }]
          };
        } catch (error) {
          console.error('[RtmMCP] rtm_add_task error:', error);
          throw error;
        }
      }
    );

    // Complete Task Tool
    this.server.tool(
      "rtm_complete_task",
      {
        description: "Mark a task as complete",
        inputSchema: toInputSchema(schemas.CompleteTaskSchema.omit({ auth_token: true }))
      },
      async ({ list_id, taskseries_id, task_id }) => {
        console.log('[RtmMCP] rtm_complete_task called with:', { list_id, taskseries_id, task_id });
        try {
          const timeline = await this.api.createTimeline(this.props.rtmToken);
          await this.api.makeRequest('rtm.tasks.complete', {
            auth_token: this.props.rtmToken,
            timeline,
            list_id,
            taskseries_id,
            task_id
          });
          console.log('[RtmMCP] rtm_complete_task success');
          return {
            content: [{
              type: "text",
              text: `Task completed successfully`
            }]
          };
        } catch (error) {
          console.error('[RtmMCP] rtm_complete_task error:', error);
          throw error;
        }
      }
    );

    // Get Tasks Tool
    this.server.tool(
      "rtm_get_tasks",
      {
        description: "Get tasks from RTM lists",
        inputSchema: toInputSchema(schemas.GetTasksSchema.omit({ auth_token: true }))
      },
      async ({ list_id, filter, last_sync }) => {
        console.log('[RtmMCP] rtm_get_tasks called with:', { list_id, filter, last_sync });
        try {
          const response = await this.api.makeRequest('rtm.tasks.getList', {
            auth_token: this.props.rtmToken,
            list_id,
            filter,
            last_sync
          });
          console.log('[RtmMCP] rtm_get_tasks response:', response);
          return {
            content: [{
              type: "text",
              text: this.api.formatTasks(response.tasks.list)
            }]
          };
        } catch (error) {
          console.error('[RtmMCP] rtm_get_tasks error:', error);
          throw error;
        }
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
        console.log('[RtmMCP] rtm_search_tasks called with query:', query);
        try {
          const response = await this.api.makeRequest('rtm.tasks.getList', {
            auth_token: this.props.rtmToken,
            filter: query
          });
          console.log('[RtmMCP] rtm_search_tasks response:', response);
          return {
            content: [{
              type: "text",
              text: this.api.formatTasks(response.tasks.list)
            }]
          };
        } catch (error) {
          console.error('[RtmMCP] rtm_search_tasks error:', error);
          throw error;
        }
      }
    );

    // Update Task Tool
    this.server.tool(
      "rtm_update_task",
      {
        description: "Update an existing task",
        inputSchema: toInputSchema(schemas.UpdateTaskSchema.omit({ auth_token: true }))
      },
      async ({ list_id, taskseries_id, task_id, name, due, priority, estimate, tags, notes }) => {
        console.log('[RtmMCP] rtm_update_task called with:', { list_id, taskseries_id, task_id, name, due, priority, estimate, tags, notes });
        try {
          const timeline = await this.api.createTimeline(this.props.rtmToken);
          const updates: any = {};
          
          if (name !== undefined) updates.name = name;
          if (due !== undefined) updates.due = due;
          if (priority !== undefined) updates.priority = priority;
          if (estimate !== undefined) updates.estimate = estimate;
          if (tags !== undefined) updates.tags = tags;
          
          const results = [];
          
          // RTM requires separate API calls for different updates
          for (const [field, value] of Object.entries(updates)) {
            const method = `rtm.tasks.set${field.charAt(0).toUpperCase() + field.slice(1)}`;
            console.log('[RtmMCP] Calling RTM method:', method, 'with value:', value);
            await this.api.makeRequest(method, {
              auth_token: this.props.rtmToken,
              timeline,
              list_id,
              taskseries_id,
              task_id,
              [field]: value
            });
            results.push(`${field}: ${value}`);
          }
          
          // Handle notes separately if provided
          if (notes !== undefined) {
            console.log('[RtmMCP] Adding note:', notes);
            await this.api.makeRequest('rtm.tasks.notes.add', {
              auth_token: this.props.rtmToken,
              timeline,
              list_id,
              taskseries_id,
              task_id,
              note_title: 'Note',
              note_text: notes
            });
            results.push(`notes: ${notes}`);
          }
          
          console.log('[RtmMCP] rtm_update_task success');
          return {
            content: [{
              type: "text",
              text: `Task updated successfully. Changed: ${results.join(', ')}`
            }]
          };
        } catch (error) {
          console.error('[RtmMCP] rtm_update_task error:', error);
          throw error;
        }
      }
    );

    // Delete Task Tool
    this.server.tool(
      "rtm_delete_task",
      {
        description: "Delete a task",
        inputSchema: toInputSchema(schemas.DeleteTaskSchema.omit({ auth_token: true }))
      },
      async ({ list_id, taskseries_id, task_id }) => {
        console.log('[RtmMCP] rtm_delete_task called with:', { list_id, taskseries_id, task_id });
        try {
          const timeline = await this.api.createTimeline(this.props.rtmToken);
          await this.api.makeRequest('rtm.tasks.delete', {
            auth_token: this.props.rtmToken,
            timeline,
            list_id,
            taskseries_id,
            task_id
          });
          console.log('[RtmMCP] rtm_delete_task success');
          return {
            content: [{
              type: "text",
              text: `Task deleted successfully`
            }]
          };
        } catch (error) {
          console.error('[RtmMCP] rtm_delete_task error:', error);
          throw error;
        }
      }
    );

    console.log('[RtmMCP] Tool registration complete. Total tools registered:', 8);
  }
}

// Create OAuth provider with RTM handler as the auth flow
const oauthProvider = new OAuthProvider({
  apiHandler: RtmMCP.mount("/sse") as any,
  apiRoute: "/sse",
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: RtmHandler as any,
  tokenEndpoint: "/token",
});

console.log('[Main] OAuth provider created with routes:', {
  apiRoute: '/sse',
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  registrationEndpoint: '/register'
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    console.log('[Main] Fetch called:', {
      method: request.method,
      pathname: url.pathname,
      search: url.search,
      headers: {
        authorization: request.headers.get('authorization'),
        contentType: request.headers.get('content-type'),
        accept: request.headers.get('accept'),
      }
    });
    
    try {
      const response = await oauthProvider.fetch(request, env, ctx);
      console.log('[Main] Response:', {
        status: response.status,
        statusText: response.statusText,
        headers: {
          contentType: response.headers.get('content-type'),
          location: response.headers.get('location'),
        }
      });
      return response;
    } catch (error) {
      console.error('[Main] Error in fetch:', error);
      throw error;
    }
  }
};