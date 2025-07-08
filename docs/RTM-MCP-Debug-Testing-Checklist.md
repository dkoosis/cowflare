# RTM MCP Debug Testing Checklist

## Pre-Test Setup
- [ ] Apply Fix #1 (remove `/register` from discovery)
- [ ] Deploy to Cloudflare Workers
- [ ] Open `/debug` dashboard in a browser tab
- [ ] Clear any existing RTM connections in Claude.ai

## Test Execution

### 1. Start Fresh Connection
- [ ] In Claude.ai, go to integrations
- [ ] Click "Add Integration" 
- [ ] Enter your server URL
- [ ] Note the debug session ID that appears

### 2. During OAuth Flow
Monitor `/debug` for these specific events:

- [ ] `discovery_request` - Claude fetches `/.well-known/oauth-authorization-server`
- [ ] Any 404 errors? (especially for `/register`)
- [ ] `oauth_authorize_start` - Authorization begins
- [ ] `complete_auth_success` - User completes flow
- [ ] `token_exchange_success` - Token obtained

### 3. After Token Exchange
**Critical observation point** - Watch for:

- [ ] Any calls to `/introspect`?
- [ ] Any calls to `/userinfo`?
- [ ] Any calls to `/mcp`?
- [ ] Any calls to `/.well-known/oauth-protected-resource`?
- [ ] Any OTHER endpoints we haven't seen before?
- [ ] Any error responses (4xx/5xx)?

### 4. Final State Check
- [ ] Does Claude.ai show "Connected" or still "Connect"?
- [ ] Are there any error messages in Claude.ai UI?
- [ ] Check browser console for any errors

## Recording Results

### If Still Not Connected:
1. **Last endpoint called**: _______________
2. **Time between token exchange and last call**: _______
3. **Any new endpoints discovered**: _______________
4. **Any error patterns**: _______________

### Debug Log Analysis
Look for patterns:
- Does Claude.ai stop calling after a specific endpoint?
- Are there any timeout patterns?
- Any requests with missing or malformed data?

## Next Test Iteration
Based on results:
- [ ] If no `/register` calls → Fix confirmed, move to Fix #2
- [ ] If new endpoints discovered → Document and research
- [ ] If errors found → Address specific error
- [ ] If silent failure → Apply Fix #2 (Protected Resource Metadata)

## Export Debug Logs
- [ ] Copy relevant session logs
- [ ] Save full debug output for this session
- [ ] Update the Debug Tracker with findings