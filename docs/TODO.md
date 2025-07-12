# Debug Log - RTM MCP Integration (Updated)

## 🎯 Context for Future Claude/Developer

**Problem**: After OAuth authentication, Claude.ai redirects to `/new` instead of reconnecting to our MCP server.

**Approach**: We're following systematic hypothesis elimination (not random attempts). Each theory must be tested in isolation with evidence before moving to the next.

**Key Rule**: Always check "Quick Start" first, then follow the decision tree. Never skip ahead or combine fixes.

## 🚀 Quick Start: What To Do Next

```
Current Status: Haven't tested with MCP Inspector yet
Next Action: Run baseline test (Phase 1, Step 1.1)
```

## 📊 Current State Summary (Last Updated: 2025-01-12)

### What Works ✅
1. OAuth flow completes successfully
2. Tokens are issued and stored correctly  
3. User authentication works (userId: 430794)
4. Discovery endpoints respond correctly

### What Doesn't Work ❌
1. Claude.ai doesn't attempt to connect to `/mcp` after OAuth
2. No requests to `/.well-known/oauth-protected-resource` after auth
3. Claude redirects to `/new` instead of reconnecting

### What We've Already Tried
1. **McpAgent props** - Execution context now properly passes auth data
2. **RFC compliance** - oauth-protected-resource returns correct format
3. **Debug logging** - Enhanced /mcp tracing ready to capture attempts
4. **Debug dashboard** - Fixed rendering error

## 🎯 Systematic Debugging Plan

### Phase 1: Baseline Testing (MUST DO FIRST)
**Goal**: Establish if MCP server works independently of Claude.ai

```bash
# 1.1 Test with MCP Inspector
npx @modelcontextprotocol/inspector https://rtm-mcp-server.vcto-6e7.workers.dev/mcp

# 1.2 Check health endpoint
curl https://rtm-mcp-server.vcto-6e7.workers.dev/health

# 1.3 Monitor logs during testing
wrangler tail --format pretty
```

**Document Results**:
- [ ] Inspector connects successfully?
- [ ] If yes → Server works, Claude-specific issue
- [ ] If no → Debug server first before Claude integration

### Phase 2: Enhanced Logging Deployment
**Goal**: Understand exactly what Claude.ai sends during OAuth

1. Add enhanced logging to capture:
   ```typescript
   // In /authorize endpoint
   await logger.log('oauth_authorize_params_detailed', {
     all_params: c.req.query(),
     has_resource: !!resource,
     resource_value: resource,
     expected_resource: `https://${c.req.header('host')}/mcp`,
   });
   ```

2. Deploy: `wrangler deploy`
3. Trigger new OAuth flow from Claude.ai
4. Check debug dashboard for `oauth_authorize_params_detailed` events

### Phase 3: Incremental Resource Implementation

#### 3.1 If Claude DOES send resource parameter:
- [ ] Store resource in session cookie
- [ ] Include in auth code data  
- [ ] Return in token response
- [ ] Test with Inspector after each change

#### 3.2 If Claude DOESN'T send resource parameter:
- [ ] Check working MCP OAuth examples
- [ ] Test token format variations
- [ ] Review discovery endpoint responses

### Phase 4: Test Each Change in Isolation

After EACH code change:
1. [ ] Deploy
2. [ ] Test with Inspector (baseline)
3. [ ] Test with Claude.ai
4. [ ] Document what changed in this file

## 📊 Test Results Log

### Test Session: [DATE]
- **Change Made**: 
- **Inspector Result**: 
- **Claude.ai Result**: 
- **New Logs Observed**: 
- **Next Step**: 

## 🔬 Hypothesis Testing & Elimination Tracker

### Decision Tree
```
1. Does MCP server work with Inspector?
   ├─ NO → Fix server issues first (skip to Server Debugging)
   └─ YES → Continue to Claude.ai specific issues
      │
      2. Does Claude send resource parameter?
         ├─ YES → Test Hypothesis 1 (Resource handling)
         └─ NO → Test Hypothesis 4 (Alternative signals)
            │
            3. Does token response need specific format?
               ├─ YES → Test Hypothesis 2 (Token format)
               └─ NO → Test Hypothesis 3 (Discovery fields)
```

### Hypothesis Tracking

**Status Legend:**
- 🔵 Not Tested - Haven't tried yet
- 🟡 In Progress - Currently testing
- 🔴 Blocked - Waiting on prerequisite
- ✅ Confirmed - Theory was correct
- ❌ Eliminated - Theory was wrong

#### ❓ Hypothesis 1: Missing Resource Parameter
- **Status**: 🔵 Not Tested
- **Evidence For**: RFC 8707 requires it; other OAuth MCP servers use it
- **Evidence Against**: None yet
- **Specific Test**: 
  1. Log if Claude sends `resource` in `/authorize`
  2. If yes, implement storage and return in token
  3. Check if Claude then attempts `/mcp`
- **Result**: _[To be filled]_
- **Conclusion**: _[Eliminated/Confirmed/Partial]_

#### ❓ Hypothesis 2: Token Format Issue  
- **Status**: 🔵 Not Tested
- **Prerequisite**: Only test if H1 is eliminated
- **Evidence For**: Claude might expect JWT or specific claims
- **Evidence Against**: None yet
- **Specific Test**:
  1. Compare our token response with working MCP OAuth servers
  2. Try adding `aud`, `sub`, `exp` claims
  3. Test with Inspector first, then Claude
- **Result**: _[To be filled]_
- **Conclusion**: _[Eliminated/Confirmed/Partial]_

#### ❓ Hypothesis 3: Discovery Response Missing Fields
- **Status**: 🔵 Not Tested  
- **Prerequisite**: Only test if H1 & H2 eliminated
- **Evidence For**: Claude requests discovery but doesn't proceed
- **Evidence Against**: Discovery endpoints return valid responses
- **Specific Test**:
  1. Add `scopes_supported`, `jwks_uri` to AS metadata
  2. Add more fields to oauth-protected-resource
  3. Compare with working implementations
- **Result**: _[To be filled]_
- **Conclusion**: _[Eliminated/Confirmed/Partial]_

#### ❓ Hypothesis 4: Claude Needs Alternative Connection Signal
- **Status**: 🔵 Not Tested
- **Prerequisite**: Test if Claude doesn't send resource param
- **Evidence For**: Claude might use different mechanism
- **Evidence Against**: None yet
- **Specific Test**:
  1. Check if Claude expects a redirect after token exchange
  2. Test if specific headers trigger reconnection
  3. Analyze working MCP OAuth implementations
- **Result**: _[To be filled]_
- **Conclusion**: _[Eliminated/Confirmed/Partial]_

### ❌ Eliminated Theories (Don't Repeat These)

#### Theory Elimination Criteria:
- **Eliminated**: Tested exactly as specified, failed with clear evidence
- **Partial**: Some aspects tested but not complete implementation  
- **Invalid**: Theory was based on incorrect assumption

#### ~~Theory: Props not reaching Durable Object~~
- **Tested**: 2025-01-11
- **Evidence**: Logs show props properly initialized
- **Conclusion**: ELIMINATED - Props work correctly

#### ~~Theory: OAuth flow is broken~~
- **Tested**: 2025-01-10
- **Evidence**: Token exchange completes, user authenticated
- **Conclusion**: ELIMINATED - OAuth works correctly

### 🧪 Test Execution Log

| Date | Hypothesis | Specific Test | Result | Conclusion |
|------|------------|---------------|---------|------------|
| 2025-01-12 | Baseline | MCP Inspector test | _pending_ | _pending_ |
| | | | | |

## 🛡️ Testing Rules (Prevent Wasted Effort)

### Before Testing ANY Hypothesis:
1. ✅ **Always run baseline test first** (MCP Inspector)
2. ✅ **One change at a time** - Never combine multiple fixes
3. ✅ **Test with Inspector before Claude** - Isolate server vs integration issues
4. ✅ **Document exact change made** - Git commit after each test

### Testing Procedure Template:
```markdown
**Hypothesis**: [Which one from above]
**Date/Time**: [When tested]
**Exact Change**: [Code diff or description]
**Inspector Result**: [Pass/Fail with details]
**Claude Result**: [Connected/No connection with details]  
**New Log Entries**: [Any new debug info observed]
**Conclusion**: [Eliminated/Confirmed/Partial - with reasoning]
```

### Red Flags to Avoid:
- 🚫 Testing hypothesis 2 before eliminating hypothesis 1
- 🚫 Making multiple changes then testing
- 🚫 Assuming Inspector results apply to Claude
- 🚫 Not documenting negative results
- 🚫 Retesting eliminated theories with "just one more tweak"

## ⚡ Combination Tracker (Prevent "Kitchen Sink" Debugging)

### Tested Combinations That Failed:
- [ ] (None yet - fill as we go)

### Example format:
```
❌ Resource param + Modified token format + Extra discovery fields
   Date: 2025-01-XX
   Result: Still no connection
   Lesson: These aren't interdependent
```

## 🔍 External Dependencies & Assumptions

### Critical Assumptions We're Making:
1. **Claude.ai hasn't changed its MCP integration** 
   - Last verified: Never
   - How to verify: Find other working Claude.ai MCP OAuth servers

2. **MCP Inspector accurately represents Claude's behavior**
   - Last verified: Never  
   - How to verify: Test a known-working MCP server with both

3. **Our development environment matches production**
   - Last verified: Using wrangler dev --remote
   - How to verify: Always test on deployed version

### External Factors to Check:
- [ ] Claude.ai MCP feature is still in beta/enabled for our account
- [ ] No Cloudflare Worker outages or changes
- [ ] RTM API still accepts our authentication method

## 🛑 When to Stop and Reassess

### Stop Conditions:
1. **All hypotheses eliminated** → Need new theories
2. **External dependency confirmed broken** → Wait for fix or find workaround
3. **3+ sessions with no progress** → Seek help from community

### Escalation Path:
1. Post minimal reproduction case to MCP GitHub discussions
2. Check if other Claude.ai OAuth MCP servers are working
3. Consider non-OAuth alternative (if RTM supports it)
4. Build proof-of-concept with different architecture

### Signs We're on Wrong Track:
- Inspector works perfectly but Claude never attempts connection
- Other OAuth MCP servers also fail with Claude
- Debug logs show no meaningful differences between attempts

## 🚫 Don't Repeat These (Already Fixed)
- Props fix (done)
- RFC compliance (done)
- Basic OAuth flow (works)

## 📋 Known Issues to Fix After MCP Works

### Code Architecture Refactoring
**⚠️ PREREQUISITE**: Complete MCP streaming debug first. Do not refactor during active debugging.

### P0: Critical - God Module Decomposition
- `src/index.ts` violates Single Responsibility Principle
- Split into: router.ts, mcp/handler.ts, rtm/service.ts, auth/middleware.ts

### P1: High - Fix Change Preventers
- Consolidate RTM API calls
- Move business logic to service layer

### P2: Medium - Type Safety & Organization
- Create domain boundaries
- Add branded types for IDs
- Replace long switch with command pattern

## 🔗 Resources
- Debug Dashboard: https://rtm-mcp-server.vcto-6e7.workers.dev/debug
- MCP Inspector: https://github.com/modelcontextprotocol/inspector
- Health Check: https://rtm-mcp-server.vcto-6e7.workers.dev/health

## 📋 Session Checklist

### Start of Session:
- [ ] Check "Quick Start" section for next action
- [ ] Review eliminated theories (don't retest!)
- [ ] Note any external changes since last session
- [ ] Pull latest code: `git pull`

### During Testing:
- [ ] Follow decision tree strictly
- [ ] One change per test
- [ ] Test with Inspector first
- [ ] Document in test execution log
- [ ] Commit after each test result

### End of Session:
- [ ] Update "Quick Start" next action
- [ ] Update hypothesis status (🔵/🟡/🔴/✅/❌)
- [ ] Add any failed combinations
- [ ] Commit TODO.md: `git add docs/TODO.md && git commit -m "Debug session: [summary]"`
- [ ] Consider if hitting stop conditions

###
# Debug Log - RTM MCP Integration (Updated)

# TODO
# TODO - Next Work Session

## ✅ What We've Already Fixed
1. **McpAgent props** - Execution context now properly passes auth data
2. **RFC compliance** - oauth-protected-resource returns correct format
3. **Debug logging** - Enhanced /mcp tracing ready to capture attempts
4. **Debug dashboard** - Fixed rendering error

## 🔴 CORE ISSUE: Claude.ai Doesn't Reconnect After OAuth

**Current State**: OAuth completes perfectly, but Claude redirects to /new instead of connecting to MCP.

**What we KNOW**:
- OAuth flow: ✅ Works
- Token exchange: ✅ Works  
- Discovery endpoints: ✅ Claude requests both
- MCP connection attempt: ❌ Never happens
- Result: Claude redirects to /new

## 🎯 Next Session Focus

### 1. Test with MCP Inspector First
```bash
npx @modelcontextprotocol/inspector https://rtm-mcp-server.vcto-6e7.workers.dev/mcp
```
If Inspector connects, our server works. The issue is Claude-specific.

### 2. Check Debug Dashboard for Clues
Look for any `/mcp` requests after token exchange. We now have enhanced logging.

### 3. Research Working Examples
Find MCP servers that DO reconnect with Claude.ai after OAuth. What's different?

### 4. Hypothesis to Test
- Missing response headers?
- Wrong token format?  
- Need different OAuth flow?
- Resource parameter not propagated?

## 🚫 Don't Repeat These
- Props fix (done)
- RFC compliance (done)
- Basic OAuth flow (works)

## 🔴 KNOWN ISSUE: OAuth Resource Parameter Missing

**Problem**: After OAuth completes, Claude.ai redirects to /new instead of reconnecting to MCP server.

**Root Cause**: We're not handling the `resource` parameter from RFC 8707 that tells Claude which MCP server the OAuth is for.

**Required Fix**:
1. Accept `resource` param in `/authorize` endpoint
2. Store it through the auth flow (frob → code → token)
3. Include it in token response
4. Update `/.well-known/oauth-protected-resource` to properly identify MCP endpoint

**Status**: Identified but not implemented. This is why Claude doesn't auto-connect after auth.

## 🔴 CORE ISSUE: Claude.ai Doesn't Reconnect After OAuth

**Observation**: After successful OAuth authentication with RTM, Claude.ai redirects to `/new` instead of reconnecting to the MCP server.

**Current behavior**:
1. OAuth flow completes successfully
2. Token is issued and stored
3. Claude.ai receives the token
4. Claude.ai redirects to `/new` (new conversation) instead of connecting to MCP

**Expected behavior**: Claude should automatically attempt to connect to the MCP server after receiving the OAuth token.

**Status**: Root cause unknown. Need to investigate what signals Claude.ai needs to reconnect.

## 🔴 KNOWN ISSUE: OAuth Resource Parameter Missing

**Problem**: After OAuth completes, Claude.ai redirects to /new instead of reconnecting to MCP server.

**Root Cause**: We're not handling the `resource` parameter from RFC 8707 that tells Claude which MCP server the OAuth is for.

**Required Fix**:
1. Accept `resource` param in `/authorize` endpoint
2. Store it through the auth flow (frob → code → token)
3. Include it in token response
4. Update `/.well-known/oauth-protected-resource` to properly identify MCP endpoint

**Status**: Identified but not implemented. This is why Claude doesn't auto-connect after auth.

## 🚀 DEPLOYMENT STATUS: McpAgent.serve() Implementation

### Expected Test Outcomes

#### 1. ✅ SUCCESS SCENARIO
If the fix worked, you should see:
- OAuth completes → Claude.ai gets token
- Claude.ai requests `/.well-known/oauth-protected-resource` ✓
- Claude.ai POSTs to `/mcp` with Bearer token ✓
- **NEW**: Connection stays open (check Network tab - should show "pending")
- **NEW**: MCP tools appear in Claude.ai interface
- **NEW**: Tools can be called successfully

#### 2. ⚠️ PARTIAL SUCCESS SCENARIOS

**A. Connection Works but No Tools**
- Symptom: No "Connection closed" error, but tools don't appear
- Cause: Props not reaching the Durable Object
- Debug: Check logs for `[RtmMCP] Initializing with props: { hasToken: false }`

**B. Authentication Loop**
- Symptom: Claude keeps asking to re-authenticate
- Cause: Session management issue with McpAgent
- Debug: Check for `Mcp-Session-Id` header in responses

#### 3. ❌ FAILURE SCENARIOS

**A. Still Getting "Connection Closed"**
```
MCP error -32000: Connection closed
```
- Check deployment actually succeeded: `wrangler tail`
- Verify the binding exists: `MCP_OBJECT` in wrangler.toml
- Check if Durable Object migration ran

**B. New Error: "Invalid binding"**
- The Durable Object isn't properly bound
- Check wrangler.toml has the binding
- Ensure `export { RtmMCP }` is in index.ts

**C. 500 Internal Server Error**
- Props passing mechanism failed
- McpAgent initialization threw an error

### 🔍 Debug Checklist

1. **Chrome DevTools Network Tab**
   - [ ] POST to `/mcp` returns 200 (not 401)
   - [ ] Response has `Mcp-Session-Id` header
   - [ ] Connection shows as "pending" (streaming)
   - [ ] Look for EventStream or chunked responses

2. **Wrangler Logs** (`wrangler tail`)
   ```bash
   wrangler tail --format pretty
   ```
   Look for:
   - `[MCP Auth] Token valid:`
   - `[RtmMCP] Initializing with props:`
   - Any error stack traces

3. **Debug Dashboard**
   - New events should appear after `/mcp` request
   - Look for WebSocket connection events
   - Check for initialization success/failure

### 🛠️ Quick Fixes for Common Issues

#### If Props Aren't Reaching DO:
The execution context props passing might not work. Alternative approach:
```typescript
// In index.ts, modify the mcpHandler call
const id = c.env.MCP_OBJECT.idFromName(`streamable-http:${userId}`);
const stub = c.env.MCP_OBJECT.get(id);

// Initialize the DO with props directly
await stub._init({
  rtmToken: token,
  userName,
  userId
});

// Then delegate to the handler
return mcpHandler.fetch(c.req.raw, c.env, c.executionCtx);
```

#### If Session Issues:
McpAgent manages sessions internally. Make sure:
1. Don't interfere with `Mcp-Session-Id` header
2. Let McpAgent handle session creation
3. Check if CORS exposes the header

#### If Binding Issues:
```toml
# wrangler.toml - ensure this exists
[[durable_objects.bindings]]
name = "MCP_OBJECT"
class_name = "RtmMCP"
```

### 📊 What Success Looks Like

1. **Network Tab**: 
   - `/mcp` request stays open
   - Chunked transfer encoding
   - EventStream messages flowing

2. **Claude.ai**:
   - "Connected to Remember The Milk" indicator
   - Tools menu shows RTM tools
   - Can successfully call tools

3. **Logs**:
   ```
   [MCP Auth] Token valid: { userName: 'user', userId: '123' }
   [RtmMCP] Initializing with props: { hasToken: true, userName: 'user' }
   Connection successful! Connected as: user
   ```

### 🚨 If All Else Fails

1. **Verify Basic Setup**:
   ```bash
   # Check deployment
   wrangler deployments list
   
   # Check DO is registered
   wrangler d1 list  # Should show RtmMCP if using SQL
   ```

2. **Test Without Auth** (temporary):
   - Comment out auth checks
   - Hardcode props
   - See if transport works

3. **Fall Back to Simpler Pattern**:
   - Use the exact pattern from Cloudflare docs
   - Add auth layer by layer

### 📝 Next Actions Based on Results

- **If Success** → Test all RTM tools, monitor for stability
- **If Props Issue** → Implement direct DO initialization
- **If Session Issue** → Debug McpAgent session handling
- **If Still Closing** → Check if McpAgent version supports Streamable HTTP

**Remember**: The `McpAgent` implementation in `paste.txt` shows it handles all the complex streaming internally. Our job is just to:
1. Authenticate the request
2. Pass the props correctly
3. Let McpAgent do the rest


# TODO

## Healthcheck
// In your /health endpoint
app.get('/health', (c) => {
  return c.json({ 
    status: 'ok',
    service: 'rtm-mcp-server',
    version: '2.4.0',
    transport: 'streamable-http',
    mcp_compliant: true,
    deployed_at: new Date().toISOString(), // Add this
    has_resource_fix: true // Add this to confirm fix is deployed
  });
});

Enhance the health check to be much more useful and detailed

## Show debug log in local friendly time. 

## Code Architecture Refactoring

**⚠️ PREREQUISITE**: Complete MCP streaming debug first. Do not refactor during active debugging.

### 🔴 P0: Critical - God Module Decomposition (After MCP Works)

**Problem**: `src/index.ts` violates Single Responsibility Principle by handling routing, auth, MCP protocol, and RTM communication.

**Action**: Split into focused modules:

```typescript
// src/server/router.ts - HTTP routing only
import { Hono } from 'hono';
export function createRouter(handlers: Handlers) {
  const app = new Hono();
  // Move all route definitions here
  return app;
}

// src/mcp/handler.ts - MCP protocol logic
export class McpRequestHandler {
  async handleRequest(request: Request, env: Env, ctx: ExecutionContext) {
    // Move MCP-specific logic here
  }
}

// src/rtm/service.ts - RTM API wrapper
export class RtmService {
  constructor(private api: RtmApi) {}
  async createTimeline(params: TimelineParams) {
    // Consolidate all RTM operations
  }
}

// src/auth/middleware.ts - Token validation
export const authMiddleware = async (c: Context, next: Next) => {
  // Extract auth logic from current /mcp endpoint
};
```

### 🟡 P1: High - Fix Change Preventers

**Problem**: Shotgun Surgery pattern - any RTM API change requires touching multiple files.

**Action 1**: Consolidate RTM API calls
```typescript
// src/rtm/api.ts - Add base method
private async _callRtmApi(method: string, params: Record<string, any>) {
  const url = this.buildUrl(method, params);
  const response = await fetch(url);
  // Common error handling, auth, etc.
  return this.parseResponse(response);
}

// Refactor all public methods to use it
async getTasks(params: GetTasksParams) {
  return this._callRtmApi('rtm.tasks.getList', params);
}
```

**Action 2**: Move business logic to service layer
```typescript
// Instead of this in request-handler.ts:
const lists = await rtmApi.getLists();
const tasks = await rtmApi.getTasks();
const timeline = // complex logic

// Do this:
const timeline = await rtmService.createTimeline(params);
```

### 🔵 P2: Medium - Type Safety & Organization

**Action 1**: Create domain boundaries
```bash
# Run these commands to create structure:
mkdir -p src/server src/mcp src/rtm src/shared
git mv src/index.ts src/server/index.ts
git mv src/rtm-api.ts src/rtm/api.ts
git mv src/types.ts src/shared/types.ts
```

**Action 2**: Add branded types for IDs
```typescript
// src/shared/branded-types.ts
type Brand<K, T> = K & { __brand: T };
export type FrobId = Brand<string, 'FrobId'>;
export type TimelineId = Brand<string, 'TimelineId'>;
export type TaskId = Brand<string, 'TaskId'>;
export type ListId = Brand<string, 'ListId'>;

// Helper functions
export const FrobId = (id: string): FrobId => id as FrobId;
export const TimelineId = (id: string): TimelineId => id as TimelineId;
```

**Action 3**: Replace long switch with command pattern
```typescript
// src/mcp/commands.ts
const commands: Record<string, CommandHandler> = {
  'timeline/create': handleTimelineCreation,
  'tasks/get': handleGetTasks,
  'task/add': handleAddTask,
  // etc.
};

// In processRequest:
const handler = commands[method];
if (!handler) throw new Error(`Unknown method: ${method}`);
return handler(params);
```

### ⚪ P3: Low - Cleanup

**Action**: Merge utils.ts into rtm/formatters.ts if RTM-specific, or delete if unused.

### 📋 Refactoring Checklist

Before starting each refactoring:
- [ ] MCP streaming is working in production
- [ ] Create integration test for current behavior
- [ ] Create feature branch
- [ ] Refactor one module at a time
- [ ] Run tests after each change
- [ ] Deploy to staging first

### 🎯 Success Metrics

- [ ] Each file has single, clear responsibility
- [ ] RTM API changes require edits to only `src/rtm/` directory
- [ ] Adding new MCP tools doesn't touch server code
- [ ] TypeScript catches ID type mismatches at compile time
- [ ] Can add Spektrix integration without modifying RTM code

### 📚 Architecture Decisions to Document

After refactoring, create ADRs for:
1. Domain boundary definitions (server vs MCP vs integrations)
2. ID type strategy (branded types vs classes)
3. Command pattern for MCP method routing
4. Service layer abstraction pattern for external APIs