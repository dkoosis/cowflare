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

**Start with SSE, prepare for Streamable HTTP migration**.

### Implementation Strategy

1. **Phase 1 (Now - Q2 2025)**: SSE Only
   - Endpoint: `/sse` with `/sse/messages`
   - Matches Claude.ai's current implementation
   - Ensures maximum compatibility

2. **Phase 2 (Q3 2025)**: Add Streamable HTTP
   - Add `/mcp` endpoint alongside SSE
   - Monitor ecosystem adoption
   - Test with early adopters

3. **Phase 3 (2026)**: Transition Primary Support
   - Make Streamable HTTP primary
   - Deprecate SSE endpoints
   - Maintain SSE for stragglers

## Rationale

1. **Ecosystem Reality**: Claude.ai uses SSE, making it the de facto standard today
2. **Future-Proof**: Streamable HTTP is clearly superior and will dominate
3. **Pragmatic Timing**: 6-12 months gives ecosystem time to migrate
4. **Low Migration Cost**: Adding second transport later is straightforward

## Implementation Notes

### Current SSE Implementation
```typescript
// Keep current implementation as-is
app.get('/sse', async (c) => { /* ... */ });
app.post('/sse/messages', async (c) => { /* ... */ });

Future Streamable HTTP Addition
typescript// Add in Phase 2
app.all('/mcp', async (c) => {
  const transport = new StreamableHTTPServerTransport(req, res);
  await server.connect(transport);
});
Consequences
Positive

Immediate Claude.ai compatibility
Time to learn from early Streamable HTTP adopters
Clear migration path
Avoids being too early to new standard

Negative

Temporary technical debt (dual endpoints)
Will require migration work in ~1 year
Slightly more complex than single transport

Monitoring Triggers
Migrate to Phase 2 when ANY of:

Claude.ai switches to Streamable HTTP
25% of MCP ecosystem adopts Streamable HTTP
Major MCP client requires it
Q3 2025 arrives (whichever comes first)

References

MCP Specification 2025-03-26
Why MCP Deprecated SSE
Claude Integrations Documentation