import { z } from 'zod';

// Timeline creation schema
export const CreateTimelineSchema = z.object({
  auth_token: z.string().min(1, "Authentication token is required")
});

// Task identifier schema (base for operations on existing tasks)
const TaskIdentifierSchema = z.object({
  auth_token: z.string().min(1, "Authentication token is required"),
  timeline: z.string().min(1, "Timeline is required"),
  list_id: z.string().min(1, "List ID is required"),
  taskseries_id: z.string().min(1, "Task series ID is required"),
  task_id: z.string().min(1, "Task ID is required")
});

// Get tasks schema
export const GetTasksSchema = z.object({
  auth_token: z.string().min(1, "Authentication token is required"),
  list_id: z.string().optional(),
  filter: z.string().optional()
});

// Add task schema
export const AddTaskSchema = z.object({
  auth_token: z.string().min(1, "Authentication token is required"),
  timeline: z.string().min(1, "Timeline is required"),
  name: z.string().min(1, "Task name is required"),
  list_id: z.string().optional()
});

// Complete task schema
export const CompleteTaskSchema = TaskIdentifierSchema;

// Delete task schema
export const DeleteTaskSchema = TaskIdentifierSchema;