/**
 * @file types.ts
 * @description Central type definitions for RTM MCP Server
 */

// Environment configuration
export interface Env {
  RTM_API_KEY: string;
  RTM_SHARED_SECRET: string;
  SERVER_URL: string;
  AUTH_STORE: KVNamespace;
  METRICS_STORE?: KVNamespace;
  LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error';
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
  timestamp: number;
}

// Logger Types
export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

// Simple Logger implementation
export interface Logger {
  debug(message: string, metadata?: Record<string, any>): void;
  info(message: string, metadata?: Record<string, any>): void;
  warn(message: string, metadata?: Record<string, any>): void;
  error(message: string, metadata?: Record<string, any>): void;
}

// Simple Metrics Collector implementation
export interface MetricsCollector {
  trackEvent(event: MetricEvent): void;
  getMetrics(): MetricEvent[];
}

// Tool Types
export interface ToolContext {
  env: Env;
  metrics: MetricsCollector;
  logger: Logger;
  requestId: string;
}

// Error Types
export class RTMError extends Error {
  constructor(
    message: string,
    public code?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'RTMError';
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string,
    public value?: any
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends Error {
  constructor(
    message: string,
    public requiresReauth: boolean = false
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }
}