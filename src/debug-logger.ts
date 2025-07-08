// File: src/debug-logger.ts
/**
 * Debug Logger for RTM OAuth Flow
 * Persists debug information to KV for systematic troubleshooting
 */

import type { Env } from './types';

export interface DebugEvent {
  timestamp: number;
  sessionId: string;
  event: string;
  endpoint?: string;
  data: Record<string, any>;
  error?: string;
  stackTrace?: string;
}

export class DebugLogger {
  private env: Env;
  private sessionId: string;
  
  constructor(env: Env, sessionId?: string) {
    this.env = env;
    this.sessionId = sessionId || crypto.randomUUID();
  }

  async log(event: string, data: Record<string, any> = {}, error?: Error) {
    const debugEvent: DebugEvent = {
      timestamp: Date.now(),
      sessionId: this.sessionId,
      event,
      endpoint: data.endpoint,
      data: this.sanitizeData(data),
      error: error?.message,
      stackTrace: error?.stack
    };

    // Store in KV with TTL
    const key = `debug:${this.sessionId}:${Date.now()}`;
    await this.env.AUTH_STORE.put(
      key,
      JSON.stringify(debugEvent),
      { expirationTtl: 86400 } // 24 hours
    );

    // Also log to console for real-time monitoring
    console.log(`[DEBUG ${event}]`, debugEvent);
  }

  // Sanitize sensitive data
  private sanitizeData(data: Record<string, any>): Record<string, any> {
    const sanitized = { ...data };
    const sensitiveKeys = ['auth_token', 'client_secret', 'rtmToken', 'password'];
    
    for (const key of sensitiveKeys) {
      if (sanitized[key]) {
        sanitized[key] = '[REDACTED]';
      }
    }
    
    // Sanitize nested objects
    for (const [key, value] of Object.entries(sanitized)) {
      if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeData(value);
      }
    }
    
    return sanitized;
  }

  // Get recent debug logs for a session
  static async getSessionLogs(env: Env, sessionId: string): Promise<DebugEvent[]> {
    const prefix = `debug:${sessionId}:`;
    const list = await env.AUTH_STORE.list({ prefix });
    
    const events: DebugEvent[] = [];
    for (const key of list.keys) {
      const value = await env.AUTH_STORE.get(key.name);
      if (value) {
        events.push(JSON.parse(value));
      }
    }
    
    return events.sort((a, b) => a.timestamp - b.timestamp);
  }

  // Get all recent sessions
  static async getRecentSessions(env: Env, hours: number = 24): Promise<string[]> {
    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    const list = await env.AUTH_STORE.list({ prefix: 'debug:' });
    
    const sessions = new Set<string>();
    for (const key of list.keys) {
      const parts = key.name.split(':');
      if (parts.length >= 3) {
        const timestamp = parseInt(parts[2]);
        if (timestamp > cutoff) {
          sessions.add(parts[1]);
        }
      }
    }
    
    return Array.from(sessions);
  }
}

// Middleware to inject debug logger
export function withDebugLogging(c: any, next: any) {
  const sessionId = c.req.header('X-Debug-Session') || 
                   c.req.query('debug_session') || 
                   c.req.cookie?.('debug_session') ||
                   crypto.randomUUID();
  
  c.set('debugLogger', new DebugLogger(c.env, sessionId));
  c.set('debugSessionId', sessionId);
  
  // Set cookie to track session across redirects
  c.header('Set-Cookie', `debug_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`);
  
  return next();
}

// Debug dashboard endpoint
export function createDebugDashboard() {
  return async (c: any) => {
    const sessionId = c.req.query('session');
    const allSessions = await DebugLogger.getRecentSessions(c.env);
    
    let logs: DebugEvent[] = [];
    if (sessionId) {
      logs = await DebugLogger.getSessionLogs(c.env, sessionId);
    }
    
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>RTM OAuth Debug Dashboard</title>
          <style>
            body { 
              font-family: monospace; 
              margin: 20px; 
              background: #1e1e1e; 
              color: #d4d4d4; 
            }
            .session-list { 
              margin-bottom: 20px; 
              padding: 10px; 
              background: #2d2d2d; 
              border-radius: 5px; 
            }
            .log-entry { 
              margin: 10px 0; 
              padding: 10px; 
              background: #2d2d2d; 
              border-left: 3px solid #569cd6; 
              border-radius: 3px; 
            }
            .error { 
              border-left-color: #f44747; 
              background: #3a2d2d; 
            }
            .timestamp { 
              color: #858585; 
              font-size: 0.9em; 
            }
            .event { 
              color: #4ec9b0; 
              font-weight: bold; 
            }
            .data { 
              margin-top: 5px; 
              white-space: pre-wrap; 
              font-size: 0.9em; 
            }
            a { 
              color: #569cd6; 
              text-decoration: none; 
            }
            a:hover { 
              text-decoration: underline; 
            }
            .success { 
              border-left-color: #4ec9b0; 
            }
            .warning { 
              border-left-color: #dcdcaa; 
            }
          </style>
        </head>
        <body>
          <h1>RTM OAuth Debug Dashboard</h1>
          
          <div class="session-list">
            <h3>Recent Sessions (last 24h)</h3>
            ${allSessions.length === 0 ? '<p>No sessions found</p>' : ''}
            ${allSessions.map(s => `
              <div>
                <a href="?session=${s}">${s}</a>
                ${s === sessionId ? ' (current)' : ''}
              </div>
            `).join('')}
          </div>
          
          ${sessionId ? `
            <h2>Session: ${sessionId}</h2>
            <div>
              ${logs.length === 0 ? '<p>No logs for this session</p>' : ''}
              ${logs.map(log => `
                <div class="log-entry ${log.error ? 'error' : ''} ${log.event.includes('success') ? 'success' : ''} ${log.event.includes('warning') ? 'warning' : ''}">
                  <div class="timestamp">${new Date(log.timestamp).toISOString()}</div>
                  <div class="event">${log.event}${log.endpoint ? ` - ${log.endpoint}` : ''}</div>
                  <div class="data">${JSON.stringify(log.data, null, 2)}</div>
                  ${log.error ? `<div class="error">ERROR: ${log.error}</div>` : ''}
                  ${log.stackTrace ? `<details><summary>Stack Trace</summary><pre>${log.stackTrace}</pre></details>` : ''}
                </div>
              `).join('')}
            </div>
          ` : '<p>Select a session to view logs</p>'}
        </body>
      </html>
    `);
  };
}