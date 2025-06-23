interface Env {
  // KV Namespaces
  AUTH_STORE: KVNamespace;
  OAUTH_DATABASE: KVNamespace;
  OAUTH_SESSIONS: KVNamespace;

  // Durable Objects
  MCP_OBJECT: DurableObjectNamespace;
  
  // Environment Variables
  RTM_API_KEY: string;
  RTM_SHARED_SECRET: string;
  SERVER_URL: string;
  
  // OAuth Configuration
  COOKIE_ENCRYPTION_KEY: string;
}