# TODO - RTM MCP Integration Debug Log

## 🎯 Current Status: Domain Mismatch Identified

**Last Updated**: 2025-01-12  
**Next Action**: Change SERVER_URL to "cowflare" and redeploy

## 🚀 Immediate Next Steps

```bash
# 1. Update wrangler.toml
SERVER_URL = "https://cowflare.vcto-6e7.workers.dev"

# 2. Deploy
wrangler deploy

# 3. Test in Inspector
npx @modelcontextprotocol/inspector https://cowflare.vcto-6e7.workers.dev/mcp
```

## ✅ What's Proven to Work

1. **OAuth Flow** - Completes successfully (when domains match)
2. **Token Storage** - KV storage works correctly
3. **MCP Protocol** - Basic connection works (Inspector confirmed)
4. **Streaming HTTP** - Correct transport (not SSE)
5. **Discovery Endpoints** - Return correct MCP info

## ❌ Dead Ends (Don't Revisit)

1. **SSE Transport** - We use streaming HTTP, not SSE
2. **Props in McpAgent** - Already fixed, passes auth correctly
3. **RFC Compliance** - oauth-protected-resource works correctly
4. **Looking for hardcoded "cowflare"** - It's dynamic from host header
5. **Bearer Token in Inspector** - Not needed with auth tools

## 🔍 Key Discoveries

### Inspector Testing (2025-01-12)
- ✅ Connected successfully with streaming HTTP
- ✅ Listed RTM auth tools
- ❌ Tool responses use non-compliant "resource" type (should be "text")
- ❌ Domain mismatch: Inspector→cowflare but SERVER_URL→rtm-mcp-server
- 💡 Solution: Align SERVER_URL with Inspector's connection

### Debug Logs Analysis
- Multiple failed token exchanges from Claude
- All fail at: `token_exchange_start` → Never completes
- Pattern: Claude can't exchange auth code for token
- Root cause: Domain mismatch in redirect URLs

## 📊 Systematic Test Plan

### Phase 1: Fix Domain Mismatch ← WE ARE HERE
1. [ ] Change SERVER_URL to cowflare.vcto-6e7.workers.dev
2. [ ] Deploy with wrangler
3. [ ] Test OAuth in Inspector
4. [ ] Document results

### Phase 2: Validate OAuth Flow (After Domain Fix)
```bash
# Manual test sequence
1. Start auth: Click rtm_authenticate in Inspector
2. Copy auth URL from response (ignore validation error)
3. Authorize in RTM
4. Run rtm_complete_auth tool
5. Test rtm_check_auth_status
6. Try actual tool: rtm_get_lists
```

**Enhanced Logging** (if needed):
```typescript
// In /authorize endpoint
await logger.log('oauth_authorize_params_detailed', {
  all_params: c.req.query(),
  has_resource: !!resource,
  resource_value: resource,
  expected_resource: `https://${c.req.header('host')}/mcp`,
});
```

### Phase 3: Fix Tool Response Format (If OAuth Works)
Change tool responses from:
```typescript
{ type: "resource", resource: {...} }  // Invalid
```
To:
```typescript
{ type: "text", text: "Message here" }  // Valid
```

### Phase 4: Test with Claude (If Inspector Works)
1. Remove MCP connection in Claude
2. Re-add with cowflare URL
3. Monitor debug logs during connection
4. Check for any Claude-specific behaviors

## 🐛 Debug Decision Tree

```
Inspector connects? 
├─ NO → Check URL, transport type
└─ YES → OAuth works?
         ├─ NO → Check domain match, auth URL generation
         └─ YES → Tools work?
                  ├─ NO → Fix response format
                  └─ YES → Test with Claude
                           ├─ Works → 🎉 Done!
                           └─ Fails → Claude-specific issue
```

## 📝 Code Locations for Quick Reference

- **OAuth Handler**: `src/rtm-handler.ts`
- **MCP Tools**: `src/rtm-mcp.ts`
- **Auth URL Generation**: Uses `c.req.header('host')` dynamically
- **Tool Response Format**: In `processRequest()` method

## 🚫 Common Pitfalls to Avoid

1. Don't change Inspector config URLs - they're correct
2. Don't search for hardcoded "cowflare" - it's dynamic
3. Don't debug token exchange before fixing domain mismatch
4. Don't modify working OAuth flow logic
5. Don't skip Inspector testing before Claude testing

## 📋 Session Checklist

### Start of Session:
- [ ] Check this "Immediate Next Steps" section
- [ ] Note which phase you're in
- [ ] Pull latest: `git pull`

### During Testing:
- [ ] Follow the phase plan sequentially
- [ ] Test with Inspector before Claude
- [ ] Check debug logs after each test
- [ ] Document any new errors

### End of Session:
- [ ] Update current phase status
- [ ] Add any new discoveries
- [ ] Commit: `git add docs/TODO.md && git commit -m "Session: [what you learned]"`

## 🎯 Success Criteria

1. Inspector can complete OAuth flow
2. Inspector can execute RTM tools
3. Claude can connect and authenticate
4. Claude can use RTM tools

## 🔗 Resources

- **Live Server**: https://cowflare.vcto-6e7.workers.dev
- **Debug Dashboard**: https://cowflare.vcto-6e7.workers.dev/debug
- **Health Check**: https://cowflare.vcto-6e7.workers.dev/health
- **Inspector**: `npx @modelcontextprotocol/inspector`

## 🔧 Future Improvements (After MCP Works)

### Enhanced Health Check
```typescript
app.get('/health', (c) => {
  return c.json({ 
    status: 'ok',
    service: 'rtm-mcp-server',
    version: '2.5.0',
    transport: 'streamable-http',
    mcp_compliant: true,
    deployed_at: new Date().toISOString(),
    has_resource_fix: true,
    environment: {
      has_server_url: !!c.env.SERVER_URL,
      has_rtm_key: !!c.env.RTM_API_KEY,
      kv_namespaces: ['AUTH_STORE', 'OAUTH_DATABASE']
    }
  });
});
```

### Debug Log Time Formatting
- Show timestamps in local time for easier debugging
- Add elapsed time between events

## 📐 Code Architecture Refactoring (Post-Debug)

**⚠️ PREREQUISITE**: Complete MCP streaming debug first. Do not refactor during active debugging.

### P0: Critical - God Module Decomposition
**Problem**: `src/index.ts` violates Single Responsibility Principle

**Solution Structure**:
```
src/
├── server/
│   └── router.ts        # HTTP routing only
├── mcp/
│   ├── handler.ts       # MCP protocol logic
│   └── tools/           # Individual tool implementations
├── rtm/
│   ├── api.ts          # RTM API client
│   └── service.ts      # Business logic layer
└── shared/
    ├── types.ts        # Shared types
    └── auth.ts         # Auth middleware
```

### P1: High - Fix Change Preventers
- Consolidate all RTM API calls to use base method
- Move business logic from handlers to service layer
- Single source of truth for each operation

### P2: Medium - Type Safety
- Add branded types for IDs (FrobId, TaskId, etc.)
- Replace long switch with command pattern
- Enforce compile-time type checking

### Success Metrics
- [ ] Each file has single responsibility
- [ ] RTM changes only touch `src/rtm/`
- [ ] New MCP tools don't touch server code
- [ ] Can add Spektrix without touching RTM

---

**Remember**: We're currently at Phase 1 - fixing the domain mismatch. Don't skip ahead!