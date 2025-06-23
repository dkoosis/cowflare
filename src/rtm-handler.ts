import { Hono } from "hono";
import { RtmApi } from "./rtm-api";
import type { Env } from "./types";
import type { Props } from "./rtm-mcp";

const app = new Hono<{ Bindings: Env }>();

/**
 * RTM Authorization Endpoint
 * This is the first step in the upstream auth flow.
 */
app.get("/authorize", async (c) => {
  // The OAUTH_PROVIDER parses the original request from the MCP client (e.g., Claude.ai)
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  if (!oauthReqInfo.clientId) {
    return c.text("Invalid request: Missing clientId", 400);
  }

  const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);
  const frob = await api.getFrob();

  // We store the original MCP client request info, keyed by the RTM frob.
  // This allows us to retrieve it in the /callback step.
  await c.env.AUTH_STORE.put(
    `frob_session:${frob}`,
    JSON.stringify(oauthReqInfo),
    { expirationTtl: 600 } // 10 minutes
  );

  const perms = oauthReqInfo.scope === "read" ? "read" : "delete";
  const authUrl = await api.getAuthUrl(frob, perms);

  // Redirect the user's browser to RTM to grant permission.
  return c.redirect(authUrl);
});

/**
 * RTM Callback Handler
 * This is where RTM redirects the user after they grant permission.
 */
app.get("/callback", async (c) => {
  const frob = c.req.query("frob");
  if (!frob) {
    return c.text("Missing frob parameter", 400);
  }

  // Retrieve the original MCP client request info using the frob.
  const sessionJSON = await c.env.AUTH_STORE.get(`frob_session:${frob}`);
  if (!sessionJSON) {
    return c.text("Invalid or expired session", 400);
  }
  const oauthReqInfo = JSON.parse(sessionJSON);

  const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);

  try {
    // Exchange the frob for a permanent RTM auth token.
    const authToken = await api.getToken(frob);
    const userInfo = await api.makeRequest('rtm.auth.checkToken', { auth_token: authToken });

    // This is the CRITICAL STEP.
    // We call `completeAuthorization` from the OAuthProvider.
    // This function will mint its own session token for Claude.ai and generate
    // the correct final redirect URL.
    const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthReqInfo,
      // These props will be made available to the RtmMCP Durable Object
      // when the client connects to the /sse endpoint.
      props: {
        rtmToken: authToken,
        userName: userInfo.auth.user.fullname || userInfo.auth.user.username,
      } as Props,
      // Metadata for the token stored by the provider
      metadata: {
        userId: userInfo.auth.user.id,
      },
    });
    
    // Clean up the frob session from KV store
    await c.env.AUTH_STORE.delete(`frob_session:${frob}`);

    // Redirect back to the MCP client (Claude.ai) with the provider-generated URL.
    return c.redirect(redirectTo);

  } catch (error: any) {
    console.error("[/callback] RTM authentication failed:", error);
    return c.text(`Authentication failed: ${error.message}`, 401);
  }
});

export const RtmHandler = app;