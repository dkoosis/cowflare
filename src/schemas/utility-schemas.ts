/**
 * @file schemas/utility-schemas.ts
 * @description Utility and helper schemas
 */

import { z } from 'zod';

/**
 * Schema for undoing a transaction
 */
export const UndoSchema = z.object({
  auth_token: z.string()
    .min(1, "Authentication token is required")
    .describe("Your Remember The Milk authentication token"),
  timeline: z.string()
    .min(1, "Timeline is required")
    .describe("Timeline ID containing the action to undo"),
  transaction_id: z.string()
    .min(1, "Transaction ID is required")
    .describe("Transaction ID of the specific action to undo")
});

export type UndoArgs = z.infer<typeof UndoSchema>;

/**
 * Schema for parsing natural language time
 */
export const ParseTimeSchema = z.object({
  text: z.string()
    .min(1, "Text to parse is required")
    .describe("Natural language time description (e.g., 'tomorrow at 3pm', 'next Monday')"),
  timezone: z.string()
    .optional()
    .describe("Timezone for parsing (optional, e.g., 'America/New_York')")
});

export type ParseTimeArgs = z.infer<typeof ParseTimeSchema>;

/**
 * Schema for adding a note to a task
 */
export const AddTaskNoteSchema = z.object({
  auth_token: z.string()
    .min(1, "Authentication token is required")
    .describe("Your Remember The Milk authentication token"),
  list_id: z.string()
    .min(1, "List ID is required")
    .describe("The ID of the list containing the task"),
  taskseries_id: z.string()
    .min(1, "Task series ID is required")
    .describe("The ID of the task series"),
  task_id: z.string()
    .min(1, "Task ID is required")
    .describe("The ID of the specific task"),
  note_title: z.string()
    .optional()
    .describe("Title for the note (optional)"),
  note_text: z.string()
    .min(1, "Note text is required")
    .describe("The note content")
});

export type AddTaskNoteArgs = z.infer<typeof AddTaskNoteSchema>;

/**
 * Schema for getting locations
 */
export const GetLocationsSchema = z.object({
  auth_token: z.string()
    .min(1, "Authentication token is required")
    .describe("Your Remember The Milk authentication token")
});

export type GetLocationsArgs = z.infer<typeof GetLocationsSchema>;

/**
 * Schema for getting tags
 */
export const GetTagsSchema = z.object({
  auth_token: z.string()
    .min(1, "Authentication token is required")
    .describe("Your Remember The Milk authentication token")
});

export type GetTagsArgs = z.infer<typeof GetTagsSchema>;