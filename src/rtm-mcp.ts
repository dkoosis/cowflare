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
    
    if (!this.props) {
      console.error('[RtmMCP] ERROR: No props object available!');
      this.rtmToken = undefined;
      this.userName = 'No Auth';
      this.userId = 'no-auth';
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
        
        const isAuthenticated = !!this.rtmToken;
        
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
      'task/add',
      'Add a new task to Remember The Milk',
      schemas.AddTaskSchema.shape,
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
          
          // For now, return a placeholder until addTask is implemented
          // TODO: Implement addTask in RtmApi
          return {
            content: [{
              type: 'text',
              text: `Add task functionality is not yet implemented. Would add: "${args.name}"`
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
      'task/complete',
      'Mark a task as completed',
      schemas.CompleteTaskSchema.shape,
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
          
          // For now, return a placeholder until completeTask is implemented
          // TODO: Implement completeTask in RtmApi
          return {
            content: [{
              type: 'text',
              text: `Complete task functionality is not yet implemented for task: ${args.task_id}`
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

    console.log('[RtmMCP] All tools registered');
  }
}