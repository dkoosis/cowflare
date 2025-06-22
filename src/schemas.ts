import { z } from 'zod';

// Base schema with auth token (will be omitted in tools)
const AuthSchema = z.object({
  auth_token: z.string().describe("RTM authentication token")
});

// Lists
export const GetListsSchema = AuthSchema;

// Tasks
export const AddTaskSchema = AuthSchema.extend({
  name: z.string().describe("Task name"),
  list_id: z.string().optional().describe("List ID (optional, defaults to Inbox)"),
  due: z.string().optional().describe("Due date in RTM format (e.g., 'tomorrow', '2024-03-15')"),
  priority: z.enum(['1', '2', '3', 'N']).optional().describe("Priority: 1 (high), 2 (medium), 3 (low), N (none)"),
  tags: z.string().optional().describe("Comma-separated tags"),
  notes: z.string().optional().describe("Task notes")
});

export const CompleteTaskSchema = AuthSchema.extend({
  list_id: z.string().describe("List ID"),
  taskseries_id: z.string().describe("Task series ID"),
  task_id: z.string().describe("Task ID")
});

export const GetTasksSchema = AuthSchema.extend({
  list_id: z.string().optional().describe("List ID (optional, gets all lists if omitted)"),
  filter: z.string().optional().describe("RTM search filter"),
  last_sync: z.string().optional().describe("ISO 8601 timestamp for incremental sync")
});

export const SearchTasksSchema = AuthSchema.extend({
  query: z.string().describe("RTM search query (e.g., 'priority:1 AND status:incomplete')")
});

export const UpdateTaskSchema = AuthSchema.extend({
  list_id: z.string().describe("List ID"),
  taskseries_id: z.string().describe("Task series ID"),
  task_id: z.string().describe("Task ID"),
  name: z.string().optional().describe("New task name"),
  due: z.string().optional().describe("New due date"),
  priority: z.enum(['1', '2', '3', 'N']).optional().describe("New priority"),
  tags: z.string().optional().describe("New tags (replaces all)"),
  notes: z.string().optional().describe("New notes")
});

export const DeleteTaskSchema = AuthSchema.extend({
  list_id: z.string().describe("List ID"),
  taskseries_id: z.string().describe("Task series ID"),
  task_id: z.string().describe("Task ID")
});

export const PostponeTaskSchema = AuthSchema.extend({
  list_id: z.string().describe("List ID"),
  taskseries_id: z.string().describe("Task series ID"),
  task_id: z.string().describe("Task ID")
});

export const GetTimeZonesSchema = AuthSchema;

export const GetSettingsSchema = AuthSchema;