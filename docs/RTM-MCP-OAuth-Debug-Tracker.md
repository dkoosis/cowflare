# RTM MCP OAuth Debug Tracker

## The Real Issue (From MCP Spec)

After OAuth completion, Claude.ai needs to discover the MCP server using this flow:
1. Try to access MCP server endpoint
2. Get 401 with `WWW-Authenticate` header containing `resource_metadata` URL
3. Fetch `/.well-known/oauth-protected-resource`
4. Discover authorization server from metadata
5. Connect to MCP server with token

**Your implementation is missing**:
- ❌ `/.well-known/oauth-protected-resource` endpoint
- ❌ Proper `WWW-Authenticate` header on 401 responses
- These are REQUIRED by MCP spec

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

1. **~~Missing `/register` endpoint~~** ✅ NOT THE ISSUE
   - Advertised in discovery but NOT called by Claude.ai
   - No 404 errors observed

2. **No post-token validation calls**
   - No `/introspect` requests observed
   - No `/userinfo` requests observed
   - No `/mcp` requests observed
   - Complete silence after token exchange at 01:30:38.991Z

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

### ✅ Confirmed from MCP Spec
1. **MCP servers MUST implement Protected Resource Metadata (RFC9728)**
   - **Evidence**: Direct requirement in MCP spec
   - **Missing**: `/.well-known/oauth-protected-resource` endpoint
   - **Status**: Not implemented

2. **MCP servers MUST return WWW-Authenticate header on 401**
   - **Evidence**: Required by spec for resource discovery
   - **Missing**: Header with `resource_metadata` URL
   - **Status**: Not implemented

### Previous Hypotheses
3. **H1**: ~~Missing `/register` endpoint causes silent failure~~ ❌ DISPROVEN
   - **Test**: Watch if called
   - **Status**: Not called - not the issue

## Debug Questions for Next Session

When testing fixes, capture:
1. Does Claude.ai attempt to call `/register`?
2. What's the exact sequence of calls after token exchange?
3. Any new endpoints called we haven't seen before?
4. Any 4xx/5xx errors in the flow?
5. Does Claude.ai ever attempt to access `/mcp`?

## Next Steps (Based on MCP Spec Requirements)

1. **Apply BOTH fixes** (they're required by spec, not optional):
   - Add `/.well-known/oauth-protected-resource` endpoint
   - Update `/mcp` middleware to return WWW-Authenticate header

2. **Deploy and test** with debug logging active

3. **Watch for new request pattern**:
   - Token exchange completes
   - Request to `/mcp` (probably without token first)
   - 401 with WWW-Authenticate
   - Request to `/.well-known/oauth-protected-resource`
   - Request to `/mcp` with Bearer token

4. **Success indicators**:
   - Claude.ai shows "Connected" instead of "Connect"
   - Debug logs show MCP requests with Bearer token

## Session Log

### Session 1 (Initial Debug)
- Identified missing `/register` endpoint
- Confirmed OAuth flow completes but connection not recognized
- No `/introspect` or `/userinfo` calls observed

### Session 2 (Current - Debug Log Analysis + Spec Review)
- **FINDING**: `/register` is NOT called - not the issue
- **FINDING**: Complete silence after token exchange (01:30:38.991Z)
- **FINDING**: No attempts to access `/mcp` or any other endpoint
- **FINDING**: Read MCP spec - MCP servers MUST implement RFC9728 Protected Resource Metadata
- **FINDING**: MCP servers MUST return WWW-Authenticate header with resource_metadata URL
- **CONCLUSION**: Claude.ai can't discover the MCP server because required discovery mechanism is missing
- **NEXT TEST**: Implement spec-compliant discovery (Protected Resource Metadata + WWW-Authenticate)

---

**Remember**: Don't guess. Test one hypothesis at a time. Document results.