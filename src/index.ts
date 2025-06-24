import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { createRtmHandler, type ProviderHolder } from "./rtm-handler";
import { RtmMCP } from "./rtm-mcp";
import type { Env } from "./types";

// A holder object is used to break the circular dependency between the
// RTM handler (which needs provider helpers) and the provider itself.
const holder: ProviderHolder = {};

// Create the Hono app for the custom RTM routes (/authorize, /callback).
const rtmAuthApp = createRtmHandler(holder);

// Create the OAuthProvider, which will act as the main router.
const provider = new OAuthProvider<Env>({
  // The provider will route requests to /sse to the RtmMCP Durable Object.
  apiRoute: "/sse",
  apiHandler: {
    fetch: RtmMCP.mount("/sse") as any
  },

  // All requests not handled by the provider's specific endpoints below
  // will be passed to this default handler.
  defaultHandler: {
    fetch: rtmAuthApp.fetch.bind(rtmAuthApp),
  },
  
  // OAuth endpoints configuration
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register"
});

// Now that the provider is created, assign it to the holder to complete the link.
holder.provider = provider;

// The provider itself is the default export. It will correctly route incoming
// requests to either its internal handlers or the default rtmAuthApp handler.
export default provider;

export { RtmMCP };