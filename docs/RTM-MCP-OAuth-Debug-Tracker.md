# RTM MCP OAuth Debug Tracker

## Current State
- **Symptom**: Claude.ai shows "Connect" button instead of "Connected" after completing OAuth flow
- **Last Updated**: [Update with each session]

## Confirmed Working ✅

### OAuth Flow Components
1. **Discovery endpoint** (`/.well-known/oauth-authorization-server`)
   - Returns valid JSON with all endpoints
   - Currently advertises `/register` endpoint (NOT IMPLEMENTED)

2. **Authorization flow** (`/authorize`)
   - Successfully returns waiting page
   - User can complete RTM auth
   - Stores session in cookie

3. **Token exchange** (`/token`)
   - Successfully exchanges code for RTM token
   - Stores token mapping: `token:{rtmToken}` → `{userName, userId, client_id, created_at}`
   - Returns valid OAuth2 response

4. **Debug logging**
   - Captures all requests at `/debug`
   - Shows successful OAuth flow completion

### RTM Integration
- Frob generation works
- RTM token retrieval works
- User info fetched from RTM successfully

## Confirmed Issues ❌

1. **Missing `/register` endpoint**
   - Advertised in discovery but returns 404
   - May cause Claude.ai to fail silently

2. **No post-token validation calls**
   - No `/introspect` requests observed
   - No `/userinfo` requests observed
   - Suggests Claude.ai might be failing before these steps

## Current Implementation Details

### Endpoints
| Endpoint | Status | Notes |
|----------|--------|-------|
| `/.well-known/oauth-authorization-server` | ✅ Implemented | Advertises `/register` incorrectly |
| `/authorize` | ✅ Implemented | Returns waiting page |
| `/complete-auth` | ✅ Implemented | Manual completion trigger |
| `/token` | ✅ Implemented | Exchanges code for token |
| `/introspect` | ✅ Implemented | Never called by Claude |
| `/userinfo` | ✅ Implemented | Never called by Claude |
| `/register` | ❌ NOT Implemented | Advertised but missing |
| `/mcp` | ✅ Implemented | Bearer auth required |

### Token Storage Pattern
```
KV Key: token:{rtmToken}
KV Value: {
  userName: string,
  userId: string, 
  client_id: string,
  created_at: number
}
```

## Hypotheses to Test

### High Priority
1. **H1**: Missing `/register` endpoint causes silent failure
   - **Test**: Remove from discovery OR implement endpoint
   - **Status**: Not tested

### Medium Priority
2. **H2**: MCP server needs Protected Resource Metadata
   - **Evidence**: MCP spec says servers MUST implement RFC9728
   - **Test**: Add `/.well-known/oauth-protected-resource`
   - **Status**: Not tested

3. **H3**: Missing `WWW-Authenticate` header on 401
   - **Evidence**: MCP spec requires specific header format
   - **Test**: Update `/mcp` auth middleware
   - **Status**: Not tested

### Low Priority
4. **H4**: Client ID validation too strict
   - **Evidence**: None yet
   - **Test**: Only after H1-H3
   - **Status**: Not tested

## Debug Questions for Next Session

When testing fixes, capture:
1. Does Claude.ai attempt to call `/register`?
2. What's the exact sequence of calls after token exchange?
3. Any new endpoints called we haven't seen before?
4. Any 4xx/5xx errors in the flow?
5. Does Claude.ai ever attempt to access `/mcp`?

## Next Steps (Prioritized)

1. **Fix #1**: Remove `/register` from discovery (simplest fix)
   ```typescript
   // Remove line: registration_endpoint: `${baseUrl}/register`,
   ```

2. **Deploy and test** with debug logging active

3. **Analyze new logs** focusing on:
   - Post-token-exchange behavior
   - Any new error patterns
   - Whether `/introspect` or `/userinfo` get called

4. **Only if #1 doesn't work**: Consider implementing Protected Resource Metadata

## Session Log

### Session 1 (Initial Debug)
- Identified missing `/register` endpoint
- Confirmed OAuth flow completes but connection not recognized
- No `/introspect` or `/userinfo` calls observed

### Session 2 (Current)
- [Add findings here]

---

**Remember**: Don't guess. Test one hypothesis at a time. Document results.