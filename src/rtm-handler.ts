import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { RtmApi } from './rtm-api';
import type { Env } from './types';

/**
 * =======================================================================================
 * RTM to OAuth2 Adapter: Desktop Flow Implementation
 * =======================================================================================
 *
 * ## CRITICAL CONSTRAINT: RTM HAS NO CALLBACK MECHANISM
 * 
 * Despite RTM's documentation mentioning web app callbacks, 20+ years of RTM code repos
 * show NO evidence of callback URL support. RTM only supports the desktop flow where
 * users manually return to the application.
 *
 * ## CONSTRAINT: SINGLE URL FOR CLAUDE.AI
 * 
 * Claude.ai integration requires a single OAuth2 endpoint. We cannot use multiple
 * URLs or domains for the authentication flow.
 *
 * ## THE SOLUTION: USER-GUIDED WAITING PAGE
 *
 * This implementation bridges RTM's desktop flow with OAuth2 expectations by:
 * 1. Showing a waiting page with clear instructions
 * 2. Using cookies to maintain session state
 * 3. Manual user action to complete the flow
 *
 * ### Step-by-Step Flow:
 *
 * 1. **OAuth2 Client → /authorize**: Returns HTML waiting page (NOT a redirect)
 * 2. **User → RTM**: Opens RTM auth in new tab, authorizes
 * 3. **User → /complete-auth**: Clicks continue button
 * 4. **Server → OAuth2 Client**: Exchanges frob for token, redirects with code
 * 5. **OAuth2 Client → /token**: Standard token exchange
 *
 * ## DO NOT ATTEMPT:
 * - Automatic callbacks (RTM doesn't support them)
 * - Multiple domains (Claude.ai constraint)
 * - Popup windows (browser blockers)
 * - Polling (no reliable completion signal)
 */
export function createRtmHandler() {
  const app = new Hono<{ Bindings: Env }>();

  /**
   * OAuth2 Authorization Endpoint
   * Returns HTML waiting page - does NOT redirect to RTM
   */
  app.get('/authorize', async (c) => {
    console.log('[OAuth] /authorize called with params:', c.req.query());
    
    const {
      response_type,
      client_id,
      redirect_uri,
      state,
      scope,
      code_challenge,
      code_challenge_method
    } = c.req.query();

    if (!redirect_uri || response_type !== 'code') {
      return c.json({ error: 'invalid_request' }, 400);
    }

    try {
      const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);
      
      const frob = await api.getFrob();
      const perms = scope === 'read' ? 'read' : 'delete';
      const rtmAuthUrl = await api.getAuthUrl(frob, perms); 
      
      // Store session in secure cookie
      const sessionData = {
        frob,
        redirect_uri,
        state,
        client_id,
        code_challenge,
        code_challenge_method
      };
      setCookie(c, 'rtm_auth_session', JSON.stringify(sessionData), {
        path: '/',
        secure: true,
        httpOnly: true,
        maxAge: 600, // 10 minutes
        sameSite: 'Lax',
      });

      // Return waiting page HTML
      return c.html(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Authorize with Remember The Milk</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                text-align: center; 
                padding: 2rem; 
                max-width: 600px; 
                margin: auto; 
                background-color: #f9f9f9; 
                color: #333; 
              }
              .card { 
                background-color: #fff; 
                border: 1px solid #ddd; 
                border-radius: 8px; 
                padding: 1.5rem; 
                margin-bottom: 2rem; 
                box-shadow: 0 2px 4px rgba(0,0,0,0.1); 
              }
              .button { 
                display: inline-block; 
                padding: 12px 24px; 
                background-color: #007acc; 
                color: white; 
                text-decoration: none; 
                border-radius: 5px; 
                font-weight: bold; 
                transition: background-color 0.2s; 
              }
              .button:hover { 
                background-color: #005f9e; 
              }
              button.button { 
                border: none; 
                font-size: 1rem; 
                cursor: pointer; 
              }
              p { 
                line-height: 1.6; 
              }
              .step-number {
                font-size: 2em;
                color: #007acc;
                margin-bottom: 0.5rem;
              }
            </style>
          </head>
          <body>
            <h1>Connect Remember The Milk</h1>
            <div class="card">
              <div class="step-number">1</div>
              <h2>Authorize with RTM</h2>
              <p>Click below to open Remember The Milk authorization in a new tab:</p>
              <a href="${rtmAuthUrl}" target="_blank" rel="noopener noreferrer" class="button">
                Open RTM Authorization
              </a>
              <p style="font-size: 0.9em; color: #666; margin-top: 1rem;">
                After authorizing, close the RTM tab and return here.
              </p>
            </div>
            <div class="card">
              <div class="step-number">2</div>
              <h2>Complete Connection</h2>
              <p>After authorizing in RTM, click below to complete the connection:</p>
              <form action="/complete-auth" method="post">
                <button type="submit" class="button">
                  I've Authorized - Complete Connection
                </button>
              </form>
            </div>
          </body>
        </html>
      `);
    } catch (error) {
      console.error('[OAuth] /authorize error:', error);
      return c.json({ error: 'server_error', error_description: 'Failed to initiate authentication' }, 500);
    }
  });
  // File: src/rtm-handler.ts (add these endpoints to createRtmHandler)

  /**
   * OAuth2 Token Introspection Endpoint
   */
  app.post('/introspect', async (c) => {
    console.log('[OAuth] /introspect called');
    
    const authHeader = c.req.header('Authorization');
    const body = await c.req.parseBody();
    const token = (body.token as string) || (authHeader?.replace('Bearer ', ''));
    
    if (!token) {
      return c.json({ active: false }, 200);
    }

    const tokenData = await c.env.AUTH_STORE.get(`token:${token}`);
    if (!tokenData) {
      console.log('[OAuth] Token not found for introspection');
      return c.json({ active: false }, 200);
    }

    const data = JSON.parse(tokenData);
    return c.json({
      active: true,
      scope: 'delete',
      client_id: data.client_id,
      username: data.userName,
      token_type: 'Bearer'
    }, 200);
  });

  /**
   * OAuth2 UserInfo Endpoint
   */
  app.get('/userinfo', async (c) => {
    console.log('[OAuth] /userinfo called');
    
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'invalid_token' }, 401);
    }

    const token = authHeader.substring(7);
    const tokenData = await c.env.AUTH_STORE.get(`token:${token}`);
    
    if (!tokenData) {
      console.log('[OAuth] Token not found for userinfo');
      return c.json({ error: 'invalid_token' }, 401);
    }

    const data = JSON.parse(tokenData);
    return c.json({
      sub: data.userId,
      name: data.userName,
      preferred_username: data.userName
    });
  });

  /**
   * Completion Endpoint
   * User manually triggers this after RTM authorization
   */
  app.post('/complete-auth', async (c) => {
    console.log('[OAuth] /complete-auth called');

    const sessionJSON = getCookie(c, 'rtm_auth_session');
    if (!sessionJSON) {
      return c.text('Session expired. Please start over.', 400);
    }
    
    const sessionData = JSON.parse(sessionJSON);
    const { frob, redirect_uri, state, client_id, code_challenge, code_challenge_method } = sessionData;

    try {
      const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);
      const rtmToken = await api.getToken(frob);
      console.log('[OAuth] Successfully got RTM token');

      const userInfo = await api.makeRequest('rtm.auth.checkToken', { auth_token: rtmToken });
      
      // Generate OAuth2 code
      const authCode = crypto.randomUUID();
      const codeData = {
        rtmToken,
        userName: userInfo.auth.user.fullname || userInfo.auth.user.username,
        userId: userInfo.auth.user.id,
        client_id,
        code_challenge,
        code_challenge_method
      };
      
      await c.env.AUTH_STORE.put(
        `auth_code:${authCode}`, 
        JSON.stringify(codeData), 
        { expirationTtl: 300 }
      );
      
      // Clear cookie
      setCookie(c, 'rtm_auth_session', '', { maxAge: -1 });

      // Redirect to OAuth2 client
      const finalRedirectUrl = new URL(redirect_uri);
      finalRedirectUrl.searchParams.set('code', authCode);
      if (state) {
        finalRedirectUrl.searchParams.set('state', state);
      }

      console.log('[OAuth] Redirecting back to client');
      return c.redirect(finalRedirectUrl.toString());
    } catch (error) {
      console.error('[OAuth] /complete-auth error:', error);
      
      // Clear cookie on error
      setCookie(c, 'rtm_auth_session', '', { maxAge: -1 });
      
      // Return user-friendly error page
      return c.html(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Authorization Failed</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                text-align: center; 
                padding: 2rem; 
                max-width: 600px; 
                margin: auto; 
              }
              .error-box {
                background-color: #fee;
                border: 1px solid #fcc;
                padding: 2rem;
                border-radius: 8px;
              }
              a {
                color: #007acc;
                text-decoration: none;
              }
            </style>
          </head>
          <body>
            <div class="error-box">
              <h2>Authorization Failed</h2>
              <p>The authorization process could not be completed. This usually means:</p>
              <ul style="text-align: left; display: inline-block;">
                <li>You didn't complete the RTM authorization</li>
                <li>The session expired (10 minute limit)</li>
                <li>RTM rejected the authorization request</li>
              </ul>
              <p><a href="/authorize?${c.req.header('referer') || ''}">Try Again</a></p>
            </div>
          </body>
        </html>
      `);
    }
  });

  /**
   * OAuth2 Token Exchange Endpoint
   * Standard implementation - no manual steps here
   */
// File: src/rtm-handler.ts (replace the existing /token endpoint)

  /**
   * OAuth2 Token Exchange Endpoint
   */
  app.post('/token', async (c) => {
    console.log('[OAuth] /token called');
    
    const body = await c.req.parseBody();
    const { grant_type, code, client_id } = body as Record<string, string>;

    if (grant_type !== 'authorization_code' || !code) {
      return c.json({ error: 'invalid_request' }, 400);
    }

    try {
      const codeDataJSON = await c.env.AUTH_STORE.get(`auth_code:${code}`);
      if (!codeDataJSON) {
        return c.json({ error: 'invalid_grant' }, 400);
      }
      
      const codeData = JSON.parse(codeDataJSON);
      
      if (client_id && codeData.client_id && client_id !== codeData.client_id) {
        return c.json({ error: 'invalid_client' }, 400);
      }
      
      await c.env.AUTH_STORE.delete(`auth_code:${code}`);
      
      await c.env.AUTH_STORE.put(
        `token:${codeData.rtmToken}`,
        JSON.stringify({
          userName: codeData.userName,
          userId: codeData.userId,
          client_id: codeData.client_id,
          created_at: Date.now()
        })
      );

      // Include expires_in for Claude.ai
      return c.json({
        access_token: codeData.rtmToken,
        token_type: 'Bearer',
        expires_in: 31536000, // 1 year in seconds
        scope: 'delete'
      });
    } catch (error) {
      console.error('[OAuth] /token error:', error);
      return c.json({ error: 'server_error' }, 500);
    }
  });
  
  /**
   * OAuth2 Discovery Endpoint
   */
  app.get('/.well-known/oauth-authorization-server', (c) => {
    const baseUrl = c.env.SERVER_URL || `https://${c.req.header('host')}`;
    return c.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      introspection_endpoint: `${baseUrl}/introspect`,
      userinfo_endpoint: `${baseUrl}/userinfo`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256', 'plain'],
      token_endpoint_auth_methods_supported: ['none'],
      introspection_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['read', 'delete']
    });
  });
  return app;
}