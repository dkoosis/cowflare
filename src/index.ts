import MD5 from "crypto-js/md5";

interface Env {
  RTM_API_KEY: string;
  RTM_SHARED_SECRET: string;
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

    // Handle JSON-RPC requests
    if (request.method === "POST") {
      try {
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
                version: "1.0.1"
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
                      }
                    },
                    required: ["frob"]
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
                resourceValue = response.auth;
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

    return new Response("RTM MCP Server", { 
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};