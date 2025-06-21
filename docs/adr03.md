ADR-005: Secret Management Strategy
Status: Accepted
Date: 2025-06-21
Context
The Cowflare server requires access to sensitive credentials to function, including an RTM_API_KEY and RTM_SHARED_SECRET for the Remember The Milk API. These secrets must be stored securely and made available to the Worker at runtime without being committed to the source code repository or exposed to the client.

Decision
We will use Cloudflare Worker Secrets as the primary mechanism for storing and accessing sensitive application credentials. All long-lived secrets will be managed via the wrangler secret command-line interface. These secrets are encrypted by Cloudflare and securely injected into the Worker's environment, where they can be accessed from the env object (e.g., env.RTM_API_KEY).

For short-lived, user-specific data such as authentication session tokens, we will use Cloudflare KV with a defined Time-To-Live (TTL) to ensure the data is automatically purged after a set period, enhancing user data security.

Consequences
Positive:
High Security: This approach follows Cloudflare's security best practices. Secrets are encrypted at rest and in transit and are not exposed in build artifacts or source code.
Simplified Management: The Wrangler CLI offers a straightforward interface for adding, listing, and removing secrets.
Environment-Specific Configuration: Secrets are managed per environment, allowing for different keys in development and production.
Secure Session Handling: Using KV with TTL for user tokens ensures that session data is ephemeral and automatically cleaned up.
Negative:
Local Development Workflow: Worker secrets are not automatically available during local development. They must be managed separately in a .dev.vars file, which needs to be excluded from version control to prevent accidental exposure.
Platform Dependency: This secret management strategy is specific to the Cloudflare Workers platform.
Alternatives Considered
Storing secrets in wrangler.toml: Rejected as this would store secrets in plaintext within the repository, which is a major security risk.
Using a third-party secrets manager: While services like HashiCorp Vault or AWS Secrets Manager are powerful, they would add unnecessary complexity and an external network dependency to the project, whereas Cloudflare provides a secure, native solution.