/**
 * @file auth.ts
 * @description Authentication and rate limiting utilities
 */

import { Env } from "./rtm-api.js";

// Type definitions for stored data
export interface PendingAuth {
  frob: string;
  created_at: number;
}

export interface CachedAuth {
  token: string;
  user: {
    id: string;
    username: string;
    fullname: string;
  };
  cached_at: number;
}

interface RateLimitData {
  count: number;
  resetAt: number;
}

// Constants
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60; // 60 requests per minute
const PENDING_AUTH_TTL = 300; // 5 minutes
const CACHED_AUTH_TTL = 86400; // 24 hours

/**
 * Enhanced rate limiting with improved client identification
 * @param request - The incoming request
 * @returns Client identifier string
 */
export function getClientId(request: Request): string {
  const forwardedFor = request.headers.get('X-Forwarded-For');
  const firstIp = forwardedFor?.split(',')[0]?.trim(); // Add optional chaining
  
  return request.headers.get('CF-Connecting-IP') || 
         firstIp || 
         request.headers.get('X-Real-IP') ||
         'anonymous';
}

/**
 * Check if a client has exceeded the rate limit
 * @param clientId - Unique client identifier
 * @param env - Cloudflare environment
 * @returns true if request is allowed, false if rate limited
 */
export async function checkRateLimit(clientId: string, env: Env): Promise<boolean> {
  const key = `rate:${clientId}`;
  const now = Date.now();
  
  try {
    const data = await env.AUTH_STORE.get<RateLimitData>(key, "json");
    
    if (!data || now > data.resetAt) {
      // New window
      await env.AUTH_STORE.put(key, JSON.stringify({
        count: 1,
        resetAt: now + RATE_LIMIT_WINDOW_MS
      }), {
        expirationTtl: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)
      });
      return true;
    }
    
    if (data.count >= RATE_LIMIT_MAX_REQUESTS) {
      return false;
    }
    
    // Increment counter
    await env.AUTH_STORE.put(key, JSON.stringify({
      count: data.count + 1,
      resetAt: data.resetAt
    }), {
      expirationTtl: Math.ceil((data.resetAt - now) / 1000)
    });
    
    return true;
  } catch (error) {
    // Log error but allow request on rate limit check failure
    console.error('Rate limit check failed:', error);
    return true;
  }
}

/**
 * Save pending authentication data
 * @param sessionId - Unique session identifier
 * @param frob - RTM frob for authentication
 * @param env - Cloudflare environment
 */
export async function savePendingAuth(sessionId: string, frob: string, env: Env): Promise<void> {
  const pendingAuth: PendingAuth = {
    frob,
    created_at: Date.now()
  };
  
  await env.AUTH_STORE.put(
    `pending:${sessionId}`,
    JSON.stringify(pendingAuth),
    {
      expirationTtl: PENDING_AUTH_TTL
    }
  );
}

/**
 * Retrieve pending authentication data
 * @param sessionId - Session identifier
 * @param env - Cloudflare environment
 * @returns PendingAuth data or null if not found/expired
 */
export async function getPendingAuth(sessionId: string, env: Env): Promise<PendingAuth | null> {
  try {
    const data = await env.AUTH_STORE.get<PendingAuth>(`pending:${sessionId}`, "json");
    return data;
  } catch (error) {
    console.error('Failed to get pending auth:', error);
    return null;
  }
}

/**
 * Cache authenticated user data
 * @param sessionId - Session identifier
 * @param auth - Authentication response from RTM
 * @param env - Cloudflare environment
 */
export async function cacheAuthToken(sessionId: string, auth: any, env: Env): Promise<void> {
  const cachedAuth: CachedAuth = {
    token: auth.token,
    user: {
      id: auth.user.id,
      username: auth.user.username,
      fullname: auth.user.fullname
    },
    cached_at: Date.now()
  };
  
  await env.AUTH_STORE.put(
    `auth:${sessionId}`,
    JSON.stringify(cachedAuth),
    {
      expirationTtl: CACHED_AUTH_TTL
    }
  );
}

/**
 * Retrieve cached authentication data
 * @param sessionId - Session identifier
 * @param env - Cloudflare environment
 * @returns CachedAuth data or null if not found
 */
export async function getCachedAuthToken(sessionId: string, env: Env): Promise<CachedAuth | null> {
  try {
    const data = await env.AUTH_STORE.get<CachedAuth>(`auth:${sessionId}`, "json");
    return data;
  } catch (error) {
    console.error('Failed to get cached auth:', error);
    return null;
  }
}

/**
 * Delete pending authentication data
 * @param sessionId - Session identifier
 * @param env - Cloudflare environment
 */
export async function deletePendingAuth(sessionId: string, env: Env): Promise<void> {
  await env.AUTH_STORE.delete(`pending:${sessionId}`);
}

/**
 * Handles OAuth callback from Remember The Milk
 */
export async function handleAuthCallback(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session');

  if (!sessionId) {
    return createErrorPage(
      'Invalid Request',
      'Missing session ID in callback URL.'
    );
  }

  try {
    const pending = await getPendingAuth(sessionId, env);
    if (!pending) {
      return createErrorPage(
        'Session Expired',
        'Your authentication session has expired. Please start over.'
      );
    }

    // Import makeRTMRequest dynamically to avoid circular dependency
    const { makeRTMRequest } = await import('./rtm-api.js');
    
    try {
      const response = await makeRTMRequest(
        'rtm.auth.getToken',
        { frob: pending.frob },
        env.RTM_API_KEY,
        env.RTM_SHARED_SECRET
      );

      await cacheAuthToken(sessionId, response.auth, env);
      await env.AUTH_STORE.delete(`pending:${sessionId}`);

      return createSuccessPage(
        response.auth.user.fullname,
        sessionId
      );

    } catch (apiError: any) {
      if (apiError.message.includes('Invalid frob') || 
          apiError.message.includes('frob is not valid')) {
        return createErrorPage(
          'Authorization Pending',
          'The authorization is not complete yet. Please make sure you clicked "Authorize" on the RTM page.',
          sessionId
        );
      }

      return createErrorPage(
        'Authentication Failed',
        `Unable to complete authentication: ${apiError.message}`
      );
    }

  } catch (error: any) {
    console.error('OAuth callback error:', error);
    
    return createErrorPage(
      'Unexpected Error',
      'An unexpected error occurred during authentication.'
    );
  }
}

/**
 * Authentication manager class for more complex auth operations
 */
export class AuthManager {
  constructor(private env: Env) {}

  /**
   * Get authentication token, checking cache first
   * @param sessionId - Session identifier
   * @returns Authentication token or null
   */
  async getAuthToken(sessionId: string): Promise<string | null> {
    const cached = await getCachedAuthToken(sessionId, this.env);
    return cached?.token || null;
  }

  /**
   * Check if a session has valid authentication
   * @param sessionId - Session identifier
   * @returns true if authenticated
   */
  async isAuthenticated(sessionId: string): Promise<boolean> {
    const token = await this.getAuthToken(sessionId);
    return token !== null;
  }

  /**
   * Clear all authentication data for a session
   * @param sessionId - Session identifier
   */
  async clearSession(sessionId: string): Promise<void> {
    await Promise.all([
      this.env.AUTH_STORE.delete(`auth:${sessionId}`),
      this.env.AUTH_STORE.delete(`pending:${sessionId}`)
    ]);
  }
}

/**
 * Creates a success page for OAuth callback
 */
function createSuccessPage(
  fullname: string,
  sessionId: string
): Response {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Authentication Successful - RTM MCP Server</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 20px;
          }
          .container {
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            padding: 48px;
            max-width: 480px;
            width: 100%;
            text-align: center;
          }
          .icon {
            width: 80px;
            height: 80px;
            background: #4CAF50;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px;
            font-size: 40px;
          }
          h1 {
            color: #333;
            font-size: 28px;
            margin-bottom: 16px;
          }
          .welcome {
            color: #666;
            font-size: 18px;
            margin-bottom: 32px;
          }
          .session-box {
            background: #f5f5f5;
            border: 2px dashed #ddd;
            border-radius: 8px;
            padding: 16px;
            margin: 24px 0;
          }
          .session-label {
            color: #888;
            font-size: 14px;
            margin-bottom: 8px;
          }
          .session-id {
            font-family: 'Courier New', monospace;
            font-size: 16px;
            color: #333;
            word-break: break-all;
            user-select: all;
          }
          .instructions {
            color: #666;
            font-size: 16px;
            line-height: 1.6;
            margin-top: 24px;
          }
          .code {
            background: #f0f0f0;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: monospace;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">✓</div>
          <h1>Authentication Successful!</h1>
          <p class="welcome">Welcome, <strong>${escapeHtml(fullname)}</strong>!</p>
          
          <div class="session-box">
            <div class="session-label">Your Session ID:</div>
            <div class="session-id">${escapeHtml(sessionId)}</div>
          </div>
          
          <div class="instructions">
            <p>You can now close this window and return to your application.</p>
            <p style="margin-top: 16px;">
              To complete the setup, use <span class="code">rtm_complete_auth</span> 
              with the session ID above.
            </p>
          </div>
        </div>
      </body>
    </html>
  `;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

/**
 * Creates an error page for OAuth callback
 */
function createErrorPage(
  title: string,
  message: string,
  sessionId?: string
): Response {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${escapeHtml(title)} - RTM MCP Server</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #ee7752 0%, #e73c7e 100%);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 20px;
          }
          .container {
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            padding: 48px;
            max-width: 480px;
            width: 100%;
            text-align: center;
          }
          .icon {
            width: 80px;
            height: 80px;
            background: #f44336;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px;
            font-size: 40px;
            color: white;
          }
          h1 {
            color: #333;
            font-size: 28px;
            margin-bottom: 16px;
          }
          .message {
            color: #666;
            font-size: 16px;
            line-height: 1.6;
            margin-bottom: 24px;
          }
          .session-info {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 8px;
            padding: 16px;
            margin-top: 24px;
            color: #856404;
            font-size: 14px;
          }
          .code {
            font-family: monospace;
            background: #f0f0f0;
            padding: 2px 6px;
            border-radius: 4px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">✕</div>
          <h1>${escapeHtml(title)}</h1>
          <p class="message">${escapeHtml(message)}</p>
          
          ${sessionId ? `
            <div class="session-info">
              <strong>Session ID:</strong> <span class="code">${escapeHtml(sessionId)}</span>
              <br><br>
              Please try running <span class="code">rtm_complete_auth</span> again in a moment.
            </div>
          ` : ''}
        </div>
      </body>
    </html>
  `;

  return new Response(html, {
    status: 400,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

/**
 * Escapes HTML to prevent XSS
 */
function escapeHtml(str: string): string {
  if (!str) return ''; // Add guard clause
  
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  
  return str.replace(/[&<>"']/g, char => htmlEscapes[char]);
}