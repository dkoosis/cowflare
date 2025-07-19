# Testing MCP Server

## Prerequisites
- Server running: `npm run dev`
- MCP Inspector or compatible client

## Manual Testing Steps

### 1. OAuth Flow
1. Open http://localhost:8787/authorize
2. Login (any email/password accepted in demo)
3. Click "Approve"
4. Note the redirect URL with authorization code
5. Exchange code for token at /token endpoint

### 2. MCP Connection
Use MCP Inspector:
1. Set endpoint: http://localhost:8787/sse
2. Add Authorization header: Bearer <your-token>
3. Connect

### 3. Test Tools

**Current: Add Tool (Cloudflare Hello World)**
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "add",
    "arguments": { "a": 5, "b": 3 }
  },
  "id": 1
}
```
Expected: `{ "content": [{ "type": "text", "text": "8" }] }`

**Future Tools (after baseline established)**
- whoami: Returns authenticated user info
- increment: Stateful counter demonstration
- Additional tools as requirements emerge

## Automated Testing

Since vitest-pool-workers has issues (see KNOWN-ISSUES.md), use:
1. Integration tests against running worker
2. Direct HTTP client tests
3. MCP SDK client for protocol testing

## Next Steps
- [ ] Add more tools (see src/index.ts)
- [ ] Test error cases
- [ ] Validate OAuth token expiry
- [ ] Check RTM integration points
