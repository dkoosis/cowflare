import { Hono } from 'hono';
import { RtmApi } from './rtm-api';
import type { Env } from './types';

/**
 * Creates a Hono app that acts as an OAuth2 adapter for RTM's non-standard frob-based auth.
 * This handler manually implements the /authorize, /callback, and /token endpoints.
 */
export function createRtmHandler() {
  const app = new Hono<{ Bindings: Env }>();

  /**
   * Endpoint 1: /authorize
   * The MCP client (e.g., Claude.ai) starts the OAuth flow here.
   * Our job is to kick off the RTM-specific flow.
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

    // Validate required parameters
    if (!redirect_uri) {
      return c.json({ error: 'invalid_request', error_description: 'Missing redirect_uri parameter' }, 400);
    }

    if (response_type !== 'code') {
      return c.json({ error: 'unsupported_response_type', error_description: 'Only code response type is supported' }, 400);
    }

    try {
      const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);
      
      // 1. Get a "frob" from RTM. This is a temporary identifier.
      const frob = await api.getFrob();
      console.log('[OAuth] Got frob:', frob);

      // 2. Store the client's details, keyed by the frob. We'll need them at the /callback step.
      const sessionData = {
        redirect_uri,
        state,
        client_id,
        code_challenge,
        code_challenge_method,
        timestamp: Date.now()
      };
      
      await c.env.AUTH_STORE.put(
        `oauth_session:${frob}`,
        JSON.stringify(sessionData),
        { expirationTtl: 600 } // Expire in 10 minutes
      );

      // 3. Generate the authentication URL the user must visit at RTM.
      // Use the scope to determine permissions (default to delete for full access)
      const perms = scope === 'read' ? 'read' : 'delete';
      const rtmAuthUrl = await api.getAuthUrl(frob, perms);
      
      console.log('[OAuth] Redirecting to RTM auth URL');

      // 4. Redirect the user's browser to the RTM auth URL.
      return c.redirect(rtmAuthUrl);
    } catch (error) {
      console.error('[OAuth] /authorize error:', error);
      return c.json({ error: 'server_error', error_description: 'Failed to initiate authentication' }, 500);
    }
  });

  /**
   * Endpoint 2: /callback
   * RTM redirects the user back here after they grant permission.
   * Note: Update RTM application settings to use this as the callback URL
   */
  app.get('/callback', async (c) => {
    console.log('[OAuth] /callback called with params:', c.req.query());
    
    // 1. RTM provides the frob in the query parameters.
    const frob = c.req.query('frob');
    if (!frob) {
      return c.text('Missing frob parameter', 400);
    }

    // 2. Retrieve the original client's details from KV.
    const sessionJSON = await c.env.AUTH_STORE.get(`oauth_session:${frob}`);
    if (!sessionJSON) {
      return c.text('Invalid or expired session. Please try again.', 400);
    }
    
    const sessionData = JSON.parse(sessionJSON);
    const { redirect_uri, state, client_id, code_challenge, code_challenge_method } = sessionData;

    try {
      // 3. Exchange the frob for a permanent RTM auth token.
      const api = new RtmApi(c.env.RTM_API_KEY, c.env.RTM_SHARED_SECRET);
      const rtmToken = await api.getToken(frob);
      console.log('[OAuth] Successfully got RTM token');

      // Get user info for the MCP connection
      const userInfo = await api.makeRequest('rtm.auth.checkToken', { auth_token: rtmToken });
      
      // 4. Generate a temporary authorization code for the OAuth2 flow.
      const authCode = crypto.randomUUID();
      
      // 5. Store the mapping from auth code to RTM token and user info.
      const codeData = {
        rtmToken,
        userName: userInfo.auth.user.fullname || userInfo.auth.user.username,
        userId: userInfo.auth.user.id,
        client_id,
        code_challenge,
        code_challenge_method,
        timestamp: Date.now()
      };
      
      await c.env.AUTH_STORE.put(
        `auth_code:${authCode}`, 
        JSON.stringify(codeData), 
        { expirationTtl: 300 } // Expire in 5 minutes
      );
      
      // Clean up the session
      await c.env.AUTH_STORE.delete(`oauth_session:${frob}`);

      // 6. Redirect the user back to the MCP client's original redirect_uri.
      const finalRedirectUrl = new URL(redirect_uri);
      finalRedirectUrl.searchParams.set('code', authCode);
      if (state) {
        finalRedirectUrl.searchParams.set('state', state);
      }

      console.log('[OAuth] Redirecting back to client');
      return c.redirect(finalRedirectUrl.toString());
    } catch (error) {
      console.error('[OAuth] /callback error:', error);
      
      // On error, redirect back with error parameter
      const errorRedirectUrl = new URL(redirect_uri);
      errorRedirectUrl.searchParams.set('error', 'access_denied');
      errorRedirectUrl.searchParams.set('error_description', 'Authentication failed');
      if (state) {
        errorRedirectUrl.searchParams.set('state', state);
      }
      
      return c.redirect(errorRedirectUrl.toString());
    }
  });

  /**
   * Endpoint 3: /token
   * The MCP client exchanges the authorization code for an access token.
   */
  app.post('/token', async (c) => {
    console.log('[OAuth] /token called');
    
    const body = await c.req.parseBody();
    const {
      grant_type,
      code,
      client_id,
      client_secret,
      redirect_uri,
      code_verifier
    } = body as Record<string, string>;

    // Validate request
    if (grant_type !== 'authorization_code') {
      return c.json({ 
        error: 'unsupported_grant_type',
        error_description: 'Only authorization_code grant type is supported'
      }, 400);
    }

    if (!code) {
      return c.json({ 
        error: 'invalid_request',
        error_description: 'Missing code parameter'
      }, 400);
    }

    try {
      // 1. Look up the stored data using the provided code.
      const codeDataJSON = await c.env.AUTH_STORE.get(`auth_code:${code}`);
      if (!codeDataJSON) {
        return c.json({ 
          error: 'invalid_grant',
          error_description: 'Invalid or expired authorization code'
        }, 400);
      }

      const codeData = JSON.parse(codeDataJSON);
      
      // Validate client_id matches
      if (client_id && codeData.client_id && client_id !== codeData.client_id) {
        return c.json({ 
          error: 'invalid_client',
          error_description: 'Client ID mismatch'
        }, 400);
      }

      // TODO: Validate PKCE code_verifier if code_challenge was provided
      // This would involve hashing code_verifier and comparing to stored code_challenge

      // 2. Delete the temporary code so it can't be reused.
      await c.env.AUTH_STORE.delete(`auth_code:${code}`);

      // 3. Store permanent token mapping for MCP access
      await c.env.AUTH_STORE.put(
        `token:${codeData.rtmToken}`,
        JSON.stringify({
          userName: codeData.userName,
          userId: codeData.userId,
          client_id: codeData.client_id,
          created_at: Date.now()
        })
      );

      // 4. Return the RTM token in the standard OAuth2 access token response format.
      console.log('[OAuth] Token exchange successful');
      return c.json({
        access_token: codeData.rtmToken,
        token_type: 'Bearer',
        scope: 'delete' // RTM doesn't use scopes, but OAuth2 clients might expect this
      });
    } catch (error) {
      console.error('[OAuth] /token error:', error);
      return c.json({ 
        error: 'server_error',
        error_description: 'Token exchange failed'
      }, 500);
    }
  });

  /**
   * OAuth2 metadata endpoint for auto-discovery
   */
  app.get('/.well-known/oauth-authorization-server', (c) => {
    const baseUrl = c.env.SERVER_URL || `https://${c.req.header('host')}`;
    
    return c.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256', 'plain'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['read', 'delete']
    });
  });

  return app;
}