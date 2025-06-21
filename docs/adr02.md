ADR-004: Language and SDK Choice
Status: Accepted
Date: 2025-06-21
Context
To build a compliant and maintainable Model Context Protocol (MCP) server, the project requires a language and a set of libraries that provide strong type safety, ensure protocol adherence, and reduce boilerplate code. The previous implementation involved manual JSON-RPC handling, which was identified as a source of potential errors and maintenance overhead.

Decision
The server will be implemented in TypeScript, leveraging its static typing capabilities to improve code quality. We will use the official @modelcontextprotocol/sdk package to handle all core MCP functionalities. This SDK provides pre-built handlers and types for the MCP, ensuring strict compliance with the protocol. For runtime validation of incoming data, we will use Zod, which is a dependency of the SDK and integrates seamlessly with TypeScript.

Consequences
Positive:
Enhanced Type Safety: Using TypeScript and Zod schemas catches errors during development and at runtime, leading to a more robust application.
Guaranteed Protocol Compliance: The official SDK manages the complexities of JSON-RPC 2.0 and the MCP specification, including method routing and error formatting.
Increased Developer Velocity: The SDK provides high-level abstractions for defining and handling tools, resources, and prompts, allowing developers to focus on application logic rather than protocol boilerplate.
Negative:
External Dependency: The project's core functionality is tied to the @modelcontextprotocol/sdk. Any bugs, breaking changes, or delays in the SDK's development could impact our project.
SDK-Specific Knowledge: Developers must learn the conventions and APIs of the SDK.
Alternatives Considered
Manual JSON-RPC Implementation: This was the previous approach and was explicitly rejected to improve maintainability and protocol compliance.
Alternative Languages (e.g., Go, Rust): While these are excellent languages for server development, the official TypeScript SDK provides the most direct path for integration with the Cloudflare Workers platform, which is JavaScript/TypeScript native.