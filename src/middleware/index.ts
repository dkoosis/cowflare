/**
 * @file middleware/index.ts
 * @description Middleware functions for authentication, rate limiting, and request handling
 * Consolidates HTTP-level concerns separate from MCP protocol logic
 */

import { Env, makeRTMRequest } from '../rtm-api';
import { 
  getPendingAuth, 
  cacheAuthToken 
} from '../auth';
import { Logger } from '../utils/logger';

/**
 * Rate limit configuration
 */
interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}

/**
 * Rate limit data structure
 */
interface RateLimitData {
  count: number;
  resetAt: number;
  firstRequestAt: number;
  lastRequestAt?: number;
}

/**
 * Default rate limit configuration
 */
const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 60,    // 60 requests per minute
  keyPrefix: 'rate'
};

/**
 * Extracts client identifier from request
 */
export function getClientId(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ||
         request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
         request.headers.get('X-Real-IP') ||
         'anonymous';
}

/**
 * Checks if a client has exceeded the rate limit
 */
export async function checkRateLimit(
  clientId: string,
  env: Env,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT
): Promise<boolean> {
  const key = `${config.keyPrefix}:${clientId}`;
  const now = Date.now();

  try {
    // Get current rate limit data
    const data = await env.AUTH_STORE.get(key, "json") as RateLimitData | null;

    if (!data || now > data.resetAt) {
      // Start new window
      const newData: RateLimitData = {
        count: 1,
        resetAt: now + config.windowMs,
        firstRequestAt: now,
        lastRequestAt: now
      };

      await env.AUTH_STORE.put(
        key,
        JSON.stringify(newData),
        { expirationTtl: Math.ceil(config.windowMs / 1000) }
      );

      Logger.info('Rate limit window started', { clientId, key });
      return true;
    }

    // Check if limit exceeded
    if (data.count >= config.maxRequests) {
      Logger.warn('Rate limit exceeded', { 
        clientId, 
        count: data.count, 
        limit: config.maxRequests,
        resetIn: data.resetAt - now
      });
      return false;
    }

    // Increment counter
    const updatedData: RateLimitData = {
      ...data,
      count: data.count + 1,
      lastRequestAt: now
    };

    const ttl = Math.ceil((data.resetAt - now) / 1000);
    await env.AUTH_STORE.put(
      key,
      JSON.stringify(updatedData),
      { expirationTtl: ttl }
    );

    return true;

  } catch (error: any) {
    Logger.error('Rate limit check failed', { 
      error: error.message, 
      clientId 
    });
    
    // Fail open - allow request on error
    return true;
  }
}

/**
 * Gets rate limit status for a client
 */
export async function getRateLimitStatus(
  clientId: string,
  env: Env,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT
): Promise<{
  remaining: number;
  resetAt: number;
  limit: number;
}> {
  const key = `${config.keyPrefix}:${clientId}`;
  const now = Date.now();

  try {
    const data = await env.AUTH_STORE.get(key, "json") as RateLimitData | null;

    if (!data || now > data.resetAt) {
      return {
        remaining: config.maxRequests,
        resetAt: now + config.windowMs,
        limit: config.maxRequests
      };
    }

    return {
      remaining: Math.max(0, config.maxRequests - data.count),
      resetAt: data.resetAt,
      limit: config.maxRequests
    };

  } catch (error: any) {
    Logger.error('Failed to get rate limit status', { 
      error: error.message, 
      clientId 
    });
    
    return {
      remaining: config.maxRequests,
      resetAt: now + config.windowMs,
      limit: config.maxRequests
    };
  }
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
  const frob = url.searchParams.get('frob');

  if (!sessionId) {
    Logger.warn('OAuth callback missing session ID');
    return createErrorPage(
      'Invalid Request',
      'Missing session ID in callback URL.'
    );
  }

  try {
    // Get pending auth
    const pending = await getPendingAuth(sessionId, env);
    if (!pending) {
      Logger.warn('OAuth callback with invalid session', { sessionId });
      return createErrorPage(
        'Session Expired',
        'Your authentication session has expired. Please start over.'
      );
    }

    // Try to exchange frob for token
    try {
      const response = await makeRTMRequest(
        'rtm.auth.getToken',
        { frob: pending.frob },
        env.RTM_API_KEY,
        env.RTM_SHARED_SECRET
      );

      // Cache the auth token
      await cacheAuthToken(sessionId, response.auth, env);

      // Clean up pending auth
      await env.AUTH_STORE.delete(`pending:${sessionId}`);

      Logger.info('OAuth callback successful', { 
        sessionId,
        username: response.auth.user.username 
      });

      // Return success page
      return createSuccessPage(
        response.auth.user.fullname,
        sessionId
      );

    } catch (apiError: any) {
      Logger.error('OAuth token exchange failed', { 
        error: apiError.message,
        sessionId 
      });

      // Check if it's a timing issue
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
    Logger.error('OAuth callback error', { 
      error: error.message,
      sessionId 
    });
    
    return createErrorPage(
      'Unexpected Error',
      'An unexpected error occurred during authentication.'
    );
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
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  
  return str.replace(/[&<>"']/g, char => htmlEscapes[char]);
}