// File: src/rtm-mcp.ts
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
    name: 'rtm',
    version: '1.0.0',
  });

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    console.log('[RtmMCP] Constructor called');
  }

  async init() {
    console.log('[RtmMCP] Init called');
    console.log('[RtmMCP] Init - this.props:', JSON.stringify(this.props));
    
    // Props may be empty on initial load, auth will come from request headers
    if (!this.props || !this.props.rtmToken) {
      console.log('[RtmMCP] No initial props/token, will check Authorization header on requests');
      this.rtmToken = undefined;
      this.userName = 'Pending Auth';
      this.userId = 'pending';
    } else {
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

  /**
   * Override fetch to extract Bearer token from Authorization header
   */
  async fetch(request: Request): Promise<Response> {
    // Extract Bearer token from Authorization header
    const authHeader = request.headers.get('Authorization');
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      console.log('[RtmMCP] Bearer token found:', token.substring(0, 8) + '...');
      
      // Look up token data in KV storage
      const tokenDataJSON = await this.env.AUTH_STORE.get(`token:${token}`);
      
      if (tokenDataJSON) {
        const tokenData = JSON.parse(tokenDataJSON);
        
        // Update auth state
        this.rtmToken = token;
        this.userName = tokenData.userName;
        this.userId = tokenData.userId;
        
        // Store in DO storage for persistence
        await this.ctx.storage.put('props', {
          rtmToken: token,
          userName: tokenData.userName,
          userId: tokenData.userId
        });
        
        console.log('[RtmMCP] Auth updated from Bearer token:', {
          userId: tokenData.userId,
          userName: tokenData.userName
        });
      } else {
        console.log('[RtmMCP] Bearer token not found in KV storage');
      }
    }
    
    // Call parent fetch method
    return super.fetch(request);
  }

  private registerTools() {
    console.log('[RtmMCP] Registering tools...');

    // Authentication initiation tool
    this.server.tool(
      'rtm_authenticate',
      'Initiate authentication with Remember The Milk',
      {}, // Empty schema for no parameters
      async () => {
        console.log('[RtmMCP] Tool called: rtm_authenticate');
        
        const baseUrl = this.env.SERVER_URL || 'https://rtm-mcp-server.vcto-6e7.workers.dev';
        const authUrl = `${baseUrl}/authorize`;
        
        return {
          content: [{
            type: 'text',
            text: `Please authenticate with Remember The Milk by visiting: ${authUrl}`
          }]
        };
      }
    );

    // Authentication completion tool
    this.server.tool(
      'rtm_complete_auth',
      'Complete the authentication process after authorizing with RTM',
      {
        code: z.string().describe('The authorization code received after authentication')
      },
      async (args: { code: string }) => {
        console.log('[RtmMCP] Tool called: rtm_complete_auth');
        
        if (!args.code) {
          return {
            content: [{
              type: 'text',
              text: 'Error: Authorization code is required'
            }]
          };
        }
        
        return {
          content: [{
            type: 'text',
            text: 'Authentication completed successfully. You can now use RTM tools.'
          }]
        };
      }
    );

    // Auth status check tool  
    this.server.tool(
      'rtm_check_auth_status',
      'Check current authentication status',
      {},
      async () => {
        console.log('[RtmMCP] Tool called: rtm_check_auth_status');
        console.log('[RtmMCP] Current auth state:', {
          hasToken: !!this.rtmToken,
          userName: this.userName,
          userId: this.userId
        });
        
        const isAuthenticated = !!this.rtmToken && this.rtmToken !== 'pending';
        
        if (isAuthenticated) {
          return {
            content: [{
              type: 'text',
              text: `Authenticated as: ${this.userName} (ID: ${this.userId})`
            }]
          };
        } else {
          return {
            content: [{
              type: 'text',
              text: 'Not authenticated. Use rtm_authenticate tool to begin authentication.'
            }]
          };
        }
      }
    );

    // Timeline creation tool
    this.server.tool(
      'timeline/create',
      'Create a new timeline for undoable operations',
      schemas.CreateTimelineSchema.shape,
      async (args) => {
        console.log('[RtmMCP] Tool called: timeline/create');
        
        // Use the Bearer token if no token provided in args
        const authToken = args.auth_token || this.rtmToken;
        
        if (!authToken) {
          return {
            content: [{
              type: 'text',
              text: 'Error: Authentication required. Use rtm_authenticate to begin.'
            }]
          };
        }

        try {
          const api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);
          const timeline = await api.createTimeline(authToken);
          
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
              text: `Error creating timeline: ${error instanceof Error ? error.message : 'Unknown error'}`
            }]
          };
        }
      }
    );

    // Get tasks tool
    this.server.tool(
      'tasks/get',
      'Get tasks from a specific list or all lists',
      schemas.GetTasksSchema.shape,
      async (args) => {
        console.log('[RtmMCP] Tool called: tasks/get');
        
        // Use the Bearer token if no token provided in args
        const authToken = args.auth_token || this.rtmToken;
        
        if (!authToken) {
          return {
            content: [{
              type: 'text',
              text: 'Error: Authentication required. Use rtm_authenticate to begin.'
            }]
          };
        }

        try {
          const api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);
          
          // For now, return a placeholder until getTasks is implemented
          // TODO: Implement getTasks in RtmApi
          return {
            content: [{
              type: 'text',
              text: 'Get tasks functionality is not yet implemented'
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Error getting tasks: ${error instanceof Error ? error.message : 'Unknown error'}`
            }]
          };
        }
      }
    );

    // Add task tool
    this.server.tool(
      'tasks/add',
      'Add a new task to Remember The Milk',
      schemas.AddTaskSchema.shape,
      async (args) => {
        console.log('[RtmMCP] Tool called: tasks/add');
        
        // Use the Bearer token if no token provided in args
        const authToken = args.auth_token || this.rtmToken;
        
        if (!authToken) {
          return {
            content: [{
              type: 'text',
              text: 'Error: Authentication required. Use rtm_authenticate to begin.'
            }]
          };
        }

        if (!args.timeline) {
          return {
            content: [{
              type: 'text',
              text: 'Error: Timeline is required. Use timeline/create first.'
            }]
          };
        }

        if (!args.name) {
          return {
            content: [{
              type: 'text',
              text: 'Error: Task name is required'
            }]
          };
        }

        try {
          const api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);
          
          // For now, return a placeholder until addTask is implemented
          // TODO: Implement addTask in RtmApi
          return {
            content: [{
              type: 'text',
              text: `Task add functionality is not yet implemented. Would add: "${args.name}"`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Error adding task: ${error instanceof Error ? error.message : 'Unknown error'}`
            }]
          };
        }
      }
    );

    // Complete task tool
    this.server.tool(
      'tasks/complete',
      'Mark a task as completed',
      schemas.CompleteTaskSchema.shape,
      async (args) => {
        console.log('[RtmMCP] Tool called: tasks/complete');
        
        // Use the Bearer token if no token provided in args
        const authToken = args.auth_token || this.rtmToken;
        
        if (!authToken) {
          return {
            content: [{
              type: 'text',
              text: 'Error: Authentication required. Use rtm_authenticate to begin.'
            }]
          };
        }

        if (!args.timeline || !args.list_id || !args.taskseries_id || !args.task_id) {
          return {
            content: [{
              type: 'text',
              text: 'Error: timeline, list_id, taskseries_id, and task_id are all required'
            }]
          };
        }

        try {
          const api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);
          
          // For now, return a placeholder until completeTask is implemented
          // TODO: Implement completeTask in RtmApi
          return {
            content: [{
              type: 'text',
              text: 'Complete task functionality is not yet implemented'
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Error completing task: ${error instanceof Error ? error.message : 'Unknown error'}`
            }]
          };
        }
      }
    );

    // Delete task tool
    this.server.tool(
      'tasks/delete',
      'Delete a task',
      schemas.DeleteTaskSchema.shape,
      async (args) => {
        console.log('[RtmMCP] Tool called: tasks/delete');
        
        // Use the Bearer token if no token provided in args
        const authToken = args.auth_token || this.rtmToken;
        
        if (!authToken) {
          return {
            content: [{
              type: 'text',
              text: 'Error: Authentication required. Use rtm_authenticate to begin.'
            }]
          };
        }

        if (!args.timeline || !args.list_id || !args.taskseries_id || !args.task_id) {
          return {
            content: [{
              type: 'text',
              text: 'Error: timeline, list_id, taskseries_id, and task_id are all required'
            }]
          };
        }

        try {
          const api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);
          
          // For now, return a placeholder until deleteTask is implemented
          // TODO: Implement deleteTask in RtmApi
          return {
            content: [{
              type: 'text',
              text: 'Delete task functionality is not yet implemented'
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Error deleting task: ${error instanceof Error ? error.message : 'Unknown error'}`
            }]
          };
        }
      }
    );
    
    console.log('[RtmMCP] All tools registered');
  }
}