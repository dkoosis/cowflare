import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { createRtmHandler } from "./rtm-handler"; // Import the factory function
import { RtmMCP } from "./rtm-mcp";
import type { Env } from "./types";

/**
 * Main application entry point.
 */
export default new OAuthProvider<Env>({
  // Create the RTM handler by passing the provider's helpers to it
  defaultHandler: (c) => createRtmHandler(c.env.OAUTH_PROVIDER),

  apiRoute: "/sse",
  apiHandler: RtmMCP.mount("/sse") as any,

  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});

export { RtmMCP };