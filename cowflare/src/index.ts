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

interface Env {
  RTM_API_KEY: string;
  RTM_SHARED_SECRET: string;
  AUTH_STORE: KVNamespace;
  SERVER_URL: string;
}

interface PendingAuth {
  frob: string;
  createdAt: number;
}

interface CachedAuth {
  token: string;
  username: string;
  fullname: string;
  cachedAt: number;
}

function generateSessionId(): string {
  return crypto.randomUUID();
}

async function storePendingAuth(sessionId: string, frob: string, env: Env): Promise<void> {
  await env.AUTH_STORE.put(`pending:${sessionId}`, JSON.stringify({
    frob,
    createdAt: Date.now()
  }), { expirationTtl: 600 });
}

async function getPendingAuth(sessionId: string, env: Env): Promise<PendingAuth | null> {
  const data = await env.AUTH_STORE.get(`pending:${sessionId}`);
  return data ? JSON.parse(data) : null;
}

function validateToolArgs(toolName: string, args: any): any {
  try {
    switch (toolName) {
      case "rtm_authenticate":
        return AuthenticateSchema.parse(args);
      case "rtm_complete_auth":
        return CompleteAuthSchema.parse(args);
      case "rtm_create_timeline":
        return CreateTimelineSchema.parse(args);
      case "rtm_get_lists":
        return GetListsSchema.parse(args);
      case "rtm_add_list":
        return AddListSchema.parse(args);
      case "rtm_get_tasks":
        return GetTasksSchema.parse(args);
      case "rtm_add_task":
        return AddTaskSchema.parse(args);
      case "rtm_complete_task":
        return CompleteTaskSchema.parse(args);
      case "rtm_delete_task":
        return DeleteTaskSchema.parse(args);
      case "rtm_set_due_date":
        return SetDueDateSchema.parse(args);
      case "rtm_add_tags":
        return AddTagsSchema.parse(args);
      case "rtm_move_task":
        return MoveTaskSchema.parse(args);
      case "rtm_set_priority":
        return SetPrioritySchema.parse(args);
      case "rtm_undo":
        return UndoSchema.parse(args);
      case "rtm_parse_time":
        return ParseTimeSchema.parse(args);
      default:
        throw new ValidationError(`Unknown tool: ${toolName}`);
    }
  } catch (error: any) {
    if (error.errors) {
      const firstError = error.errors[0];
      throw new ValidationError(`${firstError.path.join('.')}: ${firstError.message}`, firstError.path.join('.'));
    }
    throw error;
  }
}

async function handleToolCall(name: string, args: any, env: Env): Promise<{ protocol: string; value: any }> {
  // Log request
  console.log(`[${new Date().toISOString()}] ${name} ${JSON.stringify(args)}`);
  
  // Validate input
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
              next_steps: [
                "You're ready to use RTM!",
                "Try: 'Show me my tasks' or 'Add a task: Buy milk tomorrow'"
              ]
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
        
        // Use SERVER_URL for proper OAuth callback
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
            instructions: [
              "1. Click the link to authorize",
              "2. You'll be redirected back automatically",
              "3. Complete auth with rtm_complete_auth"
            ]
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
              next_steps: [
                "You're all set!",
                "Try: 'Show me my tasks' or 'Add a task: Call mom tomorrow at 2pm'"
              ]
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
        const listParams: Record<string, string> = {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          name: validatedArgs.name
        };
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
        const taskParams: Record<string, string> = {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          name: validatedArgs.name,
          parse: "1"
        };
        if (validatedArgs.list_id) taskParams.list_id = validatedArgs.list_id;
        const response = await makeRTMRequest('rtm.tasks.add', taskParams, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        return { protocol: "rtm/task-add-result", value: response };
      }

      case "rtm_complete_task": {
        const response = await makeRTMRequest('rtm.tasks.complete', {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          list_id: validatedArgs.list_id,
          taskseries_id: validatedArgs.taskseries_id,
          task_id: validatedArgs.task_id
        }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        return { protocol: "rtm/task-complete-result", value: response };
      }

      case "rtm_delete_task": {
        const response = await makeRTMRequest('rtm.tasks.delete', {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          list_id: validatedArgs.list_id,
          taskseries_id: validatedArgs.taskseries_id,
          task_id: validatedArgs.task_id
        }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        return { protocol: "rtm/task-delete-result", value: response };
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
        const response = await makeRTMRequest('rtm.tasks.setDueDate', dueParams, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        return { protocol: "rtm/task-due-result", value: response };
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
        return { protocol: "rtm/task-tags-result", value: response };
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
        return { protocol: "rtm/task-move-result", value: response };
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
        return { protocol: "rtm/task-priority-result", value: response };
      }

      case "rtm_undo": {
        await makeRTMRequest('rtm.transactions.undo', {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          transaction_id: validatedArgs.transaction_id
        }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
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
    if (error instanceof RTMAPIError || error instanceof ValidationError) {
      throw error;
    }
    
    // Convert generic errors to RTMAPIError
    if (error.message?.includes('RTM API Error')) {
      throw new RTMAPIError(error.message);
    }
    
    throw new RTMAPIError(`Unexpected error: ${error.message}`);
  }
}

async function handleAuthCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session');
  
  if (!sessionId) {
    return new Response('Invalid session', { status: 400 });
  }
  
  const pending = await getPendingAuth(sessionId, env);
  if (!pending) {
    return new Response('Session expired', { status: 400 });
  }
  
  try {
    const response = await makeRTMRequest('rtm.auth.getToken', { frob: pending.frob }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
    
    await env.AUTH_STORE.put(`auth:${sessionId}`, JSON.stringify({
      token: response.auth.token,
      username: response.auth.user.username,
      fullname: response.auth.user.fullname,
      cachedAt: Date.now()
    }), { expirationTtl: 7 * 24 * 60 * 60 });
    
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
          <p class="close">You can close this tab and return to Claude.</p>
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
    return new Response(`Authentication failed: ${error.message}`, { status: 500 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    const url = new URL(request.url);

    if (url.pathname === '/auth/callback') {
      return handleAuthCallback(request, env);
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ 
        status: 'healthy', 
        timestamp: new Date().toISOString() 
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (request.method === "POST") {
      try {
        // Rate limiting with improved fallback chain
        const clientId = request.headers.get('CF-Connecting-IP') || 
                       request.headers.get('X-Forwarded-For')?.split(',')[0] || 
                       'anonymous';
        const allowed = await checkRateLimit(clientId, env);
        if (!allowed) {
          throw new RateLimitError();
        }

        const body = await request.json();
        const { method, params, id } = body;

        if (method === "initialize") {
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: "2024-11-05",
              serverInfo: {
                name: "rtm-mcp-server",
                version: "1.1.0"
              },
              capabilities: {
                tools: {}
              }
            }
          }), {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          });
        }

        if (method === "tools/list") {
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { tools }
          }), {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          });
        }

        if (method === "resources/list") {
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { resources: [] }
          }), {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          });
        }

        if (method === "prompts/list") {
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { prompts: [] }
          }), {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          });
        }

        if (method === "tools/call") {
          const { name, arguments: args } = params;
          
          try {
            const result = await handleToolCall(name, args, env);
            
            return new Response(JSON.stringify({
              jsonrpc: "2.0",
              id,
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(result.value, null, 2)
                  }
                ]
              }
            }), {
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
              }
            });
          } catch (error: any) {
            let errorCode = -32000;
            let statusCode = 500;
            
            if (error instanceof RateLimitError) {
              errorCode = -32000;
              statusCode = 429;
            } else if (error instanceof ValidationError) {
              errorCode = -32602;
              statusCode = 400;
            } else if (error instanceof RTMAPIError) {
              errorCode = -32000;
              statusCode = 500;
            }
            
            return new Response(JSON.stringify({
              jsonrpc: "2.0",
              id,
              error: {
                code: errorCode,
                message: error.message
              }
            }), {
              status: statusCode,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
              }
            });
          }
        }
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: "Method not found"
          }
        }), {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32700,
            message: "Parse error"
          }
        }), {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
    }

    return new Response("RTM MCP Server v1.1.0", { 
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};