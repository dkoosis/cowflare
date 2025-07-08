// File: src/rtm-mcp.ts
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RtmApi } from "./rtm-api";
import * as schemas from "./schemas";
import { toInputSchema } from "./schemas/index";
import type { Env } from "./types";

export type Props = {
  rtmToken: string;
  userName: string;
  userId: string;
};

type State = null;

export class RtmMCP extends McpAgent<Env, State, Props> {
  // McpAgent expects this to be a property, not a method
  server = new McpServer({
    name: "Remember The Milk MCP Server",
    version: "2.4.0",
  });

  private api!: RtmApi;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  // This is called by McpAgent when initializing
  async init() {
    console.log('[RtmMCP] Initializing with props:', { 
      hasToken: !!this.props?.rtmToken,
      userName: this.props?.userName,
      userId: this.props?.userId
    });
    
    if (!this.props?.rtmToken) {
      console.error('[RtmMCP] No RTM token provided in props');
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
      async (args) => {
        const timeline = await this.api.createTimeline(this.props.rtmToken);
        const response = await this.api.makeRequest('rtm.tasks.complete', {
          auth_token: this.props.rtmToken,
          timeline,
          ...args
        });
        return {
          content: [{
            type: "text",
            text: `Task completed: ${response.list.taskseries[0].name}`
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
        description: "Search for tasks in RTM",
        inputSchema: toInputSchema(schemas.SearchTasksSchema.omit({ auth_token: true }))
      },
      async (args) => {
        const filter = args.filter || args.query || "";
        const response = await this.api.makeRequest('rtm.tasks.getList', {
          auth_token: this.props.rtmToken,
          filter
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

  // Remove the custom fetch method - McpAgent handles all transport logic
  // The base McpAgent class will handle:
  // - WebSocket connections
  // - Streamable HTTP transport
  // - Session management
  // - Message routing
}