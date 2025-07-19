import { describe, test, expect, beforeAll } from "vitest";
import { z } from "zod";
import app from "../src/app";
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

// Schema validation following testing standards
const OAuthAuthRequestSchema = z.object({
	client_id: z.string(),
	redirect_uri: z.string().url(),
	response_type: z.string(),
	scope: z.string().optional(),
	state: z.string().optional(),
});

describe("OAuth Authorization Flow", () => {
	const mockOAuthProvider: OAuthHelpers = {
		parseAuthRequest: async (request: Request) => {
			const url = new URL(request.url);
			const params = Object.fromEntries(url.searchParams);
			
			// Validate request parameters
			const validated = OAuthAuthRequestSchema.parse({
				client_id: params.client_id || "test-client",
				redirect_uri: params.redirect_uri || "http://localhost:3000/callback",
				response_type: params.response_type || "code",
				scope: params.scope,
				state: params.state,
			});

			return validated as any;
		},
		completeAuthorization: async (options: any) => {
			return {
				redirectTo: `${options.request.redirect_uri}?code=test-auth-code&state=${options.request.state || ''}`,
			};
		},
	};

	const env = {
		OAUTH_PROVIDER: mockOAuthProvider,
		ASSETS: {
			fetch: async () => new Response("# Test README", { status: 200 }),
		},
	};

	test("App_ReturnsHomePage_When_RootPathRequested", async () => {
		const request = new Request("http://localhost/");
		const response = await app.fetch(request, env);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
		const body = await response.text();
		expect(body).toContain("MCP Remote Auth Demo");
	});

	test("App_ShowsAuthorizationScreen_When_AuthorizeEndpointCalled", async () => {
		const request = new Request("http://localhost/authorize?client_id=test&redirect_uri=http://localhost:3000/callback");
		const response = await app.fetch(request, env);

		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain("Authorization Request");
		expect(body).toContain("read_profile");
		expect(body).toContain("read_data");
		expect(body).toContain("write_data");
	});

	test("App_CompletesAuthorization_When_ApproveFormSubmitted", async () => {
		const formData = new FormData();
		formData.append("action", "approve");
		formData.append("email", "test@example.com");
		formData.append("oauthReqInfo", JSON.stringify({
			client_id: "test",
			redirect_uri: "http://localhost:3000/callback",
			response_type: "code",
			scope: "read_profile read_data",
		}));

		const request = new Request("http://localhost/approve", {
			method: "POST",
			body: formData,
		});

		const response = await app.fetch(request, env);

		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain("Authorization approved!");
		expect(body).toContain("http://localhost:3000/callback?code=test-auth-code");
	});
});
