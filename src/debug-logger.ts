// File: src/debug-logger.ts
/**
 * Debug Logger for RTM OAuth Flow and MCP Connection
 * Persists debug information to KV for systematic troubleshooting
 */

import type { Env } from './types';
import { getCookie, setCookie } from 'hono/cookie';

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
    
    // Store with a timestamp-based key for better sorting and retrieval.
    const key = `debug:${Date.now()}_${this.sessionId}_${event}`;
    await this.env.AUTH_STORE.put(key, JSON.stringify(debugEvent), {
      expirationTtl: 86400 // 24 hours
    });
  }

  // Specific MCP connection logging
  async logMcpConnection(type: 'attempt' | 'upgrade' | 'session' | 'error', data: Record<string, any> = {}, error?: Error) {
    const mcpEvent = `mcp_connection_${type}`;
    await this.log(mcpEvent, {
      ...data,
      transport_headers: {
        upgrade: data.headers?.upgrade,
        connection: data.headers?.connection,
        'mcp-session-id': data.headers?.['mcp-session-id'],
        authorization: data.headers?.authorization ? 'Bearer [REDACTED]' : 'none'
      }
    }, error);
  }

  // Log MCP transport detection (focusing on streamable HTTP)
  async logMcpTransport(request: Request, transportType: 'streamable-http' | 'unknown') {
    const url = new URL(request.url);
    await this.log('mcp_transport_type', {
      transport: transportType,
      path: url.pathname,
      method: request.method,
      headers: {
        accept: request.headers.get('accept'),
        'content-type': request.headers.get('content-type'),
        upgrade: request.headers.get('upgrade'),
        'mcp-session-id': request.headers.get('mcp-session-id')
      }
    });
  }

  // Log Durable Object initialization
  async logDurableObjectInit(doId: string, props: any) {
    await this.log('mcp_do_init', {
      durable_object_id: doId,
      props: {
        hasToken: !!props?.rtmToken,
        hasUserId: !!props?.userId,
        hasUserName: !!props?.userName,
        propsKeys: props ? Object.keys(props) : []
      }
    });
  }
  
  /**
   * OPTIMIZED: Implements "Find, Then Fetch" strategy for the debug dashboard.
   * It finds the most recent flows and only then fetches the data for them.
   * @param env The environment object.
   * @param flowCount The number of complete flows to retrieve.
   */
  static async getRecentFlowLogs(env: Env, flowCount: number = 2): Promise<DebugEvent[]> {
    // 1. Lightweight Scan: Get the names of recent logs.
    const list = await env.AUTH_STORE.list({ prefix: 'debug:', limit: 250 });
    // Manually sort keys reverse-chronologically since the `reverse` option is not in the type definition.
    list.keys.sort((a, b) => b.name.localeCompare(a.name));

    // 2. Find Target Flows: Identify the session IDs of the most recent OAuth flows.
    const targetFlowSessionIds = new Set<string>();
    for (const key of list.keys) {
      const parts = key.name.split('_');
      // Key format: debug:${timestamp}_${sessionId}_${event}
      if (parts.length > 1) {
        const sessionId = parts[1];
        if (sessionId.startsWith('oauth_') || sessionId.startsWith('auth_')) {
          targetFlowSessionIds.add(sessionId);
          if (targetFlowSessionIds.size >= flowCount) {
            break; // Stop once we've found enough flows.
          }
        }
      }
    }
    
    // 3. Targeted Fetch: Filter the key list and fetch data only for the target flows.
    const keysToFetch = list.keys.filter(key => {
      const parts = key.name.split('_');
      return parts.length > 1 && targetFlowSessionIds.has(parts[1]);
    });
    
    const events: DebugEvent[] = [];
    for (const key of keysToFetch) {
      const data = await env.AUTH_STORE.get(key.name);
      if (data) {
        events.push(JSON.parse(data));
      }
    }
    
    events.sort((a, b) => b.timestamp - a.timestamp);
    
    return events;
  }

  static async getRecentLogs(env: Env, limit: number = 100): Promise<DebugEvent[]> {
    const list = await env.AUTH_STORE.list({ prefix: 'debug:', limit: 1000 });
    list.keys.sort((a, b) => b.name.localeCompare(a.name));
    
    const events: DebugEvent[] = [];
    const limitedKeys = list.keys.slice(0, limit);

    for (const key of limitedKeys) {
      const data = await env.AUTH_STORE.get(key.name);
      if (data) {
        events.push(JSON.parse(data));
      }
    }
    events.sort((a, b) => b.timestamp - a.timestamp);
    return events;
  }

  static async getSessionLogs(env: Env, sessionId: string): Promise<DebugEvent[]> {
    const allLogs = await this.getRecentLogs(env, 1000);
    return allLogs.filter(log => log.sessionId === sessionId);
  }

  static async deleteFlowLogs(env: Env, sessionIds: string[]): Promise<{ deleted: number }> {
    const keysToDelete = new Set<string>();
    const sessionSet = new Set(sessionIds);

    const debugList = await env.AUTH_STORE.list({ prefix: 'debug:', limit: 1000 });
    for (const key of debugList.keys) {
      const parts = key.name.split('_');
      if (parts.length > 1 && sessionSet.has(parts[1])) {
        keysToDelete.add(key.name);
      }
    }

    for (const sessionId of sessionIds) {
      const protocolList = await env.AUTH_STORE.list({ prefix: `protocol:${sessionId}` });
      for (const key of protocolList.keys) {
        keysToDelete.add(key.name);
      }
    }

    const uniqueKeys = Array.from(keysToDelete);
    
    let deleted = 0;
    for (const key of uniqueKeys) {
      await env.AUTH_STORE.delete(key);
      deleted++;
    }
    
    return { deleted };
  }
}

// Enhanced middleware that maintains session continuity across requests
export const withDebugLogging = async (c: any, next: any) => {
  let debugSessionId = null;
  
  const debugCookie = getCookie(c, 'debug_session_id');
  if (debugCookie) {
    debugSessionId = debugCookie;
  }
  
  const state = c.req.query('state');
  if (state && !debugSessionId) {
    debugSessionId = `oauth_${state}`;
  }
  
  const authHeader = c.req.header('Authorization');
  if (authHeader && !debugSessionId) {
    const tokenPrefix = authHeader.substring(7, 15);
    debugSessionId = `auth_${tokenPrefix}`;
  }
  
  const mcpSessionId = c.req.header('Mcp-Session-Id');
  if (mcpSessionId && !debugSessionId) {
    debugSessionId = `mcp_${mcpSessionId}`;
  }
  
  if (!debugSessionId) {
    debugSessionId = crypto.randomUUID();
  }
  
  setCookie(c, 'debug_session_id', debugSessionId, {
    path: '/',
    secure: true,
    httpOnly: true,
    maxAge: 3600, // 1 hour
    sameSite: 'Lax'
  });
  
  const logger = new DebugLogger(c.env, debugSessionId);
  
  const url = new URL(c.req.url);
  if (url.pathname.includes('/mcp')) {
    await logger.logMcpTransport(c.req.raw, 'streamable-http');
  }
  
  c.set('debugLogger', logger);
  c.set('debugSessionId', debugSessionId);
  
  await next();
};


// Debug dashboard 
/*
  TODO: For the delete functionality to work, you must create an API endpoint.
  ...
*/
export function createDebugDashboard(deploymentName?: string, deploymentTime?: string) {
  return async (c: any) => {
    const { DebugLogger } = await import('./debug-logger');
    const { ProtocolLogger } = await import('./protocol-logger');
    
    // OPTIMIZED: Call the new efficient method to get only the last 2 flows.
    const logs = await DebugLogger.getRecentFlowLogs(c.env, 2);
    
    const correlateFlows = (events: DebugEvent[]) => {
      const flows = new Map<string, {
        primarySessionId: string;
        relatedSessions: Set<string>;
        events: DebugEvent[];
        startTime: number;
        endTime: number;
        hasToken: boolean;
        hasDiscovery: boolean;
        hasMcpRequest: boolean;
        hasMcpTransport: boolean;
        mcpTransportType?: string;
        hasMcpError: boolean;
        mcpSessionId?: string;
        protocolLogs?: any[];
      }>();

      events.forEach(event => {
        // Group all events by their session ID to form a "flow"
        const flowKey = event.sessionId;
        
        if (!flows.has(flowKey)) {
          flows.set(flowKey, {
            primarySessionId: event.sessionId,
            relatedSessions: new Set([event.sessionId]),
            events: [],
            startTime: event.timestamp,
            endTime: event.timestamp,
            hasToken: false,
            hasDiscovery: false,
            hasMcpRequest: false,
            hasMcpTransport: false,
            hasMcpError: false,
            protocolLogs: []
          });
        }

        const flow = flows.get(flowKey)!;
        flow.events.push(event);
        
        if (event.timestamp < flow.startTime) flow.startTime = event.timestamp;
        if (event.timestamp > flow.endTime) flow.endTime = event.timestamp;
        
        if (event.event.includes('token')) flow.hasToken = true;
        if (event.event.includes('discovery')) flow.hasDiscovery = true;
        if (event.endpoint === '/mcp') flow.hasMcpRequest = true;
        
        if (event.event === 'mcp_transport_type') {
          flow.hasMcpTransport = true;
          flow.mcpTransportType = event.data.transport;
        }
        if (event.event.startsWith('mcp_') && event.error) {
          flow.hasMcpError = true;
        }
        if (event.data['mcp-session-id']) {
          flow.mcpSessionId = event.data['mcp-session-id'];
        }
      });
      
      return Array.from(flows.values())
        .map(flow => {
          flow.events.sort((a, b) => a.timestamp - b.timestamp);
          return flow;
        })
        .sort((a, b) => b.startTime - a.startTime);
    };
    
    const correlatedFlows = correlateFlows(logs);
    
    for (const flow of correlatedFlows) {
      flow.protocolLogs = [];
      for (const sessionId of flow.relatedSessions) {
        if (sessionId.startsWith('oauth_') || sessionId.startsWith('auth_')) {
          continue;
        }
        try {
          const txs = await ProtocolLogger.getSessionTransactions(c.env, sessionId);
          flow.protocolLogs.push(...txs);
        } catch (e) {
          // Ignore errors
        }
      }
    }
    
    const oauthFlows = correlatedFlows.filter(flow => 
      flow.events.some(e => e.event.includes('oauth') || e.event.includes('token'))
    );
    
    const formatTime = (timestamp: number) => {
      return new Date(timestamp).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3
      });
    };
    
    return c.html(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>RTM MCP Debug Dashboard</title>
        <style>
          body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 20px; background: #0f0f0f; color: #e0e0e0; }
          .container { max-width: 1600px; margin: 0 auto; }
          .deployment-banner { background: linear-gradient(135deg, #1a4d1a, #2d7d2d); color: #4ade80; padding: 20px; border-radius: 12px; margin-bottom: 25px; text-align: center; border: 2px solid #22c55e; box-shadow: 0 4px 12px rgba(34, 197, 94, 0.2); }
          .deployment-name { font-size: 28px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; }
          .deployment-time { font-size: 14px; opacity: 0.8; margin-top: 5px; }
          h1 { margin-bottom: 10px; color: #fff; }
          .subtitle { color: #888; margin-bottom: 20px; }
          .controls { background: #1a1a1a; padding: 15px; border-radius: 8px; margin-bottom: 20px; display: flex; gap: 10px; align-items: center; border: 1px solid #333; }
          button { background: #2d2d2d; color: #e0e0e0; border: 1px solid #444; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
          button:hover { background: #3d3d3d; }
          .session-card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 20px; margin-bottom: 20px; transition: opacity 0.3s ease; }
          .session-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; cursor: pointer; }
          .session-header:hover { color: #fff; }
          .session-title-group { display: flex; align-items: center; gap: 12px; }
          .session-actions { display: flex; gap: 8px; margin-left: auto; }
          .action-btn { font-size: 12px; padding: 4px 10px; background-color: #334155; border-color: #475569; }
          .action-btn:hover { background-color: #475569; }
          .delete-btn { background-color: #450a0a; border-color: #991b1b; color: #f87171; }
          .delete-btn:hover { background-color: #7f1d1d; }
          .session-duration { color: #666; font-size: 14px; text-align: right; }
          .event-row { display: flex; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid #2a2a2a; font-size: 14px; }
          .event-time { width: 100px; color: #666; font-family: 'SF Mono', Monaco, monospace; }
          .event-name { width: 250px; color: #4a9eff; font-weight: 500; }
          .event-name.mcp { color: #8b5cf6; }
          .event-endpoint { width: 200px; color: #888; font-family: 'SF Mono', Monaco, monospace; }
          .event-data { flex: 1; font-family: 'SF Mono', Monaco, monospace; font-size: 12px; background: #0a0a0a; padding: 8px; border-radius: 4px; border: 1px solid #2a2a2a; white-space: pre-wrap; overflow-x: auto; margin-left: 10px; max-width: 600px; word-break: break-word; }
          .success { color: #4ade80; } .error { color: #f87171; } .warning { color: #fbbf24; }
          .collapsed { display: none; }
          .status-indicator { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
          .status-success { background: #22c55e; } .status-error { background: #ef4444; } .status-pending { background: #fbbf24; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>⚙️ RTM MCP Debug Dashboard</h1>
          
          ${deploymentName ? `
          <div class="deployment-banner">
            <div class="deployment-name">🚀 ${deploymentName}</div>
            <div class="deployment-time">Deployed: ${deploymentTime ? formatTime(new Date(deploymentTime).getTime()) : 'Unknown'}</div>
            <div class="deployment-time">Current: ${formatTime(Date.now())}</div>
          </div>
          ` : ''}
          
          <div class="subtitle">
            Displaying the ${oauthFlows.length} most recent OAuth flows (from ${logs.length} total events).
          </div>
          
          <div class="controls">
            <button onclick="location.reload()">🔄 Refresh</button>
            <button onclick="expandAll()">📂 Expand All</button>
            <button onclick="collapseAll()">📁 Collapse All</button>
            <span style="margin-left: auto; color: #666;">
              Last updated: <span id="current-time">${formatTime(Date.now())}</span>
            </span>
          </div>
          
          ${oauthFlows.length === 0 ? `
            <div class="session-card">
              <p>No OAuth flows detected. Waiting for authentication attempts...</p>
            </div>
          ` : oauthFlows.map((flow, index) => `
              <div class="session-card" id="card-${flow.primarySessionId}">
                <div class="session-header" onclick="toggleSession('${flow.primarySessionId}')">
                  <div class="session-title-group">
                    <span class="status-indicator ${
                      flow.hasMcpError ? 'status-error' :
                      flow.hasMcpRequest && flow.hasMcpTransport ? 'status-success' : 
                      flow.hasToken ? 'status-pending' : 'status-error'
                    }"></span>
                    <strong>${deploymentName ? `${deploymentName} - ` : ''}Flow ${index + 1}</strong>
                    ${index === 0 ? '<span style="color: #22c55e; font-weight: bold;">LATEST</span>' : ''}
                  </div>
                  <div class="session-actions">
                    <button class="action-btn" onclick="event.stopPropagation(); exportFlow('${flow.primarySessionId}')">Export</button>
                    <button class="action-btn delete-btn" onclick="event.stopPropagation(); deleteFlow('${flow.primarySessionId}')">Delete</button>
                  </div>
                  <div class="session-duration">
                    ${formatTime(flow.startTime)} - ${formatTime(flow.endTime)}
                    (${Math.round((flow.endTime - flow.startTime) / 1000)}s)
                  </div>
                </div>
                
                <div id="session-${flow.primarySessionId}" class="collapsed">
                  ${flow.events.map(event => `
                    <div class="event-row">
                      <div class="event-time">${formatTime(event.timestamp)}</div>
                      <div class="event-name ${event.event.startsWith('mcp_') ? 'mcp' : ''}">${event.event}</div>
                      <div class="event-endpoint">${event.endpoint || ''}</div>
                      <div class="event-data">${JSON.stringify(event.data, null, 2)}</div>
                    </div>
                  `).join('')}
                </div>
              </div>
            `).join('')}
        </div>
        
        <script>
          const flowData = ${JSON.stringify(correlatedFlows)};
          
          function toggleSession(sessionId) {
            document.getElementById('session-' + sessionId)?.classList.toggle('collapsed');
          }
          
          function expandAll() {
            document.querySelectorAll('.collapsed').forEach(el => el.classList.remove('collapsed'));
          }
          
          function collapseAll() {
            document.querySelectorAll('[id^="session-"]').forEach(el => el.classList.add('collapsed'));
          }
          
          function exportFlow(primarySessionId) {
            const flow = flowData.find(f => f.primarySessionId === primarySessionId);
            if (!flow) return;
            
            const blob = new Blob([JSON.stringify(flow, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'flow-' + primarySessionId + '-logs.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }

          async function deleteFlow(primarySessionId) {
            const flow = flowData.find(f => f.primarySessionId === primarySessionId);
            if (!flow) return;

            if (!confirm('Are you sure you want to delete this entire flow? This action cannot be undone.')) {
              return;
            }

            const sessionIdsToDelete = Array.from(flow.relatedSessions);
            
            try {
              const response = await fetch('/debug/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionIds: sessionIdsToDelete }),
              });

              if (response.ok) {
                const card = document.getElementById('card-' + primarySessionId);
                if (card) {
                  card.style.opacity = '0';
                  setTimeout(() => card.remove(), 300);
                }
              } else {
                const errorResult = await response.json();
                alert('Failed to delete logs: ' + (errorResult.error || 'Unknown error'));
              }
            } catch (error) {
              console.error('Error deleting flow:', error);
              alert('An error occurred while trying to delete the logs.');
            }
          }
          
          setInterval(() => {
            const el = document.getElementById('current-time');
            if (el) el.textContent = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit' });
          }, 1000);
        </script>
      </body>
      </html>
    `);
  };
}