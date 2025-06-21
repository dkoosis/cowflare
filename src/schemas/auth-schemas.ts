/**
 * @file schemas/auth-schemas.ts
 * @description Authentication-related schemas
 */

import { z } from 'zod';

/**
 * Schema for initiating authentication
 */
export const AuthenticateSchema = z.object({});

export type AuthenticateArgs = z.infer<typeof AuthenticateSchema>;

/**
 * Schema for completing authentication
 */
export const CompleteAuthSchema = z.object({
  session_id: z.string()
    .min(1, "Session ID is required")
    .describe("The session ID received from the initial authentication setup")
});

export type CompleteAuthArgs = z.infer<typeof CompleteAuthSchema>;

/**
 * Schema for checking authentication status
 */
export const CheckAuthStatusSchema = z.object({
  session_id: z.string()
    .min(1, "Session ID is required")
    .describe("The session ID to check authentication status for")
});

export type CheckAuthStatusArgs = z.infer<typeof CheckAuthStatusSchema>;

/**
 * Schema for creating a timeline
 */
export const CreateTimelineSchema = z.object({
  auth_token: z.string()
    .min(1, "Authentication token is required")
    .describe("Your Remember The Milk authentication token")
});

export type CreateTimelineArgs = z.infer<typeof CreateTimelineSchema>;