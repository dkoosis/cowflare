/**
 * @file monitoring/metrics.ts
 * @description Metrics collection for observability
 */

import { Env, MetricEvent } from '../types';

export class MetricsCollector {
  private buffer: MetricEvent[] = [];
  private flushInterval: number = 10000; // 10 seconds
  private maxBufferSize: number = 100;

  constructor(private env: Env) {
    // In a real implementation, you'd set up periodic flushing
  }

  async recordToolCall(
    toolName: string,
    duration: number,
    success: boolean,
    error?: string
  ): Promise<void> {
    await this.record({
      type: 'tool_call',
      name: toolName,
      duration,
      success,
      error,
      timestamp: Date.now()
    });
  }

  async recordApiCall(
    method: string,
    duration: number,
    success: boolean,
    statusCode?: number
  ): Promise<void> {
    await this.record({
      type: 'api_call',
      name: method,
      duration,
      success,
      metadata: { statusCode },
      timestamp: Date.now()
    });
  }

  async recordCacheHit(key: string): Promise<void> {
    await this.record({
      type: 'cache_hit',
      name: key,
      timestamp: Date.now()
    });
  }

  async recordCacheMiss(key: string): Promise<void> {
    await this.record({
      type: 'cache_miss',
      name: key,
      timestamp: Date.now()
    });
  }

  async recordRateLimit(clientId: string): Promise<void> {
    await this.record({
      type: 'rate_limit',
      name: clientId,
      timestamp: Date.now()
    });
  }

  async recordError(name: string, error: string, duration?: number): Promise<void> {
    await this.record({
      type: 'error',
      name,
      error,
      duration,
      success: false,
      timestamp: Date.now()
    });
  }

  /**
   * Gets aggregated metrics for a time window
   */
  async getMetrics(startTime: number, endTime: number): Promise<{
    toolCalls: Record<string, { count: number; avgDuration: number; errorRate: number }>;
    apiCalls: Record<string, { count: number; avgDuration: number; errorRate: number }>;
    cacheStats: { hits: number; misses: number; hitRate: number };
    rateLimits: number;
    errors: number;
  }> {
    // In a real implementation, this would query from persistent storage
    const events = this.buffer.filter(e => e.timestamp >= startTime && e.timestamp <= endTime);

    const toolCalls: Record<string, any> = {};
    const apiCalls: Record<string, any> = {};
    let cacheHits = 0;
    let cacheMisses = 0;
    let rateLimits = 0;
    let errors = 0;

    for (const event of events) {
      switch (event.type) {
        case 'tool_call':
          if (!toolCalls[event.name]) {
            toolCalls[event.name] = { count: 0, totalDuration: 0, errors: 0 };
          }
          toolCalls[event.name].count++;
          toolCalls[event.name].totalDuration += event.duration || 0;
          if (!event.success) toolCalls[event.name].errors++;
          break;

        case 'api_call':
          if (!apiCalls[event.name]) {
            apiCalls[event.name] = { count: 0, totalDuration: 0, errors: 0 };
          }
          apiCalls[event.name].count++;
          apiCalls[event.name].totalDuration += event.duration || 0;
          if (!event.success) apiCalls[event.name].errors++;
          break;

        case 'cache_hit':
          cacheHits++;
          break;

        case 'cache_miss':
          cacheMisses++;
          break;

        case 'rate_limit':
          rateLimits++;
          break;

        case 'error':
          errors++;
          break;
      }
    }

    // Calculate aggregates
    const aggregateTools: Record<string, any> = {};
    for (const [name, stats] of Object.entries(toolCalls)) {
      aggregateTools[name] = {
        count: stats.count,
        avgDuration: stats.totalDuration / stats.count,
        errorRate: stats.errors / stats.count
      };
    }

    const aggregateApis: Record<string, any> = {};
    for (const [name, stats] of Object.entries(apiCalls)) {
      aggregateApis[name] = {
        count: stats.count,
        avgDuration: stats.totalDuration / stats.count,
        errorRate: stats.errors / stats.count
      };
    }

    const totalCacheRequests = cacheHits + cacheMisses;
    const cacheHitRate = totalCacheRequests > 0 ? cacheHits / totalCacheRequests : 0;

    return {
      toolCalls: aggregateTools,
      apiCalls: aggregateApis,
      cacheStats: {
        hits: cacheHits,
        misses: cacheMisses,
        hitRate: cacheHitRate
      },
      rateLimits,
      errors
    };
  }

  private async record(event: MetricEvent): Promise<void> {
    this.buffer.push(event);

    // Flush if buffer is full
    if (this.buffer.length >= this.maxBufferSize) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    // In production, send to analytics service
    // For now, just clear the buffer
    const events = [...this.buffer];
    this.buffer = [];

    // If METRICS_STORE is available, persist metrics
    if (this.env.METRICS_STORE) {
      const batchId = `metrics:${Date.now()}`;
      await this.env.METRICS_STORE.put(
        batchId,
        JSON.stringify(events),
        { expirationTtl: 86400 * 7 } // 7 days retention
      );
    }
  }
}