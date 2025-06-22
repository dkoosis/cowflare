ADR 004: Core Server Architecture
Status: Recommended

Context:
We need a standardized, scalable, and maintainable architecture for deploying Model Context Protocol (MCP) servers. The architecture must handle stateful connections efficiently, be cost-effective, and leverage modern serverless patterns. The cowflare repository provides multiple examples, and we need to select a primary architectural pattern to follow.

Decision:
We will adopt the following core architecture for our MCP servers:

Runtime Environment: Cloudflare Workers. This provides a globally distributed, serverless environment that is highly scalable and cost-effective.
State Management: Cloudflare Durable Objects. Each MCP connection will be managed by a corresponding Durable Object instance. This provides the necessary stateful, single-threaded execution context required to manage the lifecycle of a model context session reliably.
Web Framework: Hono. This lightweight, fast framework is optimized for Cloudflare Workers and simplifies routing and request handling.
The demos/remote-mcp-server project within the cowflare repository will serve as the foundational template for all new MCP server implementations.

Consequences:

Pros:
Scalability: The architecture scales automatically with demand, managed by the Cloudflare network.
Stateful Foundation: Durable Objects provide a robust solution for the stateful nature of MCP, avoiding common distributed state challenges.
Performance: Running on Cloudflare's edge network minimizes latency.
Developer Experience: The combination of Hono and TypeScript provides a modern and efficient development workflow.
Cons:
Platform Lock-in: This approach creates a dependency on the Cloudflare ecosystem.
Learning Curve: Developers unfamiliar with Cloudflare Workers and Durable Objects will require some ramp-up time.