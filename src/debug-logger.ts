// File: src/debug-logger.ts
/**
 * Debug Logger for RTM OAuth Flow and MCP Connection
 * Persists debug information to KV for systematic troubleshooting
 */
import { default as dashboardTemplate } from './dashboard';
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
      stackTrace: error?.stack,
    };

    // Store with a timestamp-based key for better sorting and retrieval.
    const key = `debug:${debugEvent.timestamp}_${this.sessionId}_${event}`;
    await this.env.AUTH_STORE.put(key, JSON.stringify(debugEvent), {
      expirationTtl: 86400, // 24 hours
    });
  }

  // Specific MCP connection logging
  async logMcpConnection(
    type: 'attempt' | 'upgrade' | 'session' | 'error',
    data: Record<string, any> = {},
    error?: Error
  ) {
    const mcpEvent = `mcp_connection_${type}`;
    await this.log(
      mcpEvent,
      {
        ...data,
        transport_headers: {
          upgrade: data.headers?.upgrade,
          connection: data.headers?.connection,
          'mcp-session-id': data.headers?.['mcp-session-id'],
          authorization: data.headers?.authorization ? 'Bearer [REDACTED]' : 'none',
        },
      },
      error
    );
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
        'mcp-session-id': request.headers.get('mcp-session-id'),
      },
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
        propsKeys: props ? Object.keys(props) : [],
      },
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
    // Manually sort keys reverse-chronologically.
    list.keys.sort((a, b) => b.name.localeCompare(a.name));

    // 2. Find Target Flows: Identify the session IDs of the most recent OAuth flows.
    const targetFlowSessionIds = new Set<string>();
    for (const key of list.keys) {
      // Key format: debug:${timestamp}_${sessionId}_${event}
      const parts = key.name.split('_');
      if (parts.length > 2) {
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
      return parts.length > 2 && targetFlowSessionIds.has(parts[1]);
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
    // This is potentially inefficient for old sessions but acceptable for recent ones.
    const allLogs = await this.getRecentLogs(env, 1000);
    return allLogs.filter(log => log.sessionId === sessionId);
  }

  static async deleteFlowLogs(env: Env, sessionIds: string[]): Promise<{ deleted: number }> {
    const keysToDelete = new Set<string>();
    const sessionSet = new Set(sessionIds);

    const debugList = await env.AUTH_STORE.list({ prefix: 'debug:', limit: 1000 });
    for (const key of debugList.keys) {
      const parts = key.name.split('_');
      if (parts.length > 2 && sessionSet.has(parts[1])) {
        keysToDelete.add(key.name);
      }
    }

    // Also delete associated protocol logs
    for (const sessionId of sessionIds) {
      const protocolList = await env.AUTH_STORE.list({ prefix: `protocol:${sessionId}` });
      for (const key of protocolList.keys) {
        keysToDelete.add(key.name);
      }
    }

    const uniqueKeys = Array.from(keysToDelete);
    for (const key of uniqueKeys) {
      await env.AUTH_STORE.delete(key);
    }

    return { deleted: uniqueKeys.length };
  }
}

// Hono middleware that maintains session continuity across requests
export const withDebugLogging = async (c: any, next: any) => {
  let debugSessionId: string | null = null;
  const cookieName = 'debug_session_id';

  // 1. Check for an existing session cookie
  debugSessionId = getCookie(c, cookieName) ?? null;

  // 2. Check OAuth state parameter
  if (!debugSessionId) {
    const state = c.req.query('state');
    if (state) {
      debugSessionId = `oauth_${state}`;
    }
  }

  // 3. Check Authorization header
  if (!debugSessionId) {
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const tokenPrefix = authHeader.substring(7, 15);
      debugSessionId = `auth_${tokenPrefix}`;
    }
  }
  
  // 4. Check MCP session header
  if (!debugSessionId) {
    const mcpSessionId = c.req.header('Mcp-Session-Id');
    if (mcpSessionId) {
      debugSessionId = `mcp_${mcpSessionId}`;
    }
  }

  // 5. Fallback to new session ID
  if (!debugSessionId) {
    debugSessionId = crypto.randomUUID();
  }

  setCookie(c, cookieName, debugSessionId, {
    path: '/',
    secure: true,
    httpOnly: true,
    maxAge: 3600, // 1 hour
    sameSite: 'Lax',
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

export function createDebugDashboard(deploymentName: string = '', deploymentTime: string = '') {
  return async (c: any) => {
    // These are dynamically imported to avoid circular dependencies if they also use logging
    const { DebugLogger } = await import('./debug-logger');
    const { ProtocolLogger } = await import('./protocol-logger');

    // Fetch the most recent flow logs using the optimized method
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
            protocolLogs: [],
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

    const correlatedFlowsData = correlateFlows(logs);

    // Fetch associated protocol logs for each flow
    for (const flow of correlatedFlowsData) {
      flow.protocolLogs = [];
      for (const sessionId of flow.relatedSessions) {
        if (sessionId.startsWith('oauth_') || sessionId.startsWith('auth_')) {
          continue;
        }
        try {
          const txs = await ProtocolLogger.getSessionTransactions(c.env, sessionId);
          flow.protocolLogs.push(...txs);
        } catch (e) {
          console.error(`Failed to fetch protocol logs for session ${sessionId}:`, e);
        }
      }
    }

    // Inject the dynamic data into the HTML template
    const dashboardHtml = dashboardTemplate
      .replace('__FLOW_DATA__', JSON.stringify(correlatedFlowsData, null, 2))
      .replace(`'__DEPLOYMENT_NAME__'`, `'${deploymentName}'`)
      .replace(`'__DEPLOYMENT_TIME__'`, `'${deploymentTime}'`);
      
    return c.html(dashboardHtml);
  };
}