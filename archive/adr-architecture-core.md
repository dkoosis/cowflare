## ADR-Architecture-Core.md

```markdown
# ADR-Architecture-Core: MCP Server Architecture Patterns

**Status:** Accepted  
**Date:** 2025-01-07

## Context

Need consistent patterns across RTM and future services (Spektrix, Ungerboeck) that balance immediate delivery with 3-5 year maintainability.

## Decision

Use **agents/McpAgent** pattern with **service-specific implementations**.

### Architecture Layers

```typescript
// 1. Service Entry Point (index.ts)
export default app // Hono router
export { ServiceMCP } // Durable Object

// 2. OAuth Adapter (service-handler.ts)  
function createServiceHandler() {
  // OAuth2 endpoint mappings
  // Service-specific auth flow
}

// 3. MCP Durable Object (service-mcp.ts)
class ServiceMCP extends McpAgent<Env, State, Props> {
  // MCP tool implementations
  // Service API client usage
}

// 4. API Client (service-api.ts)
class ServiceApi {
  // Service-specific API calls
  // Request signing/auth
}
Shared Patterns

All services follow 4-layer structure
Consistent error handling via Result<T>
Standardized logging and telemetry
Common validation approach

Rationale

Consistency: Same patterns across all services
Isolation: Service-specific logic contained
Reusability: Shared utilities without premature abstraction
Maintainability: Clear boundaries and responsibilities

Implementation Notes

Start concrete (RTM), extract patterns when adding Spektrix
Each service gets own directory under src/
Shared utilities in src/shared/ only when truly generic