/**
 * @file index.ts
 * @description RTM MCP Server v2.0 - Unified schema implementation
 * Modern architecture using @modelcontextprotocol/sdk with single-source schemas
 */
import { Server as McpServer, createFetchHandler, CallToolResult } from '@modelcontextprotocol/sdk';
import {
  Env,
  makeRTMRequest,
  formatLists,
  formatTasks,
  generateSessionId
} from './rtm-api.js';
import {
  checkRateLimit,
  getClientId,
  handleAuthCallback,
  savePendingAuth,
  getPendingAuth,
  cacheAuthToken,
  getCachedAuthToken,
  deletePendingAuth
} from './auth.js';
import * as schemas from './schemas/index.js';
import { toInputSchema } from './schemas/index.js';
import type { z } from 'zod';

// Type helper for extracting inferred types from Zod schemas
type InferSchema<T> = T extends z.ZodType<infer U> ? U : never;

// Initialize MCP server
const server = new McpServer({
  name: "rtm-mcp-server",
  version: "2.0.0"
});

// Logging utility
const Logger = {
  info: (message: string, data?: any) => {
    console.log(`[INFO] ${message}`, data ? JSON.stringify(data) : '');
  },
  warn: (message: string, data?: any) => {
    console.warn(`[WARN] ${message}`, data ? JSON.stringify(data) : '');
  },
  error: (message: string, data?: any) => {
    console.error(`[ERROR] ${message}`, data ? JSON.stringify(data) : '');
  }
};

// Helper to create success responses
function createSuccessResponse(text: string): CallToolResult {
  return {
    content: [{
      type: "text",
      text
    }]
  };
}

// Helper to create error responses
function createErrorResponse(error: Error): CallToolResult {
  return {
    content: [{
      type: "text",
      text: `❌ Error: ${error.message}`
    }],
    isError: true
  };
}

// Register diagnostic tool
server.registerTool(
  "test_connection",
  {
    annotations: {
      title: "Test Connection",
      description: "Test MCP server connection and configuration",
      readOnlyHint: true,
    },
    inputSchema: toInputSchema(schemas.AuthenticateSchema)
  },
  async (_args: InferSchema<typeof schemas.AuthenticateSchema>) => {
    return createSuccessResponse(
      `✅ MCP Server Connection Test\n\n` +
      `Status: Connected and operational\n` +
      `Version: 2.0.0 (Unified Schema)\n` +
      `Server: RTM MCP Server\n` +
      `Time: ${new Date().toISOString()}`
    );
  }
);

// Register authentication tools
server.registerTool(
  "rtm_authenticate",
  {
    annotations: {
      title: "Start RTM Authentication", 
      description: "Initiates Remember The Milk authentication flow. Returns an auth URL for user authorization.",
      readOnlyHint: true,
    },
    inputSchema: toInputSchema(schemas.AuthenticateSchema)
  },
  async (_args: InferSchema<typeof schemas.AuthenticateSchema>, env: Env) => {
    try {
      const sessionId = generateSessionId();
      const response = await makeRTMRequest(
        'rtm.auth.getFrob',
        {},
        env.RTM_API_KEY,
        env.RTM_SHARED_SECRET
      );
      
      const frob = response.frob;
      await savePendingAuth(sessionId, frob, env);
      
      const authParams: Record<string, string> = {
        api_key: env.RTM_API_KEY,
        perms: 'write',
        frob: frob
      };
      
      const sortedKeys = Object.keys(authParams).sort();
      const paramString = sortedKeys.map(key => `${key}${authParams[key]}`).join('');
      const signatureBase = env.RTM_SHARED_SECRET + paramString;
      
      const encoder = new TextEncoder();
      const signatureData = encoder.encode(signatureBase);
      const hashBuffer = await crypto.subtle.digest('MD5', signatureData);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const apiSig = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      
      authParams.api_sig = apiSig;
      
      const authUrl = `https://www.rememberthemilk.com/services/auth/?${new URLSearchParams(authParams)}`;
      const callbackUrl = `${env.SERVER_URL}/auth/callback?session=${sessionId}`;
      
      return createSuccessResponse(
        `🔐 Authentication Required\n\n` +
        `Please visit this URL to authorize the app:\n` +
        `${authUrl}\n\n` +
        `Or use this link with auto-redirect:\n` +
        `${authUrl}&redirect=${encodeURIComponent(callbackUrl)}\n\n` +
        `After authorizing, use rtm_complete_auth with session ID:\n` +
        `${sessionId}`
      );
    } catch (error: any) {
      Logger.error('Authentication initiation failed', { error: error.message });
      return createErrorResponse(error);
    }
  }
);

server.registerTool(
  "rtm_complete_auth",
  {
    annotations: {
      title: "Complete RTM Authentication",
      description: "Completes the authentication process after user authorizes the app on Remember The Milk.",
      readOnlyHint: true,
    },
    inputSchema: toInputSchema(schemas.CompleteAuthSchema)
  },
  async (args: InferSchema<typeof schemas.CompleteAuthSchema>, env: Env) => {
    try {
      const validatedArgs = schemas.CompleteAuthSchema.parse(args);
      const pendingAuth = await getPendingAuth(validatedArgs.session_id, env);
      
      if (!pendingAuth) {
        throw new Error("Session expired or invalid. Please start over with rtm_authenticate.");
      }
      
      const response = await makeRTMRequest(
        'rtm.auth.getToken',
        { frob: pendingAuth.frob },
        env.RTM_API_KEY,
        env.RTM_SHARED_SECRET
      );
      
      await cacheAuthToken(validatedArgs.session_id, response.auth, env);
      await deletePendingAuth(validatedArgs.session_id, env);
      
      return createSuccessResponse(
        `✅ Authentication successful!\n\n` +
        `User: ${response.auth.user.fullname}\n` +
        `Username: ${response.auth.user.username}\n` +
        `Token: ${response.auth.token}\n\n` +
        `You can now use all RTM tools with this token.`
      );
    } catch (error: any) {
      Logger.error('Authentication completion failed', { error: error.message });
      if (error.message.includes('Invalid frob')) {
        return createErrorResponse(
          new Error("Authorization pending. Please ensure you've authorized the app on RTM's website.")
        );
      }
      return createErrorResponse(error);
    }
  }
);

server.registerTool(
  "rtm_check_auth_status",
  {
    annotations: {
      title: "Check Authentication Status",
      description: "Verifies if the authentication process was completed successfully.",
      readOnlyHint: true,
    },
    inputSchema: toInputSchema(schemas.CheckAuthStatusSchema)
  },
  async (args: InferSchema<typeof schemas.CheckAuthStatusSchema>, env: Env) => {
    try {
      const validatedArgs = schemas.CheckAuthStatusSchema.parse(args);
      const cachedAuth = await getCachedAuthToken(validatedArgs.session_id, env);
      
      if (cachedAuth) {
        return createSuccessResponse(
          `✅ Authenticated\n\n` +
          `User: ${cachedAuth.user.fullname}\n` +
          `Username: ${cachedAuth.user.username}\n` +
          `Token available: Yes`
        );
      }
      
      const pendingAuth = await getPendingAuth(validatedArgs.session_id, env);
      if (pendingAuth) {
        const age = Math.floor((Date.now() - pendingAuth.created_at) / 60000);
        return createSuccessResponse(
          `⏳ Authentication Pending\n\n` +
          `Session created ${age} minutes ago.\n` +
          `Waiting for user to authorize on RTM website.`
        );
      }
      
      return createSuccessResponse(
        `❌ Not Authenticated\n\n` +
        `No authentication found for session: ${validatedArgs.session_id}\n` +
        `Please start with rtm_authenticate.`
      );
    } catch (error: any) {
      Logger.error('Auth status check failed', { error: error.message });
      return createErrorResponse(error);
    }
  }
);

// Register timeline tool
server.registerTool(
  "rtm_create_timeline",
  {
    annotations: {
      title: "Create Timeline",
      description: "Creates a timeline for making undoable changes to tasks and lists.",
      readOnlyHint: false,
    },
    inputSchema: toInputSchema(schemas.CreateTimelineSchema)
  },
  async (args: InferSchema<typeof schemas.CreateTimelineSchema>, env: Env) => {
    try {
      const validatedArgs = schemas.CreateTimelineSchema.parse(args);
      const response = await makeRTMRequest(
        'rtm.timelines.create',
        { auth_token: validatedArgs.auth_token },
        env.RTM_API_KEY,
        env.RTM_SHARED_SECRET
      );
      
      return createSuccessResponse(
        `✅ Timeline created!\n\n` +
        `Timeline ID: ${response.timeline}\n\n` +
        `Use this timeline ID for any operations that modify data.`
      );
    } catch (error: any) {
      Logger.error('Timeline creation failed', { error: error.message });
      return createErrorResponse(error);
    }
  }
);

// Register list management tools
server.registerTool(
  "rtm_get_lists",
  {
    annotations: {
      title: "Get RTM Lists",
      description: "Retrieves all task lists from your Remember The Milk account.",
      readOnlyHint: true,
    },
    inputSchema: toInputSchema(schemas.GetListsSchema)
  },
  async (args: InferSchema<typeof schemas.GetListsSchema>, env: Env) => {
    try {
      const validatedArgs = schemas.GetListsSchema.parse(args);
      const response = await makeRTMRequest(
        'rtm.lists.getList',
        { auth_token: validatedArgs.auth_token },
        env.RTM_API_KEY,
        env.RTM_SHARED_SECRET
      );
      
      const formattedLists = formatLists(response.lists.list);
      return createSuccessResponse(formattedLists);
    } catch (error: any) {
      Logger.error('Failed to get lists', { error: error.message });
      return createErrorResponse(error);
    }
  }
);

server.registerTool(
  "rtm_add_list",
  {
    annotations: {
      title: "Create New List",
      description: "Creates a new task list in Remember The Milk.",
      readOnlyHint: false,
    },
    inputSchema: toInputSchema(schemas.AddListSchema)
  },
  async (args: InferSchema<typeof schemas.AddListSchema>, env: Env) => {
    try {
      const validatedArgs = schemas.AddListSchema.parse(args);
      const params: Record<string, string> = {
        auth_token: validatedArgs.auth_token,
        timeline: validatedArgs.timeline,
        name: validatedArgs.name
      };
      
      if (validatedArgs.filter) {
        params.filter = validatedArgs.filter;
      }
      
      const response = await makeRTMRequest(
        'rtm.lists.add',
        params,
        env.RTM_API_KEY,
        env.RTM_SHARED_SECRET
      );
      
      const list = response.list;
      const listType = list.smart === "1" ? "Smart List" : "Regular List";
      
      return createSuccessResponse(
        `✅ ${listType} created!\n\n` +
        `Name: ${list.name}\n` +
        `ID: ${list.id}\n` +
        (list.filter ? `Filter: ${list.filter}\n` : '') +
        `\nTransaction ID: ${response.transaction?.id || "N/A"}`
      );
    } catch (error: any) {
      Logger.error('Failed to add list', { error: error.message });
      return createErrorResponse(error);
    }
  }
);

// Register task management tools
server.registerTool(
  "rtm_get_tasks",
  {
    annotations: {
      title: "Get Tasks",
      description: "Retrieves tasks from Remember The Milk, optionally filtered by list or search criteria.",
      readOnlyHint: true,
    },
    inputSchema: toInputSchema(schemas.GetTasksSchema)
  },
  async (args: InferSchema<typeof schemas.GetTasksSchema>, env: Env) => {
    try {
      const validatedArgs = schemas.GetTasksSchema.parse(args);
      const params: Record<string, string> = { 
        auth_token: validatedArgs.auth_token 
      };
      
      if (validatedArgs.list_id) params.list_id = validatedArgs.list_id;
      if (validatedArgs.filter) params.filter = validatedArgs.filter;
      
      const response = await makeRTMRequest(
        'rtm.tasks.getList',
        params,
        env.RTM_API_KEY,
        env.RTM_SHARED_SECRET
      );
      
      const formattedTasks = formatTasks(response.tasks);
      return createSuccessResponse(formattedTasks);
    } catch (error: any) {
      Logger.error('Failed to get tasks', { error: error.message });
      return createErrorResponse(error);
    }
  }
);

server.registerTool(
  "rtm_add_task",
  {
    annotations: {
      title: "Add New Task",
      description: "Creates a new task with Smart Add support for natural language input.",
      readOnlyHint: false,
    },
    inputSchema: toInputSchema(schemas.AddTaskSchema)
  },
  async (args: InferSchema<typeof schemas.AddTaskSchema>, env: Env) => {
    try {
      const validatedArgs = schemas.AddTaskSchema.parse(args);
      const params: Record<string, string> = {
        auth_token: validatedArgs.auth_token,
        timeline: validatedArgs.timeline,
        name: validatedArgs.name,
        parse: "1"
      };
      
      if (validatedArgs.list_id) {
        params.list_id = validatedArgs.list_id;
      }
      
      const response = await makeRTMRequest(
        'rtm.tasks.add',
        params,
        env.RTM_API_KEY,
        env.RTM_SHARED_SECRET
      );
      
      const list = response.list;
      const series = list.taskseries[0];
      const task = series.task[0];
      
      return createSuccessResponse(
        `✅ Task created!\n\n` +
        `Name: ${series.name}\n` +
        `List: ${list.id}\n` +
        `Due: ${task.due || "No due date"}\n` +
        `Priority: ${task.priority === "N" ? "None" : task.priority}\n\n` +
        `IDs: list=${list.id}, series=${series.id}, task=${task.id}`
      );
    } catch (error: any) {
      Logger.error('Failed to add task', { error: error.message });
      return createErrorResponse(error);
    }
  }
);

// Register remaining task tools with unified schemas
server.registerTool(
  "rtm_complete_task",
  {
    annotations: {
      title: "Complete Task",
      description: "Marks a task as completed in Remember The Milk.",
      readOnlyHint: false,
    },
    inputSchema: toInputSchema(schemas.CompleteTaskSchema)
  },
  async (args: InferSchema<typeof schemas.CompleteTaskSchema>, env: Env) => {
    try {
      const validatedArgs = schemas.CompleteTaskSchema.parse(args);
      const response = await makeRTMRequest(
        'rtm.tasks.complete',
        validatedArgs,
        env.RTM_API_KEY,
        env.RTM_SHARED_SECRET
      );
      
      return createSuccessResponse(
        `✅ Task completed!\n\n` +
        `Transaction ID: ${response.transaction?.id || "N/A"}\n\n` +
        `Use rtm_undo with this transaction ID to undo this action.`
      );
    } catch (error: any) {
      Logger.error('Failed to complete task', { error: error.message });
      return createErrorResponse(error);
    }
  }
);

server.registerTool(
  "rtm_delete_task",
  {
    annotations: {
      title: "Delete Task",
      description: "Permanently deletes a task from Remember The Milk.",
      readOnlyHint: false,
    },
    inputSchema: toInputSchema(schemas.DeleteTaskSchema)
  },
  async (args: InferSchema<typeof schemas.DeleteTaskSchema>, env: Env) => {
    try {
      const validatedArgs = schemas.DeleteTaskSchema.parse(args);
      const response = await makeRTMRequest(
        'rtm.tasks.delete',
        validatedArgs,
        env.RTM_API_KEY,
        env.RTM_SHARED_SECRET
      );
      
      return createSuccessResponse(
        `✅ Task deleted!\n\n` +
        `Transaction ID: ${response.transaction?.id || "N/A"}\n\n` +
        `⚠️ This action can be undone using rtm_undo with the transaction ID.`
      );
    } catch (error: any) {
      Logger.error('Failed to delete task', { error: error.message });
      return createErrorResponse(error);
    }
  }
);

server.registerTool(
  "rtm_set_due_date",
  {
    annotations: {
      title: "Set Task Due Date",
      description: "Sets or updates the due date for a task.",
      readOnlyHint: false,
    },
    inputSchema: toInputSchema(schemas.SetDueDateSchema)
  },
  async (args: InferSchema<typeof schemas.SetDueDateSchema>, env: Env) => {
    try {
      const validatedArgs = schemas.SetDueDateSchema.parse(args);
      const params: Record<string, string> = {
        auth_token: validatedArgs.auth_token,
        timeline: validatedArgs.timeline,
        list_id: validatedArgs.list_id,
        taskseries_id: validatedArgs.taskseries_id,
        task_id: validatedArgs.task_id,
        parse: "1"
      };
      
      if (validatedArgs.due !== undefined) {
        params.due = validatedArgs.due;
      }
      
      if (validatedArgs.has_due_time !== undefined) {
        params.has_due_time = validatedArgs.has_due_time;
      }
      
      const response = await makeRTMRequest(
        'rtm.tasks.setDueDate',
        params,
        env.RTM_API_KEY,
        env.RTM_SHARED_SECRET
      );
      
      return createSuccessResponse(
        `✅ Due date updated!\n\n` +
        `New due date: ${validatedArgs.due || "Cleared"}\n` +
        `Transaction ID: ${response.transaction?.id || "N/A"}`
      );
    } catch (error: any) {
      Logger.error('Failed to set due date', { error: error.message });
      return createErrorResponse(error);
    }
  }
);

server.registerTool(
  "rtm_add_tags",
  {
    annotations: {
      title: "Add Tags to Task",
      description: "Adds one or more tags to an existing task.",
      readOnlyHint: false,
    },
    inputSchema: toInputSchema(schemas.AddTagsSchema)
  },
  async (args: InferSchema<typeof schemas.AddTagsSchema>, env: Env) => {
    try {
      const validatedArgs = schemas.AddTagsSchema.parse(args);
      const response = await makeRTMRequest(
        'rtm.tasks.addTags',
        validatedArgs,
        env.RTM_API_KEY,
        env.RTM_SHARED_SECRET
      );
      
      return createSuccessResponse(
        `✅ Tags added!\n\n` +
        `Tags: ${validatedArgs.tags}\n` +
        `Transaction ID: ${response.transaction?.id || "N/A"}`
      );
    } catch (error: any) {
      Logger.error('Failed to add tags', { error: error.message });
      return createErrorResponse(error);
    }
  }
);

server.registerTool(
  "rtm_move_task",
  {
    annotations: {
      title: "Move Task to Another List",
      description: "Moves a task from one list to another.",
      readOnlyHint: false,
    },
    inputSchema: toInputSchema(schemas.MoveTaskSchema)
  },
  async (args: InferSchema<typeof schemas.MoveTaskSchema>, env: Env) => {
    try {
      const validatedArgs = schemas.MoveTaskSchema.parse(args);
      const response = await makeRTMRequest(
        'rtm.tasks.moveTo',
        {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          from_list_id: validatedArgs.from_list_id,
          to_list_id: validatedArgs.to_list_id,
          taskseries_id: validatedArgs.taskseries_id,
          task_id: validatedArgs.task_id
        },
        env.RTM_API_KEY,
        env.RTM_SHARED_SECRET
      );
      
      return createSuccessResponse(
        `✅ Task moved!\n\n` +
        `From list: ${validatedArgs.from_list_id}\n` +
        `To list: ${validatedArgs.to_list_id}\n` +
        `Transaction ID: ${response.transaction?.id || "N/A"}`
      );
    } catch (error: any) {
      Logger.error('Failed to move task', { error: error.message });
      return createErrorResponse(error);
    }
  }
);

server.registerTool(
  "rtm_set_priority",
  {
    annotations: {
      title: "Set Task Priority",
      description: "Sets the priority level for a task.",
      readOnlyHint: false,
    },
    inputSchema: toInputSchema(schemas.SetPrioritySchema)
  },
  async (args: InferSchema<typeof schemas.SetPrioritySchema>, env: Env) => {
    try {
      const validatedArgs = schemas.SetPrioritySchema.parse(args);
      const response = await makeRTMRequest(
        'rtm.tasks.setPriority',
        validatedArgs,
        env.RTM_API_KEY,
        env.RTM_SHARED_SECRET
      );
      
      const priorityMap: Record<string, string> = {
        "1": "High",
        "2": "Medium", 
        "3": "Low",
        "N": "None"
      };
      
      return createSuccessResponse(
        `✅ Priority updated!\n\n` +
        `New priority: ${priorityMap[validatedArgs.priority]}\n` +
        `Transaction ID: ${response.transaction?.id || "N/A"}`
      );
    } catch (error: any) {
      Logger.error('Failed to set priority', { error: error.message });
      return createErrorResponse(error);
    }
  }
);

// Register utility tools
server.registerTool(
  "rtm_undo",
  {
    annotations: {
      title: "Undo Last Action",
      description: "Undoes the last action performed within a timeline.",
      readOnlyHint: false,
    },
    inputSchema: toInputSchema(schemas.UndoSchema)
  },
  async (args: InferSchema<typeof schemas.UndoSchema>, env: Env) => {
    try {
      const validatedArgs = schemas.UndoSchema.parse(args);
      await makeRTMRequest(
        'rtm.transactions.undo',
        validatedArgs,
        env.RTM_API_KEY,
        env.RTM_SHARED_SECRET
      );
      
      return createSuccessResponse(
        `✅ Action undone!\n\n` +
        `Transaction ${validatedArgs.transaction_id} has been reversed.`
      );
    } catch (error: any) {
      Logger.error('Failed to undo', { error: error.message });
      return createErrorResponse(error);
    }
  }
);

server.registerTool(
  "rtm_parse_time",
  {
    annotations: {
      title: "Parse Natural Language Time",
      description: "Converts natural language time descriptions into RTM timestamps.",
      readOnlyHint: true,
    },
    inputSchema: toInputSchema(schemas.ParseTimeSchema)
  },
  async (args: InferSchema<typeof schemas.ParseTimeSchema>, env: Env) => {
    try {
      const validatedArgs = schemas.ParseTimeSchema.parse(args);
      const params: Record<string, string> = {
        text: validatedArgs.text
      };
      
      if (validatedArgs.timezone) {
        params.timezone = validatedArgs.timezone;
      }
      
      const response = await makeRTMRequest(
        'rtm.time.parse',
        params,
        env.RTM_API_KEY,
        env.RTM_SHARED_SECRET
      );
      
      return createSuccessResponse(
        `✅ Time parsed!\n\n` +
        `Input: "${validatedArgs.text}"\n` +
        `Parsed time: ${response.time.$t}\n` +
        `Precision: ${response.time.precision}`
      );
    } catch (error: any) {
      Logger.error('Failed to parse time', { error: error.message });
      return createErrorResponse(error);
    }
  }
);

// Create fetch handler
const handler = createFetchHandler(server);

// Main Worker export
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // Handle OAuth callback
    if (url.pathname === '/auth/callback') {
      return handleAuthCallback(request, env);
    }
    
    // Handle health check
    if (url.pathname === '/health') {
      return Response.json({
        status: 'healthy',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        kv_connected: !!env.AUTH_STORE,
        env_configured: !!env.RTM_API_KEY && !!env.RTM_SHARED_SECRET
      });
    }
    
    // Handle root GET
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('RTM MCP Server v2.0.0 (Unified Schema Edition)', {
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        }
      });
    }
    
    // Rate limiting
    const clientId = getClientId(request);
    const isAllowed = await checkRateLimit(clientId, env);
    
    if (!isAllowed) {
      return Response.json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Rate limit exceeded. Please try again later."
        }
      }, {
        status: 429,
        headers: {
          'Retry-After': '60',
          'X-RateLimit-Limit': '60',
          'X-RateLimit-Remaining': '0',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    // Handle MCP requests
    try {
      const response = await handler(request, { env });
      
      // Add CORS headers
      response.headers.set('Access-Control-Allow-Origin', '*');
      
      return response;
    } catch (error: any) {
      Logger.error('Request handling error', { 
        error: error.message,
        stack: error.stack 
      });
      
      return Response.json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error"
        }
      }, {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }
};