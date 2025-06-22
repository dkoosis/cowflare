ADR 006: Core Technology and Pattern Stack for RTM MCP Server
Status: Accepted

Context:
Development sessions frequently involve revisiting and questioning the project's foundational components, including the choice of libraries, platforms, and architectural patterns. This ambiguity consumes valuable time and creates uncertainty. To improve efficiency and provide a clear path forward, we need to formally document the core technology stack and the established patterns for this project.

Decision:
We will officially adopt and standardize on the following technology stack and patterns for the Remember The Milk (RTM) MCP Server. This stack represents the authoritative choice for all ongoing and future development of this service.

Runtime Environment: The service is built on and deployed to Cloudflare Workers.

Stateful Connections: All stateful MCP connections and user-specific contexts are managed by Cloudflare Durable Objects.

Web Framework: Hono is the chosen web framework for routing and handling incoming HTTP requests to the worker.

Agent & Durable Object Abstraction: The agents package is the primary framework for building our Durable Object. The RtmMCP class extends the McpAgent class from this package (import { McpAgent } from "agents/mcp"). This framework provides helpers like .mount() to abstract away DO lifecycle boilerplate.

Module Export Pattern: We will use a hybrid export pattern in src/index.ts:

A named export of the Durable Object class (export class RtmMCP...) for wrangler to bind to.
A default export of the Hono app instance, which serves as the main HTTP entry point.
RTM API Authentication: The server authenticates with the RTM API using the official "frob-based" desktop authentication flow. This involves signing all API requests with an MD5 hash derived from a shared secret.

Client Authentication: MCP clients (like Claude Desktop) must authenticate with our server by providing a Bearer Token in the Authorization header. This token is the auth_token obtained from the RTM web authentication flow.

Schema Definition & Validation: Zod is the designated library for defining and validating the schemas for all MCP tool inputs.

Node.js API Compatibility: To support RTM's MD5 signing requirement, the project relies on the Node.js crypto module. This is enabled via the nodejs_compat compatibility flag in wrangler.toml.

Consequences:

Clarity: This provides a single source of truth for the project's architecture, reducing cognitive load and eliminating recurring debates.
Consistency: Future development will follow these established patterns, ensuring the codebase remains coherent.
Onboarding: New contributors can refer to this document to quickly understand the core components and design philosophy.
Learning Curve: This stack combines several advanced concepts (Durable Objects, Hono, the agents abstraction, a bespoke auth flow). Team members must be familiar with how these components interact.