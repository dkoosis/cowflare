import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * stytchAuthMiddleware is a Hono middleware that validates that the user is logged in
 * It checks for the stytch_session_jwt cookie set by the Stytch FE SDK
 */
export const stytchSessionAuthMiddleware = createMiddleware<{
	Variables: {
		userID: string;
	};
	Bindings: Env;
}>(async (c, next) => {
	const sessionCookie = getCookie(c, "stytch_session_jwt");

	try {
		const verifyResult = await validateStytchJWT(sessionCookie ?? "", c.env);
		c.set("userID", verifyResult.payload.sub!);
	} catch (error) {
		console.error(error);
		throw new HTTPException(401, { message: "Unauthenticated" });
	}

	await next();
});

/**
 * stytchBearerTokenAuthMiddleware is a Hono middleware that validates that the request has a Stytch-issued bearer token
 * Tokens are issued to clients at the end of a successful OAuth flow
 */
export const stytchBearerTokenAuthMiddleware = createMiddleware<{
	Bindings: Env;
}>(async (c, next) => {
	const authHeader = c.req.header("Authorization");

	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		throw new HTTPException(401, { message: "Missing or invalid access token" });
	}
	const accessToken = authHeader.substring(7);

	try {
		const verifyResult = await validateStytchJWT(accessToken, c.env);
		// @ts-expect-error Props go brr
		c.executionCtx.props = {
			accessToken,
			claims: verifyResult.payload,
		};
	} catch (error) {
		console.error(error);
		throw new HTTPException(401, { message: "Unauthenticated" });
	}

	await next();
});

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

async function validateStytchJWT(token: string, env: Env) {
	if (!jwks) {
		jwks = createRemoteJWKSet(new URL(getStytchOAuthEndpointUrl(env, ".well-known/jwks.json")));
	}

	return await jwtVerify(token, jwks, {
		algorithms: ["RS256"],
		audience: env.STYTCH_PROJECT_ID,
		issuer: [`stytch.com/${env.STYTCH_PROJECT_ID}`],
		typ: "JWT",
	});
}

export function getStytchOAuthEndpointUrl(env: Env, endpoint: string): string {
	const baseURL = env.STYTCH_PROJECT_ID.includes("test")
		? "https://test.stytch.com/v1/public"
		: "https://api.stytch.com/v1/public";

	return `${baseURL}/${env.STYTCH_PROJECT_ID}/${endpoint}`;
}
