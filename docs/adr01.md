# ADR-001: Platform and Deployment Strategy
**Status:** Accepted
**Date:** 2025-06-21

## Context
The Cowflare project requires a runtime environment for a remote MCP server that is scalable, performant with low global latency, and easy to manage and deploy. The server needs to execute TypeScript code and integrate with a persistent data store for managing authentication state.

## Decision
We will use Cloudflare Workers as the runtime platform for the MCP server. This decision leverages a serverless architecture, running code on Cloudflare's edge network. The entire development and deployment lifecycle will be managed using the Wrangler CLI, as configured in the project's `package.json` and `wrangler.toml` files.

### Implementation Guidance
* All server code must be written to target the Cloudflare Workers runtime environment.
* The `wrangler.toml` file is the single source of truth for deployment configurations.
* All deployments and local development sessions must be managed through the Wrangler CLI commands (e.g., `wrangler dev`, `wrangler deploy`).

## Consequences
* **Positive:** Global Scalability & Low Latency, Zero-Maintenance Infrastructure, Integrated Toolchain, Native Integration with other Cloudflare services.
* **Negative:** Platform-Specific Code, potential for local simulation to differ from the production environment.