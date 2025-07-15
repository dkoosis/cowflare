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

  /**
   * Handle incoming HTTP requests
   * This is called by Cloudflare when a request is forwarded to this Durable Object
   */
  async fetch(request: Request): Promise<Response> {
    console.log('[RtmMCP] fetch called', {
      url: request.url,
      method: request.method,
      hasAuthHeader: request.headers.has('X-RTM-Token')
    });
    
    // Extract auth data from headers on first request
    if (!this.rtmToken && request.headers.has('X-RTM-Token')) {
      this.rtmToken = request.headers.get('X-RTM-Token') || undefined;
      this.userId = request.headers.get('X-RTM-UserId') || undefined;
      this.userName = request.headers.get('X-RTM-UserName') || undefined;
      
      console.log('[RtmMCP] Auth data extracted from headers:', {
        hasToken: !!this.rtmToken,
        userId: this.userId,
        userName: this.userName,
        tokenLength: this.rtmToken?.length
      });
      
      // Update props for the base class
      this.props = {
        rtmToken: this.rtmToken,
        userId: this.userId,
        userName: this.userName
      };
    }
    
    // Call the parent class fetch method which handles MCP protocol
    return super.fetch(request);
  }

  /**
   * Initialize the MCP server and register tools
   */
  async init() {
    console.log('[RtmMCP] Init called');
    console.log('[RtmMCP] Init - this.props:', JSON.stringify(this.props));
    
    // Props may be empty on initial load, auth will come from request headers
    if (!this.props || !this.props.rtmToken) {
      console.log('[RtmMCP] No initial props/token, will check request headers');
      // Don't set values here, they'll come from the fetch() method
    } else {
      this.rtmToken = this.props.rtmToken;
      this.userName = this.props.userName || 'Unknown';
      this.userId = this.props.userId || 'unknown';
      
      console.log('[RtmMCP] Props extracted in init:', {
        hasToken: !!this.rtmToken,
        userName: this.userName,
        userId: this.userId
      });
    }

    // Register all RTM tools
    this.initializeTools();
    
    console.log('[RtmMCP] Init complete, tools registered');
  }

  /**
   * Register all RTM tools with the MCP server
   */
  private initializeTools() {
    console.log('[RtmMCP] Registering RTM tools');

    // Authentication tool
    this.server.tool(
      'rtm_authenticate',
      'Start RTM authentication process',
      {},  // Empty schema
      async () => {
        console.log('[RtmMCP] Tool called: rtm_authenticate');
        try {
          const api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);
          const frob = await api.getFrob();
          const authUrl = await api.getAuthUrl(frob);
          
          return {
            content: [{
              type: 'text',
              text: `To authenticate with Remember The Milk:\n\n1. Open this URL in a new tab: ${authUrl}\n2. Authorize the application\n3. Return here and use the rtm_complete_auth tool with frob: ${frob}`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Error starting authentication: ${error instanceof Error ? error.message : 'Unknown error'}`
            }]
          };
        }
      }
    );

    // Complete authentication tool
    this.server.tool(
      'rtm_complete_auth',
      'Complete RTM authentication after authorizing in browser',
      {
        frob: z.string().describe('The frob token from rtm_authenticate')
      },
      async (args) => {
        console.log('[RtmMCP] Tool called: rtm_complete_auth');
        try {
          const api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);
          const tokenResponse = await api.getToken(args.frob);
          
          // Store the auth data
          this.rtmToken = tokenResponse.token;
          this.userName = tokenResponse.auth.user.fullname || tokenResponse.auth.user.username;
          this.userId = tokenResponse.auth.user.id;
          
          console.log('[RtmMCP] Auth completed:', {
            hasToken: !!this.rtmToken,
            userName: this.userName,
            userId: this.userId
          });
          
          return {
            content: [{
              type: 'text',
              text: `Authentication successful! Logged in as ${this.userName} (ID: ${this.userId})`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Error completing authentication: ${error instanceof Error ? error.message : 'Unknown error'}`
            }]
          };
        }
      }
    );

    // Check authentication status tool
    this.server.tool(
      'rtm_check_auth_status',
      'Check current RTM authentication status',
      {},  // Empty schema
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