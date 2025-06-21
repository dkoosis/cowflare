/**
 * @file index.ts
 * @description RTM MCP Server for Cloudflare Workers
 */

import {
  JSONRPCRequest,
  JSONRPCResponse,
  Tool
} from '@modelcontextprotocol/sdk/types.js';

import { makeRTMRequest, Env } from './rtm-api.js';
import {
  checkRateLimit,
  savePendingAuth,
  getPendingAuth,
  cacheAuthToken,
  getCachedAuthToken
} from './auth.js';
import { tools as toolDefinitions } from './tools.js';
import {
  AuthenticateSchema,
  CompleteAuthSchema,
  CreateTimelineSchema,
  GetListsSchema,
  AddListSchema,
  GetTasksSchema,
  AddTaskSchema,
  CompleteTaskSchema,
  DeleteTaskSchema,
  SetDueDateSchema,
  AddTagsSchema,
  MoveTaskSchema,
  SetPrioritySchema,
  UndoSchema,
  ParseTimeSchema,
  RTMAPIError,
  ValidationError,
  RateLimitError
} from './validation.js';

// Helper functions
function generateSessionId(): string {
  return crypto.randomUUID();
}

function formatTasks(tasks: any): string {
  if (!tasks.list || tasks.list.length === 0) {
    return "No tasks found.";
  }

  let output = "";
  for (const list of tasks.list) {
    if (!list.taskseries || list.taskseries.length === 0) continue;

    output += `\n### ${list.id === "0" ? "Inbox" : `List ${list.id}`}\n\n`;

    for (const series of list.taskseries) {
      const task = Array.isArray(series.task) ? series.task[0] : series.task;
      const priority = task.priority === "N" ? "" : `!${task.priority} `;
      const due = task.due ? ` (due: ${task.due})` : "";
      const tags = series.tags ? ` #${Array.isArray(series.tags.tag) ? series.tags.tag.join(" #") : series.tags.tag}` : "";

      output += `- ${priority}${series.name}${due}${tags}\n`;
      output += `  IDs: list=${list.id}, series=${series.id}, task=${task.id}\n`;
    }
  }

  return output || "No tasks found.";
}

function formatLists(lists: any[]): string {
  if (!lists || lists.length === 0) {
    return "No lists found.";
  }

  let output = "## Your RTM Lists\n\n";
  const activeLists = lists.filter(l => l.deleted === "0" && l.archived === "0");
  const archivedLists = lists.filter(l => l.archived === "1");

  if (activeLists.length > 0) {
    output += "### Active Lists\n";
    for (const list of activeLists) {
      const smart = list.smart === "1" ? " (Smart List)" : "";
      output += `- **${list.name}**${smart} - ID: ${list.id}\n`;
    }
  }

  if (archivedLists.length > 0) {
    output += "\n### Archived Lists\n";
    for (const list of archivedLists) {
      output += `- ${list.name} - ID: ${list.id}\n`;
    }
  }

  return output;
}

function validateToolArgs(toolName: string, args: any): any {
  try {
    switch (toolName) {
      case "test_connection": return {};
      case "rtm_authenticate": return AuthenticateSchema.parse(args);
      case "rtm_complete_auth": return CompleteAuthSchema.parse(args);
      case "rtm_create_timeline": return CreateTimelineSchema.parse(args);
      case "rtm_get_lists": return GetListsSchema.parse(args);
      case "rtm_add_list": return AddListSchema.parse(args);
      case "rtm_get_tasks": return GetTasksSchema.parse(args);
      case "rtm_get_tasks_from_list": return GetTasksSchema.parse(args);
      case "rtm_add_task": return AddTaskSchema.parse(args);
      case "rtm_complete_task": return CompleteTaskSchema.parse(args);
      case "rtm_delete_task": return DeleteTaskSchema.parse(args);
      case "rtm_set_due_date": return SetDueDateSchema.parse(args);
      case "rtm_add_tags": return AddTagsSchema.parse(args);
      case "rtm_move_task": return MoveTaskSchema.parse(args);
      case "rtm_set_priority": return SetPrioritySchema.parse(args);
      case "rtm_undo": return UndoSchema.parse(args);
      case "rtm_parse_time": return ParseTimeSchema.parse(args);
      default:
        throw new ValidationError(`Unknown tool: ${toolName}`);
    }
  } catch (error: any) {
    if (error.errors) {
      const firstError = error.errors[0];
      const errorMessage = `${firstError.path.join('.')}: ${firstError.message}`;
      throw new ValidationError(errorMessage, firstError.path.join('.'));
    }
    throw error;
  }
}

// Execute tool call
async function executeToolCall(name: string, args: any, env: Env): Promise<{ content: any[]; isError?: boolean }> {
  const requestId = crypto.randomUUID().slice(0, 8);

  // Log request
  const sanitizedArgs = { ...args };
  if (sanitizedArgs.auth_token) sanitizedArgs.auth_token = "[REDACTED]";
  console.log(`[${requestId}] [${new Date().toISOString()}] Tool: ${name}`, sanitizedArgs);

  try {
    // Validate arguments
    const validatedArgs = validateToolArgs(name, args);

    // Execute tool
    switch (name) {
      case "test_connection": {
        return {
          content: [{
            type: "text",
            text: `✅ MCP Server Connection Test\n\nStatus: healthy\nTimestamp: ${new Date().toISOString()}\nVersion: 2.0.0\nKV Store: ${env.AUTH_STORE ? "Connected" : "Not Connected"}\nEnvironment: ${env.RTM_API_KEY ? "Configured" : "Not Configured"}`
          }]
        };
      }

      case "rtm_authenticate": {
        const sessionId = generateSessionId();
        const cached = await getCachedAuthToken(sessionId, env);

        if (cached) {
          return {
            content: [{
              type: "text",
              text: `✅ Welcome back ${cached.user.fullname}!\n\nYour authentication is still valid.\nUsername: ${cached.user.username}\n\nYou're ready to use RTM!`
            }]
          };
        }

        const frobResponse = await makeRTMRequest('rtm.auth.getFrob', {}, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        const frob = frobResponse.frob;

        await savePendingAuth(sessionId, frob, env);

        const authParams: Record<string, string> = {
          api_key: env.RTM_API_KEY,
          perms: 'write',
          frob: frob
        };

        // Generate proper MD5 signature
        const sortedKeys = Object.keys(authParams).sort();
        const paramString = sortedKeys.map(key => `${key}${authParams[key]}`).join('');
        const signatureBase = env.RTM_SHARED_SECRET + paramString;

        const encoder = new TextEncoder();
        const data = encoder.encode(signatureBase);
        const hashBuffer = await crypto.subtle.digest('MD5', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        authParams.api_sig = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        const callbackUrl = `${env.SERVER_URL}/auth/callback?session=${sessionId}`;
        const authUrl = `https://www.rememberthemilk.com/services/auth/?${new URLSearchParams(authParams)}&redirect=${encodeURIComponent(callbackUrl)}`;

        return {
          content: [{
            type: "text",
            text: `🔐 Authentication Required\n\nPlease authorize this app:\n\n1. Click: ${authUrl}\n2. Authorize on RTM\n3. Run rtm_complete_auth with session ID: ${sessionId}`
          }]
        };
      }

      case "rtm_complete_auth": {
        const sessionId = validatedArgs.session_id;
        const pending = await getPendingAuth(sessionId, env);

        if (!pending) {
          return {
            content: [{
              type: "text",
              text: "❌ Session expired or invalid. Please start authentication again."
            }]
          };
        }

        try {
          const response = await makeRTMRequest('rtm.auth.getToken', { frob: pending.frob }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);

          await cacheAuthToken(sessionId, response.auth, env);
          await env.AUTH_STORE.delete(`pending:${sessionId}`);

          return {
            content: [{
              type: "text",
              text: `✅ Success! Welcome ${response.auth.user.fullname}!\n\nAuth Token: ${response.auth.token}\nUsername: ${response.auth.user.username}\n\nYou're all set to use Remember The Milk!`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: "⏳ Authorization not complete yet. Make sure you authorized the app on RTM."
            }]
          };
        }
      }

      case "rtm_create_timeline": {
        const response = await makeRTMRequest('rtm.timelines.create',
          { auth_token: validatedArgs.auth_token },
          env.RTM_API_KEY,
          env.RTM_SHARED_SECRET
        );

        return {
          content: [{
            type: "text",
            text: `✅ Timeline created: ${response.timeline}`
          }]
        };
      }

      case "rtm_get_lists": {
        const response = await makeRTMRequest('rtm.lists.getList',
          { auth_token: validatedArgs.auth_token },
          env.RTM_API_KEY,
          env.RTM_SHARED_SECRET
        );

        return {
          content: [{
            type: "text",
            text: formatLists(response.lists.list)
          }]
        };
      }

      case "rtm_add_list": {
        const params: Record<string, string> = {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          name: validatedArgs.name
        };
        if (validatedArgs.filter) params.filter = validatedArgs.filter;

        const response = await makeRTMRequest('rtm.lists.add', params, env.RTM_API_KEY, env.RTM_SHARED_SECRET);

        return {
          content: [{
            type: "text",
            text: `✅ List created!\n\nName: ${response.list.name}\nID: ${response.list.id}\nType: ${response.list.smart === "1" ? "Smart List" : "Regular List"}`
          }]
        };
      }

      case "rtm_get_tasks":
      case "rtm_get_tasks_from_list": {
        const taskParams: Record<string, string> = { auth_token: validatedArgs.auth_token };
        if (validatedArgs.list_id) taskParams.list_id = validatedArgs.list_id;
        if (validatedArgs.filter) taskParams.filter = validatedArgs.filter;

        const response = await makeRTMRequest('rtm.tasks.getList', taskParams, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        return {
          content: [{
            type: "text",
            text: formatTasks(response.tasks)
          }]
        };
      }

      case "rtm_add_task": {
        const params: Record<string, string> = {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          name: validatedArgs.name,
          parse: "1" // Enable Smart Add
        };
        if (validatedArgs.list_id) params.list_id = validatedArgs.list_id;

        const response = await makeRTMRequest('rtm.tasks.add', params, env.RTM_API_KEY, env.RTM_SHARED_SECRET);

        const list = response.list;
        const series = list.taskseries[0];
        const task = series.task[0];

        return {
          content: [{
            type: "text",
            text: `✅ Task created!\n\nName: ${series.name}\nList: ${list.id}\nDue: ${task.due || "No due date"}\nPriority: ${task.priority === "N" ? "None" : task.priority}\n\nIDs: list=${list.id}, series=${series.id}, task=${task.id}`
          }]
        };
      }

      case "rtm_complete_task": {
        const response = await makeRTMRequest('rtm.tasks.complete', {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          list_id: validatedArgs.list_id,
          taskseries_id: validatedArgs.taskseries_id,
          task_id: validatedArgs.task_id
        }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);

        return {
          content: [{
            type: "text",
            text: `✅ Task completed!\n\nTransaction ID: ${response.transaction?.id || "N/A"}`
          }]
        };
      }

      case "rtm_delete_task": {
        const response = await makeRTMRequest('rtm.tasks.delete', {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          list_id: validatedArgs.list_id,
          taskseries_id: validatedArgs.taskseries_id,
          task_id: validatedArgs.task_id
        }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);

        return {
          content: [{
            type: "text",
            text: `✅ Task deleted!\n\nTransaction ID: ${response.transaction?.id || "N/A"}`
          }]
        };
      }

      case "rtm_set_due_date": {
        const params: Record<string, string> = {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          list_id: validatedArgs.list_id,
          taskseries_id: validatedArgs.taskseries_id,
          task_id: validatedArgs.task_id
        };

        if (validatedArgs.due) {
          params.due = validatedArgs.due;
        } else {
          params.due = "";
        }

        if (validatedArgs.has_due_time !== undefined) {
          params.has_due_time = validatedArgs.has_due_time;
        }

        params.parse = "1"; // Enable natural language parsing

        const response = await makeRTMRequest('rtm.tasks.setDueDate', params, env.RTM_API_KEY, env.RTM_SHARED_SECRET);

        return {
          content: [{
            type: "text",
            text: `✅ Due date updated!\n\nTransaction ID: ${response.transaction?.id || "N/A"}`
          }]
        };
      }

      case "rtm_add_tags": {
        const response = await makeRTMRequest('rtm.tasks.addTags', {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          list_id: validatedArgs.list_id,
          taskseries_id: validatedArgs.taskseries_id,
          task_id: validatedArgs.task_id,
          tags: validatedArgs.tags
        }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);

        return {
          content: [{
            type: "text",
            text: `✅ Tags added!\n\nTags: ${validatedArgs.tags}\nTransaction ID: ${response.transaction?.id || "N/A"}`
          }]
        };
      }

      case "rtm_move_task": {
        const response = await makeRTMRequest('rtm.tasks.moveTo', {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          from_list_id: validatedArgs.from_list_id,
          to_list_id: validatedArgs.to_list_id,
          taskseries_id: validatedArgs.taskseries_id,
          task_id: validatedArgs.task_id
        }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);

        return {
          content: [{
            type: "text",
            text: `✅ Task moved!\n\nFrom list: ${validatedArgs.from_list_id}\nTo list: ${validatedArgs.to_list_id}\nTransaction ID: ${response.transaction?.id || "N/A"}`
          }]
        };
      }

      case "rtm_set_priority": {
        const response = await makeRTMRequest('rtm.tasks.setPriority', {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          list_id: validatedArgs.list_id,
          taskseries_id: validatedArgs.taskseries_id,
          task_id: validatedArgs.task_id,
          priority: validatedArgs.priority
        }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);

        const priorityText = validatedArgs.priority === "N" ? "None" : `Priority ${validatedArgs.priority}`;

        return {
          content: [{
            type: "text",
            text: `✅ Priority updated to ${priorityText}!\n\nTransaction ID: ${response.transaction?.id || "N/A"}`
          }]
        };
      }

      case "rtm_undo": {
        const response = await makeRTMRequest('rtm.transactions.undo', {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          transaction_id: validatedArgs.transaction_id
        }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);

        return {
          content: [{
            type: "text",
            text: `✅ Action undone!\n\nTransaction ${validatedArgs.transaction_id} has been reversed.`
          }]
        };
      }

      case "rtm_parse_time": {
        const params: Record<string, string> = {
          text: validatedArgs.text
        };
        if (validatedArgs.timezone) params.timezone = validatedArgs.timezone;

        const response = await makeRTMRequest('rtm.time.parse', params, env.RTM_API_KEY, env.RTM_SHARED_SECRET);

        return {
          content: [{
            type: "text",
            text: `📅 Parsed Time:\n\nInput: "${validatedArgs.text}"\nResult: ${response.time.$t}\nPrecision: ${response.time.precision}`
          }]
        };
      }

      default:
        throw new ValidationError(`Unknown tool: ${name}`);
    }

  } catch (error: any) {
    console.error(`[${requestId}] Tool error:`, error.message);

    let errorMessage = "An unexpected error occurred.";
    if (error instanceof RTMAPIError) {
      errorMessage = `Remember The Milk Error: ${error.message}`;
      if (error.code) errorMessage += ` (Code: ${error.code})`;
    } else if (error instanceof ValidationError) {
      errorMessage = `Invalid Request: ${error.message}`;
    } else if (error instanceof RateLimitError) {
      errorMessage = "Rate limit exceeded. Please wait a moment.";
    }

    return {
      content: [{
        type: "text",
        text: `❌ ${errorMessage}`
      }],
      isError: true
    };
  }
}

// Handle MCP protocol requests
async function handleMcpRequest(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as JSONRPCRequest;

    // Validate JSON-RPC request
    if (!body.jsonrpc || body.jsonrpc !== "2.0" || !body.method) {
      return createErrorResponse(body.id || null, -32600, "Invalid Request");
    }

    let result: any;

    // Route based on method
    switch (body.method) {
      case "initialize": {
        result = {
          protocolVersion: "2024-11-05",
          serverInfo: {
            name: "rtm-mcp-server",
            version: "2.0.0"
          },
          capabilities: {
            tools: {},
            resources: {},
            prompts: {}
          }
        };
        break;
      }

      case "tools/list": {
        const connectionTestTool: Tool = {
          name: "test_connection",
          description: "Test MCP server connection and diagnostics",
          inputSchema: {
            type: "object",
            properties: {},
            required: []
          }
        };
        result = {
          tools: [...toolDefinitions, connectionTestTool]
        };
        break;
      }

      case "resources/list": {
        result = {
          resources: [
            {
              uri: "rtm://user-profile",
              name: "rtm/user-profile",
              description: "User settings and preferences",
              mimeType: "application/json"
            },
            {
              uri: "rtm://lists-summary",
              name: "rtm/lists-summary",
              description: "Summary of all lists",
              mimeType: "application/json"
            },
            {
              uri: "rtm://tags-summary",
              name: "rtm/tags-summary",
              description: "All available tags",
              mimeType: "application/json"
            }
          ]
        };
        break;
      }

      case "prompts/list": {
        result = {
          prompts: [
            {
              name: "daily_briefing",
              description: "Get a summary of today's tasks and overdue items",
              arguments: [
                {
                  name: "auth_token",
                  description: "Your RTM authentication token",
                  required: true
                }
              ]
            },
            {
              name: "plan_my_day",
              description: "Interactive planning for unscheduled tasks",
              arguments: [
                {
                  name: "auth_token",
                  description: "Your RTM authentication token",
                  required: true
                }
              ]
            },
            {
              name: "find_and_update_task",
              description: "Search and update tasks interactively",
              arguments: [
                {
                  name: "auth_token",
                  description: "Your RTM authentication token",
                  required: true
                },
                {
                  name: "search_query",
                  description: "Search terms to find tasks",
                  required: true
                }
              ]
            }
          ]
        };
        break;
      }

      case "tools/call": {
        const params = body.params as any;
        result = await executeToolCall(params.name, params.arguments || {}, env);
        break;
      }

      default: {
        return createErrorResponse(body.id, -32601, `Method not found: ${body.method}`);
      }
    }

    // Create success response
    const response: JSONRPCResponse = {
      jsonrpc: "2.0",
      id: body.id!,
      result: result || {}
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store"
      }
    });

  } catch (error: any) {
    console.error("MCP request handling error:", error);
    return createErrorResponse(null, -32603, error.message || "Internal error");
  }
}

function createErrorResponse(id: any, code: number, message: string): Response {
  const errorResponse = {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };

  return new Response(JSON.stringify(errorResponse as any), {
    status: 200, // JSON-RPC errors should still have a 200 OK status
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}


// OAuth callback handler
async function handleAuthCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session');

  if (!sessionId) {
    return new Response('Invalid request: Missing session ID', { status: 400 });
  }

  try {
    const pending = await getPendingAuth(sessionId, env);

    if (!pending) {
      return new Response('Session expired or invalid', { status: 400 });
    }

    // Try to get the token
    const response = await makeRTMRequest('rtm.auth.getToken',
      { frob: pending.frob },
      env.RTM_API_KEY,
      env.RTM_SHARED_SECRET
    );

    // Cache the token
    await cacheAuthToken(sessionId, response.auth, env);

    // Clean up pending auth
    await env.AUTH_STORE.delete(`pending:${sessionId}`);

    // Return success page
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authentication Successful</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background-color: #f5f5f5;
            }
            .container {
              text-align: center;
              background: white;
              padding: 2rem;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .success {
              color: #4CAF50;
              font-size: 48px;
              margin-bottom: 1rem;
            }
            .session-id {
              background: #f0f0f0;
              padding: 0.5rem 1rem;
              border-radius: 4px;
              font-family: monospace;
              margin: 1rem 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success">✅</div>
            <h1>Authentication Successful!</h1>
            <p>Welcome, <strong>${response.auth.user.fullname}</strong>!</p>
            <p>You can now close this window and return to your application.</p>
            <p>Your session ID is:</p>
            <div class="session-id">${sessionId}</div>
            <p>Use the <code>rtm_complete_auth</code> tool with this session ID to finish setup.</p>
          </div>
        </body>
      </html>
    `;

    return new Response(html, {
      headers: { 'Content-Type': 'text/html' }
    });

  } catch (error: any) {
    console.error('OAuth callback error:', error);
    return new Response(`Authentication failed: ${error.message}`, { status: 500 });
  }
}

// Export the Cloudflare Worker fetch handler
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      // Handle CORS preflight
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "86400"
          }
        });
      }

      const url = new URL(request.url);

      // Handle OAuth callback
      if (url.pathname === '/auth/callback') {
        return handleAuthCallback(request, env);
      }

      // Handle health check
      if (url.pathname === '/health') {
        return Response.json({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          version: '2.0.0',
          kv_connected: !!env.AUTH_STORE,
          env_configured: !!env.RTM_API_KEY && !!env.RTM_SHARED_SECRET
        }, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store"
          }
        });
      }

      // Handle GET requests to root
      if (request.method === "GET" && url.pathname === "/") {
        return new Response("RTM MCP Server v2.0.0 (SDK Version)", {
          headers: {
            "Content-Type": "text/plain",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }

      // Apply rate limiting for POST requests
      if (request.method === "POST") {
        const clientId = request.headers.get('CF-Connecting-IP') ||
                        request.headers.get('X-Forwarded-For')?.split(',')[0] ||
                        'anonymous';

        const allowed = await checkRateLimit(clientId, env);
        if (!allowed) {
          return Response.json({
            jsonrpc: "2.0",
            error: {
              code: 429,
              message: "Rate limit exceeded. Please try again later."
            },
            id: null
          }, {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
              "Retry-After": "60"
            }
          });
        }
      }

      // Pass MCP protocol requests to our handler
      return handleMcpRequest(request, env);

    } catch (error: any) {
      console.error("Unexpected error:", error);
      return Response.json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error"
        },
        id: null
      }, {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  }
};