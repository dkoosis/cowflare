# ADR-Platform-Dependencies: Dependency Management Strategy

**Status:** Accepted  
**Date:** 2025-01-07  
**Review:** 2025-07-07

## Context

JavaScript ecosystem has notorious issues with:
- Supply chain vulnerabilities
- Abandoned packages
- Dependency sprawl (hundreds of transitive deps)
- Breaking changes in minor versions

For a 3-5 year solo-maintained project, we need strict dependency discipline.

## Decision

**Minimal dependencies with strict acceptance criteria**.

### Approved Core Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.x",     // Official MCP protocol
    "agents": "latest",                       // Durable Object framework
    "hono": "^4.x",                          // Lightweight router
    "zod": "^3.x",                           // Runtime validation
    "nanoid": "^5.x"                         // ID generation
  }
}
Acceptance Criteria for New Dependencies
Must meet ALL criteria:

Actively maintained: Updated within last 6 months
Minimal footprint: <10 transitive dependencies
TypeScript-first: Written in TS, not just typed
Single purpose: Does one thing well
Stable API: 1.0+ or proven track record
License compatible: MIT, Apache 2.0, or similar

Explicitly Rejected
These common dependencies are FORBIDDEN:

lodash - Use native JS methods
moment/dayjs - Use native Date + Intl
axios - Use native fetch
express - Too heavy, use Hono
joi - Use zod (better TS integration)
Build tools beyond what Cloudflare provides

Implementation
Dependency Audit Process
bash# Before adding any dependency
npm view [package] dependencies  # Check transitive deps
npm view [package] time          # Check update frequency
Quarterly Review
Every 3 months:

Run npm audit
Check each dependency's last update
Look for lighter alternatives
Remove unused dependencies

Enforcement
json// package.json
"scripts": {
  "deps:check": "npm list --depth=0",
  "deps:audit": "npm audit --audit-level=moderate",
  "preinstall": "node scripts/check-dependencies.js"
}
Rationale

Reliability: Fewer deps = fewer breaking changes
Security: Smaller attack surface
Maintainability: Easier to understand what code does
Performance: Smaller bundles, faster cold starts

Trade-offs
What We Give Up

Quick solutions via utility libraries
Some developer conveniences
Ecosystem compatibility

What We Gain

Predictable behavior over 3-5 years
Easier debugging (less black box code)
Better performance
Reduced security vulnerabilities

Migration Rules
When Platform/Framework dependencies need updates:

Cloudflare Workers types: Update quarterly
MCP SDK: Update when protocol changes
Others: Update only for security fixes or required features

Never update all dependencies at once. Update one, test thoroughly, then proceed.