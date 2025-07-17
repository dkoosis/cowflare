import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./index";

interface State {
  // Session state - persisted per MCP connection
  counter: number;
  lastToolCall?: {
    tool: string;
    timestamp: number;
    result: any;
  };
}

interface Props {
  // Authentication context from OAuth
  claims?: {
    sub: string;  // User ID
    name?: string;
    email?: string;
    // Future RTM claims
    permissions?: string[];
  };
}

export class CowflareMCP extends McpAgent<Env, State, Props> {
  server = new McpServer({
    name: "Cowflare MCP",
    version: "0.1.0",
    description: "MCP server with mock OAuth, ready for RTM integration",
  });

  initialState: State = {
    counter: 0,
  };

  async init() {
    // Basic test tool - no auth required
    this.server.tool(
      "add",
      "Add two numbers together",
      { 
        a: z.number().describe("First number"),
        b: z.number().describe("Second number") 
      },
      async ({ a, b }) => {
        const result = a + b;
        this.setState({
          ...this.state,
          lastToolCall: {
            tool: "add",
            timestamp: Date.now(),
            result,
          },
        });
        
        return {
          content: [{ 
            type: "text", 
            text: `${a} + ${b} = ${result}` 
          }],
        };
      }
    );

    // Tool that uses authentication context
    this.server.tool(
      "whoami",
      "Get information about the authenticated user",
      {},
      async () => {
        const claims = this.props.claims;
        
        if (!claims) {
          return {
            content: [{ 
              type: "text", 
              text: "No authentication context available" 
            }],
          };
        }
        
        return {
          content: [{ 
            type: "text", 
            text: `Authenticated as: ${claims.name || claims.sub}\nEmail: ${claims.email || "Not provided"}\nPermissions: ${claims.permissions?.join(", ") || "None"}` 
          }],
        };
      }
    );

    // Stateful tool demonstrating session persistence
    this.server.tool(
      "increment",
      "Increment the session counter",
      {
        by: z.number().default(1).describe("Amount to increment by"),
      },
      async ({ by }) => {
        this.setState({
          ...this.state,
          counter: this.state.counter + by,
          lastToolCall: {
            tool: "increment",
            timestamp: Date.now(),
            result: this.state.counter + by,
          },
        });
        
        return {
          content: [{ 
            type: "text", 
            text: `Counter incremented by ${by}. New value: ${this.state.counter}` 
          }],
        };
      }
    );

    // Resource to expose current state
    this.server.resource(
      "session-state",
      "mcp://cowflare/session-state",
      () => ({
        contents: [{
          uri: "mcp://cowflare/session-state",
          mimeType: "application/json",
          text: JSON.stringify(this.state, null, 2),
        }],
      })
    );
  }

  // Handle state updates
  onStateUpdate(state: State) {
    console.log("[CowflareMCP] State updated:", state);
  }

  // Static router setup for OAuth provider
  static Router = {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
      const url = new URL(request.url);
      
      // Support both SSE and Streamable HTTP transports
      if (url.pathname.startsWith("/sse")) {
        return CowflareMCP.serveSSE("/sse").fetch(request, env, ctx);
      }
      
      if (url.pathname.startsWith("/mcp")) {
        return CowflareMCP.serve("/mcp").fetch(request, env, ctx);
      }
      
      return new Response("Not found", { status: 404 });
    },
  };
}