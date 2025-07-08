# ADR-Architecture-Transport-Hybrid: MCP Transport Protocol Strategy

**Status:** Accepted  
**Date:** 2025-01-07
**Review:** 2025-07-07

## Context

The MCP ecosystem is in transition between transport protocols:
- SSE was deprecated in MCP spec version 2025-03-26
- Streamable HTTP is the official future direction
- Claude.ai (our primary target) still uses SSE internally despite supporting both
- Most of the ecosystem hasn't migrated yet

For a 3-5 year project, we need to navigate this transition wisely.

## Decision

**Use Streamable HTTP exclusively** for Claude.ai integration.

### Why This Changed
- Testing confirmed Claude.ai fully supports Streamable HTTP (January 2025)
- SSE requires two endpoints; Streamable HTTP uses one
- Streamable HTTP is the future direction of MCP
- No benefit to maintaining legacy SSE for our single client

### Implementation
- Single endpoint: `/mcp`
- No SSE endpoints needed
- Simpler codebase, fewer failure modes

## Consequences
- ✅ Simpler implementation
- ✅ Future-proof (already on new standard)
- ✅ Better performance (bidirectional streaming)
- ❌ Cannot support older MCP clients (acceptable - Claude.ai only)