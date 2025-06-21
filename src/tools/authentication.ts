/**
 * @file tools/authentication.ts
 * @description Clean authentication tools implementation
 */

import { McpServer } from '@modelcontextprotocol/sdk/server';
import { z } from 'zod';
import { Env } from '../types';
import { MetricsCollector } from '../monitoring/metrics';
import { Logger } from '../utils/logger';
import { RTMApiClient } from '../rtm-api/client';
import { AuthManager } from '../auth/auth-manager';
import { ToolBase } from './tool-base';

// Validation schemas
const AuthenticateSchema = z.object({});

const CompleteAuthSchema = z.object({
  session_id: z.string().uuid()
});

const CheckAuthStatusSchema = z.object({
  session_id: z.string().uuid()
});

export class AuthenticationTools extends ToolBase {
  private authManager: AuthManager;
  private rtmClient: RTMApiClient;

  constructor(env: Env, metrics: MetricsCollector, logger: Logger) {
    super(env, metrics, logger);
    this.authManager = new AuthManager(env.AUTH_STORE, logger);
    this.rtmClient = new RTMApiClient(env, logger);
  }

  register(server: McpServer): void {
    this.registerAuthenticate(server);
    this.registerCompleteAuth(server);
    this.registerCheckAuthStatus(server);
  }

  private registerAuthenticate(server: McpServer): void {
    server.registerTool(
      "rtm_authenticate",
      {
        title: "Start RTM Authentication",
        description: "Initiates Remember The Milk OAuth authentication flow",
        readOnlyHint: true,
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        }
      },
      this.wrapHandler(async (args) => {
        AuthenticateSchema.parse(args);

        const sessionId = crypto.randomUUID();
        
        // Check for existing valid token
        const existingAuth = await this.authManager.getValidAuth(sessionId);
        if (existingAuth) {
          return this.success(
            `✅ Already authenticated!\n\n` +
            `User: ${existingAuth.user.fullname}\n` +
            `Username: ${existingAuth.user.username}`
          );
        }

        // Initiate OAuth flow
        const { frob, authUrl } = await this.rtmClient.initiateAuth();
        await this.authManager.savePendingAuth(sessionId, frob);

        const callbackUrl = `${this.env.SERVER_URL}/auth/callback?session=${sessionId}`;
        const fullAuthUrl = `${authUrl}&redirect=${encodeURIComponent(callbackUrl)}`;

        return this.success(
          `🔐 Authentication Required\n\n` +
          `Please visit: ${fullAuthUrl}\n\n` +
          `After authorizing, use rtm_complete_auth with session ID:\n` +
          `${sessionId}`
        );
      })
    );
  }

  private registerCompleteAuth(server: McpServer): void {
    server.registerTool(
      "rtm_complete_auth",
      {
        title: "Complete RTM Authentication",
        description: "Completes the OAuth flow after user authorization",
        readOnlyHint: false,
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              format: "uuid",
              description: "Session ID from rtm_authenticate"
            }
          },
          required: ["session_id"],
          additionalProperties: false
        }
      },
      this.wrapHandler(async (args) => {
        const { session_id } = CompleteAuthSchema.parse(args);

        const pendingAuth = await this.authManager.getPendingAuth(session_id);
        if (!pendingAuth) {
          return this.error("Session expired or invalid. Please start over with rtm_authenticate.");
        }

        try {
          const authData = await this.rtmClient.exchangeFrobForToken(pendingAuth.frob);
          await this.authManager.saveAuth(session_id, authData);
          await this.authManager.clearPendingAuth(session_id);

          return this.success(
            `✅ Authentication successful!\n\n` +
            `User: ${authData.user.fullname}\n` +
            `Username: ${authData.user.username}\n` +
            `Token: ${authData.token}\n\n` +
            `You can now use all RTM tools with this token.`
          );
        } catch (error: any) {
          if (error.message.includes('Invalid frob')) {
            return this.error(
              "Authorization pending. Please ensure you've authorized the app on RTM's website."
            );
          }
          throw error;
        }
      })
    );
  }

  private registerCheckAuthStatus(server: McpServer): void {
    server.registerTool(
      "rtm_check_auth_status",
      {
        title: "Check Authentication Status",
        description: "Verifies current authentication status",
        readOnlyHint: true,
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              format: "uuid",
              description: "Session ID to check"
            }
          },
          required: ["session_id"],
          additionalProperties: false
        }
      },
      this.wrapHandler(async (args) => {
        const { session_id } = CheckAuthStatusSchema.parse(args);

        // Check for valid auth
        const auth = await this.authManager.getValidAuth(session_id);
        if (auth) {
          return this.success(
            `✅ Authenticated\n\n` +
            `User: ${auth.user.fullname}\n` +
            `Username: ${auth.user.username}\n` +
            `Valid until: Session expires`
          );
        }

        // Check for pending auth
        const pending = await this.authManager.getPendingAuth(session_id);
        if (pending) {
          const ageMinutes = Math.floor((Date.now() - pending.created_at) / 60000);
          return this.success(
            `⏳ Authentication Pending\n\n` +
            `Session created ${ageMinutes} minutes ago.\n` +
            `Waiting for user authorization.`
          );
        }

        return this.success(
          `❌ Not Authenticated\n\n` +
          `No authentication found for this session.\n` +
          `Start with rtm_authenticate.`
        );
      })
    );
  }
}