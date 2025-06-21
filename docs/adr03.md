# ADR-004: Language and SDK Choice
**Status:** Accepted
**Date:** 2025-06-21

## Context
To build a compliant and maintainable Model Context Protocol (MCP) server, the project requires a language and a set of libraries that provide strong type safety, ensure protocol adherence, and reduce boilerplate code. The previous implementation involved manual JSON-RPC handling, which was identified as a source of potential errors and maintenance overhead.

## Decision
The server will be implemented in TypeScript, leveraging its static typing capabilities to improve code quality. We will use the official `@modelcontextprotocol/sdk` package to handle all core MCP functionalities.

### Implementation Guidance
* All MCP protocol logic (request routing, response formatting, error handling) **must** be handled by the `McpServer` class from the `@modelcontextprotocol/sdk`. Manual implementation of the JSON-RPC layer is prohibited.
* Tool definitions **must** use the `server.registerTool()` method. This ensures that tool annotations (like `title` and `description`) are structured correctly according to the MCP schema.
* Zod schemas should be used for runtime validation of all tool inputs.

## Consequences
* **Positive:** Enhanced Type Safety, Guaranteed Protocol Compliance, Increased Developer Velocity.
* **Negative:** External Dependency on the SDK, developers must learn the SDK's conventions.