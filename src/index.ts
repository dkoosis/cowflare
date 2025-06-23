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

  async init() {
    this.api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);

    // Test Connection Tool
    this.server.tool(
      "test_connection",
      {
        description: "Test the MCP server connection",
        inputSchema: toInputSchema(z.object({}))
      },
      async () => {
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
        inputSchema: toInputSchema(schemas.AddTaskSchema.omit({ auth_token: true }))
      },
      async ({ name, list_id, due, priority, tags, notes }) => {
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
      {
        description: "Mark a task as complete",
        inputSchema: toInputSchema(schemas.CompleteTaskSchema.omit({ auth_token: true }))
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
      async ({ list_id, filter, last_sync }) => {
        const response = await this.api.makeRequest('rtm.tasks.getList', {
          auth_token: this.props.rtmToken,
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

    // Update Task Tool
    this.server.tool(
      "rtm_update_task",
      {
        description: "Update an existing task",
        inputSchema: toInputSchema(schemas.UpdateTaskSchema.omit({ auth_token: true }))
      },
      async ({ list_id, taskseries_id, task_id, name, due, priority, estimate, tags, notes }) => {
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
        
        return {
          content: [{
            type: "text",
            text: `Task updated successfully. Changed: ${results.join(', ')}`
          }]
        };
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
        const timeline = await this.api.createTimeline(this.props.rtmToken);
        await this.api.makeRequest('rtm.tasks.delete', {
          auth_token: this.props.rtmToken,
          timeline,
          list_id,
          taskseries_id,
          task_id
        });
        return {
          content: [{
            type: "text",
            text: `Task deleted successfully`
          }]
        };
      }
    );

    // Add Task Note Tool
    this.server.tool(
      "rtm_add_task_note",
      {
        description: "Add a note to a task",
        inputSchema: toInputSchema(schemas.AddTaskNoteSchema.omit({ auth_token: true }))
      },
      async ({ list_id, taskseries_id, task_id, note_title, note_text }) => {
        const timeline = await this.api.createTimeline(this.props.rtmToken);
        const response = await this.api.makeRequest('rtm.tasks.notes.add', {
          auth_token: this.props.rtmToken,
          timeline,
          list_id,
          taskseries_id,
          task_id,
          note_title: note_title || 'Note',
          note_text
        });
        return {
          content: [{
            type: "text",
            text: `Note added successfully (ID: ${response.note.id})`
          }]
        };
      }
    );

    // Get Locations Tool
    this.server.tool(
      "rtm_get_locations",
      {
        description: "Get all RTM locations",
        inputSchema: toInputSchema(schemas.GetLocationsSchema.omit({ auth_token: true }))
      },
      async () => {
        const response = await this.api.makeRequest('rtm.locations.getList', {
          auth_token: this.props.rtmToken
        });
        
        const locations = Array.isArray(response.locations.location) 
          ? response.locations.location 
          : [response.locations.location];
        
        const formatted = locations.map((loc: any) => 
          `📍 ${loc.name} (ID: ${loc.id})${loc.address ? `\n   Address: ${loc.address}` : ''}`
        ).join('\n\n');
        
        return {
          content: [{
            type: "text",
            text: formatted || 'No locations found'
          }]
        };
      }
    );

    // Get Tags Tool
    this.server.tool(
      "rtm_get_tags",
      {
        description: "Get all RTM tags",
        inputSchema: toInputSchema(schemas.GetTagsSchema.omit({ auth_token: true }))
      },
      async () => {
        const response = await this.api.makeRequest('rtm.tags.getList', {
          auth_token: this.props.rtmToken
        });
        
        const tags = response.tags.tag;
        if (!tags || tags.length === 0) {
          return {
            content: [{
              type: "text",
              text: 'No tags found'
            }]
          };
        }
        
        const tagList = Array.isArray(tags) ? tags : [tags];
        const formatted = tagList.map((tag: any) => `🏷️  ${tag.$t}`).join('\n');
        
        return {
          content: [{
              type: "text",
              text: `Tags:\n${formatted}`
          }]
        };
      }
    );
  }
}

// Create OAuth provider with RTM handler as the auth flow
export default new OAuthProvider({
  apiHandler: RtmMCP.mount("/sse") as any,
  apiRoute: "/sse",
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: RtmHandler as any,
  tokenEndpoint: "/token",
});