// validation-schemas.ts - Zod validation schemas for all RTM tools

import { z } from "zod";

export const AuthenticateSchema = z.object({});

export const CompleteAuthSchema = z.object({
  session_id: z.string().min(1, "Session ID is required")
});

export const CreateTimelineSchema = z.object({
  auth_token: z.string().min(1, "Authentication token is required")
});

export const GetListsSchema = z.object({
  auth_token: z.string().min(1, "Authentication token is required")
});

export const AddListSchema = z.object({
  auth_token: z.string().min(1, "Authentication token is required"),
  timeline: z.string().min(1, "Timeline is required"),
  name: z.string().min(1, "List name is required"),
  filter: z.string().optional()
});

export const GetTasksSchema = z.object({
  auth_token: z.string().min(1, "Authentication token is required"),
  list_id: z.string().optional(),
  filter: z.string().optional()
});

export const AddTaskSchema = z.object({
  auth_token: z.string().min(1, "Authentication token is required"),
  timeline: z.string().min(1, "Timeline is required"),
  name: z.string().min(1, "Task name is required"),
  list_id: z.string().optional()
});

export const CompleteTaskSchema = z.object({
  auth_token: z.string().min(1, "Authentication token is required"),
  timeline: z.string().min(1, "Timeline is required"),
  list_id: z.string().min(1, "List ID is required"),
  taskseries_id: z.string().min(1, "Task series ID is required"),
  task_id: z.string().min(1, "Task ID is required")
});

export const DeleteTaskSchema = z.object({
  auth_token: z.string().min(1, "Authentication token is required"),
  timeline: z.string().min(1, "Timeline is required"),
  list_id: z.string().min(1, "List ID is required"),
  taskseries_id: z.string().min(1, "Task series ID is required"),
  task_id: z.string().min(1, "Task ID is required")
});

export const SetDueDateSchema = z.object({
  auth_token: z.string().min(1, "Authentication token is required"),
  timeline: z.string().min(1, "Timeline is required"),
  list_id: z.string().min(1, "List ID is required"),
  taskseries_id: z.string().min(1, "Task series ID is required"),
  task_id: z.string().min(1, "Task ID is required"),
  due: z.string().optional(),
  has_due_time: z.boolean().optional(),
  parse: z.boolean().optional()
});

export const AddTagsSchema = z.object({
  auth_token: z.string().min(1, "Authentication token is required"),
  timeline: z.string().min(1, "Timeline is required"),
  list_id: z.string().min(1, "List ID is required"),
  taskseries_id: z.string().min(1, "Task series ID is required"),
  task_id: z.string().min(1, "Task ID is required"),
  tags: z.string().min(1, "Tags are required")
});

export const MoveTaskSchema = z.object({
  auth_token: z.string().min(1, "Authentication token is required"),
  timeline: z.string().min(1, "Timeline is required"),
  from_list_id: z.string().min(1, "Source list ID is required"),
  to_list_id: z.string().min(1, "Destination list ID is required"),
  taskseries_id: z.string().min(1, "Task series ID is required"),
  task_id: z.string().min(1, "Task ID is required")
});

export const SetPrioritySchema = z.object({
  auth_token: z.string().min(1, "Authentication token is required"),
  timeline: z.string().min(1, "Timeline is required"),
  list_id: z.string().min(1, "List ID is required"),
  taskseries_id: z.string().min(1, "Task series ID is required"),
  task_id: z.string().min(1, "Task ID is required"),
  priority: z.enum(["1", "2", "3", "N"], {
    errorMap: () => ({ message: "Priority must be 1, 2, 3, or N" })
  })
});

export const UndoSchema = z.object({
  auth_token: z.string().min(1, "Authentication token is required"),
  timeline: z.string().min(1, "Timeline is required"),
  transaction_id: z.string().min(1, "Transaction ID is required")
});

export const ParseTimeSchema = z.object({
  text: z.string().min(1, "Text to parse is required"),
  timezone: z.string().optional()
});