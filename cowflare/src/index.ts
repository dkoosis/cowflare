import { generateApiSig, makeRTMRequest } from './rtm-api';
import { checkRateLimit, cacheAuthToken, getCachedToken } from './auth';
import { tools } from './tools';

interface Env {
  RTM_API_KEY: string;
  RTM_SHARED_SECRET: string;
  AUTH_STORE: KVNamespace;
  SERVER_URL: string;
}

// Generate unique session ID
function generateSessionId(): string {
  return crypto.randomUUID();
}

// Store pending auth session
async function storePendingAuth(sessionId: string, frob: string, env: Env): Promise<void> {
  await env.AUTH_STORE.put(`pending:${sessionId}`, JSON.stringify({
    frob,
    createdAt: Date.now()
  }), { expirationTtl: 600 }); // 10 minute expiry
}

// Get pending auth session
async function getPendingAuth(sessionId: string, env: Env): Promise<{ frob: string } | null> {
  const data = await env.AUTH_STORE.get(`pending:${sessionId}`);
  return data ? JSON.parse(data) : null;
}

// Main handler for tool calls
async function handleToolCall(name: string, args: any, env: Env): Promise<{ protocol: string; value: any }> {
  switch (name) {
    case "rtm_authenticate": {
      // Generate session ID
      const sessionId = generateSessionId();
      
      // Check for cached token first (using session ID as key)
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
      
      // Get frob
      const frobResponse = await makeRTMRequest('rtm.auth.getFrob', {}, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
      const frob = frobResponse.frob;
      
      // Store pending auth
      await storePendingAuth(sessionId, frob, env);
      
      // Generate auth URL with callback
      const authParams: Record<string, string> = {
        api_key: env.RTM_API_KEY,
        perms: 'write',
        frob: frob
      };
      authParams.api_sig = generateApiSig(authParams, env.RTM_SHARED_SECRET);
      
      // RTM doesn't support callbacks - use standard auth URL
      const authUrl = `https://www.rememberthemilk.com/services/auth/?${new URLSearchParams(authParams)}`;
      
      return {
        protocol: "rtm/auth-setup",
        value: {
          success: false,
          session_id: sessionId,
          frob: frob,
          auth_url: authUrl,
          message: "Authentication required",
          instructions: [
            "1. Click the link to authorize",
            "2. After authorizing, return here",
            "3. I'll check if you're connected"
          ]
        }
      };
    }

    case "rtm_complete_auth": {
      const sessionId = args.session_id;
      
      // Get pending auth
      const pending = await getPendingAuth(sessionId, env);
      if (!pending) {
        return {
          protocol: "rtm/auth-complete",
          value: {
            success: false,
            message: "Session expired. Please start authentication again."
          }
        };
      }
      
      try {
        // Exchange frob for token
        const response = await makeRTMRequest('rtm.auth.getToken', { frob: pending.frob }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        
        // Cache the auth token
        await cacheAuthToken(sessionId, response.auth, env);
        
        // Clean up pending
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
        return {
          protocol: "rtm/auth-complete",
          value: {
            success: false,
            message: "Authorization not complete yet. Make sure you authorized the app on RTM, then try again."
          }
        };
      }
    }

    case "rtm_create_timeline": {
      const response = await makeRTMRequest('rtm.timelines.create', { auth_token: args.auth_token }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
      return { protocol: "rtm/timeline", value: response };
    }

    case "rtm_get_lists": {
      const response = await makeRTMRequest('rtm.lists.getList', { auth_token: args.auth_token }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
      return { protocol: "rtm/lists", value: response.lists.list };
    }

    case "rtm_add_list": {
      const listParams: Record<string, string> = {
        auth_token: args.auth_token,
        timeline: args.timeline,
        name: args.name
      };
      if (args.filter) listParams.filter = args.filter;
      const response = await makeRTMRequest('rtm.lists.add', listParams, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
      return { protocol: "rtm/list-add-result", value: response };
    }

    case "rtm_get_tasks": {
      const taskParams: Record<string, string> = { auth_token: args.auth_token };
      if (args.list_id) taskParams.list_id = args.list_id;
      if (args.filter) taskParams.filter = args.filter;
      const response = await makeRTMRequest('rtm.tasks.getList', taskParams, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
      return { protocol: "rtm/tasks", value: response.tasks };
    }

    case "rtm_add_task": {
      const taskParams: Record<string, string> = {
        auth_token: args.auth_token,
        timeline: args.timeline,
        name: args.name,
        parse: "1"
      };
      if (args.list_id) taskParams.list_id = args.list_id;
      const response = await makeRTMRequest('rtm.tasks.add', taskParams, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
      return { protocol: "rtm/task-add-result", value: response };
    }

    case "rtm_complete_task": {
      const response = await makeRTMRequest('rtm.tasks.complete', {
        auth_token: args.auth_token,
        timeline: args.timeline,
        list_id: args.list_id,
        taskseries_id: args.taskseries_id,
        task_id: args.task_id
      }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
      return { protocol: "rtm/task-complete-result", value: response };
    }

    case "rtm_delete_task": {
      const response = await makeRTMRequest('rtm.tasks.delete', {
        auth_token: args.auth_token,
        timeline: args.timeline,
        list_id: args.list_id,
        taskseries_id: args.taskseries_id,
        task_id: args.task_id
      }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
      return { protocol: "rtm/task-delete-result", value: response };
    }

    case "rtm_set_due_date": {
      const dueParams: Record<string, string> = {
        auth_token: args.auth_token,
        timeline: args.timeline,
        list_id: args.list_id,
        taskseries_id: args.taskseries_id,
        task_id: args.task_id
      };
      if (args.due) dueParams.due = args.due;
      if (args.has_due_time) dueParams.has_due_time = args.has_due_time;
      const response = await makeRTMRequest('rtm.tasks.setDueDate', dueParams, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
      return { protocol: "rtm/task-due-result", value: response };
    }

    case "rtm_add_tags": {
      const response = await makeRTMRequest('rtm.tasks.addTags', {
        auth_token: args.auth_token,
        timeline: args.timeline,
        list_id: args.list_id,
        taskseries_id: args.taskseries_id,
        task_id: args.task_id,
        tags: args.tags
      }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
      return { protocol: "rtm/task-tags-result", value: response };
    }

    case "rtm_move_task": {
      const response = await makeRTMRequest('rtm.tasks.moveTo', {
        auth_token: args.auth_token,
        timeline: args.timeline,
        from_list_id: args.from_list_id,
        to_list_id: args.to_list_id,
        taskseries_id: args.taskseries_id,
        task_id: args.task_id
      }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
      return { protocol: "rtm/task-move-result", value: response };
    }

    case "rtm_set_priority": {
      const response = await makeRTMRequest('rtm.tasks.setPriority', {
        auth_token: args.auth_token,
        timeline: args.timeline,
        list_id: args.list_id,
        taskseries_id: args.taskseries_id,
        task_id: args.task_id,
        priority: args.priority
      }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
      return { protocol: "rtm/task-priority-result", value: response };
    }

    case "rtm_undo": {
      await makeRTMRequest('rtm.transactions.undo', {
        auth_token: args.auth_token,
        timeline: args.timeline,
        transaction_id: args.transaction_id
      }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
      return { protocol: "rtm/undo-result", value: { success: true } };
    }

    case "rtm_parse_time": {
      const timeParams: Record<string, string> = { text: args.text };
      if (args.timezone) timeParams.timezone = args.timezone;
      const response = await makeRTMRequest('rtm.time.parse', timeParams, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
      return { protocol: "rtm/parsed-time", value: response.time };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Handle auth callback
async function handleAuthCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session');
  
  if (!sessionId) {
    return new Response('Invalid session', { status: 400 });
  }
  
  // Get pending auth
  const pending = await getPendingAuth(sessionId, env);
  if (!pending) {
    return new Response('Session expired', { status: 400 });
  }
  
  try {
    // Exchange frob for token
    const response = await makeRTMRequest('rtm.auth.getToken', { frob: pending.frob }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
    
    // Store auth data with session ID
    await env.AUTH_STORE.put(`auth:${sessionId}`, JSON.stringify({
      token: response.auth.token,
      username: response.auth.user.username,
      fullname: response.auth.user.fullname,
      cachedAt: Date.now()
    }), { expirationTtl: 7 * 24 * 60 * 60 }); // 7 days
    
    // Clean up pending auth
    await env.AUTH_STORE.delete(`pending:${sessionId}`);
    
    // Return success page
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
          // Optional: auto-close after 3 seconds
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
    // Handle CORS preflight
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

    // Handle auth callback
    if (url.pathname === '/auth/callback') {
      return handleAuthCallback(request, env);
    }

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ 
        status: 'healthy', 
        timestamp: new Date().toISOString() 
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Handle JSON-RPC requests
    if (request.method === "POST") {
      try {
        // Rate limiting
        const clientId = request.headers.get('CF-Connecting-IP') || 
                       request.headers.get('X-Forwarded-For')?.split(',')[0] || 
                       'anonymous';
        const allowed = await checkRateLimit(clientId, env);
        if (!allowed) {
          return new Response(JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Rate limit exceeded. Please try again later."
            }
          }), {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          });
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
                version: "1.2.0"
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
                    type: "resource",
                    resource: {
                      protocol: result.protocol,
                      id: "rtm-result-" + Date.now(),
                      version: "1.0",
                      value: result.value
                    }
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
            return new Response(JSON.stringify({
              jsonrpc: "2.0",
              id,
              error: {
                code: -32000,
                message: error.message
              }
            }), {
              status: 500,
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

    return new Response("RTM MCP Server v1.2.0", { 
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};