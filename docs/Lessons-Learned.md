# MCP Implementation Debugging: Lessons Learned

## Key Insights

### 1. Protocol Specifications Are Contracts
- The MCP spec isn't just documentation - it's a contract that MUST be followed
- Missing required endpoints causes silent failures
- "MUST" in specs means MUST, not "nice to have"

### 2. OAuth + MCP = Two-Phase Discovery
The connection flow has two distinct phases:
1. **OAuth Phase**: Get authorization and token
2. **MCP Discovery Phase**: Find and connect to MCP server

Many implementations fail because they assume OAuth completion = MCP connection.

### 3. Debug Logs Are Execution Traces
- Treat logs as formal protocol traces
- Can be validated like compiled programs
- Missing events are as important as present ones
- Silence after a step often indicates the exact failure point

### 4. Essential Debug Features

#### Chronological Views
- Logs must be in time order to understand flow
- Human-readable timestamps are crucial
- Session grouping helps isolate attempts

#### Protocol Validation
- Automated checking against expected sequences
- Immediate feedback on compliance
- Diagnostic messages guide fixes

#### Export Functionality
- Structured exports for sharing
- Include validation results
- Highlight what's missing

### 5. Common MCP Pitfalls

#### Missing Discovery Endpoints
- `/.well-known/oauth-protected-resource` is REQUIRED
- Without it, clients can't find your MCP server
- Even if OAuth works perfectly

#### Incorrect WWW-Authenticate Headers
- Must include `resource_metadata` parameter
- Must point to valid discovery endpoint
- Format must be exact

#### Silent Client Failures
- Clients often fail without error messages
- No requests = client doesn't know what to do
- Check browser console for client-side errors

### 6. Testing Strategy

#### Incremental Validation
1. Test OAuth flow independently
2. Test discovery endpoints with curl
3. Test full flow with client
4. Use protocol validator at each step

#### Compliance Testing
- Automated tests for all endpoints
- Verify response formats
- Check header requirements
- Test error cases

### 7. The Power of Formal Validation
- Protocol traces can be validated like code
- State machines can check sequence correctness
- Temporal logic can verify ordering constraints
- "Compilation" of logs provides immediate feedback

## Debugging Methodology

### 1. Capture Everything
```typescript
// Log all requests with context
async log(event: string, data: Record<string, any>)
```

### 2. Validate Continuously
```typescript
// Check protocol compliance
const validation = validator.validate(events);
if (!validation.passed) {
  console.log(validation.diagnosis);
}
```

### 3. Export for Analysis
```typescript
// Structured export with validation
exportLogs() {
  return {
    validation: protocolValidator.validate(events),
    events: chronologicalEvents,
    missing: expectedButNotFound
  };
}
```

### 4. Compare Against Spec
- Every client request should match spec
- Every server response should be compliant
- Missing requests indicate spec violations

## Tools We Built

### 1. Debug Dashboard
- Chronological event viewer
- Session grouping
- Protocol validation
- Export functionality

### 2. Protocol Validator
- Rule-based validation
- Diagnostic messages
- Compliance scoring
- Missing step detection

### 3. Compliance Tester
- Endpoint verification
- Response format checking
- Header validation
- CORS testing

## Future Improvements

### 1. Automated Fix Suggestions
Based on validation failures, suggest specific code changes

### 2. Diff Against Working Implementation
Compare traces with known-good implementations

### 3. Client-Side Monitoring
Inject monitoring into client to see both sides

### 4. Specification Test Generator
Generate test cases directly from spec

## Conclusion

Debugging MCP implementations requires:
1. **Rigorous spec compliance** - Follow every MUST
2. **Comprehensive logging** - Capture full protocol traces  
3. **Formal validation** - Treat logs as executable traces
4. **Systematic testing** - Validate each phase independently

The combination of good logging, protocol validation, and spec compliance testing transforms debugging from guesswork into a systematic engineering process.