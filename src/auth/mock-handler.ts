import type { AuthHandler } from "@cloudflare/workers-oauth-provider";
import type { Env } from "../index";

/**
 * Mock authentication handler for development and testing.
 * This simulates an OAuth flow without requiring external authentication.
 * 
 * TODO: Replace this with RTM integration when ready.
 */
export const MockAuthHandler: AuthHandler<Env> = {
  /**
   * Handle the authorization request.
   * In a real OAuth flow, this would redirect to an external auth provider.
   * For mock auth, we'll show a simple login form.
   */
  async authorize(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const clientId = url.searchParams.get("client_id");
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state");
    const scope = url.searchParams.get("scope");

    // Handle form submission
    if (request.method === "POST") {
      const formData = await request.formData();
      const username = formData.get("username") as string;
      const consent = formData.get("consent") === "true";

      if (!consent) {
        // User denied access
        const denyUrl = new URL(redirectUri!);
        denyUrl.searchParams.set("error", "access_denied");
        if (state) denyUrl.searchParams.set("state", state);
        return Response.redirect(denyUrl.toString());
      }

      // Generate a mock authorization code
      const code = generateMockCode(username);
      
      // Store the code temporarily (in production, use KV or Durable Objects)
      // For now, we'll encode the user info in the code itself
      
      const callbackUrl = new URL(redirectUri!);
      callbackUrl.searchParams.set("code", code);
      if (state) callbackUrl.searchParams.set("state", state);
      
      return Response.redirect(callbackUrl.toString());
    }

    // Show mock login form
    return new Response(
      `<!DOCTYPE html>
      <html>
      <head>
        <title>Mock OAuth Login - Project Cowflare</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            max-width: 400px;
            margin: 50px auto;
            padding: 20px;
            background: #f5f5f5;
          }
          .container {
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          h1 {
            color: #333;
            margin-bottom: 10px;
          }
          .info {
            background: #e3f2fd;
            padding: 15px;
            border-radius: 4px;
            margin-bottom: 20px;
            font-size: 14px;
          }
          .form-group {
            margin-bottom: 20px;
          }
          label {
            display: block;
            margin-bottom: 5px;
            color: #666;
            font-size: 14px;
          }
          input[type="text"] {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            box-sizing: border-box;
          }
          .permissions {
            background: #f9f9f9;
            padding: 15px;
            border-radius: 4px;
            margin-bottom: 20px;
          }
          .permissions h3 {
            margin-top: 0;
            font-size: 16px;
          }
          .permissions ul {
            margin: 10px 0;
            padding-left: 20px;
          }
          .button-group {
            display: flex;
            gap: 10px;
          }
          button {
            flex: 1;
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            font-size: 16px;
            cursor: pointer;
            transition: opacity 0.2s;
          }
          button:hover {
            opacity: 0.9;
          }
          .approve {
            background: #4CAF50;
            color: white;
          }
          .deny {
            background: #f44336;
            color: white;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Mock OAuth Login</h1>
          <div class="info">
            ⚠️ This is a mock authentication flow for development.
            <br>In production, this will be replaced with Cloudflare RTM.
          </div>
          
          <form method="POST">
            <div class="form-group">
              <label for="username">Username (any value for testing)</label>
              <input 
                type="text" 
                id="username" 
                name="username" 
                placeholder="test-user" 
                value="test-user"
                required
              >
            </div>
            
            <div class="permissions">
              <h3>The application is requesting access to:</h3>
              <ul>
                <li>Execute MCP tools on your behalf</li>
                <li>Access session state</li>
                ${scope ? `<li>Additional scopes: ${scope}</li>` : ''}
              </ul>
            </div>
            
            <div class="button-group">
              <button type="submit" name="consent" value="true" class="approve">
                Approve Access
              </button>
              <button type="submit" name="consent" value="false" class="deny">
                Deny Access
              </button>
            </div>
          </form>
        </div>
      </body>
      </html>`,
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      }
    );
  },

  /**
   * Exchange authorization code for access token.
   * In production, this would validate with the auth provider.
   */
  async token(request: Request, env: Env) {
    const formData = await request.formData();
    const code = formData.get("code") as string;
    const grantType = formData.get("grant_type");

    if (grantType !== "authorization_code") {
      return new Response(
        JSON.stringify({
          error: "unsupported_grant_type",
          error_description: "Only authorization_code grant type is supported",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Decode mock user info from code
    const userInfo = decodeMockCode(code);
    
    if (!userInfo) {
      return new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Invalid authorization code",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Generate mock tokens
    const accessToken = generateMockToken(userInfo.username);
    const refreshToken = generateMockToken(userInfo.username, "refresh");

    return new Response(
      JSON.stringify({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: refreshToken,
        scope: "mcp:execute",
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  },

  /**
   * Validate access token and return user claims.
   * This is called by the OAuth provider to get user context.
   */
  async validateToken(token: string, env: Env): Promise<any> {
    // Decode mock token
    const userInfo = decodeMockToken(token);
    
    if (!userInfo) {
      return null;
    }

    // Return user claims
    return {
      sub: userInfo.username,
      name: userInfo.username,
      email: `${userInfo.username}@mock.local`,
      // Mock permissions - in production, these would come from RTM
      permissions: ["mcp:execute", "mcp:read"],
    };
  },
};

// Helper functions for mock token generation

function generateMockCode(username: string): string {
  // Simple encoding for development - NOT secure for production
  const data = JSON.stringify({ username, timestamp: Date.now() });
  return btoa(data).replace(/=/g, "");
}

function decodeMockCode(code: string): { username: string } | null {
  try {
    const decoded = atob(code);
    const data = JSON.parse(decoded);
    
    // Check if code is still valid (5 minutes)
    if (Date.now() - data.timestamp > 5 * 60 * 1000) {
      return null;
    }
    
    return data;
  } catch {
    return null;
  }
}

function generateMockToken(username: string, type: string = "access"): string {
  const data = JSON.stringify({
    username,
    type,
    timestamp: Date.now(),
    random: Math.random().toString(36).substring(7),
  });
  return btoa(data).replace(/=/g, "");
}

function decodeMockToken(token: string): { username: string } | null {
  try {
    const decoded = atob(token);
    const data = JSON.parse(decoded);
    
    // Check if token is still valid (1 hour for access, 30 days for refresh)
    const maxAge = data.type === "refresh" ? 30 * 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
    if (Date.now() - data.timestamp > maxAge) {
      return null;
    }
    
    return data;
  } catch {
    return null;
  }
}