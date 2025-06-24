import { Hono } from "hono";
import { RtmApi } from "./rtm-api";
import type { Env } from "./types";
import type { Props } from "./rtm-mcp";
import type OAuthProvider from "@cloudflare/workers-oauth-provider";

// This interface defines the holder object.
export interface ProviderHolder {
  provider?: OAuthProvider<Env>;
}

// The function now accepts the holder instead of the provider directly.
export const createRtmHandler = (holder: ProviderHolder) => {
  const app = new Hono<{ Bindings: Env }>();

  /**
   * RTM Authorization Endpoint
   */
  app.get("/authorize", async (c) => {
    // Access the provider through the holder.
    // The '!' asserts that the provider will exist when this code runs.
    const provider = holder.provider!;

    const oauthReqInfo = await provider.parseAuthRequest(c.req.raw);
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
    
    // Access the provider through the holder.
    const provider = holder.provider!;

    const sessionJSON = await c.env.AUTH_STORE.get(`frob_session:${frob}`);
    if (!sessionJSON) {
      return c.text("Invalid or expired session", 400);
    }
    const oauthReqInfo = JSON.parse(sessionJSON);

    const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);

    try {
      const authToken = await api.getToken(frob);
      const userInfo = await api.makeRequest('rtm.auth.checkToken', { auth_token: authToken });

      const { redirectTo } = await provider.completeAuthorization({
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