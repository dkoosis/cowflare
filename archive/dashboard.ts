// Update src/dashboard.ts with this complete fixed version:

export default `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RTM MCP Debug Dashboard</title>
    <style>
      body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 20px; background: #0f0f0f; color: #e0e0e0; }
      .container { max-width: 1600px; margin: 0 auto; }
      .deployment-banner { background: linear-gradient(135deg, #1e3a8a, #3b82f6); color: #e0f2fe; padding: 20px; border-radius: 12px; margin-bottom: 25px; text-align: center; border: 2px solid #60a5fa; box-shadow: 0 4px 12px rgba(96, 165, 250, 0.2); }
      .deployment-name { font-size: 28px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; }
      .deployment-time { font-size: 14px; opacity: 0.8; margin-top: 5px; }
      h1 { margin-bottom: 10px; color: #fff; }
      .subtitle { color: #888; margin-bottom: 20px; }
      .controls { background: #1a1a1a; padding: 15px; border-radius: 8px; margin-bottom: 20px; display: flex; gap: 10px; align-items: center; border: 1px solid #333; }
      button { background: #2d2d2d; color: #e0e0e0; border: 1px solid #444; padding: 8px 16px; border-radius: 4px; cursor: pointer; transition: background-color 0.2s; }
      button:hover { background: #3d3d3d; }
      .session-card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 20px; margin-bottom: 20px; transition: opacity 0.3s ease; }
      .session-card.fade-out { opacity: 0; }
      .session-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; cursor: pointer; }
      .session-title-group { display: flex; flex-direction: column; gap: 5px; flex: 1; }
      .session-title { font-size: 18px; font-weight: bold; color: #fff; display: flex; align-items: center; gap: 10px; }
      .session-meta { font-size: 12px; color: #888; display: flex; gap: 15px; margin-top: 5px; }
      .session-actions { display: flex; gap: 8px; }
      .status-indicator { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
      .status-success { background: #10b981; }
      .status-warning { background: #f59e0b; }
      .status-error { background: #ef4444; }
      .status-neutral { background: #6b7280; }
      .mcp-session-id { font-size: 12px; color: #8b5cf6; font-family: monospace; }
      .event-list { margin-top: 15px; display: none; }
      .event-list.expanded { display: block; }
      .event-item { background: #262626; padding: 10px; margin-bottom: 8px; border-radius: 4px; font-size: 12px; border: 1px solid #333; }
      .event-header { display: flex; justify-content: space-between; margin-bottom: 5px; }
      .event-type { color: #60a5fa; font-weight: bold; }
      .event-time { color: #666; font-size: 11px; }
      .event-data { font-family: monospace; white-space: pre-wrap; background: #1a1a1a; padding: 8px; border-radius: 4px; margin-top: 5px; border: 1px solid #333; max-height: 300px; overflow-y: auto; }
      .event-error { background: #2a1515; border-color: #5a2020; color: #ff8888; }
      .protocol-section { margin-top: 20px; padding-top: 20px; border-top: 1px solid #333; }
      .protocol-header { font-size: 14px; font-weight: bold; color: #8b5cf6; margin-bottom: 10px; }
      .transaction-item { background: #262626; padding: 10px; margin-bottom: 8px; border-radius: 4px; font-size: 12px; border: 1px solid #4a4a4a; }
      .message-content { font-family: monospace; white-space: pre-wrap; background: #1a1a1a; padding: 8px; border-radius: 4px; border: 1px solid #333; max-height: 200px; overflow-y: auto; }
      .chevron { display: inline-block; width: 16px; height: 16px; margin-right: 5px; transition: transform 0.2s; }
      .chevron::before { content: '▶'; }
      .chevron.expanded { transform: rotate(90deg); }
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-track { background: #1a1a1a; }
      ::-webkit-scrollbar-thumb { background: #4a4a4a; border-radius: 4px; }
      ::-webkit-scrollbar-thumb:hover { background: #5a5a5a; }
    </style>
</head>
<body>
    <div class="container">
        <h1>⚙️ RTM MCP Debug Dashboard</h1>
        
        <div id="deployment-info"></div>
        
        <div class="subtitle"></div>
        
        <div class="controls">
            <button onclick="location.reload()">🔄 Refresh</button>
            <button onclick="expandAll()">📂 Expand All</button>
            <button onclick="collapseAll()">📁 Collapse All</button>
            <span style="margin-left: auto; color: #888;">
                Last updated: <span id="current-time"></span>
            </span>
        </div>
        
        <div id="flows-container"></div>
    </div>

    <script>
        const flowData = __FLOW_DATA__;

        function formatTime(timestamp) {
            return new Date(timestamp).toLocaleString('en-US', {
                timeZone: 'America/New_York',
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3
            });
        }
        
        function exportFlow(sessionId) {
            const flow = flowData.find(f => f.primarySessionId === sessionId);
            if (flow) {
                const dataStr = JSON.stringify(flow, null, 2);
                const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
                const exportFileDefaultName = \`flow-\${sessionId}-\${Date.now()}.json\`;
                
                const linkElement = document.createElement('a');
                linkElement.setAttribute('href', dataUri);
                linkElement.setAttribute('download', exportFileDefaultName);
                linkElement.click();
            }
        }
        
        function render() {
            // Render Deployment Banner
            const deploymentInfo = document.getElementById('deployment-info');
            const deploymentName = '__DEPLOYMENT_NAME__';
            const deploymentTime = '__DEPLOYMENT_TIME__';
            if (deploymentName) {
                deploymentInfo.innerHTML = \`
                <div class="deployment-banner">
                    <div class="deployment-name">🚀 \${deploymentName}</div>
                    <div class="deployment-time">Deployed: \${deploymentTime ? formatTime(new Date(deploymentTime).getTime()) : 'Unknown'}</div>
                    <div class="deployment-time">Current: \${formatTime(Date.now())}</div>
                </div>\`;
            }

            // Render Flows
            const subtitle = document.querySelector('.subtitle');
            const flowsContainer = document.getElementById('flows-container');
            const oauthFlows = flowData.filter(flow => flow.events.some(e => e.event.includes('oauth') || e.event.includes('token')));
            
            subtitle.textContent = \`Displaying the \${oauthFlows.length} most recent OAuth flows.\`;

            if (oauthFlows.length === 0) {
                flowsContainer.innerHTML = \`<div class="session-card"><p>No OAuth flows detected. Waiting for authentication attempts...</p></div>\`;
            } else {
                flowsContainer.innerHTML = oauthFlows.map((flow, index) => \`
                <div class="session-card" id="card-\${flow.primarySessionId}">
                  <div class="session-header">
                    <div class="session-title-group" onclick="toggleSession('\${flow.primarySessionId}')">
                      <div class="session-title">
                        <span class="status-indicator \${
                          flow.hasMcpError ? 'status-error' :
                          flow.hasMcpRequest && flow.hasMcpTransport ? 'status-success' :
                          flow.hasToken ? 'status-warning' : 'status-neutral'
                        }"></span>
                        <span class="chevron" id="chevron-\${flow.primarySessionId}"></span>
                        OAuth Flow #\${index + 1}
                        \${flow.mcpSessionId ? \`<span class="mcp-session-id">[\${flow.mcpSessionId}]</span>\` : ''}
                      </div>
                      <div class="session-meta">
                        <span>Session: \${flow.primarySessionId}</span>
                        <span>Duration: \${((flow.endTime - flow.startTime) / 1000).toFixed(1)}s</span>
                        <span>Events: \${flow.events.length}</span>
                        \${flow.hasToken ? '<span style="color: #10b981;">✓ Token</span>' : '<span style="color: #ef4444;">✗ Token</span>'}
                        \${flow.hasMcpRequest ? '<span style="color: #10b981;">✓ MCP Request</span>' : ''}
                        \${flow.mcpTransportType ? \`<span style="color: #8b5cf6;">Transport: \${flow.mcpTransportType}</span>\` : ''}
                      </div>
                    </div>
                    <div class="session-actions">
                      <button onclick="exportFlow('\${flow.primarySessionId}')">📥 Export</button>
                      <button onclick="deleteFlows(['\${flow.primarySessionId}'])">🗑️ Delete</button>
                    </div>
                  </div>
                  <div class="event-list" id="events-\${flow.primarySessionId}">
                    \${flow.events.map(event => \`
                      <div class="event-item">
                        <div class="event-header">
                          <span class="event-type">\${event.event}</span>
                          <span class="event-time">\${formatTime(event.timestamp)}</span>
                        </div>
                        \${event.endpoint ? \`<div><strong>Endpoint:</strong> \${event.endpoint}</div>\` : ''}
                        <div class="event-data">\${JSON.stringify(event.data, null, 2)}</div>
                        \${event.error ? \`<div class="event-error event-data"><strong>Error:</strong> \${event.error}\${event.stackTrace ? \`\\n\\nStack:\\n\${event.stackTrace}\` : ''}</div>\` : ''}
                      </div>
                    \`).join('')}
                    
                    \${flow.protocolLogs && flow.protocolLogs.length > 0 ? \`
                      <div class="protocol-section">
                        <div class="protocol-header">MCP Protocol Messages (\${flow.protocolLogs.length})</div>
                        \${flow.protocolLogs.map((tx, i) => \`
                          <div class="transaction-item">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                              <span style="color: #60a5fa;">Transaction #\${i + 1}</span>
                              <span style="color: #666; font-size: 11px;">\${formatTime(tx.timestamp)}</span>
                            </div>
                            <div class="message-content">
                              <strong>Request:</strong>\\n\${JSON.stringify(tx.request, null, 2)}
                            </div>
                            \${tx.response ? \`
                              <div class="message-content" style="margin-top: 5px;">
                                <strong>Response:</strong>\\n\${JSON.stringify(tx.response, null, 2)}
                              </div>
                            \` : ''}
                            \${tx.error ? \`
                              <div class="message-content event-error" style="margin-top: 5px;">
                                <strong>Error:</strong> \${tx.error}
                              </div>
                            \` : ''}
                          </div>
                        \`).join('')}
                      </div>
                    \` : ''}
                  </div>
                </div>
                \`).join('');
            }
            
            document.getElementById('current-time').textContent = formatTime(Date.now());
        }

        function toggleSession(sessionId) {
            const eventList = document.getElementById(\`events-\${sessionId}\`);
            const chevron = document.getElementById(\`chevron-\${sessionId}\`);
            
            if (eventList.classList.contains('expanded')) {
                eventList.classList.remove('expanded');
                chevron.classList.remove('expanded');
            } else {
                eventList.classList.add('expanded');
                chevron.classList.add('expanded');
            }
        }

        function expandAll() {
            document.querySelectorAll('.event-list').forEach(el => {
                el.classList.add('expanded');
            });
            document.querySelectorAll('.chevron').forEach(el => {
                el.classList.add('expanded');
            });
        }

        function collapseAll() {
            document.querySelectorAll('.event-list').forEach(el => {
                el.classList.remove('expanded');
            });
            document.querySelectorAll('.chevron').forEach(el => {
                el.classList.remove('expanded');
            });
        }

        async function deleteFlows(sessionIds) {
            if (!confirm(\`Delete \${sessionIds.length} flow(s)? This cannot be undone.\`)) {
                return;
            }
            
            try {
                const response = await fetch('/debug/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionIds })
                });
                
                if (response.ok) {
                    sessionIds.forEach(id => {
                        const card = document.getElementById(\`card-\${id}\`);
                        if (card) {
                            card.classList.add('fade-out');
                            setTimeout(() => card.remove(), 300);
                        }
                    });
                } else {
                    alert('Failed to delete flows');
                }
            } catch (e) {
                alert('Error deleting flows: ' + e.message);
            }
        }

        // Initial render
        render();
        
        // Removed auto-refresh - use manual refresh button instead
    </script>
</body>
</html>`;