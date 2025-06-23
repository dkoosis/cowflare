// File: src/index.ts
/**
 * @file Main entry point for RTM MCP Server with OAuth
 * @description OAuth provider for MCP clients with RTM backend authentication
 */

import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RtmHandler } from "./rtm-handler";
import { RtmApi } from "./rtm-api";
import * as schemas from "./schemas";

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

    // Get Lists Tool
    this.server.tool(
      "rtm_get_lists",
      {
        description: "Get all RTM lists",
        inputSchema: schemas.GetListsSchema.omit({ auth_token: true })
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
        inputSchema: schemas.AddTaskSchema.omit({ auth_token: true })
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
        inputSchema: schemas.CompleteTaskSchema.omit({ auth_token: true })
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
        inputSchema: schemas.GetTasksSchema.omit({ auth_token: true })
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
        inputSchema: schemas.SearchTasksSchema.omit({ auth_token: true })
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

// Create OAuth provider with RTM handler as the auth flow
export default new OAuthProvider({
  apiHandler: RtmMCP.mount("/sse") as any,
  apiRoute: "/sse",
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: RtmHandler as any,
  tokenEndpoint: "/token",
});