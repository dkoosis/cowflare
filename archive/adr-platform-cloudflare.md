# ADR-Platform-Cloudflare: Runtime Platform and Deployment Strategy

**Status:** Accepted  
**Date:** 2025-01-07  
**Review:** 2026-01-07

## Context

Building MCP servers for a 3-5 year maintenance horizon as a solo developer. Primary implementation is Remember The Milk, with Spektrix and other ticketing systems to follow. Need a platform that provides:

- Pay-per-use pricing (nonprofits have variable seasonal usage)
- Single-developer operational simplicity
- Natural scaling without complexity
- Global performance for responsive single-user experience
- Persistent state management for auth tokens and user sessions

## Decision

**Cloudflare Workers** with **Durable Objects** for all MCP server deployments.

### Implementation Stack
- **Runtime**: Cloudflare Workers (V8 isolates)
- **State**: Durable Objects for user sessions
- **Storage**: KV for auth tokens and configuration
- **Secrets**: Workers Secrets for API credentials
- **Deployment**: Wrangler CLI

## Rationale

1. **Cost Model**: Pay-per-request perfectly matches nonprofit seasonal patterns
2. **Zero Operations**: No servers, containers, or clusters to manage
3. **Performance**: Sub-10ms cold starts, global edge deployment
4. **State Management**: Durable Objects provide per-user isolation naturally
5. **3-5 Year Stability**: Cloudflare is committed to Workers platform

## Consequences

### Positive
- Deployment in seconds via `wrangler deploy`
- Automatic global distribution
- Built-in DDoS protection
- Natural per-user scaling via Durable Objects

### Negative  
- Platform lock-in (mitigated by interface abstractions)
- 10MB bundle size limit
- V8 runtime constraints (no Node.js APIs without compatibility flag)

### Telemetry Strategy
- Workers Analytics for basic metrics
- Custom KV-based error tracking
- Logpush for production debugging

## Future Considerations

When adding Spektrix/Ungerboeck, each service gets:
- Separate Worker but shared patterns
- Own Durable Object namespace
- Isolated KV namespace for auth tokens