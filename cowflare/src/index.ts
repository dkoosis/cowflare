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
  description: "Test MCP server connection and diagnostics",
  inputSchema: {
    type: "object",
    properties: {},
    required: []
  }
};

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
  console.log(`[KV_READ] Attempting to get pending auth from key: ${key}`);
  const data = await env.AUTH_STORE.get(key);
  if (data) {
    console.log(`[KV_READ] Found pending auth for key: ${key}`);
    return JSON.parse(data);
  }
  console.log(`[KV_READ] No pending auth found for key: ${key}`);
  return null;
}

/**
 * Safely parse JSON from request body with proper error handling
 */
async function safeJsonParse(request: Request): Promise<any> {
  try {
    const text = await request.text();
    if (!text || text.trim() === '') {
      throw new Error('Empty request body');
    }
    return JSON.parse(text);
  } catch (error: any) {
    console.error('JSON parse error:', error);
    throw new SyntaxError(`Invalid JSON: ${error.message}`);
  }
}

/**
 * Create a properly formatted JSON-RPC response
 */
function createJsonRpcResponse(id: any, result?: any, error?: any): Response {
  const body: any = {
    jsonrpc: "2.0",
    id: id ?? null
  };
  
  if (error) {
    body.error = error;
  } else {
    body.result = result ?? {};
  }
  
  return new Response(JSON.stringify(body), {
    status: error ? (error.code === 429 ? 429 : 400) : 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Cache-Control": "no-store",
      "Connection": "keep-alive"
    }
  });
}

/**
 * Validates the arguments for a given tool name against its Zod schema.
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
 * Handles the execution of a single tool call.
 * @param {string} name - The name of the tool to execute.
 * @param {any} args - The arguments for the tool.
 * @param {Env} env - The worker's environment.
 * @returns {Promise<{ protocol: string; value: any }>} The result of the tool call.
 */
async function handleToolCall(name: string, args: any, env: Env): Promise<{ protocol: string; value: any }> {
  // Generate a unique ID for this specific request for easier log tracing.
  const requestId = crypto.randomUUID().slice(0, 8);
  
  // Log the incoming request with its new ID.
  console.log(`[${requestId}] [${new Date().toISOString()}] Calling tool: ${name} with args: ${JSON.stringify(args)}`);
  
  // Handle connection test tool first
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
    
    return {
      protocol: "test/connection",
      value: testResult
    };
  }
  
  // Validate the incoming arguments against the tool's schema.
  const validatedArgs = validateToolArgs(name, args);
  
  try {
    switch (name) {
      case "rtm_authenticate": {
        const sessionId = generateSessionId();
        const cached = await getCachedToken(sessionId, env);
        if (cached) {
          return {
            protocol: "rtm/auth-setup",
            value: {
              success: true,
              auth_token: cached.token,
              username: cached.username,
              message: `Welcome back ${cached.fullname}! Your authentication is still valid.`,
              next_steps: [ "You're ready to use RTM!", "Try: 'Show me my tasks' or 'Add a task: Buy milk tomorrow'" ]
            }
          };
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
        
        return {
          protocol: "rtm/auth-setup",
          value: {
            success: false,
            session_id: sessionId,
            frob: frob,
            auth_url: authUrl,
            callback_url: callbackUrl,
            message: "Authentication required",
            instructions: [ "1. Click the link to authorize", "2. You'll be redirected back automatically", "3. Complete auth with rtm_complete_auth" ]
          }
        };
      }

      case "rtm_complete_auth": {
        const sessionId = validatedArgs.session_id;
        const pending = await getPendingAuth(sessionId, env);
        if (!pending) {
          throw new RTMAPIError("Session expired. Please start authentication again.");
        }
        
        try {
          const response = await makeRTMRequest('rtm.auth.getToken', { frob: pending.frob }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
          
          await cacheAuthToken(sessionId, response.auth, env);
          await env.AUTH_STORE.delete(`pending:${sessionId}`);
          
          return {
            protocol: "rtm/auth-complete",
            value: {
              success: true,
              auth_token: response.auth.token,
              username: response.auth.user.username,
              fullname: response.auth.user.fullname,
              message: `Success! Welcome ${response.auth.user.fullname}!`,
              next_steps: [ "You're all set!", "Try: 'Show me my tasks' or 'Add a task: Call mom tomorrow at 2pm'" ]
            }
          };
        } catch (error: any) {
          throw new RTMAPIError("Authorization not complete yet. Make sure you authorized the app on RTM, then try again.");
        }
      }

      case "rtm_create_timeline": {
        const response: RTMTimelineResponse = await makeRTMRequest('rtm.timelines.create', { auth_token: validatedArgs.auth_token }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        return { protocol: "rtm/timeline", value: response };
      }

      case "rtm_get_lists": {
        const response = await makeRTMRequest('rtm.lists.getList', { auth_token: validatedArgs.auth_token }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        return { protocol: "rtm/lists", value: response.lists.list as RTMList[] };
      }

      case "rtm_add_list": {
        const listParams: Record<string, string> = { auth_token: validatedArgs.auth_token, timeline: validatedArgs.timeline, name: validatedArgs.name };
        if (validatedArgs.filter) listParams.filter = validatedArgs.filter;
        const response = await makeRTMRequest('rtm.lists.add', listParams, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        return { protocol: "rtm/list-add-result", value: response };
      }

      case "rtm_get_tasks": {
        const taskParams: Record<string, string> = { auth_token: validatedArgs.auth_token };
        if (validatedArgs.list_id) taskParams.list_id = validatedArgs.list_id;
        if (validatedArgs.filter) taskParams.filter = validatedArgs.filter;
        const response = await makeRTMRequest('rtm.tasks.getList', taskParams, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        return { protocol: "rtm/tasks", value: response.tasks };
      }

      case "rtm_add_task": {
        const taskParams: Record<string, string> = { auth_token: validatedArgs.auth_token, timeline: validatedArgs.timeline, name: validatedArgs.name, parse: "1" };
        if (validatedArgs.list_id) taskParams.list_id = validatedArgs.list_id;
        const response = await makeRTMRequest('rtm.tasks.add', taskParams, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        return { protocol: "rtm/task-add-result", value: response };
      }

      case "rtm_complete_task": {
        const response = await makeRTMRequest('rtm.tasks.complete', { auth_token: validatedArgs.auth_token, timeline: validatedArgs.timeline, list_id: validatedArgs.list_id, taskseries_id: validatedArgs.taskseries_id, task_id: validatedArgs.task_id }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        return { protocol: "rtm/task-complete-result", value: response };
      }

      case "rtm_delete_task": {
        const response = await makeRTMRequest('rtm.tasks.delete', { auth_token: validatedArgs.auth_token, timeline: validatedArgs.timeline, list_id: validatedArgs.list_id, taskseries_id: validatedArgs.taskseries_id, task_id: validatedArgs.task_id }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        return { protocol: "rtm/task-delete-result", value: response };
      }

      case "rtm_set_due_date": {
        const dueParams: Record<string, string> = { auth_token: validatedArgs.auth_token, timeline: validatedArgs.timeline, list_id: validatedArgs.list_id, taskseries_id: validatedArgs.taskseries_id, task_id: validatedArgs.task_id };
        if (validatedArgs.due) dueParams.due = validatedArgs.due;
        if (validatedArgs.has_due_time) dueParams.has_due_time = validatedArgs.has_due_time;
        const response = await makeRTMRequest('rtm.tasks.setDueDate', dueParams, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        return { protocol: "rtm/task-due-result", value: response };
      }

      case "rtm_add_tags": {
        const response = await makeRTMRequest('rtm.tasks.addTags', { auth_token: validatedArgs.auth_token, timeline: validatedArgs.timeline, list_id: validatedArgs.list_id, taskseries_id: validatedArgs.taskseries_id, task_id: validatedArgs.task_id, tags: validatedArgs.tags }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        return { protocol: "rtm/task-tags-result", value: response };
      }

      case "rtm_move_task": {
        const response = await makeRTMRequest('rtm.tasks.moveTo', { auth_token: validatedArgs.auth_token, timeline: validatedArgs.timeline, from_list_id: validatedArgs.from_list_id, to_list_id: validatedArgs.to_list_id, taskseries_id: validatedArgs.taskseries_id, task_id: validatedArgs.task_id }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        return { protocol: "rtm/task-move-result", value: response };
      }

      case "rtm_set_priority": {
        const response = await makeRTMRequest('rtm.tasks.setPriority', { auth_token: validatedArgs.auth_token, timeline: validatedArgs.timeline, list_id: validatedArgs.list_id, taskseries_id: validatedArgs.taskseries_id, task_id: validatedArgs.task_id, priority: validatedArgs.priority }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        return { protocol: "rtm/task-priority-result", value: response };
      }

      case "rtm_undo": {
        await makeRTMRequest('rtm.transactions.undo', { auth_token: validatedArgs.auth_token, timeline: validatedArgs.timeline, transaction_id: validatedArgs.transaction_id }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        return { protocol: "rtm/undo-result", value: { success: true } };
      }

      case "rtm_parse_time": {
        const timeParams: Record<string, string> = { text: validatedArgs.text };
        if (validatedArgs.timezone) timeParams.timezone = validatedArgs.timezone;
        const response = await makeRTMRequest('rtm.time.parse', timeParams, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        return { protocol: "rtm/parsed-time", value: response.time };
      }

      default:
        throw new ValidationError(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    console.error(`[${requestId}] Tool call ${name} FAILED:`, error);
    if (error instanceof RTMAPIError || error instanceof ValidationError || error instanceof RateLimitError) {
      throw error;
    }
    if (error.message?.includes('RTM API Error')) {
      throw new RTMAPIError(error.message);
    }
    throw new RTMAPIError(`An unexpected error occurred: ${error.message}`);
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
  
  console.log(`[AUTH_CALLBACK] Received callback for session: ${sessionId}`);

  if (!sessionId) {
    console.error('[AUTH_CALLBACK] Callback received without a session ID.');
    return new Response('Invalid session ID provided in callback.', { status: 400 });
  }
  
  const pending = await getPendingAuth(sessionId, env);
  if (!pending) {
    console.error(`[AUTH_CALLBACK] No pending auth found in KV for session: ${sessionId}. It may have expired.`);
    return new Response('Authentication session expired or is invalid. Please try initiating the connection again.', { status: 400 });
  }
  
  try {
    console.log(`[AUTH_CALLBACK] Exchanging frob for auth token for session: ${sessionId}`);
    const response = await makeRTMRequest('rtm.auth.getToken', { frob: pending.frob }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
    
    console.log(`[AUTH_CALLBACK] Successfully received auth token for session: ${sessionId}. Caching...`);
    await cacheAuthToken(sessionId, response.auth, env);
    
    console.log(`[AUTH_CALLBACK] Deleting pending session key: pending:${sessionId}`);
    await env.AUTH_STORE.delete(`pending:${sessionId}`);
    
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Connected!</title>
        <style>
          body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
          .success { background: white; padding: 40px; border-radius: 10px; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .success h1 { color: #28a745; margin: 0 0 20px 0; }
          .close { color: #666; }
        </style>
      </head>
      <body>
        <div class="success">
          <h1>✅ Connected!</h1>
          <p>Remember The Milk has been connected successfully.</p>
          <p class="close">You can close this tab and return to your conversation.</p>
        </div>
        <script>
          setTimeout(() => {
            window.close();
          }, 3000);
        </script>
      </body>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html' }
    });

  } catch (error: any) {
    console.error(`[AUTH_CALLBACK] FAILED to get auth token for session ${sessionId}. RTM API Error:`, error);
    return new Response(`Authentication failed. RTM API responded with: ${error.message}`, { status: 500 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID().slice(0, 8);
    const startTime = Date.now();
    
    console.log(`[${requestId}] New request: ${request.method} ${request.url}`);
    console.log(`[${requestId}] Headers:`, Object.fromEntries(request.headers.entries()));
    
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
        
        console.log(`[${requestId}] Request body:`, JSON.stringify(body));
        
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
            
            const result = await handleToolCall(params.name, params.arguments || {}, env);
            return createJsonRpcResponse(id, {
              content: [{
                type: "text",
                text: JSON.stringify(result.value, null, 2)
              }]
            });

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
          errorMessage = "RTM API Error: " + error.message;
        } else if (error instanceof RateLimitError) {
          errorCode = 429;
          errorMessage = error.message;
        } else {
          errorMessage = error.message || "Unknown error occurred";
        }
        
        return createJsonRpcResponse(id, null, {
          code: errorCode,
          message: errorMessage,
          data: {
            error: error.toString(),
            type: error.constructor.name,
            requestId
          }
        });
      }
    } catch (outerError: any) {
      // This catches any errors that occur before we can parse the request
      const duration = Date.now() - startTime;
      console.error(`[${requestId}] Fatal error after ${duration}ms:`, outerError);
      console.error(`[${requestId}] Stack trace:`, outerError.stack);
      
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32603,
          message: `Internal server error: ${outerError.message}`,
          data: {
            requestId,
            error: outerError.toString(),
            stack: outerError.stack
          }
        }
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "X-Request-ID": requestId
        }
      });
    }
  }
};