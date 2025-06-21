/**
 * @file index.ts
 * @description Main Cloudflare Worker file for the RTM MCP Server.
 * It handles incoming JSON-RPC requests, routes them to the appropriate tool handlers,
 * manages the OAuth authentication flow, and returns structured responses.
 */

import { generateApiSig, makeRTMRequest } from './rtm-api';
import { checkRateLimit, cacheAuthToken, getCachedToken } from './auth';
import { tools } from './tools';
import {
  RTMAPIError,
  ValidationError,
  RateLimitError,
  RTMAuthResponse,
  RTMTimelineResponse,
  RTMList,
  RTMTaskSeries,
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
  ParseTimeSchema
} from './validation';

// Define the environment variables required by the worker.
interface Env {
  RTM_API_KEY: string;
  RTM_SHARED_SECRET: string;
  AUTH_STORE: KVNamespace;
  SERVER_URL: string;
}

// Describes the structure of a pending authentication request stored in KV.
interface PendingAuth {
  frob: string;
  createdAt: number;
}

// Describes the structure of a cached, successful authentication stored in KV.
interface CachedAuth {
  token: string;
  username: string;
  fullname: string;
  cachedAt: number;
}

// Add connection test tool to the tools array
const connectionTestTool = {
  name: "test_connection",
  title: "Test MCP Server Connection",
  description: "Test MCP server connection and diagnostics",
  readOnlyHint: true,
  inputSchema: {
    type: "object",
    properties: {},
    required: []
  }
};

/**
 * Formats task data into a human-readable markdown string
 */
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

/**
 * Formats list data into a human-readable markdown string
 */
function formatLists(lists: RTMList[]): string {
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

/**
 * Generates a unique session ID for a new authentication flow.
 * @returns {string} A UUID.
 */
function generateSessionId(): string {
  return crypto.randomUUID();
}

/**
 * Stores a pending authentication's frob and session ID in the KV store.
 * The entry has a 10-minute time-to-live (TTL).
 * @param {string} sessionId - The unique session identifier.
 * @param {string} frob - The frob received from RTM.
 * @param {Env} env - The worker's environment.
 */
async function storePendingAuth(sessionId: string, frob: string, env: Env): Promise<void> {
  const key = `pending:${sessionId}`;
  console.log(`[KV_WRITE] Storing pending auth to key: ${key}`);
  await env.AUTH_STORE.put(key, JSON.stringify({
    frob,
    createdAt: Date.now()
  }), { expirationTtl: 600 }); // 10 minute expiry
}

/**
 * Retrieves a pending authentication object from the KV store.
 * @param {string} sessionId - The session ID to look up.
 * @param {Env} env - The worker's environment.
 * @returns {Promise<PendingAuth | null>} The pending auth data or null if not found.
 */
async function getPendingAuth(sessionId: string, env: Env): Promise<PendingAuth | null> {
  const key = `pending:${sessionId}`;
  console.log(`[KV_READ] Reading pending auth from key: ${key}`);
  const data = await env.AUTH_STORE.get(key);
  return data ? JSON.parse(data) : null;
}

/**
 * Validates tool arguments against their defined schemas.
 * @param {string} toolName - The name of the tool being called.
 * @param {any} args - The arguments provided for the tool.
 * @returns {any} The parsed and validated arguments.
 * @throws {ValidationError} Throws a validation error if the arguments are invalid.
 */
function validateToolArgs(toolName: string, args: any): any {
  // Special case for test_connection which has no required args
  if (toolName === "test_connection") {
    return {};
  }
  
  try {
    switch (toolName) {
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
    // Re-throw Zod errors as our custom ValidationError for consistent handling.
    if (error.errors) {
      const firstError = error.errors[0];
      const errorMessage = `${firstError.path.join('.')}: ${firstError.message}`;
      throw new ValidationError(errorMessage, firstError.path.join('.'));
    }
    throw error;
  }
}

/**
 * Handles the execution of a single tool call with standardized output
 */
async function handleToolCall(name: string, args: any, env: Env): Promise<any> {
  const requestId = crypto.randomUUID().slice(0, 8);
  
  // Log request without sensitive data
  const sanitizedArgs = { ...args };
  if (sanitizedArgs.auth_token) sanitizedArgs.auth_token = "[REDACTED]";
  console.log(`[${requestId}] [${new Date().toISOString()}] Tool: ${name}`, sanitizedArgs);
  
  // Handle connection test tool
  if (name === "test_connection") {
    const testResult = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      kv_connected: !!env.AUTH_STORE,
      env_vars: {
        rtm_api_key: !!env.RTM_API_KEY,
        rtm_shared_secret: !!env.RTM_SHARED_SECRET,
        server_url: !!env.SERVER_URL
      },
      worker: {
        name: "cowflare",
        version: "1.1.0"
      }
    };
    
    return [{
      type: "text",
      text: `✅ MCP Server Connection Test\n\nStatus: ${testResult.status}\nTimestamp: ${testResult.timestamp}\nKV Store: ${testResult.kv_connected ? "Connected" : "Not Connected"}\nConfiguration: ${Object.values(testResult.env_vars).every(v => v) ? "Complete" : "Incomplete"}\nWorker: ${testResult.worker.name} v${testResult.worker.version}`
    }];
  }
  
  // Validate arguments
  const validatedArgs = validateToolArgs(name, args);
  
  try {
    switch (name) {
      case "rtm_authenticate": {
        const sessionId = generateSessionId();
        const cached = await getCachedToken(sessionId, env);
        
        if (cached) {
          return [{
            type: "text",
            text: `✅ Welcome back ${cached.fullname}!\n\nYour authentication is still valid.\nUsername: ${cached.username}\n\nYou're ready to use RTM! Try:\n- "Show me my tasks"\n- "Add a task: Buy milk tomorrow"`
          }];
        }
        
        const frobResponse = await makeRTMRequest('rtm.auth.getFrob', {}, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        const frob = frobResponse.frob;
        
        await storePendingAuth(sessionId, frob, env);
        
        const authParams: Record<string, string> = {
          api_key: env.RTM_API_KEY,
          perms: 'write',
          frob: frob
        };
        authParams.api_sig = generateApiSig(authParams, env.RTM_SHARED_SECRET);
        
        const callbackUrl = `${env.SERVER_URL}/auth/callback?session=${sessionId}`;
        const authUrl = `https://www.rememberthemilk.com/services/auth/?${new URLSearchParams(authParams)}&redirect=${encodeURIComponent(callbackUrl)}`;
        
        return [{
          type: "text",
          text: `🔐 Authentication Required\n\nPlease authorize this app to access your Remember The Milk account:\n\n1. Click this link: ${authUrl}\n2. Authorize the app on RTM\n3. You'll be redirected back automatically\n4. Run rtm_complete_auth with session ID: ${sessionId}\n\nSession ID: ${sessionId}`
        }];
      }

      case "rtm_complete_auth": {
        const sessionId = validatedArgs.session_id;
        const pending = await getPendingAuth(sessionId, env);
        
        if (!pending) {
          return [{
            type: "text",
            text: "❌ Session expired or invalid. Please start authentication again with rtm_authenticate."
          }];
        }
        
        try {
          const response = await makeRTMRequest('rtm.auth.getToken', { frob: pending.frob }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
          
          await cacheAuthToken(sessionId, response.auth, env);
          await env.AUTH_STORE.delete(`pending:${sessionId}`);
          
          return [{
            type: "text",
            text: `✅ Success! Welcome ${response.auth.user.fullname}!\n\nUsername: ${response.auth.user.username}\nAuth Token: ${response.auth.token}\n\nYou're all set! Try:\n- "Show me my tasks"\n- "Add a task: Call mom tomorrow at 2pm"`
          }];
        } catch (error: any) {
          return [{
            type: "text",
            text: "⏳ Authorization not complete yet. Make sure you authorized the app on RTM, then try again."
          }];
        }
      }

      case "rtm_create_timeline": {
        const response = await makeRTMRequest('rtm.timelines.create', { auth_token: validatedArgs.auth_token }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        return [{
          type: "text",
          text: `✅ Timeline created successfully\n\nTimeline ID: ${response.timeline}\n\nUse this timeline ID for any operations that modify data (add, complete, delete tasks, etc.)`
        }];
      }

      case "rtm_get_lists": {
        const response = await makeRTMRequest('rtm.lists.getList', { auth_token: validatedArgs.auth_token }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        const lists = response.lists.list as RTMList[];
        return [{
          type: "text",
          text: formatLists(lists)
        }];
      }

      case "rtm_add_list": {
        const listParams: Record<string, string> = { 
          auth_token: validatedArgs.auth_token, 
          timeline: validatedArgs.timeline, 
          name: validatedArgs.name 
        };
        if (validatedArgs.filter) listParams.filter = validatedArgs.filter;
        
        const response = await makeRTMRequest('rtm.lists.add', listParams, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        const list = response.list;
        
        return [{
          type: "text",
          text: `✅ Successfully created list "${list.name}"\n\nList ID: ${list.id}\n${list.smart === "1" ? "Type: Smart List\n" : ""}${list.filter ? `Filter: ${list.filter}` : ""}`
        }];
      }

      case "rtm_get_tasks": 
      case "rtm_get_tasks_from_list": {
        const taskParams: Record<string, string> = { auth_token: validatedArgs.auth_token };
        if (validatedArgs.list_id) taskParams.list_id = validatedArgs.list_id;
        if (validatedArgs.filter) taskParams.filter = validatedArgs.filter;
        
        const response = await makeRTMRequest('rtm.tasks.getList', taskParams, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        return [{
          type: "text",
          text: formatTasks(response.tasks)
        }];
      }

      case "rtm_add_task": {
        const taskParams: Record<string, string> = { 
          auth_token: validatedArgs.auth_token, 
          timeline: validatedArgs.timeline, 
          name: validatedArgs.name, 
          parse: "1" 
        };
        if (validatedArgs.list_id) taskParams.list_id = validatedArgs.list_id;
        
        const response = await makeRTMRequest('rtm.tasks.add', taskParams, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        const list = response.list;
        const series = list.taskseries;
        const task = Array.isArray(series.task) ? series.task[0] : series.task;
        
        return [{
          type: "text",
          text: `✅ Successfully added task "${series.name}"\n\nList: ${list.id}\nTask IDs: series=${series.id}, task=${task.id}\n${task.due ? `Due: ${task.due}` : "No due date"}`
        }];
      }

      case "rtm_complete_task": {
        await makeRTMRequest('rtm.tasks.complete', {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          list_id: validatedArgs.list_id,
          taskseries_id: validatedArgs.taskseries_id,
          task_id: validatedArgs.task_id
        }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        
        return [{
          type: "text",
          text: "✅ Task marked as completed"
        }];
      }

      case "rtm_delete_task": {
        await makeRTMRequest('rtm.tasks.delete', {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          list_id: validatedArgs.list_id,
          taskseries_id: validatedArgs.taskseries_id,
          task_id: validatedArgs.task_id
        }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        
        return [{
          type: "text",
          text: "✅ Task deleted successfully"
        }];
      }

      case "rtm_set_due_date": {
        const dueParams: Record<string, string> = {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          list_id: validatedArgs.list_id,
          taskseries_id: validatedArgs.taskseries_id,
          task_id: validatedArgs.task_id
        };
        if (validatedArgs.due) dueParams.due = validatedArgs.due;
        if (validatedArgs.has_due_time) dueParams.has_due_time = validatedArgs.has_due_time;
        
        await makeRTMRequest('rtm.tasks.setDueDate', dueParams, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        
        return [{
          type: "text",
          text: `✅ Due date ${validatedArgs.due ? `set to ${validatedArgs.due}` : "cleared"}`
        }];
      }

      case "rtm_add_tags": {
        await makeRTMRequest('rtm.tasks.addTags', {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          list_id: validatedArgs.list_id,
          taskseries_id: validatedArgs.taskseries_id,
          task_id: validatedArgs.task_id,
          tags: validatedArgs.tags
        }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        
        return [{
          type: "text",
          text: `✅ Added tags: ${validatedArgs.tags}`
        }];
      }

      case "rtm_move_task": {
        await makeRTMRequest('rtm.tasks.moveTo', {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          from_list_id: validatedArgs.from_list_id,
          to_list_id: validatedArgs.to_list_id,
          taskseries_id: validatedArgs.taskseries_id,
          task_id: validatedArgs.task_id
        }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        
        return [{
          type: "text",
          text: "✅ Task moved successfully"
        }];
      }

      case "rtm_set_priority": {
        await makeRTMRequest('rtm.tasks.setPriority', {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          list_id: validatedArgs.list_id,
          taskseries_id: validatedArgs.taskseries_id,
          task_id: validatedArgs.task_id,
          priority: validatedArgs.priority
        }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        
        const priorityMap = { "N": "None", "1": "High", "2": "Medium", "3": "Low" };
        return [{
          type: "text",
          text: `✅ Priority set to ${priorityMap[validatedArgs.priority as keyof typeof priorityMap]}`
        }];
      }

      case "rtm_undo": {
        await makeRTMRequest('rtm.transactions.undo', {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          transaction_id: validatedArgs.transaction_id
        }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        
        return [{
          type: "text",
          text: "✅ Action undone successfully"
        }];
      }

      case "rtm_parse_time": {
        const timeParams: Record<string, string> = { text: validatedArgs.text };
        if (validatedArgs.timezone) timeParams.timezone = validatedArgs.timezone;
        
        const response = await makeRTMRequest('rtm.time.parse', timeParams, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        const time = response.time;
        
        return [{
          type: "text",
          text: `Parsed time: ${time.$t}\n\nUse this value when setting due dates for tasks.`
        }];
      }

      default:
        throw new ValidationError(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    console.error(`[${requestId}] Tool error:`, error.message);
    
    // Return user-friendly error messages
    if (error instanceof RTMAPIError) {
      return [{
        type: "text",
        text: `❌ Remember The Milk Error: ${error.message}`,
        isError: true
      }];
    } else if (error instanceof ValidationError) {
      return [{
        type: "text",
        text: `❌ Invalid Request: ${error.message}`,
        isError: true
      }];
    } else if (error instanceof RateLimitError) {
      return [{
        type: "text",
        text: "❌ Rate limit exceeded. Please wait a moment before trying again.",
        isError: true
      }];
    } else {
      return [{
        type: "text",
        text: "❌ An unexpected error occurred. Please check your connection and try again.",
        isError: true
      }];
    }
  }
}

/**
 * Handles the OAuth callback from RTM after a user authorizes the application.
 * @param {Request} request - The incoming request from the RTM redirect.
 * @param {Env} env - The worker's environment.
 * @returns {Promise<Response>} A response containing a success/failure page for the user.
 */
async function handleAuthCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session');
  
  // Don't log session ID for security
  console.log(`[AUTH_CALLBACK] Received callback request`);

  if (!sessionId) {
    return new Response('Invalid request: missing session parameter', { status: 400 });
  }
  
  const pending = await getPendingAuth(sessionId, env);
  if (!pending) {
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Session Expired</title>
        <style>
          body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
          .error { background: white; padding: 40px; border-radius: 10px; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; }
          .error h1 { color: #dc3545; margin: 0 0 20px 0; }
          .error p { color: #666; line-height: 1.5; }
        </style>
      </head>
      <body>
        <div class="error">
          <h1>Session Expired</h1>
          <p>Your authentication session has expired. Please return to your conversation and start the authentication process again.</p>
        </div>
      </body>
      </html>
    `, {
      status: 400,
      headers: { 'Content-Type': 'text/html' }
    });
  }
  
  try {
    console.log(`[AUTH_CALLBACK] Exchanging frob for token`);
    const response = await makeRTMRequest('rtm.auth.getToken', { frob: pending.frob }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
    
    await cacheAuthToken(sessionId, response.auth, env);
    await env.AUTH_STORE.delete(`pending:${sessionId}`);
    
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Connected Successfully!</title>
        <style>
          body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
          .success { background: white; padding: 40px; border-radius: 10px; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; }
          .success h1 { color: #28a745; margin: 0 0 20px 0; }
          .success p { color: #666; line-height: 1.5; margin: 15px 0; }
          .session-info { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; font-family: monospace; word-break: break-all; }
          .close { color: #999; font-size: 14px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="success">
          <h1>✅ Connected!</h1>
          <p>Remember The Milk has been successfully connected.</p>
          <div class="session-info">Session: ${sessionId}</div>
          <p>Return to your conversation and use <strong>rtm_complete_auth</strong> with the session ID above to finish setup.</p>
          <p class="close">This window will close automatically in 5 seconds...</p>
        </div>
        <script>
          // Copy session ID to clipboard if available
          if (navigator.clipboard) {
            navigator.clipboard.writeText('${sessionId}').catch(() => {});
          }
          setTimeout(() => {
            window.close();
          }, 5000);
        </script>
      </body>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html' }
    });

  } catch (error: any) {
    console.error(`[AUTH_CALLBACK] Failed to exchange token:`, error.message);
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authentication Failed</title>
        <style>
          body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
          .error { background: white; padding: 40px; border-radius: 10px; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; }
          .error h1 { color: #dc3545; margin: 0 0 20px 0; }
          .error p { color: #666; line-height: 1.5; }
        </style>
      </head>
      <body>
        <div class="error">
          <h1>Authentication Failed</h1>
          <p>There was an error connecting to Remember The Milk. Please try again or contact support if the issue persists.</p>
        </div>
      </body>
      </html>
    `, {
      status: 500,
      headers: { 'Content-Type': 'text/html' }
    });
  }
}

/**
 * Creates a JSON-RPC response with the specified id, result, and optional error.
 */
function createJsonRpcResponse(id: any, result: any, error?: any): Response {
  const response: any = {
    jsonrpc: "2.0",
    id: id
  };
  
  if (error) {
    response.error = error;
  } else {
    response.result = result;
  }
  
  return Response.json(response, {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    }
  });
}

/**
 * Safely parses JSON from the request body with error handling.
 */
async function safeJsonParse(request: Request): Promise<any> {
  const text = await request.text();
  
  if (!text) {
    throw new ValidationError("Empty request body");
  }
  
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new SyntaxError(`Invalid JSON: ${error.message}`);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID().slice(0, 8);
    const startTime = Date.now();
    
    console.log(`[${requestId}] New request: ${request.method} ${request.url}`);
    
    try {
      // Handle preflight CORS requests
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Max-Age": "86400"
          }
        });
      }

      const url = new URL(request.url);
      
      // Handle special endpoints
      if (url.pathname === '/auth/callback') {
        return handleAuthCallback(request, env);
      }

      if (url.pathname === '/health') {
        return Response.json({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          version: '1.1.0',
          worker: 'cowflare',
          kv_namespace: env.AUTH_STORE ? 'connected' : 'missing',
          environment: {
            rtm_api_key: !!env.RTM_API_KEY,
            rtm_shared_secret: !!env.RTM_SHARED_SECRET,
            server_url: !!env.SERVER_URL
          }
        }, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store"
          }
        });
      }

      // Default GET response
      if (request.method !== "POST") {
        return new Response("RTM MCP Server v1.1.0", {
          status: 200,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "text/plain"
          }
        });
      }

      // Handle POST requests (MCP protocol)
      let id = null;
      let body: any = {};
      
      try {
        // Parse request body
        body = await safeJsonParse(request);
        id = body.id;
        
        console.log(`[${requestId}] Request method: ${body.method}`);
        
        // Validate JSON-RPC structure
        if (!body.jsonrpc || body.jsonrpc !== "2.0") {
          throw new ValidationError("Invalid JSON-RPC version");
        }
        
        if (!body.method) {
          throw new ValidationError("Missing method field");
        }
        
        // Rate limiting with improved client ID detection
        const clientId = request.headers.get('CF-Connecting-IP') || 
                        request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 
                        request.headers.get('X-Real-IP') ||
                        'anonymous';
                        
        console.log(`[${requestId}] Client ID for rate limiting: ${clientId}`);
        
        const allowed = await checkRateLimit(clientId, env);
        if (!allowed) {
          console.log(`[${requestId}] Rate limit exceeded for client: ${clientId}`);
          return createJsonRpcResponse(id, null, {
            code: 429,
            message: "Rate limit exceeded. Please try again later."
          });
        }

        const { method, params = {} } = body;

        // Handle MCP methods
        switch (method) {
          case "initialize":
            console.log(`[${requestId}] Handling initialize`);
            return createJsonRpcResponse(id, {
              protocolVersion: "2024-11-05",
              serverInfo: {
                name: "rtm-mcp-server",
                version: "1.1.0"
              },
              capabilities: {
                tools: {}
              }
            });

          case "tools/list":
            console.log(`[${requestId}] Handling tools/list`);
            // Include connection test tool with other tools
            const allTools = [...tools, connectionTestTool];
            return createJsonRpcResponse(id, { tools: allTools });

          case "resources/list":
            console.log(`[${requestId}] Handling resources/list`);
            return createJsonRpcResponse(id, { resources: [] });

          case "prompts/list":
            console.log(`[${requestId}] Handling prompts/list`);
            return createJsonRpcResponse(id, { prompts: [] });

          case "tools/call":
            console.log(`[${requestId}] Handling tools/call for tool: ${params.name}`);
            
            if (!params.name) {
              throw new ValidationError("Missing tool name");
            }
            
            try {
              // Call the enhanced handleToolCall function
              const content = await handleToolCall(params.name, params.arguments || {}, env);
              
              // Return standardized content response
              return createJsonRpcResponse(id, { content });
              
            } catch (error: any) {
              // Handle errors with user-friendly messages
              if (error instanceof RTMAPIError) {
                return createJsonRpcResponse(id, {
                  content: [{
                    type: "text",
                    text: `Could not complete the request with Remember The Milk. ${error.message}`
                  }],
                  isError: true
                });
              } else if (error instanceof ValidationError) {
                return createJsonRpcResponse(id, {
                  content: [{
                    type: "text",
                    text: `Invalid request: ${error.message}. Please check your parameters and try again.`
                  }],
                  isError: true
                });
              } else if (error instanceof RateLimitError) {
                return createJsonRpcResponse(id, {
                  content: [{
                    type: "text",
                    text: "Too many requests. Please wait a moment before trying again."
                  }],
                  isError: true
                });
              } else {
                // Generic error - don't expose internals
                console.error(`[${requestId}] Unexpected error in tool ${params.name}:`, error);
                return createJsonRpcResponse(id, {
                  content: [{
                    type: "text",
                    text: "An unexpected error occurred. Please try again or contact support if the issue persists."
                  }],
                  isError: true
                });
              }
            }

          default:
            console.log(`[${requestId}] Unknown method: ${method}`);
            return createJsonRpcResponse(id, null, {
              code: -32601,
              message: `Method not found: ${method}`
            });
        }
        
      } catch (error: any) {
        const duration = Date.now() - startTime;
        console.error(`[${requestId}] Error handling request after ${duration}ms:`, error);
        console.error(`[${requestId}] Stack trace:`, error.stack);
        
        let errorCode = -32603;
        let errorMessage = "Internal server error";
        
        if (error instanceof SyntaxError) {
          errorCode = -32700;
          errorMessage = "Parse error: " + error.message;
        } else if (error instanceof ValidationError) {
          errorCode = -32602;
          errorMessage = "Invalid params: " + error.message;
        } else if (error instanceof RTMAPIError) {
          errorCode = -32000;
          errorMessage = error.message;
        } else if (error instanceof RateLimitError) {
          errorCode = 429;
          errorMessage = error.message;
        }
        
        return createJsonRpcResponse(id, null, {
          code: errorCode,
          message: errorMessage
        });
      }
      
    } catch (error: any) {
      console.error(`[${requestId}] Unexpected error:`, error);
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