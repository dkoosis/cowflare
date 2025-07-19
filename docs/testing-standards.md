# MCP Server Testing Standards v1.0
_Claude-optimized enforcement rules for TypeScript MCP server development_

## ENFORCEMENT_MODE: ACTIVE_DEVELOPMENT

### RULE_SET_1: TEST_NAMING
```
PATTERN: Test[Component]_[ExpectedBehaviour]_When_[StateUnderTest]
ENFORCE: ALL test functions MUST follow this pattern
EXAMPLES:
  ✓ MockAuthHandler_ReturnsAuthorizationCode_When_UserConsents
  ✓ CowflareMCP_ReturnsSum_When_AddToolCalledWithValidNumbers
  ✗ testAuthSuccess() // REJECT: Missing pattern
  ✗ should_work_correctly() // REJECT: Wrong format
```

### RULE_SET_2: SCHEMA_VALIDATION
```
REQUIREMENT: ALL MCP protocol messages MUST be validated BEFORE business logic
IMPLEMENTATION:
  1. Define Zod schemas for EVERY MCP method
  2. Validate at transport boundary
  3. Map validation errors to JSON-RPC codes:
     - Invalid JSON syntax → -32700 (Parse Error)
     - Missing jsonrpc/method → -32600 (Invalid Request)  
     - Invalid params → -32602 (Invalid Params)
     - Unknown method → -32601 (Method Not Found)

ENFORCE: No raw JSON parsing without schema validation
ENFORCE: No business logic before validation passes
```

### RULE_SET_3: ERROR_HANDLING
```
CRITICAL_DISTINCTION:
  - Tool execution errors → Return in CallToolResult with isError: true
  - All other errors → JSON-RPC error response

ERROR_TYPES:
  1. Transport errors → -32700 or -32600
  2. Validation errors → -32602
  3. Internal errors → -32603
  4. Tool errors → { content: [{type: 'text', text: 'Error: ...'}], isError: true }

ENFORCE: NEVER throw tool errors as JSON-RPC errors
ENFORCE: ALWAYS include context in error objects
ENFORCE: NEVER expose sensitive data in error messages
```

### VALIDATION_CHECKLIST
When reviewing code, Claude MUST verify:
- [ ] Test names follow exact pattern
- [ ] Zod schema exists for method being tested
- [ ] Validation occurs before business logic
- [ ] Tool errors use CallToolResult format
- [ ] Error codes match JSON-RPC spec
- [ ] No raw JSON.parse without schema

### CODE_GENERATION_RULES
When writing new code:
1. FIRST: Define Zod schema for any new MCP method
2. THEN: Write validation middleware using schema
3. THEN: Write handler assuming validated input
4. FINALLY: Write tests following naming pattern

### REJECTION_CRITERIA
Claude MUST refuse to approve code that:
- Uses incorrect test naming
- Skips schema validation
- Throws tool errors as JSON-RPC errors
- Exposes stack traces to clients
- Parses JSON without validation