interface Env {
  MCP_SERVER_URL: string;
}

const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Remember The Milk Authentication</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background: #f5f5f5; }
        .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; margin-bottom: 30px; }
        input, button { width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #ddd; border-radius: 5px; font-size: 16px; box-sizing: border-box; }
        button { background: #0066cc; color: white; cursor: pointer; border: none; }
        button:hover { background: #0052a3; }
        button:disabled { background: #ccc; cursor: not-allowed; }
        .status { margin: 20px 0; padding: 15px; border-radius: 5px; display: none; }
        .status.error { background: #fee; color: #c00; display: block; }
        .status.success { background: #efe; color: #060; display: block; }
        .status.info { background: #eef; color: #006; display: block; }
        .auth-link { display: inline-block; margin: 20px 0; padding: 15px 30px; background: #28a745; color: white; text-decoration: none; border-radius: 5px; font-weight: bold; }
        .auth-link:hover { background: #218838; }
        .step { margin: 20px 0; padding: 20px; background: #f8f9fa; border-radius: 5px; display: none; }
        .step.active { display: block; }
        .step h3 { margin-top: 0; }
        .saved-auth { background: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 5px; margin: 20px 0; }
        code { background: #f0f0f0; padding: 2px 5px; border-radius: 3px; font-family: monospace; word-break: break-all; }
        pre { background: #222; color: #eee; padding: 15px; border-radius: 5px; white-space: pre-wrap; word-wrap: break-word; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🐄 Remember The Milk Authentication</h1>
        <div id="step1" class="step active">
            <h3>Step 1: Enter Your Email</h3>
            <p>This will be used to save your authentication token in the RTM MCP Server so you don't have to log in every time.</p>
            <input type="email" id="email" placeholder="your@email.com" />
            <button onclick="startAuth()">Start Authentication</button>
        </div>
        <div id="step2" class="step">
            <h3>Step 2: Authorize the App</h3>
            <p>Click the button below to go to Remember The Milk and authorize this app. It will open in a new tab.</p>
            <a id="authLink" class="auth-link" target="_blank">Authorize on Remember The Milk</a>
            <p>After authorizing, <strong>return to this tab</strong> and click the button below:</p>
            <button onclick="completeAuth()">I've Authorized the App</button>
        </div>
        <div id="step3" class="step">
            <h3>Step 3: Success!</h3>
            <div class="saved-auth">
                <strong>✅ Authentication Complete!</strong><br>
                Your authentication token has been saved.
                <ul>
                    <li>Email: <code id="savedEmail"></code></li>
                    <li>Auth Token: <code id="authToken"></code></li>
                </ul>
            </div>
            <button id="testApiButton" onclick="testApiCall()">Test: Get My Lists</button>
            <div id="apiResultContainer" style="display:none; margin-top:20px;">
              <h4>API Result:</h4>
              <pre id="apiResult"></pre>
            </div>
        </div>
        <div id="status" class="status"></div>
    </div>
    <script>
        const API_URL = '__MCP_SERVER_URL__';
        let currentFrob = null;
        let currentEmail = null;
        let currentAuthToken = null;

        function showStatus(message, type = 'info') {
            const status = document.getElementById('status');
            status.className = 'status ' + type;
            status.textContent = message;
        }
        function showStep(stepNumber) {
            document.querySelectorAll('.step').forEach(step => step.classList.remove('active'));
            document.getElementById('step' + stepNumber).classList.add('active');
        }
        async function startAuth() {
            // ... (this function is unchanged)
        }
        async function completeAuth() {
            // ... (this function is mostly unchanged, just added saving the token)
        }
        
        // --- The following functions are either new or updated ---

        async function testApiCall() {
            if (!currentAuthToken) {
                showStatus('Auth token not found. Please re-authenticate.', 'error');
                return;
            }
            const testButton = document.getElementById('testApiButton');
            testButton.disabled = true;
            testButton.textContent = 'Testing...';
            document.getElementById('apiResultContainer').style.display = 'none';
            showStatus('Calling the API...', 'info');

            try {
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 'testApiCall',
                        method: 'tools/call',
                        params: {
                            name: 'rtm_get_lists',
                            arguments: { auth_token: currentAuthToken }
                        }
                    })
                });

                if (!response.ok) throw new Error('Network response was not ok.');
                const data = await response.json();
                if (data.error) throw new Error(data.error.message);

                document.getElementById('apiResult').textContent = JSON.stringify(data, null, 2);
                document.getElementById('apiResultContainer').style.display = 'block';
                showStatus('API call successful!', 'success');

            } catch(error) {
                showStatus('API Test Error: ' + error.message, 'error');
            } finally {
                testButton.disabled = false;
                testButton.textContent = 'Test: Get My Lists';
            }
        }
        
        // --- Full Functions (copy and paste everything below) ---
        
        document.getElementById('email').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') startAuth();
        });

        async function startAuth() {
            const emailInput = document.getElementById('email');
            const email = emailInput.value.trim();
            if (!email) {
                showStatus('Please enter your email address', 'error');
                return;
            }
            currentEmail = email;
            document.querySelector('#step1 button').disabled = true;
            showStatus('Connecting to Remember The Milk...', 'info');

            try {
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: Date.now(),
                        method: 'tools/call',
                        params: { name: 'rtm_authenticate', arguments: { user_id: email } }
                    })
                });
                if (!response.ok) throw new Error('Network response was not ok: ' + response.statusText);
                const data = await response.json();
                if (data.error) throw new Error(data.error.message);
                const resource = data.result?.content?.[0]?.resource?.value;

                if (resource?.success === true) {
                    currentAuthToken = resource.auth_token;
                    showStatus('Welcome back! You are already authenticated.', 'success');
                    document.getElementById('savedEmail').textContent = email;
                    document.getElementById('authToken').textContent = resource.auth_token;
                    showStep(3);
                } else if (resource?.auth_url) {
                    currentFrob = resource.frob;
                    document.getElementById('authLink').href = resource.auth_url;
                    showStatus('Click the green button to authorize.', 'info');
                    showStep(2);
                } else {
                    throw new Error('Unexpected response from server. Check console for details.');
                }
            } catch (error) {
                showStatus('Error: ' + error.message, 'error');
            } finally {
                document.querySelector('#step1 button').disabled = false;
            }
        }

        async function completeAuth() {
            if (!currentFrob || !currentEmail) {
                showStatus('Missing authentication data. Please start over.', 'error');
                showStep(1);
                return;
            }
            document.querySelector('#step2 button').disabled = true;
            showStatus('Completing authentication...', 'info');

            try {
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: Date.now(),
                        method: 'tools/call',
                        params: { name: 'rtm_complete_auth', arguments: { frob: currentFrob, user_id: currentEmail } }
                    })
                });
                if (!response.ok) throw new Error('Network response was not ok: ' + response.statusText);
                const data = await response.json();
                if (data.error) throw new Error(data.error.message);
                const resource = data.result?.content?.[0]?.resource?.value;

                if (resource?.success === true) {
                    currentAuthToken = resource.auth_token;
                    showStatus('Authentication successful!', 'success');
                    document.getElementById('savedEmail').textContent = currentEmail;
                    document.getElementById('authToken').textContent = resource.auth_token;
                    showStep(3);
                } else {
                    throw new Error(resource?.message || 'Authorization not complete. Please ensure you authorized the app on the RTM website, then try again.');
                }
            } catch (error) {
                showStatus('Error: ' + error.message, 'error');
            } finally {
                document.querySelector('#step2 button').disabled = false;
            }
        }
    </script>
</body>
</html>
`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/') {
      return new Response('Not Found', { status: 404 });
    }
    if (!env.MCP_SERVER_URL) {
      return new Response('Server configuration error: MCP_SERVER_URL is not set.', { status: 500 });
    }
    const finalHtml = html.replace('__MCP_SERVER_URL__', env.MCP_SERVER_URL);
    return new Response(finalHtml, {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
      },
    });
  },
};