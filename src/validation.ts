// File: src/validation.ts

import { z } from 'zod';

// --- Custom Error Classes ---

/**
 * Represents an error returned from the RTM (Remember The Milk) API.
 * @param {string} message - The error message from the API.
 * @param {string} [code] - The optional error code from the API.
 */
export class RTMAPIError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'RTMAPIError';
  }
}

/**
 * Represents a validation error for incoming tool arguments.
 * @param {string} message - The validation error message.
 * @param {string} [field] - The optional field that failed validation.
 */
export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Represents an error thrown when a client exceeds the configured rate limit.
 */
export class RateLimitError extends Error {
  constructor() {
    super('Rate limit exceeded. Please try again later.');
    this.name = 'RateLimitError';
  }
}

// --- RTM API Response Interfaces ---

/**
 * Describes the successful authentication response from RTM.
 */
export interface RTMAuthResponse {
  token: string;
  user: {
    id: string;
    username: string;
    fullname: string;
  };
}

/**
 * Describes the response for creating a new timeline.
 */
export interface RTMTimelineResponse {
  timeline: string;
}

/**
 * Describes a single list object from RTM.
 */
export interface RTMList {
  id: string;
  name: string;
  deleted: string; // "0" or "1"
  locked: string;   // "0" or "1"
  archived: string; // "0" or "1"
  position: string;
  smart: string;    // "0" or "1"
  sort_order?: string;
  filter?: string;
}

/**
 * Describes a single task instance within a task series.
 */
export interface RTMTask {
  id: string;
  due?: string;
  has_due_time: string; // "0" or "1"
  added: string;
  completed?: string;
  deleted?: string;
  priority: string; // "N", "1", "2", "3"
  postponed: string;
  estimate?: string;
}

/**
 * Describes a task series, which contains one or more task instances.
 */
export interface RTMTaskSeries {
  id: string;
  created: string;
  modified: string;
  name: string;
  source: string;
  url?: string;
  location_id?: string;
  tags?: { tag: string[] } | { tag: string };
  participants?: any;
  notes?: any;
  task: RTMTask[];
}

// --- Zod Validation Schemas ---

/** Validates arguments for the initial authentication setup. */
export const AuthenticateSchema = z.object({});

/** Validates arguments for completing the authentication process. */
export const CompleteAuthSchema = z.object({
  session_id: z.string().min(1, 'Session ID is required')
});

/** Validates arguments for checking authentication status. */
export const CheckAuthStatusSchema = z.object({
  session_id: z.string().min(1, 'Session ID is required')
});

/** Validates arguments for creating a timeline for undoable actions. */
export const CreateTimelineSchema = z.object({
  auth_token: z.string().min(1, 'Auth token is required')
});

/** Validates arguments for retrieving all of the user's lists. */
export const GetListsSchema = z.object({
  auth_token: z.string().min(1, 'Auth token is required')
});

/** Validates arguments for adding a new list. */
export const AddListSchema = z.object({
  auth_token: z.string().min(1, 'Auth token is required'),
  timeline: z.string().min(1, 'Timeline is required'),
  name: z.string().min(1, 'List name is required'),
  filter: z.string().optional()
});

/** Validates arguments for retrieving tasks. */
export const GetTasksSchema = z.object({
  auth_token: z.string().min(1, 'Auth token is required'),
  list_id: z.string().optional(),
  filter: z.string().optional()
});

/** Validates arguments for adding a new task using Smart Add. */
export const AddTaskSchema = z.object({
  auth_token: z.string().min(1, 'Auth token is required'),
  timeline: z.string().min(1, 'Timeline is required'),
  name: z.string().min(1, 'Task name is required'),
  list_id: z.string().optional()
});

/** Validates arguments for marking a task as complete. */
export const CompleteTaskSchema = z.object({
  auth_token: z.string().min(1, 'Auth token is required'),
  timeline: z.string().min(1, 'Timeline is required'),
  list_id: z.string().min(1, 'List ID is required'),
  taskseries_id: z.string().min(1, 'Task series ID is required'),
  task_id: z.string().min(1, 'Task ID is required')
});

/** Validates arguments for deleting a task. */
export const DeleteTaskSchema = z.object({
  auth_token: z.string().min(1, 'Auth token is required'),
  timeline: z.string().min(1, 'Timeline is required'),
  list_id: z.string().min(1, 'List ID is required'),
  taskseries_id: z.string().min(1, 'Task series ID is required'),
  task_id: z.string().min(1, 'Task ID is required')
});

/** Validates arguments for setting a task's due date. */
export const SetDueDateSchema = z.object({
  auth_token: z.string().min(1, 'Auth token is required'),
  timeline: z.string().min(1, 'Timeline is required'),
  list_id: z.string().min(1, 'List ID is required'),
  taskseries_id: z.string().min(1, 'Task series ID is required'),
  task_id: z.string().min(1, 'Task ID is required'),
  due: z.string().optional(),
  has_due_time: z.enum(['0', '1']).optional()
});

/** Validates arguments for adding tags to a task. */
export const AddTagsSchema = z.object({
  auth_token: z.string().min(1, 'Auth token is required'),
  timeline: z.string().min(1, 'Timeline is required'),
  list_id: z.string().min(1, 'List ID is required'),
  taskseries_id: z.string().min(1, 'Task series ID is required'),
  task_id: z.string().min(1, 'Task ID is required'),
  tags: z.string().min(1, 'Tags are required')
});

/** Validates arguments for moving a task to a different list. */
export const MoveTaskSchema = z.object({
  auth_token: z.string().min(1, 'Auth token is required'),
  timeline: z.string().min(1, 'Timeline is required'),
  from_list_id: z.string().min(1, 'Source list ID is required'),
  to_list_id: z.string().min(1, 'Destination list ID is required'),
  taskseries_id: z.string().min(1, 'Task series ID is required'),
  task_id: z.string().min(1, 'Task ID is required')
});

/** Validates arguments for setting a task's priority. */
export const SetPrioritySchema = z.object({
  auth_token: z.string().min(1, 'Auth token is required'),
  timeline: z.string().min(1, 'Timeline is required'),
  list_id: z.string().min(1, 'List ID is required'),
  taskseries_id: z.string().min(1, 'Task series ID is required'),
  task_id: z.string().min(1, 'Task ID is required'),
  priority: z.enum(['1', '2', '3', 'N'])
});

/** Validates arguments for undoing a previous transaction. */
export const UndoSchema = z.object({
  auth_token: z.string().min(1, 'Auth token is required'),
  timeline: z.string().min(1, 'Timeline is required'),
  transaction_id: z.string().min(1, 'Transaction ID is required')
});

/** Validates arguments for parsing a time string with RTM's engine. */
export const ParseTimeSchema = z.object({
  text: z.string().min(1, 'Text to parse is required'),
  timezone: z.string().optional()
});

// Type exports for validated schemas
export type AuthenticateArgs = z.infer<typeof AuthenticateSchema>;
export type CompleteAuthArgs = z.infer<typeof CompleteAuthSchema>;
export type CheckAuthStatusArgs = z.infer<typeof CheckAuthStatusSchema>;
export type CreateTimelineArgs = z.infer<typeof CreateTimelineSchema>;
export type GetListsArgs = z.infer<typeof GetListsSchema>;
export type AddListArgs = z.infer<typeof AddListSchema>;
export type GetTasksArgs = z.infer<typeof GetTasksSchema>;
export type AddTaskArgs = z.infer<typeof AddTaskSchema>;
export type CompleteTaskArgs = z.infer<typeof CompleteTaskSchema>;
export type DeleteTaskArgs = z.infer<typeof DeleteTaskSchema>;
export type SetDueDateArgs = z.infer<typeof SetDueDateSchema>;
export type AddTagsArgs = z.infer<typeof AddTagsSchema>;
export type MoveTaskArgs = z.infer<typeof MoveTaskSchema>;
export type SetPriorityArgs = z.infer<typeof SetPrioritySchema>;
export type UndoArgs = z.infer<typeof UndoSchema>;
export type ParseTimeArgs = z.infer<typeof ParseTimeSchema>;