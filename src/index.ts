import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { RtmHandler } from "./rtm-handler";
import { RtmMCP } from "./rtm-mcp";
import type { Env } from "./types";

/**
 * Main application entry point.
 *
 * This worker uses the `@cloudflare/workers-oauth-provider` to manage
 * the entire authentication and API flow.
 *
 * - `defaultHandler`: Manages the upstream authentication with RTM.
 * - `apiHandler`: The actual MCP agent that provides tools.
 *
 * The `OAuthProvider` handles the token exchange, session management,
 * and routing between the auth flow and the API.
 */
export default new OAuthProvider<Env>({
  // The handler for the RTM-specific authentication flow
  defaultHandler: RtmHandler,

  // The route where the MCP service is available
  apiRoute: "/sse",
  // The MCP Agent that will handle requests to the apiRoute
  apiHandler: RtmMCP.mount("/sse") as any,

  // OAuth 2.1 endpoints that the provider will expose to clients like Claude.ai
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});

// We also need to export the Durable Object class itself
export { RtmMCP };