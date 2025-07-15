// File: src/rtm-mcp.ts
import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RtmApi } from './rtm-api';
import type { Env, RTMList } from './types';
import * as schemas from './schemas/index';

/**
 * Remember The Milk MCP Server
 * Implements MCP tools for task management via RTM API
 */
export class RtmMCP extends McpAgent<Env, {}, { rtmToken?: string; userName?: string; userId?: string }> {
  private rtmToken?: string;
  private userName?: string;
  private userId?: string;
  private sessionInitialized = false;

  server = new McpServer({
    name: 'rtm',
    version: '1.0.0',
  });

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    console.log('[RtmMCP] Constructor called');
    this.init();
  }

  async fetch(request: Request): Promise<Response> {
    console.log('[RtmMCP] fetch called', {
      url: request.url,
      method: request.method,
      isInitialized: this.sessionInitialized
    });

    if (!this.sessionInitialized) {
      console.log('[RtmMCP] Connection is not initialized. Assuming this is the handshake.');
      this.sessionInitialized = true;
      return super.fetch(request);
    }

    const token = request.headers.get('X-RTM-Token');
    if (!token) {
      console.error('[RtmMCP] Error: Missing X-RTM-Token header on authenticated request.');
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32000,
          message: 'Authentication failed: Missing token.'
        }
      }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    this.rtmToken = token;
    this.userId = request.headers.get('X-RTM-UserId') || undefined;
    this.userName = request.headers.get('X-RTM-UserName') || undefined;
    this.props.rtmToken = this.rtmToken;
    this.props.userId = this.userId;
    this.props.userName = this.userName;

    console.log(`[RtmMCP] Authenticated request for user ${this.userId}`);
    return super.fetch(request);
  }

  async init() {
    console.log('[RtmMCP] init() called', {
      hasToken: !!this.rtmToken,
      props: this.props
    });

    // Register tools with available schemas or empty objects
    this.server.tool(
      'rtm_getLists',
      'Get all lists/folders from Remember The Milk',
      {},
      this.handleGetLists.bind(this)
    );

    this.server.tool(
      'rtm_getSettings',
      'Get user settings from Remember The Milk',
      {},
      this.handleGetSettings.bind(this)
    );

    this.server.tool(
      'rtm_getTasks',
      'Get tasks from Remember The Milk with optional filters',
      {
        filter: { type: 'string', description: 'Optional RTM filter query' },
        list_id: { type: 'string', description: 'Optional list ID to filter by' }
      },
      this.handleGetTasks.bind(this)
    );

    this.server.tool(
      'rtm_authenticate',
      'Check authentication status',
      {},
      this.handleAuthenticate.bind(this)
    );

    this.server.tool(
      'rtm_addTask',
      'Add a new task to Remember The Milk',
      {
        name: { type: 'string', description: 'Task name' },
        list_id: { type: 'string', description: 'Optional list ID' },
        parse: { type: 'boolean', description: 'Parse smart add syntax' }
      },
      this.handleAddTask.bind(this)
    );

    this.server.tool(
      'rtm_deleteTask',
      'Delete a task from Remember The Milk',
      {
        list_id: { type: 'string', description: 'List ID' },
        taskseries_id: { type: 'string', description: 'Task series ID' },
        task_id: { type: 'string', description: 'Task ID' }
      },
      this.handleDeleteTask.bind(this)
    );

    this.server.tool(
      'rtm_completeTask',
      'Mark a task as complete',
      {
        list_id: { type: 'string', description: 'List ID' },
        taskseries_id: { type: 'string', description: 'Task series ID' },
        task_id: { type: 'string', description: 'Task ID' }
      },
      this.handleCompleteTask.bind(this)
    );

    this.server.tool(
      'rtm_uncompleteTask',
      'Mark a task as incomplete',
      {
        list_id: { type: 'string', description: 'List ID' },
        taskseries_id: { type: 'string', description: 'Task series ID' },
        task_id: { type: 'string', description: 'Task ID' }
      },
      this.handleUncompleteTask.bind(this)
    );

    this.server.tool(
      'rtm_setTaskName',
      'Update task name',
      {
        list_id: { type: 'string', description: 'List ID' },
        taskseries_id: { type: 'string', description: 'Task series ID' },
        task_id: { type: 'string', description: 'Task ID' },
        name: { type: 'string', description: 'New task name' }
      },
      this.handleSetTaskName.bind(this)
    );

    this.server.tool(
      'rtm_setTaskPriority',
      'Update task priority',
      {
        list_id: { type: 'string', description: 'List ID' },
        taskseries_id: { type: 'string', description: 'Task series ID' },
        task_id: { type: 'string', description: 'Task ID' },
        priority: { type: 'string', description: 'Priority (1, 2, 3, or N)' }
      },
      this.handleSetTaskPriority.bind(this)
    );

    this.server.tool(
      'rtm_setTaskDueDate',
      'Update task due date',
      {
        list_id: { type: 'string', description: 'List ID' },
        taskseries_id: { type: 'string', description: 'Task series ID' },
        task_id: { type: 'string', description: 'Task ID' },
        due: { type: 'string', description: 'Due date' },
        has_due_time: { type: 'boolean', description: 'Has due time' },
        parse: { type: 'boolean', description: 'Parse date format' }
      },
      this.handleSetTaskDueDate.bind(this)
    );

    console.log('[RtmMCP] Tools registered successfully');
  }

  private async handleGetLists(request: any) {
    console.log('[RtmMCP] rtm_getLists called');
    const api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);
    try {
      // Using getTasks as a workaround since getLists doesn't exist yet
      const response = await api.getTasks(this.rtmToken!);
      const lists = response.lists?.list || [];
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ lists }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[RtmMCP] Error in rtm_getLists:', error);
      return {
        content: [{
          type: 'text' as const,
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  }

  private async handleGetSettings(request: any) {
    console.log('[RtmMCP] rtm_getSettings called');
    return {
      content: [{
        type: 'text' as const,
        text: 'Get settings not yet implemented'
      }]
    };
  }

  private async handleGetTasks(request: any) {
    console.log('[RtmMCP] rtm_getTasks called with params:', request);
    const api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);
    try {
      const tasks = await api.getTasks(this.rtmToken!, request.filter, request.list_id);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(tasks, null, 2)
        }]
      };
    } catch (error) {
      console.error('[RtmMCP] Error in rtm_getTasks:', error);
      return {
        content: [{
          type: 'text' as const,
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  }

  private async handleAuthenticate(request: any) {
    console.log('[RtmMCP] rtm_authenticate called');
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          authenticated: !!this.rtmToken,
          userName: this.userName,
          userId: this.userId
        }, null, 2)
      }]
    };
  }

  private async handleAddTask(request: any) {
    console.log('[RtmMCP] rtm_addTask called with params:', request);
    const api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);
    try {
      const result = await api.addTask(
        this.rtmToken!,
        request.name,
        request.list_id,
        request.parse
      );
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result, null, 2)
        }]
      };
    } catch (error) {
      console.error('[RtmMCP] Error in rtm_addTask:', error);
      return {
        content: [{
          type: 'text' as const,
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  }

  private async handleDeleteTask(request: any) {
    console.log('[RtmMCP] rtm_deleteTask called with params:', request);
    return {
      content: [{
        type: 'text' as const,
        text: 'Delete task not yet implemented'
      }]
    };
  }

  private async handleCompleteTask(request: any) {
    console.log('[RtmMCP] rtm_completeTask called with params:', request);
    return {
      content: [{
        type: 'text' as const,
        text: 'Complete task not yet implemented'
      }]
    };
  }

  private async handleUncompleteTask(request: any) {
    console.log('[RtmMCP] rtm_uncompleteTask called with params:', request);
    return {
      content: [{
        type: 'text' as const,
        text: 'Uncomplete task not yet implemented'
      }]
    };
  }

  private async handleSetTaskName(request: any) {
    console.log('[RtmMCP] rtm_setTaskName called with params:', request);
    return {
      content: [{
        type: 'text' as const,
        text: 'Set task name not yet implemented'
      }]
    };
  }

  private async handleSetTaskPriority(request: any) {
    console.log('[RtmMCP] rtm_setTaskPriority called with params:', request);
    return {
      content: [{
        type: 'text' as const,
        text: 'Set task priority not yet implemented'
      }]
    };
  }

  private async handleSetTaskDueDate(request: any) {
    console.log('[RtmMCP] rtm_setTaskDueDate called with params:', request);
    return {
      content: [{
        type: 'text' as const,
        text: 'Set task due date not yet implemented'
      }]
    };
  }
}