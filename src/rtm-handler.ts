import { Hono } from "hono";
import { RtmApi } from "./rtm-api";
import type { Env } from "./types";
import type { Props } from "./rtm-mcp";
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

// This file now exports a function that creates the Hono app.
// This allows us to pass in the `OAUTH_PROVIDER` from the main index.ts
export const createRtmHandler = (OAUTH_PROVIDER: OAuthHelpers) => {
  const app = new Hono<{ Bindings: Env }>();

  /**
   * RTM Authorization Endpoint
   */
  app.get("/authorize", async (c) => {
    // We use the passed-in OAUTH_PROVIDER directly here.
    const oauthReqInfo = await OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
    if (!oauthReqInfo.clientId) {
      return c.text("Invalid request: Missing clientId", 400);
    }

    const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);
    const frob = await api.getFrob();

    await c.env.AUTH_STORE.put(
      `frob_session:${frob}`,
      JSON.stringify(oauthReqInfo),
      { expirationTtl: 600 } // 10 minutes
    );

    const perms = oauthReqInfo.scope === "read" ? "read" : "delete";
    const authUrl = await api.getAuthUrl(frob, perms);

    return c.redirect(authUrl);
  });

  /**
   * RTM Callback Handler
   */
  app.get("/callback", async (c) => {
    const frob = c.req.query("frob");
    if (!frob) {
      return c.text("Missing frob parameter", 400);
    }

    const sessionJSON = await c.env.AUTH_STORE.get(`frob_session:${frob}`);
    if (!sessionJSON) {
      return c.text("Invalid or expired session", 400);
    }
    const oauthReqInfo = JSON.parse(sessionJSON);

    const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);

    try {
      const authToken = await api.getToken(frob);
      const userInfo = await api.makeRequest('rtm.auth.checkToken', { auth_token: authToken });

      // Use the passed-in OAUTH_PROVIDER to complete the authorization.
      const { redirectTo } = await OAUTH_PROVIDER.completeAuthorization({
        request: oauthReqInfo,
        props: {
          rtmToken: authToken,
          userName: userInfo.auth.user.fullname || userInfo.auth.user.username,
        } as Props,
        metadata: {
          userId: userInfo.auth.user.id,
        },
      });
      
      await c.env.AUTH_STORE.delete(`frob_session:${frob}`);

      return c.redirect(redirectTo);

    } catch (error: any) {
      console.error("[/callback] RTM authentication failed:", error);
      return c.text(`Authentication failed: ${error.message}`, 401);
    }
  });

  return app;
};