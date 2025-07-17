# ADR-Platform-TypeScript: Language and SDK Choice

**Status:** Accepted  
**Date:** 2025-01-07  
**Review:** 2025-07-07

## Context

Need a language that balances developer productivity with long-term maintainability for a 3-5 year project lifecycle. Must work well with Cloudflare Workers and MCP SDK.

## Decision

**TypeScript** with maximum strictness settings and official **@modelcontextprotocol/sdk**.

### Core Configuration
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "target": "ES2022",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"]
  }
}
Approved Dependencies

@modelcontextprotocol/sdk - Official MCP implementation
agents - Durable Object framework
hono - Lightweight router
zod - Runtime validation
nanoid - ID generation

Rationale

Type Safety: Catches errors at build time, crucial for solo maintenance
MCP SDK: Official SDK ensures protocol compliance
Ecosystem: TypeScript-first packages reduce runtime surprises
Cloudflare Native: First-class Workers support

Consequences
Positive

IDE support makes refactoring safe
Types serve as inline documentation
Official SDK handles protocol complexity

Negative

Build step required
JavaScript ecosystem quality varies
Types can't catch all runtime errors

Mitigation

Strict dependency criteria (see ADR-Platform-Dependencies)
Result<T> pattern for explicit error handling
Comprehensive validation at boundaries