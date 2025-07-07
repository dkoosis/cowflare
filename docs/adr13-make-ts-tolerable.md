# ADR-002: TypeScript Development Best Practices for MCP Servers

## Status
**Accepted**

## Context

Having selected TypeScript + Cloudflare Workers for MCP server development (ADR-001), we need to establish practices that maintain the code quality, reliability, and developer experience we've come to expect from Go projects. 

### Primary Concerns
- **Dependency Hell**: JavaScript ecosystem's notorious supply chain and quality issues
- **Runtime Safety**: Losing Go's compile-time guarantees and explicit error handling
- **Tooling Quality**: Maintaining productivity without Go's excellent standard library and tooling
- **Long-term Maintainability**: Ensuring code remains manageable as a solo developer

### Success Criteria
- Code quality comparable to our Go projects
- Minimal dependency surface area
- Predictable, debuggable runtime behavior
- Sustainable development velocity over months/years

## Decision

**Implement a "Go-Inspired TypeScript" development methodology** emphasizing explicit error handling, minimal dependencies, and strict type safety.

## Core Principles

### 1. Dependency Minimalism
**Rule: Prefer zero dependencies, justify every addition**

```typescript
// ❌ DON'T: Kitchen sink libraries
import _ from 'lodash'
import moment from 'moment'
import axios from 'axios'

// ✅ DO: Built-in APIs and targeted utilities
const groupBy = <T>(arr: T[], key: keyof T) => 
  arr.reduce((groups, item) => {
    const group = String(item[key])
    return { ...groups, [group]: [...(groups[group] || []), item] }
  }, {} as Record<string, T[]>)

// Built-in fetch, Date, and Web APIs
```

**Dependency Acceptance Criteria:**
- Zero transitive dependencies preferred
- <10 total dependencies across entire project
- Active maintenance within last 6 months
- TypeScript-first design
- Single, focused purpose

### 2. Go-Style Error Handling
**Rule: Make errors explicit and recoverable**

```typescript
// Define Result type for explicit error handling
type Result<T, E = Error> = 
  | { ok: true; data: T }
  | { ok: false; error: E }

// All fallible operations return Results
async function fetchTickets(venueId: string): Promise<Result<Ticket[]>> {
  try {
    const response = await fetch(`/api/venues/${venueId}/tickets`)
    
    if (!response.ok) {
      return { 
        ok: false, 
        error: new Error(`API error: ${response.status} ${response.statusText}`) 
      }
    }
    
    const data = await response.json()
    const validation = TicketSchema.safeParse(data)
    
    if (!validation.success) {
      return { 
        ok: false, 
        error: new Error(`Invalid ticket data: ${validation.error.message}`) 
      }
    }
    
    return { ok: true, data: validation.data }
  } catch (error) {
    return { 
      ok: false, 
      error: error instanceof Error ? error : new Error(String(error))
    }
  }
}

// Usage (feels like Go!)
const result = await fetchTickets(venueId)
if (!result.ok) {
  console.error('Failed to fetch tickets:', result.error.message)
  return { error: 'Unable to load tickets' }
}

// TypeScript knows result.data exists here
const tickets = result.data
```

### 3. Strict Type Safety
**Rule: Make illegal states unrepresentable**

```typescript
// tsconfig.json - Maximum strictness
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "allowUnusedLabels": false,
    "allowUnreachableCode": false
  }
}

// Use discriminated unions instead of optional fields
type UserState = 
  | { status: 'anonymous' }
  | { status: 'authenticated'; userId: string; email: string }
  | { status: 'expired'; refreshToken: string }

// Branded types for domain safety
type VenueId = string & { readonly __brand: 'VenueId' }
type TicketId = string & { readonly __brand: 'TicketId' }

function createVenueId(id: string): VenueId {
  // Validation logic here
  return id as VenueId
}
```

### 4. Approved Dependencies List
**Rule: Use only pre-approved, high-quality packages**

```typescript
// APPROVED: Core validation and safety
import { z } from 'zod'              // Runtime validation
import { nanoid } from 'nanoid'      // ID generation

// APPROVED: Cloudflare-specific
import type { 
  ExportedHandler, 
  DurableObjectNamespace 
} from '@cloudflare/workers-types'

// FORBIDDEN: Everything else unless explicitly justified
// - No lodash, moment, axios, express, etc.
// - No packages with >5 dependencies
// - No packages last updated >6 months ago
```

### 5. Go-Inspired Project Structure
**Rule: Organize code like a Go project**

```
src/
├── handlers/          # HTTP handlers (like Go net/http)
│   ├── auth.ts
│   ├── tickets.ts
│   └── venues.ts
├── types/             # Type definitions (like Go structs)
│   ├── mcp.ts
│   ├── tickets.ts
│   └── users.ts
├── services/          # Business logic (like Go services)
│   ├── ticketing.ts
│   └── auth.ts
├── utils/             # Pure utilities (like Go packages)
│   ├── validation.ts
│   ├── crypto.ts
│   └── errors.ts
├── objects/           # Durable Objects
│   ├── user-session.ts
│   └── venue-cache.ts
└── index.ts           # Main entry point
```

## Quality Gates

### Pre-Commit Requirements
```bash
#!/bin/bash
# .githooks/pre-commit

# TypeScript strict checking
npx tsc --noEmit || exit 1

# No any types allowed
if grep -r "any" src/ --include="*.ts" --exclude="*.d.ts"; then
  echo "❌ 'any' types are forbidden"
  exit 1
fi

# Dependency audit
npm audit --audit-level=moderate || exit 1

# Bundle size check
npx wrangler deploy --dry-run | grep "Size:" | awk '{if($2 > 100) exit 1}'
```

### Code Review Checklist
- [ ] All functions return `Result<T>` for fallible operations
- [ ] No `any` types (use `unknown` if necessary)
- [ ] All external data validated with schemas
- [ ] Error cases explicitly handled
- [ ] No new dependencies without justification
- [ ] All state changes go through Durable Objects

## Development Tooling Setup

### VS Code Configuration
```json
// .vscode/settings.json
{
  "typescript.preferences.strictFunctionTypes": true,
  "typescript.preferences.strictNullChecks": true,
  "editor.codeActionsOnSave": {
    "source.fixAll": true,
    "source.organizeImports": true
  },
  "typescript.preferences.includePackageJsonAutoImports": "off"
}
```

### Debugging Setup
```typescript
// Enhanced logging for production debugging
interface LogContext {
  requestId: string
  userId?: string
  operation: string
  timestamp: number
}

function createLogger(context: LogContext) {
  return {
    info: (message: string, data?: unknown) => 
      console.log(JSON.stringify({ level: 'info', ...context, message, data })),
    
    error: (message: string, error: Error, data?: unknown) => 
      console.error(JSON.stringify({ 
        level: 'error', 
        ...context, 
        message, 
        error: error.message, 
        stack: error.stack,
        data 
      })),
    
    warn: (message: string, data?: unknown) => 
      console.warn(JSON.stringify({ level: 'warn', ...context, message, data }))
  }
}
```

### Testing Strategy
```typescript
// Minimal testing with native APIs
// test/tickets.test.ts
import { assertEquals } from 'https://deno.land/std/testing/asserts.ts'

Deno.test('ticket validation', () => {
  const result = validateTicket({ id: '123', price: 50 })
  assertEquals(result.ok, true)
})

// Integration tests using Workers test runner
// wrangler.toml
[env.test]
compatibility_date = "2023-10-30"
```

## Operational Practices

### Deployment Pipeline
```yaml
# .github/workflows/deploy.yml
name: Deploy MCP Server
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      # Quality gates
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm audit --audit-level=moderate
      
      # Deploy
      - run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

### Monitoring & Alerting
```typescript
// Built-in Workers Analytics + custom metrics
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const start = Date.now()
    
    try {
      const response = await handleRequest(request, env)
      
      // Success metrics
      env.ANALYTICS.writeDataPoint({
        blobs: ['success', request.url],
        doubles: [Date.now() - start],
        indexes: [request.cf?.colo || 'unknown']
      })
      
      return response
    } catch (error) {
      // Error metrics
      env.ANALYTICS.writeDataPoint({
        blobs: ['error', error.message],
        doubles: [Date.now() - start],
        indexes: [request.cf?.colo || 'unknown']
      })
      
      throw error
    }
  }
}
```

## Migration Path

### Phase 1: Foundation (Week 1)
- [ ] Set up strict TypeScript configuration
- [ ] Implement Result<T> error handling patterns
- [ ] Create basic project structure
- [ ] Set up quality gates and pre-commit hooks

### Phase 2: Core Libraries (Week 2)
- [ ] Build validation utilities using zod
- [ ] Implement logging and error reporting
- [ ] Create Durable Object base classes
- [ ] Set up testing framework

### Phase 3: Production Ready (Week 3)
- [ ] Complete monitoring and alerting setup
- [ ] Deploy staging environment
- [ ] Document debugging procedures
- [ ] Create incident response playbook

## Success Metrics

### Code Quality
- Zero `any` types in production code
- <5 total npm dependencies
- 100% TypeScript strict mode compliance
- <100KB bundle size

### Developer Experience
- <5 second local reload times
- <30 second deployment times
- Zero "dependency hell" incidents
- 90%+ test coverage on critical paths

### Operational Excellence
- <1% error rate in production
- <50ms P95 response times
- Zero security vulnerabilities
- <1 hour mean time to resolution

---

**Date**: 2025-07-07  
**Decision Owner**: [Your Name]  
**Next Review**: 2025-10-07  
**Dependencies**: ADR-001 (Technology Stack)  
**Status**: Implementation In Progress