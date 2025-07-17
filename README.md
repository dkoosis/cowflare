# Project Cowflare

MCP server with mock OAuth authentication, ready for Cloudflare RTM integration.

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create a `.dev.vars` file for local secrets:**
   ```bash
   echo 'MOCK_CLIENT_ID="local-dev-client"' > .dev.vars
   echo 'MOCK_CLIENT_SECRET="local-dev-secret"' >> .dev.vars
   ```

3. **Start the development server:**
   ```bash
   npm start
   ```

   Your MCP server will be available at:
   - SSE transport: `http://localhost:8787/sse`
   - Streamable HTTP: `http://localhost:8787/mcp`

4. **Test with MCP Inspector:**
   ```bash
   npx @modelcontextprotocol/inspector@latest
   ```

   Connect to `http://localhost:8787/sse` and complete the mock OAuth flow.

## Project Structure

```
project-cowflare/
├── src/
│   ├── index.ts          # OAuth provider setup
│   ├── mcp.ts           # MCP server implementation
│   └── auth/
│       └── mock-handler.ts  # Mock OAuth handler (to be replaced with RTM)
├── docs/
│   ├── DEBUG-STATE.yaml  # Machine-optimized context
│   ├── TODO.md          # Human priorities
│   └── tree.txt         # File structure (generated)
├── wrangler.toml        # Cloudflare Workers config
└── package.json
```

## Available MCP Tools

1. **`add`** - Add two numbers (no auth required)
2. **`whoami`** - Get authenticated user info
3. **`increment`** - Increment session counter (stateful)

## Mock Authentication Flow

The mock OAuth handler simulates a complete OAuth 2.0 flow:

1. User is redirected to `/authorize`
2. Mock login form is shown (any username works)
3. User approves/denies access
4. Authorization code is generated
5. Code is exchanged for access token at `/token`
6. Token includes mock user claims and permissions

## Next Steps

### Replace Mock Auth with RTM

1. Update `MockAuthHandler` to integrate with Cloudflare RTM
2. Map RTM user attributes to MCP claims
3. Implement proper token validation against RTM

### Add Your MCP Tools

Edit `src/mcp.ts` to add your custom tools:

```typescript
this.server.tool(
  "your-tool",
  "Description of what it does",
  { 
    param: z.string().describe("Parameter description") 
  },
  async ({ param }) => {
    // Tool implementation
    return {
      content: [{ type: "text", text: "Result" }],
    };
  }
);
```

### Deploy to Cloudflare

```bash
npx wrangler deploy
```

## Testing

### With Claude Desktop (via proxy)

```json
{
  "mcpServers": {
    "cowflare": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:8787/sse"]
    }
  }
}
```

### With AI Playground

Deploy your server and connect directly to:
`https://project-cowflare.your-account.workers.dev/sse`

## Development Tips

- The OAuth provider handles CORS automatically
- Session state is persisted in Durable Objects
- Both SSE and Streamable HTTP are supported
- Check `/docs/DEBUG-STATE.yaml` for session context
- Update `/docs/TODO.md` with progress

## Debugging

Enable debug logging:

```typescript
console.log("[CowflareMCP] Debug info:", data);
```

Check wrangler logs:
```bash
wrangler tail
```