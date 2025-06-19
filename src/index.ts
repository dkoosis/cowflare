import MD5 from "crypto-js/md5";

interface Env {
  RTM_API_KEY: string;
  RTM_SHARED_SECRET: string;
  AUTH_STORE: KVNamespace;
  SERVER_URL: string;
}

// Rate limiter
async function checkRateLimit(clientId: string, env: Env): Promise<boolean> {
  const key = `rate:${clientId}`;
  const data = await env.AUTH_STORE.get(key);
  
  if (!data) {
    await env.AUTH_STORE.put(key, JSON.stringify({
      count: 1,
      resetAt: Date.now() + 3600000 // 1 hour
    }), { expirationTtl: 3600 });
    return true;
  }
  
  const rateData = JSON.parse(data);
  if (Date.now() > rateData.resetAt) {
    await env.AUTH_STORE.put(key, JSON.stringify({
      count: 1,
      resetAt: Date.now() + 3600000
    }), { expirationTtl: 3600 });
    return true;
  }
  
  if (rateData.count >= 100) {
    return false;
  }
  
  rateData.count++;
  await env.AUTH_STORE.put(key, JSON.stringify(rateData), { expirationTtl: 3600 });
  return true;
}

// Cache auth tokens
async function cacheAuthToken(userId: string, authData: any, env: Env): Promise<void> {
  await env.AUTH_STORE.put(`token:${userId}`, JSON.stringify({
    token: authData.token,
    username: authData.user.username,
    fullname: authData.user.fullname,
    cachedAt: Date.now(),
    expires: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
  }), { expirationTtl: 7 * 24 * 60 * 60 });
}

async function getCachedToken(userId: string, env: Env): Promise<any | null> {
  const data = await env.AUTH_STORE.get(`token:${userId}`);
  if (!data) return null;
  
  const cached = JSON.parse(data);
  if (Date.now() > cached.expires) {
    await env.AUTH_STORE.delete(`token:${userId}`);
    return null;
  }
  
  return cached;
}

// RTM API helper functions
function generateApiSig(params: Record<string, string>, secret: string): string {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map(key => key + params[key]).join('');
  return MD5(secret + paramString).toString();
}

async function makeRTMRequest(method: string, params: Record<string, string>, env: Env): Promise<any> {
  const allParams = {
    ...params,
    api_key: env.RTM_API_KEY,
    method,
    format: 'json'
  };
  
  const unsignedMethods = ['rtm.test.echo', 'rtm.time.parse'];
  if (!unsignedMethods.includes(method)) {
    allParams.api_sig = generateApiSig(allParams, env.RTM_SHARED_SECRET);
  }
  
  const url = `https://api.rememberthemilk.com/services/rest/?${new URLSearchParams(allParams)}`;
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.rsp.stat === 'fail') {
    throw new Error(`RTM API Error: ${data.rsp.err.msg} (code: ${data.rsp.err.code})`);
  }
  
  return data.rsp;
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
              protocolVersion: "1.0.0",
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
            result: {
              tools: [
                {
                  name: "rtm_get_auth_url",
                  description: "Generate an authentication URL for Remember The Milk",
                  inputSchema: {
                    type: "object",
                    properties: {
                      perms: {
                        type: "string",
                        enum: ["read", "write", "delete"],
                        description: "Permission level requested"
                      },
                      frob: {
                        type: "string",
                        description: "Optional frob for desktop authentication"
                      }
                    },
                    required: ["perms"]
                  }
                },
                {
                  name: "rtm_get_frob",
                  description: "Get a frob for desktop application authentication",
                  inputSchema: {
                    type: "object",
                    properties: {}
                  }
                },
                {
                  name: "rtm_get_token",
                  description: "Exchange a frob for an authentication token",
                  inputSchema: {
                    type: "object",
                    properties: {
                      frob: {
                        type: "string",
                        description: "The frob to exchange for a token"
                      },
                      user_id: {
                        type: "string",
                        description: "Optional user ID for caching the token"
                      }
                    },
                    required: ["frob"]
                  }
                },
                {
                  name: "rtm_get_cached_token",
                  description: "Retrieve a cached authentication token",
                  inputSchema: {
                    type: "object",
                    properties: {
                      user_id: {
                        type: "string",
                        description: "User ID to retrieve token for"
                      }
                    },
                    required: ["user_id"]
                  }
                },
                {
                  name: "rtm_create_timeline",
                  description: "Create a new timeline for undoable operations",
                  inputSchema: {
                    type: "object",
                    properties: {
                      auth_token: {
                        type: "string",
                        description: "Authentication token"
                      }
                    },
                    required: ["auth_token"]
                  }
                },
                {
                  name: "rtm_get_lists",
                  description: "Retrieve all lists",
                  inputSchema: {
                    type: "object",
                    properties: {
                      auth_token: {
                        type: "string",
                        description: "Authentication token"
                      }
                    },
                    required: ["auth_token"]
                  }
                },
                {
                  name: "rtm_add_list",
                  description: "Create a new list",
                  inputSchema: {
                    type: "object",
                    properties: {
                      auth_token: {
                        type: "string",
                        description: "Authentication token"
                      },
                      timeline: {
                        type: "string",
                        description: "Timeline ID"
                      },
                      name: {
                        type: "string",
                        description: "List name"
                      },
                      filter: {
                        type: "string",
                        description: "Smart list filter (optional)"
                      }
                    },
                    required: ["auth_token", "timeline", "name"]
                  }
                },
                {
                  name: "rtm_get_tasks",
                  description: "Retrieve tasks from a list",
                  inputSchema: {
                    type: "object",
                    properties: {
                      auth_token: {
                        type: "string",
                        description: "Authentication token"
                      },
                      list_id: {
                        type: "string",
                        description: "List ID (optional)"
                      },
                      filter: {
                        type: "string",
                        description: "RTM search filter (optional)"
                      }
                    },
                    required: ["auth_token"]
                  }
                },
                {
                  name: "rtm_add_task",
                  description: "Add a new task with Smart Add support",
                  inputSchema: {
                    type: "object",
                    properties: {
                      auth_token: {
                        type: "string",
                        description: "Authentication token"
                      },
                      timeline: {
                        type: "string",
                        description: "Timeline ID"
                      },
                      name: {
                        type: "string",
                        description: "Task name (supports Smart Add syntax)"
                      },
                      list_id: {
                        type: "string",
                        description: "List ID (optional)"
                      }
                    },
                    required: ["auth_token", "timeline", "name"]
                  }
                },
                {
                  name: "rtm_complete_task",
                  description: "Mark a task as completed",
                  inputSchema: {
                    type: "object",
                    properties: {
                      auth_token: {
                        type: "string",
                        description: "Authentication token"
                      },
                      timeline: {
                        type: "string",
                        description: "Timeline ID"
                      },
                      list_id: {
                        type: "string",
                        description: "List ID"
                      },
                      taskseries_id: {
                        type: "string",
                        description: "Task series ID"
                      },
                      task_id: {
                        type: "string",
                        description: "Task ID"
                      }
                    },
                    required: ["auth_token", "timeline", "list_id", "taskseries_id", "task_id"]
                  }
                },
                {
                  name: "rtm_delete_task",
                  description: "Delete a task",
                  inputSchema: {
                    type: "object",
                    properties: {
                      auth_token: {
                        type: "string",
                        description: "Authentication token"
                      },
                      timeline: {
                        type: "string",
                        description: "Timeline ID"
                      },
                      list_id: {
                        type: "string",
                        description: "List ID"
                      },
                      taskseries_id: {
                        type: "string",
                        description: "Task series ID"
                      },
                      task_id: {
                        type: "string",
                        description: "Task ID"
                      }
                    },
                    required: ["auth_token", "timeline", "list_id", "taskseries_id", "task_id"]
                  }
                },
                {
                  name: "rtm_set_due_date",
                  description: "Set or clear task due date",
                  inputSchema: {
                    type: "object",
                    properties: {
                      auth_token: {
                        type: "string",
                        description: "Authentication token"
                      },
                      timeline: {
                        type: "string",
                        description: "Timeline ID"
                      },
                      list_id: {
                        type: "string",
                        description: "List ID"
                      },
                      taskseries_id: {
                        type: "string",
                        description: "Task series ID"
                      },
                      task_id: {
                        type: "string",
                        description: "Task ID"
                      },
                      due: {
                        type: "string",
                        description: "Due date/time (ISO format or RTM natural language)"
                      },
                      has_due_time: {
                        type: "string",
                        enum: ["0", "1"],
                        description: "Whether time is specified (0=date only, 1=date+time)"
                      }
                    },
                    required: ["auth_token", "timeline", "list_id", "taskseries_id", "task_id"]
                  }
                },
                {
                  name: "rtm_add_tags",
                  description: "Add tags to a task",
                  inputSchema: {
                    type: "object",
                    properties: {
                      auth_token: {
                        type: "string",
                        description: "Authentication token"
                      },
                      timeline: {
                        type: "string",
                        description: "Timeline ID"
                      },
                      list_id: {
                        type: "string",
                        description: "List ID"
                      },
                      taskseries_id: {
                        type: "string",
                        description: "Task series ID"
                      },
                      task_id: {
                        type: "string",
                        description: "Task ID"
                      },
                      tags: {
                        type: "string",
                        description: "Comma-separated list of tags to add"
                      }
                    },
                    required: ["auth_token", "timeline", "list_id", "taskseries_id", "task_id", "tags"]
                  }
                },
                {
                  name: "rtm_move_task",
                  description: "Move task to another list",
                  inputSchema: {
                    type: "object",
                    properties: {
                      auth_token: {
                        type: "string",
                        description: "Authentication token"
                      },
                      timeline: {
                        type: "string",
                        description: "Timeline ID"
                      },
                      from_list_id: {
                        type: "string",
                        description: "Source list ID"
                      },
                      to_list_id: {
                        type: "string",
                        description: "Destination list ID"
                      },
                      taskseries_id: {
                        type: "string",
                        description: "Task series ID"
                      },
                      task_id: {
                        type: "string",
                        description: "Task ID"
                      }
                    },
                    required: ["auth_token", "timeline", "from_list_id", "to_list_id", "taskseries_id", "task_id"]
                  }
                },
                {
                  name: "rtm_set_priority",
                  description: "Set task priority",
                  inputSchema: {
                    type: "object",
                    properties: {
                      auth_token: {
                        type: "string",
                        description: "Authentication token"
                      },
                      timeline: {
                        type: "string",
                        description: "Timeline ID"
                      },
                      list_id: {
                        type: "string",
                        description: "List ID"
                      },
                      taskseries_id: {
                        type: "string",
                        description: "Task series ID"
                      },
                      task_id: {
                        type: "string",
                        description: "Task ID"
                      },
                      priority: {
                        type: "string",
                        enum: ["1", "2", "3", "N"],
                        description: "Priority (1=High, 2=Medium, 3=Low, N=None)"
                      }
                    },
                    required: ["auth_token", "timeline", "list_id", "taskseries_id", "task_id", "priority"]
                  }
                },
                {
                  name: "rtm_undo",
                  description: "Undo a transaction",
                  inputSchema: {
                    type: "object",
                    properties: {
                      auth_token: {
                        type: "string",
                        description: "Authentication token"
                      },
                      timeline: {
                        type: "string",
                        description: "Timeline ID"
                      },
                      transaction_id: {
                        type: "string",
                        description: "Transaction ID to undo"
                      }
                    },
                    required: ["auth_token", "timeline", "transaction_id"]
                  }
                },
                {
                  name: "rtm_parse_time",
                  description: "Parse a time string using RTM's natural language processing",
                  inputSchema: {
                    type: "object",
                    properties: {
                      text: {
                        type: "string",
                        description: "Time string to parse (e.g., 'tomorrow at 3pm', 'next friday')"
                      },
                      timezone: {
                        type: "string",
                        description: "Timezone (optional, e.g., 'America/New_York')"
                      }
                    },
                    required: ["text"]
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
        }

        if (method === "tools/call") {
          const { name, arguments: args } = params;
          let resourceProtocol: string;
          let resourceValue: any;

          try {
            switch (name) {
              case "rtm_get_auth_url": {
                resourceProtocol = "rtm/auth-url";
                const authParams: Record<string, string> = {
                  api_key: env.RTM_API_KEY,
                  perms: args.perms
                };
                if (args.frob) {
                  authParams.frob = args.frob;
                }
                authParams.api_sig = generateApiSig(authParams, env.RTM_SHARED_SECRET);
                const authUrl = `https://www.rememberthemilk.com/services/auth/?${new URLSearchParams(authParams)}`;
                resourceValue = {
                  authUrl,
                  instructions: args.frob 
                    ? "Direct the user to this URL. After authorization, they should return to your app."
                    : "Direct the user to this URL. They will be redirected to your callback with a frob parameter."
                };
                break;
              }

              case "rtm_get_frob": {
                resourceProtocol = "rtm/frob";
                const response = await makeRTMRequest('rtm.auth.getFrob', {}, env);
                resourceValue = response;
                break;
              }

              case "rtm_get_token": {
                resourceProtocol = "rtm/auth-token";
                const response = await makeRTMRequest('rtm.auth.getToken', { frob: args.frob }, env);
                
                // Cache the token if user_id provided
                if (args.user_id) {
                  await cacheAuthToken(args.user_id, response.auth, env);
                }
                
                resourceValue = response.auth;
                break;
              }

              case "rtm_get_cached_token": {
                resourceProtocol = "rtm/cached-token";
                const cached = await getCachedToken(args.user_id, env);
                if (!cached) {
                  throw new Error("No cached token found for this user");
                }
                resourceValue = cached;
                break;
              }

              case "rtm_create_timeline": {
                resourceProtocol = "rtm/timeline";
                const response = await makeRTMRequest('rtm.timelines.create', { auth_token: args.auth_token }, env);
                resourceValue = response;
                break;
              }

              case "rtm_get_lists": {
                resourceProtocol = "rtm/lists";
                const response = await makeRTMRequest('rtm.lists.getList', { auth_token: args.auth_token }, env);
                resourceValue = response.lists.list;
                break;
              }

              case "rtm_add_list": {
                resourceProtocol = "rtm/list-add-result";
                const listParams: Record<string, string> = {
                  auth_token: args.auth_token,
                  timeline: args.timeline,
                  name: args.name
                };
                if (args.filter) listParams.filter = args.filter;
                const response = await makeRTMRequest('rtm.lists.add', listParams, env);
                resourceValue = response;
                break;
              }

              case "rtm_get_tasks": {
                resourceProtocol = "rtm/tasks";
                const taskParams: Record<string, string> = { auth_token: args.auth_token };
                if (args.list_id) taskParams.list_id = args.list_id;
                if (args.filter) taskParams.filter = args.filter;
                const response = await makeRTMRequest('rtm.tasks.getList', taskParams, env);
                resourceValue = response.tasks;
                break;
              }

              case "rtm_add_task": {
                resourceProtocol = "rtm/task-add-result";
                const taskParams: Record<string, string> = {
                  auth_token: args.auth_token,
                  timeline: args.timeline,
                  name: args.name,
                  parse: "1"
                };
                if (args.list_id) taskParams.list_id = args.list_id;
                const response = await makeRTMRequest('rtm.tasks.add', taskParams, env);
                resourceValue = response;
                break;
              }

              case "rtm_complete_task": {
                resourceProtocol = "rtm/task-complete-result";
                const response = await makeRTMRequest('rtm.tasks.complete', {
                  auth_token: args.auth_token,
                  timeline: args.timeline,
                  list_id: args.list_id,
                  taskseries_id: args.taskseries_id,
                  task_id: args.task_id
                }, env);
                resourceValue = response;
                break;
              }

              case "rtm_delete_task": {
                resourceProtocol = "rtm/task-delete-result";
                const response = await makeRTMRequest('rtm.tasks.delete', {
                  auth_token: args.auth_token,
                  timeline: args.timeline,
                  list_id: args.list_id,
                  taskseries_id: args.taskseries_id,
                  task_id: args.task_id
                }, env);
                resourceValue = response;
                break;
              }

              case "rtm_set_due_date": {
                resourceProtocol = "rtm/task-due-result";
                const dueParams: Record<string, string> = {
                  auth_token: args.auth_token,
                  timeline: args.timeline,
                  list_id: args.list_id,
                  taskseries_id: args.taskseries_id,
                  task_id: args.task_id
                };
                if (args.due) dueParams.due = args.due;
                if (args.has_due_time) dueParams.has_due_time = args.has_due_time;
                const response = await makeRTMRequest('rtm.tasks.setDueDate', dueParams, env);
                resourceValue = response;
                break;
              }

              case "rtm_add_tags": {
                resourceProtocol = "rtm/task-tags-result";
                const response = await makeRTMRequest('rtm.tasks.addTags', {
                  auth_token: args.auth_token,
                  timeline: args.timeline,
                  list_id: args.list_id,
                  taskseries_id: args.taskseries_id,
                  task_id: args.task_id,
                  tags: args.tags
                }, env);
                resourceValue = response;
                break;
              }

              case "rtm_move_task": {
                resourceProtocol = "rtm/task-move-result";
                const response = await makeRTMRequest('rtm.tasks.moveTo', {
                  auth_token: args.auth_token,
                  timeline: args.timeline,
                  from_list_id: args.from_list_id,
                  to_list_id: args.to_list_id,
                  taskseries_id: args.taskseries_id,
                  task_id: args.task_id
                }, env);
                resourceValue = response;
                break;
              }

              case "rtm_set_priority": {
                resourceProtocol = "rtm/task-priority-result";
                const response = await makeRTMRequest('rtm.tasks.setPriority', {
                  auth_token: args.auth_token,
                  timeline: args.timeline,
                  list_id: args.list_id,
                  taskseries_id: args.taskseries_id,
                  task_id: args.task_id,
                  priority: args.priority
                }, env);
                resourceValue = response;
                break;
              }

              case "rtm_undo": {
                resourceProtocol = "rtm/undo-result";
                await makeRTMRequest('rtm.transactions.undo', {
                  auth_token: args.auth_token,
                  timeline: args.timeline,
                  transaction_id: args.transaction_id
                }, env);
                resourceValue = { success: true };
                break;
              }

              case "rtm_parse_time": {
                resourceProtocol = "rtm/parsed-time";
                const timeParams: Record<string, string> = { text: args.text };
                if (args.timezone) timeParams.timezone = args.timezone;
                const response = await makeRTMRequest('rtm.time.parse', timeParams, env);
                resourceValue = response.time;
                break;
              }

              default:
                throw new Error(`Unknown tool: ${name}`);
            }

            return new Response(JSON.stringify({
              jsonrpc: "2.0",
              id,
              result: {
                content: [
                  {
                    type: "resource",
                    resource: {
                      protocol: resourceProtocol,
                      id: "rtm-result-" + Date.now(),
                      version: "1.0",
                      value: resourceValue
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