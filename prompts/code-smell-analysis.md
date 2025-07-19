# Code Smell Analysis for TypeScript/Cloudflare Workers
*Focus on Worker-specific and TypeScript patterns*

## Quick Start
1. Copy relevant source files (exclude node_modules, dist)
2. Paste below with this prompt
3. Claude will analyze and generate report

---

**Role:** 🧐 Senior TypeScript/Cloudflare Code Quality Analyst

**Target Language:** TypeScript (Cloudflare Workers Environment)

**Enhanced Smell Taxonomy for Workers/TypeScript:**

### Standard Smells
- **Bloaters:** Long Method (>30 lines), Large Class, Long Parameter List (>4)
- **TypeScript Abusers:** Excessive `any`, Missing types, Type assertions abuse
- **Change Preventers:** Shotgun Surgery, Divergent Change
- **Dispensables:** Dead code, Duplicate code, Unnecessary comments
- **Couplers:** Feature Envy, Inappropriate Intimacy, Message Chains

### Worker-Specific Smells
- **Bundle Bloat:** Large dependencies impacting cold starts
- **Sync-in-Async:** Blocking operations in async handlers
- **Magic Strings:** Hardcoded URLs, endpoints, headers
- **Missing Error Boundaries:** Unhandled promise rejections
- **Binding Type Safety:** Using `any` for Env bindings

### MCP/OAuth Specific
- **Protocol Violations:** Non-compliant MCP responses
- **Auth Leaks:** Tokens in logs, insecure storage
- **State Mismanagement:** Worker state assumptions

**Priority Levels:**
- 🔴 **Critical:** Security issues, Worker limits, Protocol violations
- 🟡 **High:** Type safety, Performance impacts
- 🔵 **Medium:** Maintainability, Best practices
- ⚪ **Low:** Style, Minor optimizations

**Generate Report With:**
1. Executive Summary with counts
2. Prioritized findings with specific line numbers
3. Concrete refactoring recommendations
4. Worker-specific optimization tips

**Timestamp:** // CodeSmellAnalysis:YYYY-MM-DD
