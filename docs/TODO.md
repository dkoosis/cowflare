# TODO.md - Human Priorities & Narrative

## Current Focus: Starting Fresh with Mock OAuth

We're building Project Cowflare from the ground up, starting with a proven remote MCP server template that includes OAuth structure. This gives us a clear path to integrate Cloudflare RTM later.

## Immediate Tasks

### 1. Project Setup (NOW)
- [x] Create initial documentation structure
- [ ] Initialize project with remote MCP template
- [ ] Replace GitHub OAuth with mock authentication
- [ ] Verify local development workflow

### 2. Mock OAuth Implementation
- [ ] Create MockAuthHandler to replace GitHubHandler
- [ ] Implement simple user/token system for testing
- [ ] Add session persistence (memory-based initially)
- [ ] Test full OAuth flow with MCP inspector

### 3. RTM Integration Points
- [ ] Identify where RTM will plug into OAuth flow
- [ ] Document required RTM endpoints
- [ ] Plan migration from mock to RTM auth

### 4. Basic MCP Tools
- [ ] Create simple test tool (add numbers)
- [ ] Add tool with authentication context
- [ ] Test with multiple MCP clients

## Future Considerations

- **Transport Evolution**: Supporting both SSE and Streamable HTTP from day one
- **State Management**: McpAgent provides Durable Object backing
- **Permission System**: OAuth scopes → RTM permissions mapping
- **Testing Strategy**: MCP inspector for quick iteration

## Why This Approach?

Starting with `remote-mcp-server` gives us:
1. Working OAuth structure we can modify
2. Proven MCP client compatibility
3. Clear testing path with inspector
4. Easy transition to RTM when ready

## Notes

- Mock auth should mirror RTM's expected behavior
- Keep authentication separate from MCP logic
- Document all RTM assumptions as we go
- **DISCOVERY**: Found existing `rtm-mcp-server` and `rtm-auth-page` workers in the Cloudflare account - these may contain RTM integration patterns to reference