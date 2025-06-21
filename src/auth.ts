// auth.ts - Authentication and rate limiting utilities

import { Env } from "./rtm-api.js";

interface PendingAuth {
  frob: string;
  created_at: number;
}

interface CachedAuth {
  token: string;
  user: {
    id: string;
    username: string;
    fullname: string;
  };
}

// Rate limiting with improved client identification
export async function checkRateLimit(clientId: string, env: Env): Promise<boolean> {
  const key = `rate:${clientId}`;
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute window
  const maxRequests = 60; // 60 requests per minute
  
  const data = await env.AUTH_STORE.get(key, "json") as { count: number; resetAt: number } | null;
  
  if (!data || now > data.resetAt) {
    // New window
    await env.AUTH_STORE.put(key, JSON.stringify({
      count: 1,
      resetAt: now + windowMs
    }), {
      expirationTtl: 60 // Expire after 1 minute
    });
    return true;
  }
  
  if (data.count >= maxRequests) {
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
}

// Pending auth management
export async function savePendingAuth(sessionId: string, frob: string, env: Env): Promise<void> {
  const pendingAuth: PendingAuth = {
    frob,
    created_at: Date.now()
  };
  
  await env.AUTH_STORE.put(
    `pending:${sessionId}`,
    JSON.stringify(pendingAuth),
    {
      expirationTtl: 300 // 5 minutes TTL
    }
  );
}

export async function getPendingAuth(sessionId: string, env: Env): Promise<PendingAuth | null> {
  const data = await env.AUTH_STORE.get(`pending:${sessionId}`, "json");
  return data as PendingAuth | null;
}

// Auth token caching
export async function cacheAuthToken(sessionId: string, auth: any, env: Env): Promise<void> {
  const cachedAuth: CachedAuth = {
    token: auth.token,
    user: {
      id: auth.user.id,
      username: auth.user.username,
      fullname: auth.user.fullname
    }
  };
  
  await env.AUTH_STORE.put(
    `auth:${sessionId}`,
    JSON.stringify(cachedAuth),
    {
      expirationTtl: 86400 // 24 hours TTL
    }
  );
}

export async function getCachedAuthToken(sessionId: string, env: Env): Promise<CachedAuth | null> {
  const data = await env.AUTH_STORE.get(`auth:${sessionId}`, "json");
  return data as CachedAuth | null;
}