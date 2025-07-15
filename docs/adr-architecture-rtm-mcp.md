Of course. Here is the architecture decision record based on our discussion, following the model you provided.

-----

# ADR-Architecture-RTM: RTM MCP Server Final Architecture

**Status:** Accepted
**Date:** 2025-07-15

## Context

The initial RTM MCP server implementation has experienced instability and circular debugging sessions. These issues stem from unclear boundaries between our application code and the Cloudflare `agents` library, particularly concerning object initialization and the handling of RTM's custom authentication flow. A stable, maintainable architecture with explicit responsibilities is required to move forward.

## Decision

We will adopt a **Router-Controller pattern** using Hono for routing and a simplified Durable Object for tool logic. The `McpAgent.mount()` function will be deprecated in favor of an explicit router in `index.ts` to gain full control over the request lifecycle and authentication flow.

### Architecture Layers

```typescript
// 1. Worker Entry Point & Router (index.ts)
// - Handles all inbound HTTP requests and routing.
// - Manages the complete RTM authentication flow.
// - Guards the /mcp endpoint with auth middleware.

import { Hono } from 'hono';
import { RtmMCP } from './rtm-mcp';

const app = new Hono();

// Routes for the custom RTM authentication flow
app.get('/authorize', (c) => { /* ... begin auth flow ... */ });
app.get('/callback', (c) => { /* ... handle RTM callback, get token ... */ });

// Middleware to protect the /mcp endpoint
app.use('/mcp', async (c, next) => {
  const body = await c.req.json();
  // The 'initialize' method is the only one allowed without a token.
  if (body.method === 'initialize') {
    return next();
  }
  // For all other methods, validate the token.
  // If invalid, return 401.
  await next();
});

// Route for all MCP traffic
app.post('/mcp', (c) => {
  // Get DO stub and forward the request
});

export default app;
export { RtmMCP };
```

```typescript
// 2. MCP Durable Object (rtm-mcp.ts)
// - Responsible ONLY for implementing MCP tool logic.
// - Assumes all incoming requests are authenticated.
// - Is completely unaware of auth flows, tokens, or routing.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export class RtmMCP extends DurableObject {
  private server: McpServer;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.server = new McpServer({ /* ... */ });
    this.init(); // Initialize tools once on creation.
  }

  init() {
    // Register all RTM tools with this.server
    this.server.tool('rtm_getTasks', ...);
  }

  async fetch(request: Request): Promise<Response> {
    // Simply pass the pre-validated request to the MCP server.
    return this.server.fetch(request, { 
      // Context can be passed from index.ts if needed
    });
  }
}
```

```typescript
// 3. RTM API Client (rtm-api.ts)
// - Handles all direct API communication with Remember The Milk.
// - Manages API key signing and other transport-level details.
class RtmApi {
  // Implements getTasks(), addTask(), etc.
}
```

## Rationale

  * **Stability**: This design **solves the double-initialization crash** by removing the implicit `McpAgent.mount()` function. We now have explicit control over the Durable Object lifecycle, guaranteeing `init()` runs only once.
  * **Clarity**: It creates a **strict separation of concerns**. `index.ts` handles the "how" (routing, auth), while `rtm-mcp.ts` handles the "what" (tool logic). This resolves the confusion over responsibilities.
  * **Maintainability**: The custom RTM authentication logic is **centralized in `index.ts`**. It can be debugged and modified without impacting the tool implementations, which directly addresses the challenges documented in `DEBUG-STATE.yaml`.

## Implementation Notes

  * Refactor `index.ts` to implement the Hono router and authentication middleware as defined above.
  * Simplify the `RtmMCP` class in `rtm-mcp.ts` by removing all logic from its `fetch()` method except for the call to the MCP SDK's `server.fetch()`.
  * Ensure the `RtmMCP` constructor calls `this.init()` exactly once.

## Explaining the Router-Controller Pattern
Think of this pattern as having two distinct roles with a clear division of labor:

The Router (The "Traffic Cop" 👮): This is your index.ts file, powered by Hono. Its only job is to be the first point of contact for all incoming requests. It looks at the request's URL, method, and headers and decides where it needs to go. Crucially, it also acts as the gatekeeper. It runs the authentication middleware to check credentials and reject unauthorized requests before they can go any further. It doesn't know how to perform any business tasks itself; it just directs traffic.

The Controller (The "Specialist" 🧑‍🔧): This is your RtmMCP Durable Object. It's a specialist that only knows how to perform a specific set of tasks (your MCP tool logic). It receives simple, pre-vetted commands from the Router. It doesn't know or care about the complexities of HTTP, auth tokens, or URL routing. It just does its job and returns a result.

## How This Pattern Solves Your Core Challenges
This clear separation of roles directly solves the root causes of the instability you've experienced.

Challenge: Initialization Crashes & Library Conflicts
The crash happened because two parts of the system were fighting for control: your constructor was calling init() and the McpAgent.mount() function was also calling it. The Router-Controller pattern eliminates this conflict. By removing McpAgent.mount(), your index.ts router becomes the single, explicit authority. It alone decides when to create an instance of your RtmMCP controller, guaranteeing its constructor—and therefore your init() method—runs exactly one time. The power struggle is over.

Challenge: Confusing Authentication Logic
Your debug history shows a constant struggle with the authentication flow, especially the need to make a special exception for the initialize method. The previous implementation spread this logic between different files and used flags like sessionInitialized, making it hard to follow. The Router pattern provides the perfect home for this. The middleware in index.ts becomes a "smart bouncer" at the door of the /mcp endpoint. It knows to check for a token for most requests but also knows to let the special initialize guest in for free. All of this complex logic is now centralized in one place, making it easy to understand, debug, and maintain.

## How This Pattern Achieves Your Long-Term Goals
Most importantly, this architecture aligns perfectly with the goals you defined in your adr-architecture-core.md.

Consistency & Reusability: You wanted consistent patterns across all services. This Router-Controller design is a highly reusable blueprint. For your next service (e.g., Spektrix), you can copy this exact structure: a router in index.ts handling auth and a controller in spektrix-mcp.ts handling the tool logic.

Isolation & Maintainability: You required "Clear boundaries and responsibilities" to ensure maintainability. This is the primary benefit of the pattern. Your RtmMCP controller is now completely isolated from the auth system. You can modify RTM API calls without touching auth code, and you can update your auth flow without touching your RTM business logic. This separation is critical for long-term health and makes the system vastly easier to manage.