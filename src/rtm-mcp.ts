// File: src/rtm-mcp.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { RtmApi } from './rtm-api';
import type { Env } from './types';

/**
 * Remember The Milk MCP Server - Durable Object
 * Implements MCP tools for task management via RTM API
 */
export class RtmMCP {
  private state: DurableObjectState;
  private env: Env;
  private server: McpServer;
  private rtmToken?: string;
  private userName?: string;
  private userId?: string;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    console.log('[RtmMCP] Constructor called');
    
    this.server = new McpServer({
      name: 'rtm',
      version: '1.0.0',
    });
    
    this.registerTools();
  }

  async fetch(request: Request): Promise<Response> {
    console.log('[RtmMCP] fetch called', {
      url: request.url,
      method: request.method,
      hasToken: !!request.headers.get('X-RTM-Token')
    });

    // Extract auth info from headers
    this.rtmToken = request.headers.get('X-RTM-Token') || undefined;
    this.userId = request.headers.get('X-RTM-UserId') || undefined;
    this.userName = request.headers.get('X-RTM-UserName') || undefined;

    try {
      // Parse the JSON-RPC request body
      const requestBody = await request.json() as JSONRPCMessage;
      console.log('[RtmMCP] Request:', { method: (requestBody as any).method });

      // Create in-memory transports for this request
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      
      // Connect server to transport
      await this.server.connect(serverTransport);

      // Send request through transport
      await clientTransport.send(requestBody);

      // Wait for response
      return new Promise((resolve) => {
        clientTransport.onmessage = (response) => {
          console.log('[RtmMCP] Response:', response);
          resolve(new Response(JSON.stringify(response), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        };

        clientTransport.onerror = (error) => {
          console.error('[RtmMCP] Transport error:', error);
          resolve(new Response(JSON.stringify({
            jsonrpc: '2.0',
            id: (requestBody as any).id || null,
            error: {
              code: -32603,
              message: 'Internal error',
              data: error.message
            }
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        };

        // Start the transport
        clientTransport.start();
      });

    } catch (error) {
      console.error('[RtmMCP] Error:', error);
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error'
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  private registerTools() {
    console.log('[RtmMCP] Registering tools');

    // Authentication tools
    this.server.tool(
      'rtm_authenticate',
      'Check authentication status',
      {},
      async () => ({
        content: [{
          type: 'text',
          text: JSON.stringify({
            authenticated: !!this.rtmToken,
            userName: this.userName,
            userId: this.userId
          }, null, 2)
        }]
      })
    );

    this.server.tool(
      'rtm_check_auth_status',
      'Check current authentication status',
      {},
      async () => ({
        content: [{
          type: 'text',
          text: JSON.stringify({
            authenticated: !!this.rtmToken,
            userName: this.userName,
            userId: this.userId,
            hasToken: !!this.rtmToken
          }, null, 2)
        }]
      })
    );

    // List tools
    this.server.tool(
      'rtm_getLists',
      'Get all RTM lists',
      {},
      async () => {
        if (!this.rtmToken) {
          return {
            content: [{
              type: 'text',
              text: 'Error: Not authenticated. Please authenticate first.'
            }]
          };
        }

        const api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);
        try {
          const response = await api.getTasks(this.rtmToken);
          const lists = response.lists?.list || [];
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ lists }, null, 2)
            }]
          };
        } catch (error) {
          console.error('[RtmMCP] Error in rtm_getLists:', error);
          return {
            content: [{
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
            }]
          };
        }
      }
    );

    // Task tools
    this.server.tool(
      'rtm_getTasks',
      'Get tasks from RTM',
      {
        list_id: { type: 'string', description: 'List ID (optional)' },
        filter: { type: 'string', description: 'RTM filter string (optional)' }
      },
      async ({ list_id, filter }) => {
        if (!this.rtmToken) {
          return {
            content: [{
              type: 'text',
              text: 'Error: Not authenticated. Please authenticate first.'
            }]
          };
        }

        const api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);
        try {
          const tasks = await api.getTasks(this.rtmToken, list_id, filter);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(tasks, null, 2)
            }]
          };
        } catch (error) {
          console.error('[RtmMCP] Error in rtm_getTasks:', error);
          return {
            content: [{
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
            }]
          };
        }
      }
    );

    this.server.tool(
      'rtm_addTask',
      'Add a new task',
      {
        name: { type: 'string', description: 'Task name' },
        list_id: { type: 'string', description: 'List ID (optional)' },
        parse: { type: 'boolean', description: 'Parse for Smart Add syntax' }
      },
      async ({ name, list_id, parse }) => {
        if (!this.rtmToken) {
          return {
            content: [{
              type: 'text',
              text: 'Error: Not authenticated. Please authenticate first.'
            }]
          };
        }

        const api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);
        try {
          const timeline = await api.createTimeline(this.rtmToken);
          const result = await api.addTask(this.rtmToken, timeline, name, list_id);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          };
        } catch (error) {
          console.error('[RtmMCP] Error in rtm_addTask:', error);
          return {
            content: [{
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
            }]
          };
        }
      }
    );

    // Placeholder tools
    const placeholderTools = [
      { name: 'rtm_deleteTask', description: 'Delete a task' },
      { name: 'rtm_completeTask', description: 'Mark a task as complete' },
      { name: 'rtm_uncompleteTask', description: 'Mark a task as incomplete' },
      { name: 'rtm_setTaskName', description: 'Update task name' },
      { name: 'rtm_setTaskPriority', description: 'Update task priority' },
      { name: 'rtm_setTaskDueDate', description: 'Update task due date' },
      { name: 'rtm_getSettings', description: 'Get RTM settings' }
    ];

    for (const tool of placeholderTools) {
      this.server.tool(
        tool.name,
        tool.description,
        {},
        async () => ({
          content: [{
            type: 'text',
            text: `${tool.description} not yet implemented`
          }]
        })
      );
    }

    console.log('[RtmMCP] Tools registered successfully');
  }
}