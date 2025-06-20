interface Env {
  AUTH_STORE: KVNamespace;
}

export async function checkRateLimit(clientId: string, env: Env): Promise<boolean> {
  // Updated fallback chain for client identification
  const key = `rate:${clientId}`;
  const data = await env.AUTH_STORE.get(key);
  
  if (!data) {
    await env.AUTH_STORE.put(key, JSON.stringify({
      count: 1,
      resetAt: Date.now() + 3600000 // 1 hour
    }), { expirationTtl: 3600 });
    return true;
  }
  
  const rateData = JSON.parse(data);
  if (Date.now() > rateData.resetAt) {
    await env.AUTH_STORE.put(key, JSON.stringify({
      count: 1,
      resetAt: Date.now() + 3600000
    }), { expirationTtl: 3600 });
    return true;
  }
  
  if (rateData.count >= 100) {
    return false;
  }
  
  rateData.count++;
  await env.AUTH_STORE.put(key, JSON.stringify(rateData), { expirationTtl: 3600 });
  return true;
}

export async function cacheAuthToken(sessionId: string, authData: any, env: Env): Promise<void> {
  await env.AUTH_STORE.put(`token:${sessionId}`, JSON.stringify({
    token: authData.token,
    username: authData.user.username,
    fullname: authData.user.fullname,
    cachedAt: Date.now(),
    expires: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
  }), { expirationTtl: 7 * 24 * 60 * 60 });
}

export async function getCachedToken(sessionId: string, env: Env): Promise<any | null> {
  const data = await env.AUTH_STORE.get(`token:${sessionId}`);
  if (!data) return null;
  
  const cached = JSON.parse(data);
  if (Date.now() > cached.expires) {
    await env.AUTH_STORE.delete(`token:${sessionId}`);
    return null;
  }
  
  return cached;
}