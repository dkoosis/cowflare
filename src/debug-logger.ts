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
          .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.4);
          }
          .modal-content {
            background-color: #fefefe;
            margin: 5% auto;
            padding: 20px;
            border: 1px solid #888;
            width: 80%;
            max-width: 800px;
            border-radius: 8px;
          }
          .close {
            color: #aaa;
            float: right;
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
          }
          .close:hover,
          .close:focus {
            color: black;
          }
          #exportText {
            width: 100%;
            height: 400px;
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 12px;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 10px;
          }
          .copy-btn {
            background: #28a745;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            margin-top: 10px;
          }
          .copy-btn:hover {
            background: #218838;
          }
          .validation-panel {
            display: none;
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          }
          .validation-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
          }
          .validation-score {
            font-size: 2em;
            font-weight: bold;
          }
          .validation-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 10px;
            margin-bottom: 15px;
          }
          .validation-rule {
            display: flex;
            align-items: center;
            padding: 8px;
            background: #f8f9fa;
            border-radius: 4px;
          }
          .validation-rule.passed {
            background: #d4edda;
          }
          .validation-rule.failed {
            background: #f8d7da;
          }
          .validation-rule.warning {
            background: #fff3cd;
          }
          .validation-icon {
            font-size: 20px;
            margin-right: 10px;
          }
          .validation-details {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 4px;
            margin-top: 15px;
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 0.9em;
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
            <button onclick="validateProtocol()">🔍 Validate Protocol</button>
            <button onclick="exportLogs()">📤 Export for Debugging</button>
            <span style="float: right; color: #666;">
              Showing ${oauthFlows.length} OAuth flows from last 24h
            </span>
          </div>
          
          <!-- Protocol Validation Panel -->
          <div id="validationPanel" class="validation-panel">
            <div class="validation-header">
              <h2>🔍 Protocol Validation Results</h2>
              <button onclick="closeValidation()" style="background: none; border: none; font-size: 24px; cursor: pointer;">×</button>
            </div>
            <div id="validationContent"></div>
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
        
        <!-- Export Modal -->
        <div id="exportModal" class="modal">
          <div class="modal-content">
            <span class="close" onclick="closeModal()">&times;</span>
            <h2>📤 Export Logs for Debugging</h2>
            <p>Copy this text and share it for debugging:</p>
            <textarea id="exportText" readonly></textarea>
            <button class="copy-btn" onclick="copyToClipboard()">📋 Copy to Clipboard</button>
          </div>
        </div>
        
        <script>
          // Store flow data for export
          const flowData = ${JSON.stringify(oauthFlows)};
          
          // MCP OAuth Protocol Validator
          class ProtocolValidator {
            constructor() {
              this.rules = [
                {
                  id: 'oauth_discovery',
                  name: 'OAuth Discovery',
                  description: 'Client must discover authorization server',
                  required: true,
                  check: (events) => events.some(e => e.event === 'discovery_request')
                },
                {
                  id: 'oauth_authorize',
                  name: 'OAuth Authorization',
                  description: 'User must complete authorization',
                  required: true,
                  check: (events) => events.some(e => e.event.includes('complete_auth'))
                },
                {
                  id: 'token_exchange',
                  name: 'Token Exchange',
                  description: 'Authorization code must be exchanged for token',
                  required: true,
                  check: (events) => events.some(e => e.event === 'token_exchange_success')
                },
                {
                  id: 'post_token_activity',
                  name: 'Post-Token Activity',
                  description: 'Client should attempt to use token after exchange',
                  required: false,
                  check: (events) => {
                    const tokenIdx = events.findIndex(e => e.event === 'token_exchange_success');
                    return tokenIdx !== -1 && tokenIdx < events.length - 1;
                  }
                },
                {
                  id: 'resource_discovery',
                  name: 'Protected Resource Discovery',
                  description: 'Client should fetch /.well-known/oauth-protected-resource',
                  required: false,
                  check: (events) => events.some(e => 
                    e.endpoint === '/.well-known/oauth-protected-resource'
                  )
                },
                {
                  id: 'mcp_attempt',
                  name: 'MCP Access Attempt',
                  description: 'Client should attempt to access /mcp endpoint',
                  required: false,
                  check: (events) => events.some(e => e.endpoint === '/mcp')
                },
                {
                  id: 'authenticated_mcp',
                  name: 'Authenticated MCP Request',
                  description: 'Client should make authenticated request to MCP',
                  required: false,
                  check: (events) => events.some(e => 
                    e.endpoint === '/mcp' && e.data && e.data.hasAuth === true
                  )
                }
              ];
            }
            
            validate(events) {
              const results = this.rules.map(rule => ({
                ...rule,
                passed: rule.check(events)
              }));
              
              const required = results.filter(r => r.required);
              const optional = results.filter(r => !r.required);
              const requiredPassed = required.filter(r => r.passed).length;
              const optionalPassed = optional.filter(r => r.passed).length;
              
              return {
                results,
                summary: {
                  totalScore: Math.round((results.filter(r => r.passed).length / results.length) * 100),
                  requiredScore: Math.round((requiredPassed / required.length) * 100),
                  requiredPassed,
                  requiredTotal: required.length,
                  optionalPassed,
                  optionalTotal: optional.length,
                  status: requiredPassed === required.length ? 'VALID' : 'INVALID'
                },
                diagnosis: this.diagnose(events, results)
              };
            }
            
            diagnose(events, results) {
              const diagnosis = [];
              
              // Check if OAuth completed
              const tokenExchange = results.find(r => r.id === 'token_exchange');
              if (!tokenExchange.passed) {
                diagnosis.push({
                  severity: 'error',
                  message: 'OAuth flow did not complete. Check authorization and token exchange steps.'
                });
                return diagnosis;
              }
              
              // Check post-token behavior
              const postToken = results.find(r => r.id === 'post_token_activity');
              if (!postToken.passed) {
                diagnosis.push({
                  severity: 'error',
                  message: 'No activity after token exchange. Client may have crashed or failed silently.'
                });
              }
              
              // Check for new endpoints
              const resourceDiscovery = results.find(r => r.id === 'resource_discovery');
              const mcpAttempt = results.find(r => r.id === 'mcp_attempt');
              
              if (!resourceDiscovery.passed && !mcpAttempt.passed) {
                diagnosis.push({
                  severity: 'warning',
                  message: 'Client did not attempt to discover MCP server. Missing Protected Resource Metadata implementation?'
                });
              }
              
              if (mcpAttempt.passed && !results.find(r => r.id === 'authenticated_mcp').passed) {
                diagnosis.push({
                  severity: 'info',
                  message: 'MCP endpoint was accessed but not with authentication. Check WWW-Authenticate handling.'
                });
              }
              
              // Success case
              if (results.find(r => r.id === 'authenticated_mcp').passed) {
                diagnosis.push({
                  severity: 'success',
                  message: 'Full OAuth to MCP flow completed successfully!'
                });
              }
              
              return diagnosis;
            }
          }
          
          function validateProtocol() {
            if (flowData.length === 0) {
              alert('No OAuth flows to validate');
              return;
            }
            
            const validator = new ProtocolValidator();
            const flow = flowData[0]; // Validate most recent
            const validation = validator.validate(flow.events);
            
            // Build validation UI
            let html = '<div class="validation-score" style="color: ' + 
              (validation.summary.status === 'VALID' ? '#28a745' : '#dc3545') + ';">' +
              validation.summary.status + ' - ' + validation.summary.totalScore + '% Compliant</div>';
            
            html += '<p>Required: ' + validation.summary.requiredPassed + '/' + 
              validation.summary.requiredTotal + ' | Optional: ' + 
              validation.summary.optionalPassed + '/' + validation.summary.optionalTotal + '</p>';
            
            // Rules grid
            html += '<div class="validation-grid">';
            validation.results.forEach(rule => {
              const cssClass = rule.passed ? 'passed' : (rule.required ? 'failed' : 'warning');
              const icon = rule.passed ? '✅' : (rule.required ? '❌' : '⚠️');
              
              html += '<div class="validation-rule ' + cssClass + '">';
              html += '<span class="validation-icon">' + icon + '</span>';
              html += '<div>';
              html += '<strong>' + rule.name + '</strong><br>';
              html += '<small>' + rule.description + '</small>';
              html += '</div></div>';
            });
            html += '</div>';
            
            // Diagnosis
            if (validation.diagnosis.length > 0) {
              html += '<div class="validation-details">';
              html += '<h3>Diagnosis</h3>';
              validation.diagnosis.forEach(d => {
                const color = {
                  error: '#dc3545',
                  warning: '#ffc107', 
                  info: '#17a2b8',
                  success: '#28a745'
                }[d.severity];
                html += '<div style="color: ' + color + '; margin: 5px 0;">';
                html += '<strong>' + d.severity.toUpperCase() + ':</strong> ' + d.message;
                html += '</div>';
              });
              html += '</div>';
            }
            
            // Show panel
            document.getElementById('validationContent').innerHTML = html;
            document.getElementById('validationPanel').style.display = 'block';
          }
          
          function closeValidation() {
            document.getElementById('validationPanel').style.display = 'none';
          }
          
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
          
          function exportLogs() {
            // Create export text optimized for debugging
            let exportText = 'RTM MCP DEBUG LOGS\\n';
            exportText += '==================\\n\\n';
            
            // Add most recent OAuth flow
            if (flowData.length > 0) {
              const recentFlow = flowData[0];
              
              // Add protocol validation
              const validator = new ProtocolValidator();
              const validation = validator.validate(recentFlow.events);
              
              exportText += 'PROTOCOL VALIDATION\\n';
              exportText += '-------------------\\n';
              exportText += 'Status: ' + validation.summary.status + '\\n';
              exportText += 'Compliance Score: ' + validation.summary.totalScore + '%\\n';
              exportText += 'Required Steps: ' + validation.summary.requiredPassed + '/' + validation.summary.requiredTotal + '\\n\\n';
              
              validation.results.forEach(result => {
                const icon = result.passed ? '✅' : (result.required ? '❌' : '⚠️');
                exportText += icon + ' ' + result.name + ': ' + (result.passed ? 'PASSED' : 'FAILED') + '\\n';
              });
              
              if (validation.diagnosis.length > 0) {
                exportText += '\\nDiagnosis:\\n';
                validation.diagnosis.forEach(d => {
                  exportText += d.severity.toUpperCase() + ': ' + d.message + '\\n';
                });
              }
              
              exportText += '\\n';
              
              exportText += 'MOST RECENT OAUTH FLOW\\n';
              exportText += 'Session: ' + recentFlow.sessionId.substring(0, 8) + '...\\n';
              exportText += 'Started: ' + new Date(recentFlow.startTime).toISOString() + '\\n';
              exportText += 'Duration: ' + Math.round((recentFlow.endTime - recentFlow.startTime) / 1000) + 's\\n\\n';
              
              exportText += 'EVENT SEQUENCE:\\n';
              exportText += '---------------\\n';
              
              recentFlow.events.forEach((event, index) => {
                const time = new Date(event.timestamp).toLocaleTimeString();
                exportText += (index + 1) + '. [' + time + '] ' + event.event;
                
                if (event.endpoint) {
                  exportText += ' - ' + event.endpoint;
                }
                
                // Add key data points
                if (event.event === 'token_exchange_success') {
                  exportText += ' ✓';
                } else if (event.event.includes('error')) {
                  exportText += ' ✗ ERROR: ' + (event.data.error || event.error || 'Unknown error');
                }
                
                exportText += '\\n';
                
                // Add relevant data for specific events
                if (event.event === 'discovery_request' || 
                    event.event === 'token_exchange_success' ||
                    event.endpoint === '/.well-known/oauth-protected-resource' ||
                    event.endpoint === '/mcp') {
                  exportText += '   Data: ' + JSON.stringify(event.data, null, 2).replace(/\\n/g, '\\n   ') + '\\n';
                }
              });
              
              exportText += '\\nEXPECTED BUT MISSING:\\n';
              exportText += '----------------------\\n';
              
              // Check for missing expected requests
              const hasProtectedResource = recentFlow.events.some(e => 
                e.endpoint === '/.well-known/oauth-protected-resource'
              );
              const hasMcpWithAuth = recentFlow.events.some(e => 
                e.endpoint === '/mcp' && e.data.hasAuth
              );
              
              if (!hasProtectedResource) {
                exportText += '❌ No request to /.well-known/oauth-protected-resource\\n';
              }
              if (!hasMcpWithAuth) {
                exportText += '❌ No authenticated request to /mcp\\n';
              }
              
              if (hasProtectedResource && hasMcpWithAuth) {
                exportText += '✅ All expected requests found\\n';
              }
            } else {
              exportText += 'NO OAUTH FLOWS FOUND\\n';
            }
            
            // Show in modal
            document.getElementById('exportText').value = exportText;
            document.getElementById('exportModal').style.display = 'block';
          }
          
          function closeModal() {
            document.getElementById('exportModal').style.display = 'none';
          }
          
          function copyToClipboard() {
            const textArea = document.getElementById('exportText');
            textArea.select();
            document.execCommand('copy');
            
            // Show feedback
            const btn = event.target;
            const originalText = btn.textContent;
            btn.textContent = '✓ Copied!';
            setTimeout(() => {
              btn.textContent = originalText;
            }, 2000);
          }
          
          // Close modal when clicking outside
          window.onclick = function(event) {
            const modal = document.getElementById('exportModal');
            if (event.target == modal) {
              modal.style.display = 'none';
            }
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