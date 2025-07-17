# ADR-Practices-Telemetry: Observability for 3-5 Year Maintenance

**Status:** Accepted  
**Date:** 2025-01-07

## Context  

Solo developer maintaining production services for 3-5 years needs visibility into:
- Error patterns
- Performance degradation  
- Usage patterns
- Debug information when issues occur

## Decision

Implement **lightweight telemetry** using Cloudflare native features.

### Implementation

```typescript
// 1. Structured Logging
interface LogEntry {
  timestamp: number
  level: 'info' | 'warn' | 'error'
  service: string
  userId?: string
  operation: string
  duration?: number
  error?: string
  metadata?: Record<string, unknown>
}

// 2. Metrics Collection  
class MetricsCollector {
  async track(event: MetricEvent) {
    // Write to Analytics Engine
    env.ANALYTICS.writeDataPoint({
      blobs: [event.type, event.name],
      doubles: [event.duration || 0],
      indexes: [event.userId || 'anonymous']
    })
  }
}

// 3. Error Tracking
async function trackError(error: Error, context: Context) {
  await env.ERRORS_KV.put(
    `error:${Date.now()}:${nanoid()}`,
    JSON.stringify({
      message: error.message,
      stack: error.stack,
      context,
      timestamp: Date.now()
    }),
    { expirationTtl: 2592000 } // 30 days
  )
}
What We Track

All API calls (success/failure, duration)
Tool invocations
Authentication flows
Error details with context
Performance metrics (p50, p95, p99)

What We Don't Track

Personal data beyond user ID
Message contents
Detailed user behavior

Rationale

Native Tools: No external dependencies
Low Overhead: Minimal performance impact
Actionable: Focuses on what helps debugging
Privacy-Conscious: No PII in logs

Dashboard
Create Cloudflare Analytics dashboard showing:

Request volume by service
Error rates and types
Performance percentiles
Geographic distribution