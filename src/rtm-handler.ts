import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { RtmApi } from './rtm-api';
import type { Env } from './types';
import { withDebugLogging, createDebugDashboard } from './debug-logger';

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
  
  // Apply debug logging to all routes
  app.use('*', withDebugLogging);

  /**
   * OAuth2 Authorization Endpoint
   * Returns HTML waiting page - does NOT redirect to RTM
   */
  app.get('/authorize', async (c) => {
    const logger = c.get('debugLogger');
    const debugSessionId = c.get('debugSessionId');
    
    await logger.log('oauth_authorize_start', {
      endpoint: '/authorize',
      query: c.req.query(),
      headers: Object.fromEntries(c.req.raw.headers.entries()),
      debugSessionId
    });
    
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
      await logger.log('oauth_authorize_error', {
        error: 'invalid_request',
        reason: 'Missing redirect_uri or invalid response_type',
        received: { redirect_uri, response_type }
      });
      return c.json({ error: 'invalid_request' }, 400);
    }

    try {
      const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);
      
      await logger.log('rtm_frob_request', { endpoint: 'rtm.auth.getFrob' });
      const frob = await api.getFrob();
      
      const perms = scope === 'read' ? 'read' : 'delete';
      const rtmAuthUrl = await api.getAuthUrl(frob, perms);
      
      await logger.log('rtm_frob_success', { 
        frob_length: frob.length,
        perms,
        rtm_auth_url_generated: true
      });
      
      // Store session in secure cookie
      const sessionData = {
        frob,
        redirect_uri,
        state,
        client_id,
        code_challenge,
        code_challenge_method,
        debugSessionId
      };
      setCookie(c, 'rtm_auth_session', JSON.stringify(sessionData), {
        path: '/',
        secure: true,
        httpOnly: true,
        maxAge: 600, // 10 minutes
        sameSite: 'Lax',
      });
      
      await logger.log('oauth_authorize_success', {
        session_stored: true,
        has_state: !!state,
        has_code_challenge: !!code_challenge
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
              .debug-info {
                position: fixed;
                bottom: 10px;
                right: 10px;
                font-size: 0.8em;
                color: #666;
                background: #f0f0f0;
                padding: 5px 10px;
                border-radius: 3px;
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
            <div class="debug-info" data-debug-session="${debugSessionId}">
              Debug: ${debugSessionId.substring(0, 8)}...
            </div>
          </body>
        </html>
      `);
    } catch (error) {
      await logger.log('oauth_authorize_exception', {
        endpoint: '/authorize',
        error_type: error.constructor.name,
        error_message: error.message
      }, error);
      return c.json({ error: 'server_error', error_description: 'Failed to initiate authentication' }, 500);
    }
  });

  /**
   * Completion Endpoint
   * User manually triggers this after RTM authorization
   */
  app.post('/complete-auth', async (c) => {
    const logger = c.get('debugLogger');
    
    await logger.log('complete_auth_start', {
      endpoint: '/complete-auth',
      has_cookie: !!getCookie(c, 'rtm_auth_session'),
      cookies: Object.keys(c.req.cookie || {})
    });

    const sessionJSON = getCookie(c, 'rtm_auth_session');
    if (!sessionJSON) {
      await logger.log('complete_auth_error', {
        error: 'no_session',
        cookies: Object.keys(c.req.cookie || {})
      });
      return c.text('Session expired. Please start over.', 400);
    }
    
    const sessionData = JSON.parse(sessionJSON);
    const { frob, redirect_uri, state, client_id, code_challenge, code_challenge_method } = sessionData;
    
    await logger.log('complete_auth_session_loaded', {
      has_frob: !!frob,
      has_state: !!state,
      has_redirect_uri: !!redirect_uri,
      client_id,
      has_code_challenge: !!code_challenge
    });

    try {
      const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);
      
      await logger.log('rtm_token_request', { 
        endpoint: 'rtm.auth.getToken',
        frob_prefix: frob.substring(0, 8)
      });
      
      const rtmToken = await api.getToken(frob);
      
      await logger.log('rtm_token_success', { 
        token_received: true,
        token_length: rtmToken.length 
      });

      const userInfo = await api.makeRequest('rtm.auth.checkToken', { auth_token: rtmToken });
      
      await logger.log('rtm_user_info', {
        user_id: userInfo.auth.user.id,
        username: userInfo.auth.user.username,
        has_fullname: !!userInfo.auth.user.fullname
      });
      
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
        { expirationTtl: 300 } // 5 minutes
      );
      
      await logger.log('oauth_code_generated', {
        code: authCode,
        stored_with_ttl: 300,
        has_code_challenge: !!code_challenge,
        key: `auth_code:${authCode}`
      });
      
      // Clear cookie
      setCookie(c, 'rtm_auth_session', '', { maxAge: -1 });

      // Redirect to OAuth2 client
      const finalRedirectUrl = new URL(redirect_uri);
      finalRedirectUrl.searchParams.set('code', authCode);
      if (state) {
        finalRedirectUrl.searchParams.set('state', state);
      }

      await logger.log('complete_auth_redirect', {
        redirect_to: finalRedirectUrl.hostname,
        redirect_path: finalRedirectUrl.pathname,
        has_state: !!state,
        code_included: true,
        full_url: finalRedirectUrl.toString()
      });
      
      return c.redirect(finalRedirectUrl.toString());
    } catch (error) {
      await logger.log('complete_auth_exception', {
        error_type: error.constructor.name,
        error_message: error.message,
        rtm_error: error.message
      }, error);
      
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
              <p>Error: ${error.message}</p>
              <p><a href="/authorize?${c.req.header('referer') || ''}">Try Again</a></p>
            </div>
          </body>
        </html>
      `);
    }
  });

  /**
   * OAuth2 Token Exchange Endpoint
   */
  app.post('/token', async (c) => {
    const logger = c.get('debugLogger');
    const baseUrl = c.env.SERVER_URL || `https://${c.req.header('host')}`;
    
    const body = await c.req.parseBody();
    const { grant_type, code, client_id } = body as Record<string, string>;
    
    await logger.log('token_exchange_start', {
      endpoint: '/token',
      grant_type,
      has_code: !!code,
      code_length: code?.length,
      code_prefix: code?.substring(0, 8),
      client_id,
      headers: Object.fromEntries(c.req.raw.headers.entries())
    });

    if (grant_type !== 'authorization_code' || !code) {
      await logger.log('token_exchange_error', {
        error: 'invalid_request',
        reason: 'Invalid grant_type or missing code',
        grant_type,
        has_code: !!code
      });
      return c.json({ error: 'invalid_request' }, 400);
    }

    try {
      const codeDataJSON = await c.env.AUTH_STORE.get(`auth_code:${code}`);
      
      await logger.log('token_exchange_code_lookup', {
        code,
        code_key: `auth_code:${code}`,
        found: !!codeDataJSON
      });
      
      if (!codeDataJSON) {
        await logger.log('token_exchange_invalid_code', {
          code,
          reason: 'Code not found in storage'
        });
        return c.json({ error: 'invalid_grant' }, 400);
      }
      
      const codeData = JSON.parse(codeDataJSON);
      
      await logger.log('token_exchange_code_data', {
        has_rtm_token: !!codeData.rtmToken,
        user_id: codeData.userId,
        stored_client_id: codeData.client_id,
        request_client_id: client_id
      });
      
      // Validate client_id if provided
      if (client_id && codeData.client_id && client_id !== codeData.client_id) {
        await logger.log('token_exchange_client_mismatch', {
          expected: codeData.client_id,
          received: client_id
        });
        return c.json({ error: 'invalid_client' }, 400);
      }
      
      // Delete used code
      await c.env.AUTH_STORE.delete(`auth_code:${code}`);
      
      // Store token mapping for introspection
      const tokenData = {
        userName: codeData.userName,
        userId: codeData.userId,
        client_id: codeData.client_id,
        created_at: Date.now()
      };
      
      await c.env.AUTH_STORE.put(
        `token:${codeData.rtmToken}`,
        JSON.stringify(tokenData)
      );
      
      await logger.log('token_exchange_success', {
        user_id: codeData.userId,
        token_stored: true,
        token_key: `token:${codeData.rtmToken.substring(0, 8)}...`,
        expires_in: 31536000
      });

      // Return OAuth2 token response
      return c.json({
        access_token: codeData.rtmToken,
        token_type: 'Bearer',
        expires_in: 31536000, // 1 year
        scope: 'delete',
        resource: `${baseUrl}/mcp`
      });
    } catch (error) {
      await logger.log('token_exchange_exception', {
        error_type: error.constructor.name,
        error_message: error.message
      }, error);
      return c.json({ error: 'server_error' }, 500);
    }
  });

  /**
   * OAuth2 Token Introspection Endpoint
   */
  app.post('/introspect', async (c) => {
    const logger = c.get('debugLogger');
    
    const authHeader = c.req.header('Authorization');
    const body = await c.req.parseBody();
    const token = (body.token as string) || (authHeader?.replace('Bearer ', ''));
    
    await logger.log('introspect_start', {
      endpoint: '/introspect',
      has_auth_header: !!authHeader,
      has_body_token: !!body.token,
      token_source: body.token ? 'body' : authHeader ? 'header' : 'none',
      token_length: token?.length,
      token_prefix: token?.substring(0, 8)
    });
    
    if (!token) {
      await logger.log('introspect_no_token', {
        reason: 'No token provided'
      });
      return c.json({ active: false }, 200);
    }

    const tokenDataJSON = await c.env.AUTH_STORE.get(`token:${token}`);
    
    await logger.log('introspect_lookup', {
      token_key: `token:${token.substring(0, 8)}...`,
      found: !!tokenDataJSON
    });
    
    if (!tokenDataJSON) {
      await logger.log('introspect_token_not_found', {
        token_prefix: token.substring(0, 8)
      });
      return c.json({ active: false }, 200);
    }

    const data = JSON.parse(tokenDataJSON);
    
    await logger.log('introspect_success', {
      user_id: data.userId,
      username: data.userName,
      client_id: data.client_id,
      created_at: data.created_at,
      active: true
    });
    
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
    const logger = c.get('debugLogger');
    
    const authHeader = c.req.header('Authorization');
    
    await logger.log('userinfo_start', {
      endpoint: '/userinfo',
      has_auth_header: !!authHeader,
      auth_type: authHeader?.split(' ')[0]
    });
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      await logger.log('userinfo_invalid_auth', {
        reason: 'Missing or invalid Authorization header'
      });
      return c.json({ error: 'invalid_token' }, 401);
    }

    const token = authHeader.substring(7);
    const tokenDataJSON = await c.env.AUTH_STORE.get(`token:${token}`);
    
    await logger.log('userinfo_lookup', {
      token_prefix: token.substring(0, 8),
      found: !!tokenDataJSON
    });
    
    if (!tokenDataJSON) {
      await logger.log('userinfo_token_not_found');
      return c.json({ error: 'invalid_token' }, 401);
    }

    const data = JSON.parse(tokenDataJSON);
    
    await logger.log('userinfo_success', {
      user_id: data.userId,
      username: data.userName
    });
    
    return c.json({
      sub: data.userId,
      name: data.userName,
      preferred_username: data.userName
    });
  });

  /**
   * OAuth2 Discovery Endpoint
   */
  app.get('/.well-known/oauth-authorization-server', async (c) => {
    const logger = c.get('debugLogger');
    const baseUrl = c.env.SERVER_URL || `https://${c.req.header('host')}`;
    
    await logger.log('discovery_request', {
      endpoint: '/.well-known/oauth-authorization-server',
      base_url: baseUrl
    });
    
return c.json({
  issuer: baseUrl,
  authorization_endpoint: `${baseUrl}/authorize`,
  token_endpoint: `${baseUrl}/token`,
  introspection_endpoint: `${baseUrl}/introspect`,
  userinfo_endpoint: `${baseUrl}/userinfo`,
  registration_endpoint: `${baseUrl}/register`, // ADD THIS LINE
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code'],
  code_challenge_methods_supported: ['S256', 'plain'],
  token_endpoint_auth_methods_supported: ['none'],
  introspection_endpoint_auth_methods_supported: ['none'],
  scopes_supported: ['read', 'delete']
  });
});

  // Debug endpoints
  app.get('/debug', createDebugDashboard());
  
  app.get('/debug/session/:sessionId', async (c) => {
    const { DebugLogger } = await import('./debug-logger');
    const logs = await DebugLogger.getSessionLogs(c.env, c.req.param('sessionId'));
    return c.json(logs);
  });

  return app;
}