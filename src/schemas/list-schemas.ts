/**
 * @file schemas/list-schemas.ts
 * @description List management schemas
 */

import { z } from 'zod';

/**
 * Schema for retrieving lists
 */
export const GetListsSchema = z.object({
  auth_token: z.string()
    .min(1, "Authentication token is required")
    .describe("Your Remember The Milk authentication token")
});

export type GetListsArgs = z.infer<typeof GetListsSchema>;

/**
 * Schema for adding a new list
 */
export const AddListSchema = z.object({
  auth_token: z.string()
    .min(1, "Authentication token is required")
    .describe("Your Remember The Milk authentication token"),
  timeline: z.string()
    .min(1, "Timeline is required")
    .describe("Timeline ID for undoable operations"),
  name: z.string()
    .min(1, "List name is required")
    .describe("Name for the new list"),
  filter: z.string()
    .optional()
    .describe("Smart list filter criteria (optional, creates a Smart List)")
});

export type AddListArgs = z.infer<typeof AddListSchema>;