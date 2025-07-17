## ADR-Auth-RTM-Desktop-Flow.md

```markdown
# ADR-Auth-RTM-Desktop-Flow: RTM Authentication Implementation

**Status:** Accepted  
**Date:** 2025-01-07  
**Supersedes:** ADR-OAuth2-Adapter concepts

## Context

Remember The Milk only supports desktop authentication flow (no callbacks) but Claude.ai requires OAuth2. Need a bridge that works within single-domain constraint.

## Decision

Implement **user-guided waiting page** that bridges RTM desktop flow with OAuth2.

### Flow
1. OAuth2 `/authorize` returns waiting page (not redirect)
2. User opens RTM auth in new tab
3. User manually continues via button
4. Server exchanges frob for token
5. OAuth2 redirect with code

### Storage Strategy
- **Cookies**: Temporary OAuth session (10 min TTL)
- **KV**: Long-term auth tokens (permanent)

## Rationale

1. **Works Today**: Accepts RTM's limitations
2. **User-Friendly**: Clear two-step instructions  
3. **Secure**: HttpOnly cookies, encrypted tokens
4. **Simple**: No polling or complex state

## Security Notes

- MD5 signing matches RTM's security level
- Tokens stored encrypted in KV
- Session cookies marked Secure, HttpOnly, SameSite=Lax

## Future Consideration

When adding Spektrix (true OAuth2), this pattern becomes RTM-specific while Spektrix uses standard flow.