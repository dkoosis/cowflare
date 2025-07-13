import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RtmApi } from './rtm-api';
import type { Env } from './types';
import * as schemas from './schemas/task-schemas';

/**
 * Remember The Milk MCP Server
 * Implements MCP tools for task management via RTM API
 */
export class RtmMCP extends McpAgent<Env, {}, { rtmToken?: string; userName?: string; userId?: string }> {
  private rtmToken?: string;
  private userName?: string;
  private userId?: string;
  
  server = new McpServer({
    //    name: 'remember-the-milk',
    name: 'spooky',
    version: '1.0.0',
  });

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    console.log('[RtmMCP] Constructor called');
    console.log('[RtmMCP] Constructor - available methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(this)));
    console.log('[RtmMCP] Constructor - McpAgent methods:', Object.getOwnPropertyNames(McpAgent.prototype));
  }

  async init() {
    console.log('[RtmMCP] Init called');
    console.log('[RtmMCP] Init - this.props:', JSON.stringify(this.props));
    console.log('[RtmMCP] Init - props type:', typeof this.props);
    console.log('[RtmMCP] Init - props keys:', this.props ? Object.keys(this.props) : 'props is undefined');
    
    if (!this.props) {
      console.error('[RtmMCP] ERROR: No props object available!');
      // Initialize without auth for debugging
      this.rtmToken = undefined;
      this.userName = 'No Auth';
      this.userId = 'no-auth';
    } else {
      // Access props
      this.rtmToken = this.props.rtmToken;
      this.userName = this.props.userName || 'Unknown';
      this.userId = this.props.userId || 'unknown';
      
      console.log('[RtmMCP] Props extracted:', {
        hasToken: !!this.rtmToken,
        userName: this.userName,
        userId: this.userId,
        tokenLength: this.rtmToken?.length
      });
    }

    // Register all RTM tools
    this.registerTools();
    
    console.log('[RtmMCP] Init complete, tools registered');
  }

  private registerTools() {
  console.log('[RtmMCP] Tools at start of registerTools:', {
    tools: this.server.getTools(),
    server: this.server,
    serverKeys: Object.keys(this.server),
    serverProto: Object.getOwnPropertyNames(Object.getPrototypeOf(this.server))
  });
   // This tool intentionally overrides the default authentication tool provided
   // by the McpAgent base class. Our custom implementation is necessary to
   // accommodate Remember The Milk's non-standard, "desktop-style" auth flow
   // and correctly direct the client to our custom /authorize endpoint.
   /* test dk
  this.server.tool(
      'rtm_authenticate',
      'Initiate authentication with Remember The Milk',
      z.object({}), // No input arguments are needed
      async () => {
        console.log('[RtmMCP] Tool called: rtm_authenticate (override)');
        
        // The base URL of your worker. this.props.host should be available
        // during the MCP handshake.
        const baseUrl = this.env.SERVER_URL || `https://${this.props.host}`;
        
        // The URL to your custom OAuth handler
        const authUrl = `${baseUrl}/authorize`;

        return {
          content: [{
            type: 'text',
            text: `Please begin the authentication process by visiting: ${authUrl}`
          }]
        };
      }
    );
    */
    // Timeline creation tool
    this.server.tool(
      'timeline/create',
      'Create a new timeline for undoable operations',
      schemas.CreateTimelineSchema,
      async (args) => {
        console.log('[RtmMCP] Tool called: timeline/create');
        if (!args.auth_token) {
          return {
            content: [{
              type: 'text',
              text: 'Error: Authentication token is required'
            }]
          };
        }

        try {
          const api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);
          const timeline = await api.createTimeline(args.auth_token);
          
          return {
            content: [{
              type: 'text',
              text: `Timeline created: ${timeline}`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Error creating timeline: ${error.message}`
            }]
          };
        }
      }
    );

    // Get tasks tool
    this.server.tool(
      'tasks/get',
      'Get tasks from a specific list or all lists',
      schemas.GetTasksSchema,
      async (args) => {
        console.log('[RtmMCP] Tool called: tasks/get');
        if (!args.auth_token) {
          return {
            content: [{
              type: 'text',
              text: 'Error: Authentication token is required'
            }]
          };
        }

        try {
          const api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);
          const tasks = await api.getTasks({
            auth_token: args.auth_token,
            list_id: args.list_id,
            filter: args.filter
          });
          
          const taskList = tasks.map(task => 
            `- ${task.name} (ID: ${task.id})${task.due ? ` - Due: ${task.due}` : ''}`
          ).join('\n');
          
          return {
            content: [{
              type: 'text',
              text: taskList || 'No tasks found'
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Error getting tasks: ${error.message}`
            }]
          };
        }
      }
    );

    // Add task tool
    this.server.tool(
      'task/add',
      'Add a new task to Remember The Milk',
      schemas.AddTaskSchema,
      async (args) => {
        console.log('[RtmMCP] Tool called: task/add');
        if (!args.auth_token || !args.timeline) {
          return {
            content: [{
              type: 'text',
              text: 'Error: Authentication token and timeline are required'
            }]
          };
        }

        try {
          const api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);
          const task = await api.addTask(args);
          
          return {
            content: [{
              type: 'text',
              text: `Task added: "${task.name}" (ID: ${task.id})`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Error adding task: ${error.message}`
            }]
          };
        }
      }
    );

    // Complete task tool
    this.server.tool(
      'task/complete',
      'Mark a task as completed',
      schemas.CompleteTaskSchema,
      async (args) => {
        console.log('[RtmMCP] Tool called: task/complete');
        if (!args.auth_token || !args.timeline) {
          return {
            content: [{
              type: 'text',
              text: 'Error: Authentication token and timeline are required'
            }]
          };
        }

        try {
          const api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);
          await api.completeTask(args);
          
          return {
            content: [{
              type: 'text',
              text: `Task ${args.task_id} marked as complete`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Error completing task: ${error.message}`
            }]
          };
        }
      }
    );

    // Add more tools as needed...
    console.log('[RtmMCP] Registered tools:', this.server.getTools().map(t => t.name));
  }
}