## ADR-Client-Web-First.md

```markdown
# ADR-Client-Web-First: Claude.ai as Primary Target

**Status:** Accepted  
**Date:** 2025-01-07

## Context

Multiple potential MCP clients exist:
- Claude.ai (web)
- Claude Desktop
- Cursor, Windsurf, other IDEs
- Future AI clients

We need to prioritize our development and testing efforts for maximum impact.

## Decision

**Claude.ai web interface is the primary and only supported client**.

### What This Means

1. **All features target Claude.ai integration**
2. **No desktop-specific accommodations**
3. **Testing only against Claude.ai**
4. **Documentation assumes web flow**

### Explicitly Not Supporting

- Claude Desktop configuration files
- Local MCP server instructions  
- IDE-specific integrations
- Stdio transport (web requires HTTP)

## Rationale

1. **Simplicity**: One target = less complexity
2. **User Journey**: Web provides complete auth flow
3. **Adoption**: Easiest path for non-technical users
4. **OAuth2 Native**: Web handles redirects naturally

## Implementation Guidelines

### URL Structure
https://[your-domain]/authorize  # OAuth entry
https://[your-domain]/sse        # MCP endpoint

### Authentication Flow
- Optimized for browser redirects
- Cookie-based session management
- No manual token copying

### Error Messages
```typescript
// Good: Web-friendly
return c.html(`<div>Authentication failed. <a href="/authorize">Try again</a></div>`);

// Bad: Desktop-oriented  
return c.json({ error: 'Set AUTH_TOKEN environment variable' });
Documentation
Focus exclusively on:

Adding integration URL to Claude.ai
Clicking through OAuth flow
Using tools in chat

No mentions of:

config.json files
Local installation
Command-line setup

Future Considerations
If/when we support other clients:

Add separate endpoints/flows
Maintain web-first experience
Never compromise web UX for desktop

Success Metrics

Zero support requests about desktop setup
90%+ successful auth completions
No user-facing references to unsupported clients

Testing Checklist
All features must work in:

 Chrome/Chromium
 Safari
 Firefox
 Mobile browsers (responsive)

Never test in:

Claude Desktop
Local development setups
IDE integrations