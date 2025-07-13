# TODO - RTM MCP Integration Debug Log

## 🎯 Current Status: Understanding McpAgent Architecture

**Last Updated**: 2025-01-18  
**Domain**: rtm-mcp-server.vcto-6e7.workers.dev (standardized)  
**Next Action**: Check if we're using McpAgent.serve() correctly

## 🧠 Key Learnings (DO NOT LOSE THESE)

### Understanding the Bug
1. **McpAgent expects standard OAuth** - Built for modern OAuth2 providers with dynamic client registration
2. **RTM uses legacy desktop flow** - Incompatible with McpAgent's assumptions
3. **Default auth sends invalid response** - `{ "type": "resource" }` when OAuth discovery expected
4. **Custom rtm_authenticate tool is CORRECT** - This bypasses the broken default flow

### McpAgent Architecture (from Cloudflare source analysis)
1. **Props Flow**:
   - Props passed during OAuth completion
   - Stored in DO storage by `_init()`
   - Loaded from storage during `onStart()`
   - Available in `init()` method via `this.props`
   
2. **Transport Types**:
   - Stored in DO storage as "sse" or "streamable-http"
   - We need "streamable-http" for MCP compliance
   
3. **Static serve() Method**:
   - McpAgent provides a static `serve()` method
   - This handles protocol negotiation and DO creation
   - Critical for proper MCP handling

## ✅ What's Proven to Work

1. **OAuth Flow** - Completes successfully
2. **Token Storage** - KV storage works correctly
3. **MCP Protocol** - Basic connection works (Inspector confirmed)
4. **Streaming HTTP** - Correct transport (not SSE)
5. **Discovery Endpoints** - Return correct MCP info
6. **Custom rtm_authenticate tool** - Correctly bypasses default auth

## ❌ Dead Ends (Don't Revisit)

1. **SSE Transport** - We use streaming HTTP, not SSE
2. **Domain mismatch** - Fixed, using rtm-mcp-server everywhere
3. **Props in McpAgent** - Already fixed, passes auth correctly
4. **RFC Compliance** - oauth-protected-resource works correctly
5. **Bearer Token in Inspector** - Not needed with auth tools
6. **Looking for hardcoded domains** - Everything uses dynamic host header

## 🔍 Current Issues to Fix

### Issue 1: McpAgent.serve() Usage ← CHECK THIS FIRST
```typescript
// Current (might be wrong):
app.all('/mcp', async (c) => {
  // ... manual handler
});

// Should be (based on cf_index.ts):
app.all('/mcp', (c) => McpAgent.serve(RtmMCP, c.req.raw, c.env, c.executionCtx));
```

### Issue 2: Tool Response Format
```typescript
// Current (invalid):
return {
  content: [{
    type: 'resource',  // ❌ Invalid
    resource: {...}
  }]
};

// Should be:
return {
  content: [{
    type: 'text',  // ✅ Valid
    text: 'Message here'
  }]
};
```

### Issue 3: Transport Type Setting
- Verify transport type is set to "streamable-http" in DO storage
- Check if it's being set during initialization

## 📊 Incremental Test Plan

### Step 1: Verify McpAgent.serve() Implementation
```bash
# Check if McpAgent has static serve method
grep -n "serve" src/index.ts

# If missing, this is likely our main issue
```

### Step 2: Fix serve() If Needed
- Update `/mcp` route to use `McpAgent.serve()`
- This handles all the protocol negotiation we're doing manually

### Step 3: Test Basic Connection
```bash
# Deploy changes
wrangler deploy

# Test with Inspector
npx @modelcontextprotocol/inspector https://rtm-mcp-server.vcto-6e7.workers.dev/mcp

# Should see:
# - Connection established
# - Tools listed (including rtm_authenticate)
```

### Step 4: Fix Tool Response Format
- Update all tool responses to use `type: "text"`
- Test each tool individually in Inspector

### Step 5: Test Complete Auth Flow
1. Use `rtm_authenticate` tool
2. Complete RTM authorization
3. Use `rtm_complete_auth` tool
4. Verify with `rtm_check_auth_status`
5. Test actual RTM tools

## 📝 Code Locations Reference

- **OAuth Handler**: `src/rtm-handler.ts`
- **MCP Tools**: `src/rtm-mcp.ts` 
- **Tool Response Format**: In each tool's return statement
- **Main Route**: `src/index.ts` - `/mcp` handler
- **Props Access**: Available in `init()` via `this.props`

## 🐛 Debug Decision Tree

```
McpAgent.serve() being used?
├─ NO → Fix this first (likely the main issue)
└─ YES → Connection works?
         ├─ NO → Check transport type in DO storage
         └─ YES → Tools work?
                  ├─ NO → Fix response format (type: "text")
                  └─ YES → Test with Claude
                           ├─ Works → 🎉 Done!
                           └─ Fails → Check Claude-specific headers
```

## 🔧 Session Continuity Checklist

### When Starting a Session:
- [ ] Read this entire TODO first
- [ ] Check current deployment: `wrangler deployments list`
- [ ] Note which step you're on
- [ ] Don't repeat dead ends

### Before Making Changes:
- [ ] Understand WHY (check Key Learnings)
- [ ] Make ONE change at a time
- [ ] Test incrementally

### When Debugging:
- [ ] Check debug logs: https://rtm-mcp-server.vcto-6e7.workers.dev/debug
- [ ] Use Inspector before Claude
- [ ] Save any new error messages here

### End of Session:
- [ ] Update this TODO with findings
- [ ] Document any new dead ends
- [ ] Update "Last Updated" date
- [ ] Commit changes

## 🚀 Future Improvements (After MCP Works)

- Enhanced health check with environment details
- Time formatting in debug logs
- Architecture refactoring (see original TODO)

## 📚 References

- **Live Server**: https://rtm-mcp-server.vcto-6e7.workers.dev
- **Debug Dashboard**: https://rtm-mcp-server.vcto-6e7.workers.dev/debug
- **Health Check**: https://rtm-mcp-server.vcto-6e7.workers.dev/health
- **Inspector**: `npx @modelcontextprotocol/inspector`
- **Cloudflare MCP Docs**: https://developers.cloudflare.com/agents/model-context-protocol/