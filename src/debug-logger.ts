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
    
    // Store with timestamp-based key for better sorting
    const key = `debug:${Date.now()}_${this.sessionId}_${event}`;
    await this.env.AUTH_STORE.put(key, JSON.stringify(debugEvent), {
      expirationTtl: 86400 // 24 hours
    });
  }

  // NEW: Specific MCP connection logging
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

  // NEW: Log MCP transport detection (focusing on streamable HTTP)
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

  // NEW: Log Durable Object initialization
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

// Enhanced middleware that maintains session continuity across requests
export const withDebugLogging = async (c: any, next: any) => {
  // Try to get session from multiple sources
  let debugSessionId = null;
  
  // 1. Check for existing debug session cookie
  const debugCookie = getCookie(c, 'debug_session_id');
  if (debugCookie) {
    debugSessionId = debugCookie;
  }
  
  // 2. Check for OAuth state parameter (links OAuth flow)
  const state = c.req.query('state');
  if (state && !debugSessionId) {
    // Use state as session ID for OAuth flow continuity
    debugSessionId = `oauth_${state}`;
  }
  
  // 3. Check for Authorization header (links authenticated requests)
  const authHeader = c.req.header('Authorization');
  if (authHeader && !debugSessionId) {
    // Create session based on token prefix
    const tokenPrefix = authHeader.substring(7, 15); // First 8 chars of token
    debugSessionId = `auth_${tokenPrefix}`;
  }
  
  // 4. Check for MCP-Session-Id header (links MCP sessions)
  const mcpSessionId = c.req.header('Mcp-Session-Id');
  if (mcpSessionId && !debugSessionId) {
    debugSessionId = `mcp_${mcpSessionId}`;
  }
  
  // 5. Generate new session only if none found
  if (!debugSessionId) {
    debugSessionId = crypto.randomUUID();
  }
  
  // Set cookie to maintain session
  setCookie(c, 'debug_session_id', debugSessionId, {
    path: '/',
    secure: true,
    httpOnly: true,
    maxAge: 3600, // 1 hour
    sameSite: 'Lax'
  });
  
  const logger = new DebugLogger(c.env, debugSessionId);
  
  // Log MCP transport details for debugging
  const url = new URL(c.req.url);
  if (url.pathname.includes('/mcp')) {
    await logger.logMcpTransport(c.req.raw, 'streamable-http');
  }
  
  c.set('debugLogger', logger);
  c.set('debugSessionId', debugSessionId);
  
  await next();
};


// Debug dashboard 
// Complete createDebugDashboard function for debug-logger.ts

export function createDebugDashboard(deploymentName?: string, deploymentTime?: string) {
  return async (c: any) => {
    const { DebugLogger } = await import('./debug-logger');
    const { ProtocolLogger } = await import('./protocol-logger');
    
    const logs = await DebugLogger.getRecentLogs(c.env, 500);
    
    // Group logs by session
    const sessionGroups = new Map<string, DebugEvent[]>();
    for (const log of logs) {
      if (!sessionGroups.has(log.sessionId)) {
        sessionGroups.set(log.sessionId, []);
      }
      sessionGroups.get(log.sessionId)!.push(log);
    }
    
    // Correlate sessions into unified flows
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

      // Initialize flows
      events.forEach(event => {
        const flowKey = event.sessionId.startsWith('oauth_') ? event.sessionId : 
                       event.sessionId.startsWith('auth_') ? event.sessionId : 
                       event.sessionId;
        
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
        flow.relatedSessions.add(event.sessionId);
        
        // Update flow metadata
        if (event.timestamp < flow.startTime) flow.startTime = event.timestamp;
        if (event.timestamp > flow.endTime) flow.endTime = event.timestamp;
        
        // Track specific events
        if (event.event.includes('token')) flow.hasToken = true;
        if (event.event.includes('discovery')) flow.hasDiscovery = true;
        if (event.endpoint === '/mcp') flow.hasMcpRequest = true;
        
        // Track MCP-specific events
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
      
      // Convert to array and sort
      return Array.from(flows.values())
        .map(flow => {
          flow.events.sort((a, b) => a.timestamp - b.timestamp);
          return flow;
        })
        .sort((a, b) => b.startTime - a.startTime);
    };
    
    const correlatedFlows = correlateFlows(logs);
    
    // Get protocol logs for correlated flows
    for (const flow of correlatedFlows) {
      flow.protocolLogs = [];
      // Check all related sessions for protocol logs
      for (const sessionId of flow.relatedSessions) {
        if (sessionId.startsWith('oauth_') || sessionId.startsWith('auth_')) {
          continue; // Skip correlation keys
        }
        try {
          const txs = await ProtocolLogger.getSessionTransactions(c.env, sessionId);
          flow.protocolLogs.push(...txs);
        } catch (e) {
          // Session might not have protocol logs
        }
      }
    }
    
    // Use correlated flows instead of oauthFlows
    const oauthFlows = correlatedFlows.filter(flow => 
      flow.events.some(e => e.event.includes('oauth') || e.event.includes('token'))
    );
    
    // Format time helper with Eastern Time
    const formatTime = (timestamp: number) => {
      const date = new Date(timestamp);
      return date.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3
      });
    };
    
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
            background: #0f0f0f;
            color: #e0e0e0;
          }
          .container {
            max-width: 1600px;
            margin: 0 auto;
          }
          .deployment-banner {
            background: linear-gradient(135deg, #1a4d1a, #2d7d2d);
            color: #4ade80;
            padding: 20px;
            border-radius: 12px;
            margin-bottom: 25px;
            text-align: center;
            border: 2px solid #22c55e;
            box-shadow: 0 4px 12px rgba(34, 197, 94, 0.2);
          }
          .deployment-name {
            font-size: 28px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 2px;
          }
          .deployment-time {
            font-size: 14px;
            opacity: 0.8;
            margin-top: 5px;
          }
          h1 {
            margin-bottom: 10px;
            color: #fff;
          }
          .subtitle {
            color: #888;
            margin-bottom: 20px;
          }
          .controls {
            background: #1a1a1a;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            display: flex;
            gap: 10px;
            align-items: center;
            border: 1px solid #333;
          }
          button {
            background: #2d2d2d;
            color: #e0e0e0;
            border: 1px solid #444;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
          }
          button:hover {
            background: #3d3d3d;
          }
          .session-card {
            background: #1a1a1a;
            border: 1px solid #333;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
          }
          .session-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            cursor: pointer;
          }
          .session-header:hover {
            color: #fff;
          }
          .session-id {
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 14px;
            color: #888;
          }
          .session-duration {
            color: #666;
            font-size: 14px;
          }
          .event-row {
            display: flex;
            align-items: flex-start;
            padding: 8px 0;
            border-bottom: 1px solid #2a2a2a;
            font-size: 14px;
          }
          .event-row:last-child {
            border-bottom: none;
          }
          .event-time {
            width: 100px;
            color: #666;
            font-family: 'SF Mono', Monaco, monospace;
          }
          .event-name {
            width: 250px;
            color: #4a9eff;
            font-weight: 500;
          }
          .event-name.mcp {
            color: #8b5cf6;
          }
          .event-endpoint {
            width: 200px;
            color: #888;
            font-family: 'SF Mono', Monaco, monospace;
          }
          .event-data {
            flex: 1;
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 12px;
            background: #0a0a0a;
            padding: 8px;
            border-radius: 4px;
            border: 1px solid #2a2a2a;
            white-space: pre-wrap;
            overflow-x: auto;
            margin-left: 10px;
            max-width: 600px;
            word-break: break-word;
          }
          .success {
            color: #4ade80;
          }
          .error {
            color: #f87171;
          }
          .warning {
            color: #fbbf24;
          }
          .collapsed {
            display: none;
          }
          .status-indicator {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            margin-right: 8px;
          }
          .status-success {
            background: #22c55e;
          }
          .status-error {
            background: #ef4444;
          }
          .status-pending {
            background: #fbbf24;
          }
          .json-key {
            color: #94a3b8;
          }
          .json-string {
            color: #86efac;
          }
          .json-number {
            color: #fbbf24;
          }
          .json-boolean {
            color: #60a5fa;
          }
          .json-null {
            color: #94a3b8;
            font-style: italic;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🔍 RTM MCP Debug Dashboard</h1>
          
          ${deploymentName ? `
          <div class="deployment-banner">
            <div class="deployment-name">🚀 ${deploymentName}</div>
            <div class="deployment-time">Deployed: ${deploymentTime ? formatTime(new Date(deploymentTime).getTime()) : 'Unknown'}</div>
            <div class="deployment-time">Current: ${formatTime(Date.now())}</div>
          </div>
          ` : ''}
          
          <div class="subtitle">
            Correlated OAuth flows (${oauthFlows.length} flows from ${logs.length} events)
          </div>
          
          <div class="controls">
            <button onclick="location.reload()">🔄 Refresh</button>
            <button onclick="expandAll()">📂 Expand All</button>
            <button onclick="collapseAll()">📁 Collapse All</button>
            <button onclick="exportLogs()">📤 Export Logs</button>
            <span style="margin-left: auto; color: #666;">
              Last updated: <span id="current-time">${formatTime(Date.now())}</span>
            </span>
          </div>
          
          ${oauthFlows.length === 0 ? `
            <div class="session-card">
              <p>No OAuth flows detected. Waiting for authentication attempts...</p>
            </div>
          ` : oauthFlows.map((flow, index) => {
            const isLatest = index === 0;
            const hasProtocolLogs = flow.protocolLogs && flow.protocolLogs.length > 0;
            
            return `
              <div class="session-card">
                <div class="session-header" onclick="toggleSession('${flow.primarySessionId}')">
                  <div>
                    <span class="status-indicator ${
                      flow.hasMcpError ? 'status-error' :
                      flow.hasMcpRequest && flow.hasMcpTransport ? 'status-success' : 
                      flow.hasToken ? 'status-pending' : 'status-error'
                    }"></span>
                    <strong>Flow ${index + 1}</strong>
                    ${isLatest ? '<span style="color: #22c55e; margin-left: 8px;">LATEST</span>' : ''}
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
            `;
          }).join('')}
        </div>
        
        <script>
          const flowData = ${JSON.stringify(correlatedFlows)};
          
          function toggleSession(sessionId) {
            const el = document.getElementById('session-' + sessionId);
            if (el) {
              el.classList.toggle('collapsed');
            }
          }
          
          function expandAll() {
            document.querySelectorAll('.collapsed').forEach(el => {
              el.classList.remove('collapsed');
            });
          }
          
          function collapseAll() {
            document.querySelectorAll('[id^="session-"]').forEach(el => {
              el.classList.add('collapsed');
            });
          }
          
          function exportLogs() {
            const logs = flowData;
            const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'rtm-mcp-debug-logs.json';
            a.click();
          }
          
          // Update current time
          setInterval(() => {
            document.getElementById('current-time').textContent = new Date().toLocaleTimeString();
          }, 1000);
        </script>
      </body>
      </html>
    `);
  };
}