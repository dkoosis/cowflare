/**
 * @file types.ts
 * @description Central type definitions for RTM MCP Server
 */

// Environment configuration
export interface Env {
  // Environment Variables
  RTM_API_KEY: string;
  RTM_SHARED_SECRET: string;
  SERVER_URL: string;
  
  // KV Namespaces  
  AUTH_STORE: KVNamespace;
  OAUTH_DATABASE: KVNamespace;
  OAUTH_SESSIONS: KVNamespace;
  OAUTH_KV: KVNamespace;
  
  // Durable Objects
  RTM_MCP: DurableObjectNamespace;
  MCP_OBJECT: DurableObjectNamespace;
  
  // Cookie encryption for OAuth sessions
  COOKIE_ENCRYPTION_KEY?: string;
}

// RTM API Types
export interface RTMAuthData {
  token: string;
  user: {
    id: string;
    username: string;
    fullname: string;
  };
}

export interface RTMList {
  id: string;
  name: string;
  deleted: '0' | '1';
  locked: '0' | '1';
  archived: '0' | '1';
  position: string;
  smart: '0' | '1';
  sort_order?: string;
  filter?: string;
}

export interface RTMTask {
  id: string;
  due?: string;
  has_due_time: '0' | '1';
  added: string;
  completed?: string;
  deleted?: string;
  priority: 'N' | '1' | '2' | '3';
  postponed: string;
  estimate?: string;
}

export interface RTMTaskSeries {
  id: string;
  created: string;
  modified: string;
  name: string;
  source: string;
  url?: string;
  location_id?: string;
  tags?: RTMTags;
  participants?: any[];
  notes?: RTMNotes;
  task: RTMTask[];
}

export interface RTMTags {
  tag: string | string[];
}

export interface RTMNotes {
  note: RTMNote | RTMNote[];
}

export interface RTMNote {
  id: string;
  created: string;
  modified: string;
  title?: string;
  $t: string; // Note content
}

export interface RTMTransaction {
  id: string;
  undoable: '0' | '1';
}

export interface RTMTimeline {
  timeline: string;
}

// Cache Types
export interface CachedItem<T> {
  data: T;
  expiresAt: number;
  cachedAt: number;
  etag?: string;
}

export interface CacheOptions {
  ttl: number;
  staleWhileRevalidate?: number;
  etag?: string;
}

// Auth Types
export interface PendingAuth {
  frob: string;
  created_at: number;
  expires_at: number;
}

export interface CachedAuth {
  token: string;
  user: {
    id: string;
    username: string;
    fullname: string;
  };
  created_at: number;
}

// Rate Limit Types
export interface RateLimitData {
  count: number;
  resetAt: number;
  firstRequestAt: number;
  lastRequestAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

// Metrics Types
export interface MetricEvent {
  type: 'tool_call' | 'api_call' | 'cache_hit' | 'cache_miss' | 'rate_limit' | 'error';
  name: string;
  duration?: number;
  success?: boolean;
  error?: string;
  metadata?: Record<string, any>;
}

// Error Types
export interface RTMError {
  code: string;
  msg: string;
}

export interface RTMResponse<T> {
  rsp: {
    stat: 'ok' | 'fail';
    err?: RTMError;
  } & T;
}

// OAuth Types (for MCP OAuth flow)
export interface OAuthState {
  sessionId: string;
  timestamp: number;
  redirectUri?: string;
}

export interface StoredToken {
  token: string;
  userId: string;
  userName: string;
  createdAt: number;
  expiresAt?: number;
}

// Worker-specific types
export interface WorkerContext {
  env: Env;
  ctx: ExecutionContext;
  sessionId?: string;
}