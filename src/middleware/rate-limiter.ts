/**
 * @file middleware/rate-limiter.ts
 * @description Token bucket rate limiter for Cloudflare Workers
 */

import { RateLimitData, RateLimitResult } from '../types';

export interface RateLimitConfig {
  windowMs: number;
  maxTokens: number;
  refillRate: number; // tokens per second
  keyPrefix: string;
}

export class RateLimiter {
  private readonly defaultConfig: RateLimitConfig = {
    windowMs: 60000, // 1 minute
    maxTokens: 60,
    refillRate: 1, // 1 token per second
    keyPrefix: 'rl'
  };

  constructor(
    private kvStore: KVNamespace,
    private config: RateLimitConfig = {} as RateLimitConfig
  ) {
    this.config = { ...this.defaultConfig, ...config };
  }

  /**
   * Checks if a request is allowed under the rate limit
   */
  async check(identifier: string, tokens: number = 1): Promise<RateLimitResult> {
    const key = `${this.config.keyPrefix}:${identifier}`;
    const now = Date.now();

    // Get current bucket state
    const data = await this.kvStore.get(key, "json") as RateLimitData | null;

    if (!data) {
      // Initialize new bucket
      const newData: RateLimitData = {
        count: this.config.maxTokens - tokens,
        resetAt: now + this.config.windowMs,
        firstRequestAt: now,
        lastRequestAt: now
      };

      await this.kvStore.put(
        key,
        JSON.stringify(newData),
        { expirationTtl: Math.ceil(this.config.windowMs / 1000) }
      );

      return {
        allowed: true,
        limit: this.config.maxTokens,
        remaining: newData.count,
        resetAt: newData.resetAt
      };
    }

    // Calculate tokens to add based on time elapsed
    const timeElapsed = now - data.lastRequestAt;
    const tokensToAdd = Math.floor(timeElapsed * this.config.refillRate / 1000);
    const currentTokens = Math.min(this.config.maxTokens, data.count + tokensToAdd);

    // Check if request can be allowed
    if (currentTokens < tokens) {
      const tokensNeeded = tokens - currentTokens;
      const timeToWait = Math.ceil(tokensNeeded / this.config.refillRate * 1000);
      
      return {
        allowed: false,
        limit: this.config.maxTokens,
        remaining: currentTokens,
        resetAt: data.resetAt,
        retryAfter: Math.ceil(timeToWait / 1000)
      };
    }

    // Update bucket
    const updatedData: RateLimitData = {
      count: currentTokens - tokens,
      resetAt: data.resetAt,
      firstRequestAt: data.firstRequestAt,
      lastRequestAt: now
    };

    const ttl = Math.ceil((data.resetAt - now) / 1000);
    await this.kvStore.put(
      key,
      JSON.stringify(updatedData),
      { expirationTtl: ttl }
    );

    return {
      allowed: true,
      limit: this.config.maxTokens,
      remaining: updatedData.count,
      resetAt: data.resetAt
    };
  }

  /**
   * Resets rate limit for an identifier
   */
  async reset(identifier: string): Promise<void> {
    const key = `${this.config.keyPrefix}:${identifier}`;
    await this.kvStore.delete(key);
  }

  /**
   * Gets current rate limit status without consuming tokens
   */
  async status(identifier: string): Promise<RateLimitResult> {
    const key = `${this.config.keyPrefix}:${identifier}`;
    const now = Date.now();

    const data = await this.kvStore.get(key, "json") as RateLimitData | null;

    if (!data) {
      return {
        allowed: true,
        limit: this.config.maxTokens,
        remaining: this.config.maxTokens,
        resetAt: now + this.config.windowMs
      };
    }

    // Calculate current tokens
    const timeElapsed = now - data.lastRequestAt;
    const tokensToAdd = Math.floor(timeElapsed * this.config.refillRate / 1000);
    const currentTokens = Math.min(this.config.maxTokens, data.count + tokensToAdd);

    return {
      allowed: currentTokens > 0,
      limit: this.config.maxTokens,
      remaining: currentTokens,
      resetAt: data.resetAt
    };
  }
}