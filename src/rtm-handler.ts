/**
 * @file rtm-handler.ts
 * @description OAuth handler that manages RTM authentication flow
 */

import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { type Context, Hono } from "hono";
import { RtmApi } from "./rtm-api";
import {
  clientIdAlreadyApproved,
  parseRedirectApproval,
  renderApprovalDialog,
} from "./workers-oauth-utils";

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

/**
 * OAuth authorization endpoint - shows approval dialog
 */
app.get("/authorize", async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  const { clientId } = oauthReqInfo;
  if (!clientId) {
    return c.text("Invalid request", 400);
  }

  // Check if client already approved
  if (
    await clientIdAlreadyApproved(c.req.raw, oauthReqInfo.clientId, c.env.COOKIE_ENCRYPTION_KEY)
  ) {
    return redirectToRtmAuth(c, oauthReqInfo);
  }

  // Show approval dialog
  return renderApprovalDialog(c.req.raw, {
    client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
    server: {
      name: "Remember The Milk MCP Server",
      description: "Access your RTM tasks from Claude and other MCP clients",
    },
    state: { oauthReqInfo },
  });
});

/**
 * Handle approval form submission
 */
app.post("/authorize", async (c) => {
  const { state, headers } = await parseRedirectApproval(c.req.raw, c.env.COOKIE_ENCRYPTION_KEY);
  if (!state.oauthReqInfo) {
    return c.text("Invalid request", 400);
  }

  return redirectToRtmAuth(c, state.oauthReqInfo, headers);
});

/**
 * Redirect to RTM authentication
 */
async function redirectToRtmAuth(
  c: Context,
  oauthReqInfo: AuthRequest,
  headers: Record<string, string> = {},
) {
  const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);
  
  // Get frob from RTM
  const frob = await api.getFrob();
  
  // Store OAuth request info with frob in KV
  await c.env.AUTH_STORE.put(
    `oauth:${frob}`,
    JSON.stringify({
      oauthReqInfo,
      timestamp: Date.now()
    }),
    { expirationTtl: 300 } // 5 minutes
  );
  
  // Get RTM auth URL
  const rtmAuthUrl = await api.getAuthUrl(frob, 'delete');
  
  // Build callback URL that includes frob
  const callbackUrl = new URL("/callback", c.req.url);
  callbackUrl.searchParams.set("frob", frob);
  
  // Show RTM auth page
  return new Response(
    `<!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Authenticate with Remember The Milk</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: #f9fafb;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
          }
          .container {
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            max-width: 400px;
            text-align: center;
          }
          h1 { color: #333; margin-bottom: 1.5rem; }
          .button {
            display: inline-block;
            background: #0073e6;
            color: white;
            padding: 0.75rem 1.5rem;
            border-radius: 6px;
            text-decoration: none;
            margin: 0.5rem;
          }
          .button:hover { background: #005bb5; }
          .secondary { background: #6c757d; }
          .secondary:hover { background: #5a6268; }
          .info { color: #666; margin: 1rem 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Connect to Remember The Milk</h1>
          <p class="info">
            To use RTM tools in your MCP client, you need to authorize access to your RTM account.
          </p>
          <p>
            <a href="${rtmAuthUrl}" target="_blank" class="button">
              Authorize with RTM
            </a>
          </p>
          <p class="info">
            After authorizing, click below to complete setup:
          </p>
          <p>
            <a href="${callbackUrl.toString()}" class="button secondary">
              Complete Setup
            </a>
          </p>
        </div>
      </body>
    </html>`,
    {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "text/html; charset=utf-8",
      },
    }
  );
}

/**
 * OAuth callback endpoint - exchanges frob for token and completes OAuth flow
 */
app.get("/callback", async (c) => {
  const frob = c.req.query("frob");
  if (!frob) {
    return c.text("Missing frob parameter", 400);
  }

  // Retrieve OAuth request info
  const oauthData = await c.env.AUTH_STORE.get(`oauth:${frob}`);
  if (!oauthData) {
    return c.text("Invalid or expired session", 400);
  }

  const { oauthReqInfo } = JSON.parse(oauthData);
  const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);

  try {
    // Exchange frob for RTM token
    const rtmToken = await api.getToken(frob);
    
    // Get user info from RTM
    const userInfo = await api.makeRequest('rtm.auth.checkToken', {
      auth_token: rtmToken
    });

    // Clean up temporary data
    await c.env.AUTH_STORE.delete(`oauth:${frob}`);

    // Complete OAuth authorization
    const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
      metadata: {
        label: userInfo.auth.user.username,
      },
      props: {
        rtmToken,
        userEmail: userInfo.auth.user.username, // RTM doesn't provide email
        userName: userInfo.auth.user.fullname || userInfo.auth.user.username,
      },
      request: oauthReqInfo,
      scope: oauthReqInfo.scope,
      userId: userInfo.auth.user.id,
    });

    return Response.redirect(redirectTo);
    
  } catch (error) {
    console.error("RTM authentication failed:", error);
    return c.text(`Authentication failed: ${error.message}`, 401);
  }
});

// Root endpoint for OAuth discovery
app.get("/", (c) => {
  return c.json({
    name: "Remember The Milk MCP Server",
    version: "2.0.0",
    oauth2: {
      authorizationUrl: "/authorize",
      tokenUrl: "/token",
      required: true
    }
  });
});

//export { app as RtmHandler };
export const RtmHandler = {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => 
    app.fetch(request, env, ctx)
};