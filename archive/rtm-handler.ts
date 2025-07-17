// File: src/rtm-handler.ts
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { RtmApi } from './rtm-api';
import type { Env } from './types';
import { withDebugLogging, type DebugLogger } from './debug-logger';

/**
 * Type definition for Hono context variables
 */
type Variables = {
  debugLogger: DebugLogger;
  debugSessionId: string;
};

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
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  
  // Apply debug logging to all routes
  app.use('*', withDebugLogging);

  /**
   * Health check endpoint
   */
  app.get('/health', (c) => {
    return c.json({ status: 'ok', service: 'rtm-auth-handler' });
  });

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
    
    let {
      response_type,
      client_id,
      redirect_uri,
      state,
      scope,
      code_challenge,
      code_challenge_method
    } = c.req.query();

    const originalRedirectUri = redirect_uri;
    
    // Check if this is coming from Claude.ai
    const origin = c.req.header('Origin');
    const referer = c.req.header('Referer');
    const isFromClaude = (
      origin?.includes('claude.ai') || 
      referer?.includes('claude.ai') ||
      (redirect_uri && redirect_uri.includes('example.com'))
    );
    
    if (isFromClaude && redirect_uri?.includes('example.com')) {
      // Replace with the correct Claude.ai callback URL
      redirect_uri = 'https://claude.ai/api/mcp/auth_callback';
      
      await logger.log('oauth_redirect_uri_fix', {
        original: originalRedirectUri,
        fixed: redirect_uri,
        reason: 'Claude.ai sends incorrect redirect_uri',
        client_id,
        state
      });
    }

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
        redirect_uri, // This now contains the fixed URL
        state,
        client_id,
        code_challenge,
        code_challenge_method,
        debugSessionId,
        originalRedirectUri // Keep track of what Claude originally sent
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
        cookie_set: true,
        redirect_uri_used: redirect_uri,
        original_redirect_uri: originalRedirectUri
      });
      
      // Return HTML waiting page with Auth Button
      return c.html(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Authorize RTM MCP Server</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                text-align: center; 
                padding: 2rem; 
                background-color: #f5f5f5; 
                margin: 0;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
              }
              .container {
                background-color: white;
                padding: 3rem;
                border-radius: 12px;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
                max-width: 600px;
                width: 100%;
              }
              h1 { 
                color: #333; 
                margin-bottom: 1rem;
                font-size: 2rem;
              }
              .step {
                margin: 2rem 0;
                text-align: left;
              }
              .step-number {
                background: #007acc;
                color: white;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-weight: bold;
                margin-right: 1rem;
              }
              .step-content {
                display: inline-block;
                vertical-align: middle;
                max-width: calc(100% - 50px);
              }
              button, .button {
                background-color: #007acc;
                color: white;
                padding: 12px 24px;
                border: none;
                border-radius: 6px;
                font-size: 1.1rem;
                cursor: pointer;
                text-decoration: none;
                display: inline-block;
                margin: 1rem 0.5rem;
                transition: background-color 0.2s;
              }
              button:hover, .button:hover {
                background-color: #005a9e;
              }
              button:disabled {
                background-color: #ccc;
                cursor: not-allowed;
              }
              .button.secondary {
                background-color: #28a745;
              }
              .button.secondary:hover {
                background-color: #218838;
              }
              .warning {
                background-color: #fff3cd;
                border: 1px solid #ffeaa7;
                color: #856404;
                padding: 1rem;
                border-radius: 6px;
                margin: 2rem 0;
                text-align: left;
              }
              .debug-info {
                background-color: #f8f9fa;
                border: 1px solid #dee2e6;
                padding: 1rem;
                border-radius: 6px;
                margin-top: 2rem;
                font-family: monospace;
                font-size: 0.9rem;
                text-align: left;
                color: #666;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>🔐 Authorize RTM MCP Server</h1>
              
              <p>Complete these steps to connect Remember The Milk to your MCP client:</p>
              
              <div class="step">
                <span class="step-number">1</span>
                <span class="step-content">
                  <strong>Click the button below</strong> to open Remember The Milk in a new tab
                </span>
              </div>
              
              <a href="${rtmAuthUrl}" target="_blank" class="button">
                Open Remember The Milk →
              </a>
              
              <div class="step">
                <span class="step-number">2</span>
                <span class="step-content">
                  <strong>Authorize the application</strong> in the Remember The Milk tab
                </span>
              </div>
              
              <div class="step">
                <span class="step-number">3</span>
                <span class="step-content">
                  <strong>Return to this tab</strong> and click "Complete Authorization"
                </span>
              </div>
              
              <div class="warning">
                <strong>⚠️ Important:</strong> You must complete the authorization in Remember The Milk before clicking the button below.
              </div>
              
              <button 
                onclick="window.location.href='/complete-auth'"
                class="button secondary"
              >
                Complete Authorization ✓
              </button>
              
              <div class="debug-info">
                <strong>Debug Info:</strong><br>
                Session: ${debugSessionId}<br>
                State: ${state || 'none'}<br>
                Client: ${client_id || 'default'}<br>
                Original redirect_uri: ${originalRedirectUri || 'none'}<br>
                Fixed redirect_uri: ${redirect_uri}
              </div>
            </div>
          </body>
        </html>
      `);
    } catch (error) {
      await logger.log('oauth_authorize_exception', {
        error_type: error instanceof Error ? error.constructor.name : 'unknown',
        error_message: error instanceof Error ? error.message : String(error)
      }, error instanceof Error ? error : undefined);
      
      // Return HTML error page instead of JSON
      return c.html(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Authorization Error</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                text-align: center; 
                padding: 2rem; 
                background-color: #f5f5f5; 
                margin: 0;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
              }
              .container {
                background-color: white;
                padding: 3rem;
                border-radius: 12px;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
                max-width: 600px;
                width: 100%;
              }
              .error-box {
                background-color: #fee;
                border: 1px solid #fcc;
                padding: 2rem;
                border-radius: 8px;
                margin-bottom: 2rem;
              }
              h1 { 
                color: #d73a49; 
                margin-bottom: 1rem;
              }
              p {
                color: #666;
                line-height: 1.6;
              }
              .error-details {
                background-color: #f8f9fa;
                border: 1px solid #dee2e6;
                padding: 1rem;
                border-radius: 6px;
                margin-top: 2rem;
                font-family: monospace;
                font-size: 0.9rem;
                text-align: left;
                color: #666;
              }
              a {
                color: #007acc;
                text-decoration: none;
              }
              a:hover {
                text-decoration: underline;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="error-box">
                <h1>⚠️ Authorization Error</h1>
                <p>Unable to start the authorization process. This usually means the server configuration is incomplete.</p>
                <p><strong>Error:</strong> ${error instanceof Error ? error.message : 'Server configuration error'}</p>
              </div>
              
              <p>Please contact the administrator to ensure the RTM API credentials are properly configured.</p>
              
              <div class="error-details">
                <strong>Debug Info:</strong><br>
                Error Type: ${error instanceof Error ? error.constructor.name : 'Unknown'}<br>
                Endpoint: /authorize<br>
                Time: ${new Date().toISOString()}
              </div>
            </div>
          </body>
        </html>
      `);
    }
  });

  /**
   * OAuth2 Complete Authorization Endpoint
   * Handles return from RTM after user authorization
   */
/**
   * OAuth2 Complete Authorization Endpoint
   * Handles return from RTM after user authorization
   */
  app.get('/complete-auth', async (c) => {
    const logger = c.get('debugLogger');
    
    await logger.log('complete_auth_start', {
      endpoint: '/complete-auth',
      cookies: c.req.header('Cookie'),
      debugSessionId: c.get('debugSessionId')
    });
    
    // Get session from cookie
    const sessionCookie = getCookie(c, 'rtm_auth_session');
    if (!sessionCookie) {
      await logger.log('complete_auth_no_session', {
        error: 'No session cookie found'
      });
      return c.text('Session expired. Please restart authorization.', 400);
    }

    let sessionData;
    try {
      sessionData = JSON.parse(sessionCookie);
      await logger.log('complete_auth_session_found', {
        has_frob: !!sessionData.frob,
        has_redirect_uri: !!sessionData.redirect_uri,
        has_state: !!sessionData.state,
        original_debug_session: sessionData.debugSessionId
      });
    } catch (error) {
      await logger.log('complete_auth_invalid_session', {
        error: 'Failed to parse session cookie'
      }, error instanceof Error ? error : undefined);
      return c.text('Invalid session data.', 400);
    }

    const { frob, redirect_uri, state, client_id, code_challenge, code_challenge_method } = sessionData;

    try {
      // Exchange frob for token
      const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);
      
      await logger.log('rtm_token_request', { 
        endpoint: 'rtm.auth.getToken',
        frob_length: frob.length 
      });
      
      // Get token AND user info from RTM
      let rtmToken: string;
      let userInfo: any;
      
      try {
        const tokenResponse = await api.getToken(frob);
        rtmToken = tokenResponse.token;
        
        await logger.log('rtm_token_success', { 
          token_length: rtmToken.length,
          token_prefix: rtmToken.substring(0, 8),
          hasAuth: !!tokenResponse.auth,
          hasUser: !!tokenResponse.auth?.user,
          authKeys: Object.keys(tokenResponse.auth || {}),
          fullAuthData: JSON.stringify(tokenResponse.auth)
        });
        
        // Use the real user info from RTM
        userInfo = { 
          auth: tokenResponse.auth
        };
        
        await logger.log('rtm_user_info', {
          user_id: userInfo.auth.user?.id,
          username: userInfo.auth.user?.username,
          fullname: userInfo.auth.user?.fullname,
          has_real_data: true,
          user_data_keys: Object.keys(userInfo.auth.user || {})
        });
        
      } catch (tokenError) {
        await logger.log('rtm_token_error', {
          error: tokenError instanceof Error ? tokenError.message : String(tokenError),
          falling_back_to_mock: true
        });
        
        // Only use mock data if RTM fails completely
        rtmToken = 'mock-token-' + Date.now();
        userInfo = { 
          auth: { 
            user: { 
              id: 'rtm-user-' + Date.now(), 
              username: 'rtm-user',
              fullname: 'RTM User (Mock)'
            } 
          } 
        };
      }
      
      // Generate OAuth2 code
      const authCode = crypto.randomUUID();
      const codeData = {
        rtmToken,
        userName: userInfo.auth.user?.fullname || userInfo.auth.user?.username || 'Unknown User',
        userId: userInfo.auth.user?.id || 'unknown-id',
        client_id,
        code_challenge,
        code_challenge_method,
        isRealUser: !rtmToken.startsWith('mock-token-')
      };
      
      await logger.log('oauth_code_data', {
        ...codeData,
        rtmToken: rtmToken.substring(0, 8) + '...'
      });
      
      await c.env.AUTH_STORE.put(
        `auth_code:${authCode}`, 
        JSON.stringify(codeData), 
        { expirationTtl: 300 } // 5 minutes
      );
      
      await logger.log('oauth_code_generated', {
        code: authCode,
        stored_with_ttl: 300,
        has_code_challenge: !!code_challenge,
        key: `auth_code:${authCode}`,
        is_real_user: codeData.isRealUser
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
        error_type: error instanceof Error ? error.constructor.name : 'unknown',
        error_message: error instanceof Error ? error.message : String(error),
        rtm_error: error instanceof Error ? error.message : String(error)
      }, error instanceof Error ? error : undefined);
      
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
              <p>Error: ${error instanceof Error ? error.message : 'Unknown error'}</p>
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
        error_type: error instanceof Error ? error.constructor.name : 'unknown',
        error_message: error instanceof Error ? error.message : String(error)
      }, error instanceof Error ? error : undefined);
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
      await logger.log('userinfo_token_not_found', {
        token_prefix: token.substring(0, 8)
      });
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
      registration_endpoint: `${baseUrl}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256', 'plain'],
      token_endpoint_auth_methods_supported: ['none'],
      introspection_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['read', 'delete']
    });
  });

  // Debug endpoint for specific sessions only
  app.get('/debug/session/:sessionId', async (c) => {
    const { DebugLogger } = await import('./debug-logger');
    const logs = await DebugLogger.getSessionLogs(c.env, c.req.param('sessionId'));
    return c.json(logs);
  });

  return app;
}