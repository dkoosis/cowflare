import { generateApiSig, makeRTMRequest } from './rtm-api';
import { checkRateLimit, cacheAuthToken, getCachedToken } from './auth';
import { tools } from './tools';

interface Env {
  RTM_API_KEY: string;
  RTM_SHARED_SECRET: string;
  AUTH_STORE: KVNamespace;
  SERVER_URL: string;
}

// Main handler for tool calls
async function handleToolCall(name: string, args: any, env: Env): Promise<{ protocol: string; value: any }> {
  switch (name) {
    case "rtm_authenticate": {
      // Check for cached token first
      const cached = await getCachedToken(args.user_id, env);
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
      
      // Generate auth URL
      const authParams: Record<string, string> = {
        api_key: env.RTM_API_KEY,
        perms: 'write',
        frob: frob
      };
      authParams.api_sig = generateApiSig(authParams, env.RTM_SHARED_SECRET);
      const authUrl = `https://www.rememberthemilk.com/services/auth/?${new URLSearchParams(authParams)}`;
      
      return {
        protocol: "rtm/auth-setup",
        value: {
          success: false,
          frob: frob,
          auth_url: authUrl,
          message: "Authentication required",
          instructions: [
            `1. Click this link: ${authUrl}`,
            "2. Log in and authorize the app",
            "3. Come back here and say 'I authorized it'",
            "4. I'll complete the setup for you!"
          ],
          user_id: args.user_id
        }
      };
    }

    case "rtm_complete_auth": {
      try {
        const response = await makeRTMRequest('rtm.auth.getToken', { frob: args.frob }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        await cacheAuthToken(args.user_id, response.auth, env);
        
        return {
          protocol: "rtm/auth-complete",
          value: {
            success: true,
            auth_token: response.auth.token,
            username: response.auth.user.username,
            fullname: response.auth.user.fullname,
            message: `Success! Welcome ${response.auth.user.fullname}!`,
            next_steps: [
              "You're all set up!",
              "Try: 'Show me my tasks' or 'Add a task: Call mom tomorrow at 2pm'"
            ]
          }
        };
      } catch (error) {
        return {
          protocol: "rtm/auth-complete",
          value: {
            success: false,
            message: "Authorization not complete yet. Make sure you clicked the link and authorized the app, then try again."
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

    // Health check endpoint
    if (request.url.endsWith('/health')) {
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
        const clientId = request.headers.get('CF-Connecting-IP') || 'anonymous';
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

    return new Response("RTM MCP Server v1.1.0", { 
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};