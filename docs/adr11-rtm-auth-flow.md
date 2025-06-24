# ADR-011: RTM Authentication Flow - Desktop Implementation

**Status:** Accepted  
**Date:** 2025-06-23  
**Supersedes:** ADR-010 sequence diagram

## Context

RTM's documentation claims support for web application callbacks, but 20+ years of RTM code repositories show no evidence of callback URL configuration. Testing confirms RTM only supports the desktop authentication flow where users manually return to the application after authorization.

Claude.ai requires standard OAuth2 flow with automatic redirects. We must bridge this gap while constrained to a single domain.

## Decision

Implement RTM's desktop authentication flow with a user-guided waiting page that maintains OAuth2 compatibility for Claude.ai.

### The Implementation

1. **OAuth2 Client → /authorize**: Returns HTML waiting page (not a redirect)
2. **User Action**: Opens RTM auth in new tab, authorizes, returns to waiting page
3. **User → /complete-auth**: Manually clicks continue button
4. **Server → OAuth2 Client**: Exchanges frob for token, redirects with code
5. **OAuth2 Client → /token**: Standard token exchange

### Technical Details

- Session state stored in secure HttpOnly cookies (not KV)
- 10-minute session timeout
- Clear two-step UI with numbered instructions
- Error handling returns user to start

## Constraints

1. **RTM Limitation**: No callback URL support despite documentation
2. **Claude.ai Requirement**: Single OAuth2 endpoint URL
3. **Browser Security**: No popups or cross-origin messaging

## Consequences

### Positive
- Works with actual RTM behavior
- Maintains OAuth2 interface for Claude.ai
- Clear user instructions minimize confusion
- Reliable cookie-based sessions

### Negative
- Manua