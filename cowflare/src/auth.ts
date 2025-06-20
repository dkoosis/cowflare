// File: cowflare/src/auth.ts
/**
 * @file auth.ts
 * @description This file handles authentication-related logic, including rate limiting
 * and caching of authentication tokens in the Cloudflare KV store.
 */

interface Env {
  AUTH_STORE: KVNamespace;
}

/**
 * Checks if a client has exceeded the rate limit.
 * The rate limit is currently set to 100 requests per hour per client.
 * @param {string} clientId - The identifier for the client (e.g., IP address).
 * @param {Env} env - The worker's environment containing the AUTH_STORE.
 * @returns {Promise<boolean>} A promise that resolves to true if the request is allowed, false otherwise.
 */
export async function checkRateLimit(clientId: string, env: Env): Promise<boolean> {
  const key = `rate:${clientId}`;
  const data = await env.AUTH_STORE.get(key);
  
  if (!data) {
    // If no record exists, create one and allow the request.
    await env.AUTH_STORE.put(key, JSON.stringify({
      count: 1,
      resetAt: Date.now() + 3600000 // 1 hour from now
    }), { expirationTtl: 3600 });
    return true;
  }
  
  const rateData = JSON.parse(data);
  // Reset the count if the reset time has passed.
  if (Date.now() > rateData.resetAt) {
    await env.AUTH_STORE.put(key, JSON.stringify({
      count: 1,
      resetAt: Date.now() + 3600000
    }), { expirationTtl: 3600 });
    return true;
  }
  
  // Block the request if the count exceeds the limit.
  if (rateData.count >= 100) {
    return false;
  }
  
  // Increment the count and allow the request.
  rateData.count++;
  await env.AUTH_STORE.put(key, JSON.stringify(rateData), { expirationTtl: 3600 });
  return true;
}

/**
 * Caches a successful RTM authentication token in the KV store.
 * The token is stored with a 7-day expiration.
 * @param {string} sessionId - The unique session identifier to use as the cache key.
 * @param {any} authData - The authentication data object from the RTM API.
 * @param {Env} env - The worker's environment.
 */
export async function cacheAuthToken(sessionId: string, authData: any, env: Env): Promise<void> {
  const key = `token:${sessionId}`;
  console.log(`[KV_WRITE] Caching auth token to key: ${key}`);
  await env.AUTH_STORE.put(key, JSON.stringify({
    token: authData.token,
    username: authData.user.username,
    fullname: authData.user.fullname,
    cachedAt: Date.now(),
    expires: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
  }), { expirationTtl: 7 * 24 * 60 * 60 });
}

/**
 * Retrieves a cached authentication token from the KV store.
 * It automatically handles token expiration.
 * @param {string} sessionId - The session identifier to look up.
 * @param {Env} env - The worker's environment.
 * @returns {Promise<any | null>} A promise that resolves to the cached token data or null if not found or expired.
 */
export async function getCachedToken(sessionId: string, env: Env): Promise<any | null> {
  const key = `token:${sessionId}`;
  console.log(`[KV_READ] Attempting to get cached token from key: ${key}`);
  const data = await env.AUTH_STORE.get(key);
  
  if (!data) {
    console.log(`[KV_READ] Cache MISS for token key: ${key}`);
    return null;
  }
  
  const cached = JSON.parse(data);
  // Check if the token has expired.
  if (Date.now() > cached.expires) {
    console.log(`[KV_READ] Found expired token for key: ${key}. Deleting.`);
    await env.AUTH_STORE.delete(key);
    return null;
  }
  
  console.log(`[KV_READ] Cache HIT for token key: ${key}`);
  return cached;
}