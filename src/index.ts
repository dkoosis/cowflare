/**
 * @file index.ts
 * @description RTM MCP Server using the official MCP TypeScript SDK
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema,
  Tool,
  TextContent,
  ImageContent,
  EmbeddedResource
} from '@modelcontextprotocol/sdk/types.js';

import { makeRTMRequest } from './rtm-api.js';
import { checkRateLimit, storePendingAuth, getPendingAuth, cacheAuthToken, getCachedToken } from './auth.js';
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

// Environment interface
interface Env {
  RTM_API_KEY: string;
  RTM_SHARED_SECRET: string;
  AUTH_STORE: KVNamespace;
  SERVER_URL: string;
}

// Create the MCP server
const server = new Server(
  {
    name: 'rtm-mcp-server',
    version: '2.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {}
    },
  }
);

// Helper functions for formatting
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

function generateSessionId(): string {
  return crypto.randomUUID();
}

// Validate tool arguments
function validateToolArgs(toolName: string, args: any): any {
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
    if (error.errors) {
      const firstError = error.errors[0];
      const errorMessage = `${firstError.path.join('.')}: ${firstError.message}`;
      throw new ValidationError(errorMessage, firstError.path.join('.'));
    }
    throw error;
  }
}

// Register tools
const connectionTestTool: Tool = {
  name: "test_connection",
  description: "Test MCP server connection and diagnostics",
  inputSchema: {
    type: "object",
    properties: {},
    required: []
  }
};

// Register all tools with the server
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [...toolDefinitions, connectionTestTool]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  // Get environment from somewhere (this part needs adaptation for your setup)
  const env = getEnvironment(); // You'll need to implement this based on your setup
  
  const requestId = crypto.randomUUID().slice(0, 8);
  
  // Log request
  const sanitizedArgs = { ...args };
  if (sanitizedArgs.auth_token) sanitizedArgs.auth_token = "[REDACTED]";
  console.log(`[${requestId}] [${new Date().toISOString()}] Tool: ${name}`, sanitizedArgs);
  
  try {
    // Handle connection test
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
          name: "rtm-mcp-server",
          version: "2.0.0"
        }
      };
      
      return {
        content: [{
          type: "text",
          text: `✅ MCP Server Connection Test\n\nStatus: ${testResult.status}\nTimestamp: ${testResult.timestamp}\nKV Store: ${testResult.kv_connected ? "Connected" : "Not Connected"}\nConfiguration: ${Object.values(testResult.env_vars).every(v => v) ? "Complete" : "Incomplete"}\nServer: ${testResult.worker.name} v${testResult.worker.version}`
        }]
      };
    }
    
    // Validate arguments
    const validatedArgs = validateToolArgs(name, args);
    
    // Handle each tool
    switch (name) {
      case "rtm_authenticate": {
        const sessionId = generateSessionId();
        const cached = await getCachedToken(sessionId, env);
        
        if (cached) {
          return {
            content: [{
              type: "text",
              text: `✅ Welcome back ${cached.fullname}!\n\nYour authentication is still valid.\nUsername: ${cached.username}\n\nYou're ready to use RTM!`
            }]
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
              text: `✅ Success! Welcome ${response.auth.user.fullname}!\n\nAuth Token: ${response.auth.token}`
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
      
      case "rtm_get_lists": {
        const response = await makeRTMRequest('rtm.lists.getList', { auth_token: validatedArgs.auth_token }, env.RTM_API_KEY, env.RTM_SHARED_SECRET);
        return {
          content: [{
            type: "text",
            text: formatLists(response.lists.list)
          }]
        };
      }
      
      case "rtm_get_tasks": {
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
      
      // Add other tool implementations...
      
      default:
        throw new ValidationError(`Unknown tool: ${name}`);
    }
    
  } catch (error: any) {
    console.error(`[${requestId}] Tool error:`, error.message);
    
    // Return user-friendly error messages
    let errorMessage = "An unexpected error occurred.";
    if (error instanceof RTMAPIError) {
      errorMessage = `Remember The Milk Error: ${error.message}`;
    } else if (error instanceof ValidationError) {
      errorMessage = `Invalid Request: ${error.message}`;
    } else if (error instanceof RateLimitError) {
      errorMessage = "Rate limit exceeded. Please wait a moment.";
    }
    
    return {
      content: [{
        type: "text",
        text: `❌ ${errorMessage}`,
        isError: true
      }]
    };
  }
});

// For Cloudflare Workers, you'll need to adapt this part
// The SDK is designed for stdio transport, but you need HTTP transport
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // You'll need to implement an HTTP transport adapter here
    // This is where you'd handle the HTTP-to-MCP protocol translation
    
    // For now, this is a placeholder showing the structure
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        }
      });
    }
    
    // Handle health check
    if (new URL(request.url).pathname === '/health') {
      return Response.json({
        status: 'healthy',
        version: '2.0.0',
        timestamp: new Date().toISOString()
      });
    }
    
    // You would need to implement the HTTP transport adapter here
    // to bridge HTTP requests to the MCP server instance
    
    return new Response("RTM MCP Server v2.0.0 (SDK Version)", {
      headers: { "Content-Type": "text/plain" }
    });
  }
};