import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { CowflareMCP } from "./mcp";
import { MockAuthHandler } from "./auth/mock-handler";

export interface Env {
  // OAuth provider will use these for token storage
  AUTH_STORE: KVNamespace;
  
  // Mock auth credentials (will be replaced by RTM)
  MOCK_CLIENT_ID?: string;
  MOCK_CLIENT_SECRET?: string;
  
  // Future RTM integration
  RTM_CLIENT_ID?: string;
  RTM_CLIENT_SECRET?: string;
  RTM_ENDPOINT?: string;
}

// Main OAuth provider configuration
export default new OAuthProvider({
  // SSE endpoint for backward compatibility
  apiRoute: "/sse",
  
  // Our MCP server router
  apiHandler: CowflareMCP.Router,
  
  // Mock authentication handler (to be replaced with RTM)
  defaultHandler: MockAuthHandler,
  
  // OAuth endpoints
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  
  // Additional configuration
  config: {
    // Allow CORS for local development
    cors: {
      origin: "*",
      methods: ["GET", "POST", "OPTIONS"],
      headers: ["Content-Type", "Authorization"],
    },
  },
});