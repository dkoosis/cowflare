import { Hono } from "hono";
import { cors } from "hono/cors";
import { getStytchOAuthEndpointUrl, stytchBearerTokenAuthMiddleware } from "./lib/auth";
import { TodoAPI } from "./TodoAPI.ts";
import { TodoMCP } from "./TodoMCP.ts";

// Export the TodoMCP class so the Worker runtime can find it
export { TodoMCP };

export default new Hono<{ Bindings: Env }>()
	.use(cors())

	// Mount the TODO API underneath us
	.route("/api", TodoAPI)

	// Serve the OAuth Authorization Server response for Dynamic Client Registration
	.get("/.well-known/oauth-authorization-server", async (c) => {
		const url = new URL(c.req.url);
		return c.json({
			// Link to the OAuth Authorization screen implemented within the React UI
			authorization_endpoint: `${url.origin}/oauth/authorize`,
			code_challenge_methods_supported: ["S256"],
			grant_types_supported: ["authorization_code", "refresh_token"],
			issuer: c.env.STYTCH_PROJECT_ID,
			registration_endpoint: getStytchOAuthEndpointUrl(c.env, "oauth2/register"),
			response_modes_supported: ["query"],
			response_types_supported: ["code"],
			scopes_supported: ["openid", "profile", "email", "offline_access"],
			token_endpoint: getStytchOAuthEndpointUrl(c.env, "oauth2/token"),
			token_endpoint_auth_methods_supported: ["none"],
		});
	})

	// Let the MCP Server have a go at handling the request
	.use("/sse/*", stytchBearerTokenAuthMiddleware)
	.route("/sse", new Hono().mount("/", TodoMCP.mount("/sse").fetch))

	// Finally - serve static assets from Vite
	.mount("/", (req, env) => env.ASSETS.fetch(req));
