import { WorkerEntrypoint } from "cloudflare:workers";
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
  
  // Methods that don't require signing
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

// MCP Server implementation for Cloudflare Workers
export default class MCPServer extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const url = new URL(request.url);
    
    // SSE endpoint for MCP
    if (url.pathname === "/sse") {
      return this.handleSSE();
    }
    
    // MCP RPC endpoint
    if (url.pathname === "/mcp" && request.method === "POST") {
      return this.handleMCPRequest(request);
    }
    
    return new Response("MCP Server Running", { status: 200 });
  }

  async handleSSE(): Promise<Response> {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Send initial connection message
        const message = JSON.stringify({
          jsonrpc: "2.0",
          method: "initialized",
          params: {
            protocolVersion: "0.1.0",
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: "rtm-mcp-server",
              version: "1.0.0",
            },
          },
        });
        controller.enqueue(encoder.encode(`data: ${message}\n\n`));
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  async handleMCPRequest(request: Request): Promise<Response> {
    const body = await request.json();
    
    if (body.method === "tools/list") {
      return this.listTools();
    }
    
    if (body.method === "tools/call") {
      return this.callTool(body);
    }
    
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      error: {
        code: -32601,
        message: "Method not found",
      },
    }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  listTools(): Response {
    const tools = [
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
              description: "List ID (optional, returns all tasks if not specified)"
            },
            filter: {
              type: "string",
              description: "RTM search filter (optional)"
            },
            last_sync: {
              type: "string",
              description: "ISO 8601 datetime for incremental sync (optional)"
            }
          },
          required: ["auth_token"]
        }
      },
      {
        name: "rtm_add_task",
        description: "Add a new task",
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
              description: "Task name (can include Smart Add syntax)"
            },
            list_id: {
              type: "string",
              description: "List ID (optional)"
            },
            parse: {
              type: "string",
              description: "Whether to parse Smart Add syntax (1 or 0, default 1)"
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
      }
    ];

    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      result: { tools },
    }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  async callTool(body: any): Promise<Response> {
    const { name, arguments: args } = body.params;
    
    try {
      let result;
      
      switch (name) {
        case "rtm_get_auth_url":
          result = await this.getAuthUrl(args);
          break;
        case "rtm_get_frob":
          result = await this.getFrob();
          break;
        case "rtm_get_token":
          result = await this.getToken(args);
          break;
        case "rtm_create_timeline":
          result = await this.createTimeline(args);
          break;
        case "rtm_get_lists":
          result = await this.getLists(args);
          break;
        case "rtm_get_tasks":
          result = await this.getTasks(args);
          break;
        case "rtm_add_task":
          result = await this.addTask(args);
          break;
        case "rtm_complete_task":
          result = await this.completeTask(args);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
      
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error: any) {
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        error: {
          code: -32000,
          message: error.message,
        },
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  async getAuthUrl(args: any): Promise<any> {
    const params: Record<string, string> = {
      api_key: this.env.RTM_API_KEY,
      perms: args.perms
    };
    
    if (args.frob) {
      params.frob = args.frob;
    }
    
    params.api_sig = generateApiSig(params, this.env.RTM_SHARED_SECRET);
    
    const authUrl = `https://www.rememberthemilk.com/services/auth/?${new URLSearchParams(params)}`;
    
    return {
      authUrl,
      instructions: args.frob 
        ? "Direct the user to this URL. After authorization, they should return to your app."
        : "Direct the user to this URL. They will be redirected to your callback with a frob parameter."
    };
  }

  async getFrob(): Promise<any> {
    const result = await makeRTMRequest('rtm.auth.getFrob', {}, this.env);
    return { frob: result.frob };
  }

  async getToken(args: any): Promise<any> {
    const result = await makeRTMRequest('rtm.auth.getToken', { frob: args.frob }, this.env);
    return {
      token: result.auth.token,
      perms: result.auth.perms,
      user: result.auth.user
    };
  }

  async createTimeline(args: any): Promise<any> {
    const result = await makeRTMRequest('rtm.timelines.create', { auth_token: args.auth_token }, this.env);
    return { timeline: result.timeline };
  }

  async getLists(args: any): Promise<any> {
    const result = await makeRTMRequest('rtm.lists.getList', { auth_token: args.auth_token }, this.env);
    return { lists: result.lists.list };
  }

  async getTasks(args: any): Promise<any> {
    const params: Record<string, string> = { auth_token: args.auth_token };
    
    if (args.list_id) params.list_id = args.list_id;
    if (args.filter) params.filter = args.filter;
    if (args.last_sync) params.last_sync = args.last_sync;
    
    const result = await makeRTMRequest('rtm.tasks.getList', params, this.env);
    return { tasks: result.tasks };
  }

  async addTask(args: any): Promise<any> {
    const params: Record<string, string> = {
      auth_token: args.auth_token,
      timeline: args.timeline,
      name: args.name,
      parse: args.parse || "1"
    };
    
    if (args.list_id) params.list_id = args.list_id;
    
    const result = await makeRTMRequest('rtm.tasks.add', params, this.env);
    return {
      transaction: result.transaction,
      list: result.list
    };
  }

  async completeTask(args: any): Promise<any> {
    const result = await makeRTMRequest('rtm.tasks.complete', {
      auth_token: args.auth_token,
      timeline: args.timeline,
      list_id: args.list_id,
      taskseries_id: args.taskseries_id,
      task_id: args.task_id
    }, this.env);
    return {
      transaction: result.transaction,
      list: result.list
    };
  }
}