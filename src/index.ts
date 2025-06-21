/**
 * @file index.ts
 * @description RTM MCP Server - Clean SDK implementation
 * Modern architecture using @modelcontextprotocol/sdk
 */

import { McpServer } from '@modelcontextprotocol/sdk/server';
import { StdioTransport } from '@modelcontextprotocol/sdk/transport/stdio';
import { HttpTransport } from '@modelcontextprotocol/sdk/transport/http';
import { Env } from './types';
import { registerTools } from './tools';
import { registerResources } from './resources';
import { registerPrompts } from './prompts';
import { RateLimiter } from './middleware/rate-limiter';
import { Logger } from './utils/logger';
import { MetricsCollector } from './monitoring/metrics';
import { handleAuthCallback } from './auth/oauth-handler';

/**
 * Creates and configures an MCP server instance
 */
function createMcpServer(env: Env): McpServer {
  const server = new McpServer({
    name: "rtm-mcp-server",
    version: "1.0.0",
    capabilities: {
      tools: true,
      resources: true,
      prompts: true
    }
  });

  // Initialize services
  const metrics = new MetricsCollector(env);
  const logger = new Logger(env);

  // Register all MCP components
  registerTools(server, env, metrics, logger);
  registerResources(server, env, metrics, logger);
  registerPrompts(server, env, metrics, logger);

  // Set up error handling
  server.onerror = (error) => {
    logger.error('MCP Server Error', { 
      error: error.message, 
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  };

  return server;
}

/**
 * Main Cloudflare Worker export
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const logger = new Logger(env);
    const rateLimiter = new RateLimiter(env.AUTH_STORE);
    const url = new URL(request.url);

    // Handle OAuth callback separately
    if (url.pathname === '/auth/callback') {
      return handleAuthCallback(request, env);
    }

    // Apply rate limiting
    const clientId = getClientId(request);
    const rateLimitResult = await rateLimiter.check(clientId);
    
    if (!rateLimitResult.allowed) {
      return new Response('Too Many Requests', {
        status: 429,
        headers: {
          'Retry-After': String(rateLimitResult.retryAfter),
          'X-RateLimit-Limit': String(rateLimitResult.limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(rateLimitResult.resetAt)
        }
      });
    }

    // Create MCP server and handle request
    const server = createMcpServer(env);
    
    // Use HTTP transport for the server
    const transport = new HttpTransport();
    await server.connect(transport);
    
    try {
      // Process the request through MCP server
      const response = await transport.handleRequest(request);
      
      // Add rate limit headers
      response.headers.set('X-RateLimit-Limit', String(rateLimitResult.limit));
      response.headers.set('X-RateLimit-Remaining', String(rateLimitResult.remaining));
      response.headers.set('X-RateLimit-Reset', String(rateLimitResult.resetAt));
      
      return response;
    } catch (error: any) {
      logger.error('Request processing error', {
        error: error.message,
        url: request.url,
        method: request.method
      });
      
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error"
        }
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
  }
};

/**
 * Extracts client identifier from request
 */
function getClientId(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ||
         request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
         crypto.randomUUID();
}