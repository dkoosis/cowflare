// File: src/rtm-mcp.ts
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RtmApi } from "./rtm-api";
import * as schemas from "./schemas";
import { toInputSchema } from "./schemas/index";
import type { Env } from "./types";
import { ProtocolLogger } from './protocol-logger';

export type Props = {
  rtmToken: string;
  userName: string;
};

type State = null;

export class RtmMCP extends McpAgent<Env, State, Props> {
  server = new McpServer({
    name: "Remember The Milk MCP Server",
    version: "2.4.0",
  });

  private api!: RtmApi;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  async init() {
    console.log('[RtmMCP] Initializing with props:', { 
      hasToken: !!this.props?.rtmToken,
      userName: this.props?.userName 
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

  // Override fetch to handle props initialization before mounting
async fetch(request: Request): Promise<Response> {
    const startTime = Date.now();
    const url = new URL(request.url);

    const propsParam = url.searchParams.get('props');
    if (propsParam) {
        try {
            this.props = JSON.parse(propsParam);
        } catch (e) {
            console.error('[RtmMCP] Failed to parse props:', e);
        }
    }
    
    const sessionId = this.state.id.toString();

    const requestBody = await request.clone().text();
    const requestData = {
        method: request.method,
        url: request.url,
        headers: Object.fromEntries(request.headers),
        body: requestBody,
    };

    const response = await super.fetch(request);

    const responseClone = response.clone();
    const responseBody = await responseClone.text();

    const transaction: Omit<McpTransaction, 'sessionId'> = {
        transactionId: crypto.randomUUID(),
        timestamp: startTime,
        durationMs: Date.now() - startTime,
        request: requestData,
        response: {
            statusCode: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers),
            body: responseBody,
        },
    };

    const protocolLogger = new ProtocolLogger(this.env, sessionId);
    this.state.waitUntil(protocolLogger.logTransaction(transaction));

    return response;
}