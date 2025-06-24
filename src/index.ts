import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { createRtmHandler, type ProviderHolder } from "./rtm-handler";
import { RtmMCP } from "./rtm-mcp";
import type { Env } from "./types";

// A holder object is used to break the circular dependency between the
// RTM handler (which needs provider helpers) and the provider itself.
const holder: ProviderHolder = {};

// Create the Hono app for the custom RTM auth routes.
const rtmAuthApp = createRtmHandler(holder);

// Create a Hono app specifically for the MCP/SSE endpoint.
const sseApp = new Hono<{ Bindings: Env }>();
// Mount the DO handler to catch all requests to this app. The "/*" is important
// to ensure sub-paths like /sse/foo are also routed to the DO.
sseApp.all("/*", RtmMCP.mount("/sse")); 

// Create the OAuthProvider.
const provider = new OAuthProvider<Env>({
  provider: "rtm", // The name of your custom provider
  
  // Route requests for /sse/... to our sseApp.
  apiRoute: "/sse",
  apiHandler: sseApp, // Hono instances are valid ExportedHandlers.

  // All other requests will be passed to the auth app.
  defaultHandler: rtmAuthApp,
  
  // OAuth endpoints configuration
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register"
});

// Now that the provider is created, assign it to the holder to complete the link.
holder.provider = provider;

// The provider itself is the default export. It will correctly route incoming
// requests to either its internal handlers or one of the configured handlers.
export default provider;

export { RtmMCP };
