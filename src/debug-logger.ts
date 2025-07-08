// Update this in your src/debug-logger.ts file

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
      data,
      error: error?.message,
      stackTrace: error?.stack
    };
    
    // Store with timestamp-based key for better sorting
    const key = `debug:${Date.now()}_${this.sessionId}_${event}`;
    await this.env.AUTH_STORE.put(key, JSON.stringify(debugEvent), {
      expirationTtl: 86400 // 24 hours
    });
  }

  static async getRecentLogs(env: Env, limit: number = 100): Promise<DebugEvent[]> {
    const list = await env.AUTH_STORE.list({ prefix: 'debug:', limit: 1000 });
    const events: DebugEvent[] = [];
    
    // Get all events
    for (const key of list.keys) {
      const data = await env.AUTH_STORE.get(key.name);
      if (data) {
        events.push(JSON.parse(data));
      }
    }
    
    // Sort by timestamp descending (newest first)
    events.sort((a, b) => b.timestamp - a.timestamp);
    
    // Return limited number of events
    return events.slice(0, limit);
  }

  static async getSessionLogs(env: Env, sessionId: string): Promise<DebugEvent[]> {
    const allLogs = await this.getRecentLogs(env, 1000);
    return allLogs.filter(log => log.sessionId === sessionId);
  }
}

// Middleware for adding debug logging
export const withDebugLogging = async (c: any, next: any) => {
  const debugSessionId = c.req.header('X-Debug-Session-Id') || crypto.randomUUID();
  const logger = new DebugLogger(c.env, debugSessionId);
  
  c.set('debugLogger', logger);
  c.set('debugSessionId', debugSessionId);
  
  await next();
};

// Create improved debug dashboard
export function createDebugDashboard() {
  return async (c: any) => {
    const { DebugLogger } = await import('./debug-logger');
    const logs = await DebugLogger.getRecentLogs(c.env, 200);
    
    // Group logs by session
    const sessionGroups = new Map<string, DebugEvent[]>();
    for (const log of logs) {
      if (!sessionGroups.has(log.sessionId)) {
        sessionGroups.set(log.sessionId, []);
      }
      sessionGroups.get(log.sessionId)!.push(log);
    }
    
    // Format timestamp
    const formatTime = (timestamp: number) => {
      const date = new Date(timestamp);
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3
      });
    };
    
    // Format relative time
    const getRelativeTime = (timestamp: number) => {
      const diff = Date.now() - timestamp;
      if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
      if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
      if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
      return `${Math.round(diff / 86400000)}d ago`;
    };
    
    // Find OAuth flows
    const findOAuthFlows = () => {
      const flows = [];
      for (const [sessionId, events] of sessionGroups) {
        const hasOAuth = events.some(e => 
          e.event.includes('oauth') || 
          e.event.includes('authorize') || 
          e.event.includes('token')
        );
        if (hasOAuth) {
          flows.push({
            sessionId,
            events: events.sort((a, b) => a.timestamp - b.timestamp),
            startTime: Math.min(...events.map(e => e.timestamp)),
            endTime: Math.max(...events.map(e => e.timestamp))
          });
        }
      }
      return flows.sort((a, b) => b.startTime - a.startTime);
    };
    
    const oauthFlows = findOAuthFlows();
    
    return c.html(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>RTM MCP Debug Dashboard</title>
        <style>
          body {
            font-family: -apple-system, system-ui, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
          }
          .container {
            max-width: 1400px;
            margin: 0 auto;
          }
          h1 {
            margin-bottom: 10px;
          }
          .subtitle {
            color: #666;
            margin-bottom: 20px;
          }
          .controls {
            background: white;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          }
          .controls button {
            background: #007acc;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            margin-right: 10px;
          }
          .controls button:hover {
            background: #005a9e;
          }
          .oauth-flow {
            background: white;
            border-radius: 8px;
            margin-bottom: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            overflow: hidden;
          }
          .flow-header {
            background: #f8f9fa;
            padding: 15px;
            border-bottom: 1px solid #dee2e6;
            cursor: pointer;
          }
          .flow-header:hover {
            background: #e9ecef;
          }
          .flow-title {
            font-weight: 600;
            margin-bottom: 5px;
          }
          .flow-meta {
            font-size: 0.9em;
            color: #666;
          }
          .flow-events {
            display: none;
            padding: 0;
          }
          .flow-events.expanded {
            display: block;
          }
          .event {
            border-bottom: 1px solid #eee;
            padding: 12px 20px;
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 0.9em;
          }
          .event:hover {
            background: #f8f9fa;
          }
          .event-time {
            color: #666;
            width: 140px;
            display: inline-block;
          }
          .event-name {
            font-weight: 600;
            color: #333;
            margin-right: 10px;
          }
          .event-endpoint {
            color: #007acc;
          }
          .event-data {
            color: #666;
            margin-top: 5px;
            margin-left: 150px;
            font-size: 0.85em;
          }
          .highlight {
            background: #fff3cd;
          }
          .error {
            color: #dc3545;
          }
          .success {
            color: #28a745;
          }
          .new-request {
            background: #d4edda;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🔍 RTM MCP Debug Dashboard</h1>
          <div class="subtitle">Recent OAuth flows and API requests (newest first)</div>
          
          <div class="controls">
            <button onclick="location.reload()">🔄 Refresh</button>
            <button onclick="expandAll()">📂 Expand All</button>
            <button onclick="collapseAll()">📁 Collapse All</button>
            <span style="float: right; color: #666;">
              Showing ${oauthFlows.length} OAuth flows from last 24h
            </span>
          </div>
          
          ${oauthFlows.length === 0 ? '<div class="oauth-flow"><div class="flow-header">No OAuth flows found in the last 24 hours</div></div>' : ''}
          
          ${oauthFlows.map((flow, index) => `
            <div class="oauth-flow">
              <div class="flow-header" onclick="toggleFlow(${index})">
                <div class="flow-title">
                  OAuth Flow ${getRelativeTime(flow.startTime)}
                </div>
                <div class="flow-meta">
                  Session: ${flow.sessionId.substring(0, 8)}... | 
                  Duration: ${Math.round((flow.endTime - flow.startTime) / 1000)}s |
                  Events: ${flow.events.length}
                </div>
              </div>
              <div class="flow-events" id="flow-${index}">
                ${flow.events.map(event => {
                  const isNewEndpoint = event.endpoint === '/.well-known/oauth-protected-resource' || 
                                       (event.endpoint === '/mcp' && event.data.hasAuth);
                  const isError = event.error || event.data.error;
                  const isSuccess = event.event.includes('success');
                  
                  return `
                    <div class="event ${isNewEndpoint ? 'new-request' : ''} ${isError ? 'error' : ''} ${isSuccess ? 'success' : ''}">
                      <span class="event-time">${formatTime(event.timestamp)}</span>
                      <span class="event-name">${event.event}</span>
                      ${event.endpoint ? `<span class="event-endpoint">${event.endpoint}</span>` : ''}
                      ${event.data && Object.keys(event.data).length > 0 ? `
                        <div class="event-data">
                          ${JSON.stringify(event.data, null, 2).replace(/\\n/g, '<br>').replace(/ /g, '&nbsp;')}
                        </div>
                      ` : ''}
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `).join('')}
          
          <div style="margin-top: 40px; padding: 20px; background: #e9ecef; border-radius: 8px;">
            <h3>🔍 What to Look For</h3>
            <p><strong>After OAuth completes, you should see:</strong></p>
            <ol>
              <li><code>token_exchange_success</code> - OAuth token obtained</li>
              <li class="new-request" style="padding: 5px;">Request to <code>/.well-known/oauth-protected-resource</code> (NEW)</li>
              <li class="new-request" style="padding: 5px;">Request to <code>/mcp</code> with Bearer token (NEW)</li>
            </ol>
            <p>Green highlighted rows = new requests that should appear with the fixes</p>
          </div>
        </div>
        
        <script>
          function toggleFlow(index) {
            const el = document.getElementById('flow-' + index);
            el.classList.toggle('expanded');
          }
          
          function expandAll() {
            document.querySelectorAll('.flow-events').forEach(el => {
              el.classList.add('expanded');
            });
          }
          
          function collapseAll() {
            document.querySelectorAll('.flow-events').forEach(el => {
              el.classList.remove('expanded');
            });
          }
          
          // Auto-expand the most recent flow
          if (document.querySelector('.flow-events')) {
            document.querySelector('.flow-events').classList.add('expanded');
          }
        </script>
      </body>
      </html>
    `);
  };
}