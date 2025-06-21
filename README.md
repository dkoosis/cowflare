RTM MCP Server v2.0 - SDK Implementation
This is a refactored version of the Remember The Milk MCP Server using the official Model Context Protocol TypeScript SDK.

Key Improvements
1. MCP TypeScript SDK Integration
Replaced manual JSON-RPC handling with McpServer from @modelcontextprotocol/sdk
Proper protocol compliance and standardized error handling
Built-in support for tools, resources, and prompts
2. Enhanced Type Safety
Replaced all any types with proper TypeScript interfaces
Comprehensive type definitions for RTM API responses
Zod schemas for runtime validation
3. Improved Error Handling
Custom error classes: RTMAPIError, ValidationError, RateLimitError
Consistent error responses following MCP protocol standards
Better error messages and debugging information
4. Enhanced Rate Limiting
typescript
// Improved client identification with fallback chain
const clientId = request.headers.get('CF-Connecting-IP') || 
                request.headers.get('X-Forwarded-For')?.split(',')[0] || 
                'anonymous';
5. OAuth Callback Flow
Full OAuth implementation with callback endpoint
Automatic token exchange after user authorization
User-friendly success page with session ID
6. New Resources
rtm/user-profile: User settings including timezone and date format
rtm/lists-summary: Overview of all user lists
rtm/tags-summary: All available tags
7. New Prompts
daily_briefing: Summary of today's and overdue tasks
plan_my_day: Interactive scheduling for unscheduled tasks
find_and_update_task: Search and update tasks interactively
8. Request Logging
All requests are logged with timestamp and unique request ID:

[requestId] [2025-06-21T10:30:45.123Z] tools/call {"name": "rtm_get_tasks", ...}
Installation
bash
# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Deploy to Cloudflare Workers
npm run deploy
Configuration
Set up environment variables in Cloudflare dashboard:
RTM_API_KEY: Your Remember The Milk API key
RTM_SHARED_SECRET: Your RTM shared secret
SERVER_URL: Your worker URL (e.g., https://rtm-mcp.your-domain.workers.dev)
Create KV namespace:
bash
wrangler kv:namespace create AUTH_STORE
Update wrangler.toml with your KV namespace ID
Usage with MCP Clients
The server exposes the MCP protocol via HTTP. Configure your MCP client to connect to your worker URL.

Example client configuration:

json
{
  "servers": {
    "rtm": {
      "url": "https://rtm-mcp.your-domain.workers.dev",
      "transport": "streamable-http"
    }
  }
}
Testing
The test suite has been updated to work with the SDK implementation:

bash
# Run all tests
npm test

# Watch mode
npm run test:watch
Architecture
src/
├── index.ts           # Main server implementation with SDK
├── rtm-api.ts        # RTM API types and request handler
├── validation-schemas.ts  # Zod validation schemas
└── auth.ts           # Authentication and rate limiting

test/
└── index.spec.ts     # Test suite
Migration from v1
If migrating from the previous version:

Update client configuration to use the new server URL
Re-authenticate users (auth tokens remain compatible)
Update any custom integrations to use the new tool names/schemas
Future Enhancements
WebSocket transport support for real-time updates
Batch operations for bulk task management
Advanced filtering and search capabilities
Integration with RTM's Smart Lists
Caching layer for improved performance
Contributing
Contributions are welcome! Please ensure:

All tests pass
Type safety is maintained
Error handling follows established patterns
New features include appropriate tests
