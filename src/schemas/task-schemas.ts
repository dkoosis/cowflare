/**
 * @file schemas/task-schemas.ts
 * @description Task management schemas
 */

import { z } from 'zod';

/**
 * Common task identifier schema for operations on existing tasks
 */
const TaskIdentifierSchema = z.object({
  auth_token: z.string()
    .min(1, "Authentication token is required")
    .describe("Your Remember The Milk authentication token"),
  timeline: z.string()
    .min(1, "Timeline is required")
    .describe("Timeline ID for undoable operations"),
  list_id: z.string()
    .min(1, "List ID is required")
    .describe("ID of the list containing the task"),
  taskseries_id: z.string()
    .min(1, "Task series ID is required")
    .describe("Task series ID"),
  task_id: z.string()
    .min(1, "Task ID is required")
    .describe("Specific task ID within the series")
});

/**
 * Schema for retrieving tasks
 */
export const GetTasksSchema = z.object({
  auth_token: z.string()
    .min(1, "Authentication token is required")
    .describe("Your Remember The Milk authentication token"),
  list_id: z.string()
    .optional()
    .describe("ID of a specific list to retrieve tasks from (optional)"),
  filter: z.string()
    .optional()
    .describe("RTM search filter (e.g., 'due:today', 'tag:important') (optional)")
});

export type GetTasksArgs = z.infer<typeof GetTasksSchema>;

/**
 * Schema for adding a new task
 */
export const AddTaskSchema = z.object({
  auth_token: z.string()
    .min(1, "Authentication token is required")
    .describe("Your Remember The Milk authentication token"),
  timeline: z.string()
    .min(1, "Timeline is required")
    .describe("Timeline ID for undoable operations"),
  name: z.string()
    .min(1, "Task name is required")
    .describe("Task description (supports Smart Add: 'Buy milk tomorrow at 3pm #shopping !2')"),
  list_id: z.string()
    .optional()
    .describe("ID of the list to add the task to (optional, defaults to Inbox)")
});

export type AddTaskArgs = z.infer<typeof AddTaskSchema>;

/**
 * Schema for completing a task
 */
export const CompleteTaskSchema = TaskIdentifierSchema;

export type CompleteTaskArgs = z.infer<typeof CompleteTaskSchema>;

/**
 * Schema for deleting a task
 */
export const DeleteTaskSchema = TaskIdentifierSchema;

export type DeleteTaskArgs = z.infer<typeof DeleteTaskSchema>;

/**
 * Schema for setting task due date
 */
export const SetDueDateSchema = TaskIdentifierSchema.extend({
  due: z.string()
    .optional()
    .describe("Due date in ISO format (YYYY-MM-DD) or RTM natural language (e.g., 'tomorrow', 'next Friday')"),
  has_due_time: z.enum(["0", "1"])
    .optional()
    .describe("Whether the due date includes a specific time (0=date only, 1=date and time)"),
  parse: z.boolean()
    .optional()
    .describe("Whether to parse natural language dates")
});

export type SetDueDateArgs = z.infer<typeof SetDueDateSchema>;

/**
 * Schema for adding tags to a task
 */
export const AddTagsSchema = TaskIdentifierSchema.extend({
  tags: z.string()
    .min(1, "Tags are required")
    .describe("Comma-separated list of tags to add (e.g., 'urgent,work,followup')")
});

export type AddTagsArgs = z.infer<typeof AddTagsSchema>;

/**
 * Schema for moving a task between lists
 */
export const MoveTaskSchema = z.object({
  auth_token: z.string()
    .min(1, "Authentication token is required")
    .describe("Your Remember The Milk authentication token"),
  timeline: z.string()
    .min(1, "Timeline is required")
    .describe("Timeline ID for undoable operations"),
  from_list_id: z.string()
    .min(1, "Source list ID is required")
    .describe("ID of the current list containing the task"),
  to_list_id: z.string()
    .min(1, "Destination list ID is required")
    .describe("ID of the destination list"),
  taskseries_id: z.string()
    .min(1, "Task series ID is required")
    .describe("Task series ID"),
  task_id: z.string()
    .min(1, "Task ID is required")
    .describe("Specific task ID within the series")
});

export type MoveTaskArgs = z.infer<typeof MoveTaskSchema>;

/**
 * Schema for setting task priority
 */
export const SetPrioritySchema = TaskIdentifierSchema.extend({
  priority: z.enum(["1", "2", "3", "N"], {
    errorMap: () => ({ message: "Priority must be 1, 2, 3, or N" })
  }).describe("Priority level: N=None, 1=High, 2=Medium, 3=Low")
});


export type SetPriorityArgs = z.infer<typeof SetPrioritySchema>;

/**
 * Schema for searching tasks
 */
export const SearchTasksSchema = z.object({
  auth_token: z.string()
    .min(1, "Authentication token is required")
    .describe("Your Remember The Milk authentication token"),
  query: z.string()
    .min(1, "Search query is required")
    .describe("RTM search query (e.g., 'priority:1 AND status:incomplete')")
});

export type SearchTasksArgs = z.infer<typeof SearchTasksSchema>;

/**
 * Schema for updating a task
 */
export const UpdateTaskSchema = TaskIdentifierSchema.extend({
  name: z.string()
    .optional()
    .describe("New task name"),
  due: z.string()
    .optional()
    .describe("New due date"),
  priority: z.enum(['1', '2', '3', 'N'])
    .optional()
    .describe("New priority"),
  tags: z.string()
    .optional()
    .describe("New tags (replaces all)"),
  notes: z.string()
    .optional()
    .describe("New notes"),
  estimate: z.string()
    .optional()
    .describe("Time estimate")
});

export type UpdateTaskArgs = z.infer<typeof UpdateTaskSchema>;
