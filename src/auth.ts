// src/auth.ts - Authentication and rate limiting utilities

import { Env } from "./rtm-api.js";
import { RateLimitError } from "./validation.js";

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
 * @param env - Cloudflare environment
 * @returns Client identifier string
 */
export function getClientId(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || 
         request.headers.get('X-Forwarded-For')?.split(',')[0].trim() || 
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