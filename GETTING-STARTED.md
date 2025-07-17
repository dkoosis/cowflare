# Getting Started with Project Cowflare

## Quick Setup (3 minutes)

1. **Clone/Download the project files**
   ```bash
   # Create project directory
   mkdir project-cowflare
   cd project-cowflare
   ```

2. **Make setup script executable and run it**
   ```bash
   chmod +x setup.sh
   ./setup.sh
   ```

   Or manually:
   ```bash
   npm install
   echo 'MOCK_CLIENT_ID="local-dev-client"' > .dev.vars
   echo 'MOCK_CLIENT_SECRET="local-dev-secret"' >> .dev.vars
   ```

3. **Start the development server**
   ```bash
   npm start
   ```

   Your MCP server is now running at:
   - SSE: http://localhost:8787/sse
   - Streamable HTTP: http://localhost:8787/mcp

## Test Your Setup

### Option 1: MCP Inspector (Recommended)
```bash
npx @modelcontextprotocol/inspector@latest
```

1. Open http://localhost:5173
2. Enter URL: `http://localhost:8787/sse`
3. Click Connect
4. Complete the mock OAuth flow (any username works)
5. Test the tools: `add`, `whoami`, `increment`

### Option 2: Claude Desktop
Edit Claude's config (Settings → Developer → Edit Config):

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

Restart Claude (Cmd/Ctrl+R) and look for the tools icon.

## What You Got

### Project Structure
```
project-cowflare/
├── src/
│   ├── index.ts          # OAuth provider setup
│   ├── mcp.ts           # Your MCP tools
│   └── auth/
│       └── mock-handler.ts  # Mock OAuth (replace with RTM)
├── docs/                 # Session documentation
├── wrangler.toml        # Cloudflare config
└── package.json
```

### Built-in Tools
- **add** - Simple addition (no auth required)
- **whoami** - Shows authenticated user info
- **increment** - Stateful counter demonstration

### Mock OAuth Flow
1. User redirected to `/authorize`
2. Simple login form (any username)
3. Authorization code generated
4. Code exchanged for token at `/token`
5. Token includes mock claims

## Next Steps

### 1. Add Your Own Tools
Edit `src/mcp.ts`:

```typescript
this.server.tool(
  "my-tool",
  "What it does",
  { param: z.string() },
  async ({ param }) => {
    // Your logic here
    return {
      content: [{ type: "text", text: "Result" }],
    };
  }
);
```

### 2. Deploy to Cloudflare
```bash
npx wrangler deploy
```

Then connect to: `https://project-cowflare.[your-account].workers.dev/sse`

### 3. Integrate RTM
When ready to replace mock auth:
1. Create `src/auth/rtm-handler.ts`
2. Update `src/index.ts` to use RTM handler
3. Configure RTM credentials in wrangler.toml

## Troubleshooting

### Port already in use
```bash
lsof -i :8787  # Find process
kill -9 [PID]  # Kill it
```

### Wrangler issues
```bash
npx wrangler login
npx wrangler whoami
```

### Can't connect with MCP Inspector
- Check server is running: `curl http://localhost:8787/sse`
- Try the Streamable HTTP endpoint: `/mcp`
- Check browser console for errors

## Important Discovery

We found existing Workers in your account:
- `rtm-mcp-server` - May contain RTM integration code
- `rtm-auth-page` - Authentication page for RTM

You might want to examine these for RTM integration patterns.

## Resources

- [MCP Documentation](https://modelcontextprotocol.io)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers)
- [Project TODO](/docs/TODO.md) - Current priorities
- [Debug State](/docs/DEBUG-STATE.yaml) - Technical context

Happy building! 🐄