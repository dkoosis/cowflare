ADR 007: MCP Transport Protocol Selection
You are right to want to formalize this decision. Here is a new ADR to address the transport protocol choice.

Status: Accepted

Context:
The Model Context Protocol (MCP) supports multiple transport layers. While the current implementation is built entirely around Server-Sent Events (SSE), it has been noted that newer documentation for the underlying framework may now favor HTML Streaming. To eliminate ambiguity and prevent future rework, a definitive decision on the transport protocol for this project must be made and documented.

Decision:
This project will standardize on Server-Sent Events (SSE) as the exclusive transport protocol for all MCP communication.

Justification and Consequences:

Existing Implementation: The entire existing codebase, including the server entrypoint, routing, and the McpAgent implementation, is built for and tested with SSE. The primary interaction endpoint is /sse.

Framework Support: The agents package provides clear, out-of-the-box support for the SSE transport via its mount() helper function, which is core to our current architecture.

Path of Least Resistance: Committing to SSE allows development to proceed without a significant refactoring effort. Changing the transport layer at this stage would introduce unnecessary delay and complexity.

Future Consideration: While we are standardizing on SSE for the foreseeable future, this decision can be revisited if a migration to HTML Streaming is later found to offer compelling and necessary advantages for the project's requirements. For now, all development must target the SSE transport.