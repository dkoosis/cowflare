/**
 * @file tools/tasks.ts
 * @description Task management tools for RTM
 * Handles task CRUD operations and modifications
 */

import { McpServer } from '@modelcontextprotocol/sdk/server';
import { z } from 'zod';
import { Env, makeRTMRequest } from '../rtm-api';
import { MetricsCollector } from '../monitoring/metrics';
import { Logger } from '../utils/logger';
import { CacheManager } from '../cache/cache-manager';
import { 
  RTMAPIError, 
  ValidationError,
  GetTasksSchema,
  AddTaskSchema,
  CompleteTaskSchema,
  DeleteTaskSchema,
  SetDueDateSchema,
  AddTagsSchema,
  MoveTaskSchema,
  SetPrioritySchema
} from '../validation';

// Initialize cache manager
let cacheManager: CacheManager;

/**
 * Formats tasks for display
 */
function formatTasks(tasks: any): string {
  if (!tasks.list || tasks.list.length === 0) {
    return "No tasks found.";
  }

  let output = "";
  for (const list of tasks.list) {
    if (!list.taskseries || list.taskseries.length === 0) continue;

    const listName = list.id === "0" ? "Inbox" : `List ${list.id}`;
    output += `\n### ${listName}\n\n`;

    for (const series of list.taskseries) {
      const task = Array.isArray(series.task) ? series.task[0] : series.task;
      
      // Skip completed or deleted tasks unless specifically requested
      if (task.completed || task.deleted) continue;
      
      const priority = task.priority === "N" ? "" : `!${task.priority} `;
      const due = task.due ? ` (due: ${formatDueDate(task.due)})` : "";
      const tags = series.tags ? 
        ` #${Array.isArray(series.tags.tag) ? series.tags.tag.join(" #") : series.tags.tag}` : 
        "";

      output += `- ${priority}${series.name}${due}${tags}\n`;
      output += `  IDs: list=${list.id}, series=${series.id}, task=${task.id}\n`;
      
      // Add notes if present
      if (series.notes && series.notes.note) {
        const notes = Array.isArray(series.notes.note) ? series.notes.note : [series.notes.note];
        for (const note of notes) {
          output += `  📝 ${note.$t}\n`;
        }
      }
    }
  }

  return output || "No tasks found.";
}

/**
 * Formats due date for display
 */
function formatDueDate(dueDate: string): string {
  if (!dueDate) return "";
  
  try {
    const date = new Date(dueDate);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (date.toDateString() === today.toDateString()) {
      return "today";
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return "tomorrow";
    } else {
      return date.toLocaleDateString();
    }
  } catch {
    return dueDate;
  }
}

/**
 * Registers task management tools
 */
export function registerTaskTools(
  server: McpServer,
  env: Env,
  metrics: MetricsCollector
): void {
  // Initialize cache manager if not already done
  if (!cacheManager) {
    cacheManager = new CacheManager(env.AUTH_STORE);
  }

  // Tool: rtm_get_tasks
  server.registerTool(
    "rtm_get_tasks",
    {
      title: "Get Tasks",
      description: "Retrieves tasks from Remember The Milk, optionally filtered by list or search criteria.",
      readOnlyHint: true,
      inputSchema: {
        type: "object",
        properties: {
          auth_token: {
            type: "string",
            description: "Your Remember The Milk authentication token"
          },
          list_id: {
            type: "string",
            description: "ID of a specific list to retrieve tasks from (optional)"
          },
          filter: {
            type: "string",
            description: "RTM search filter (e.g., 'due:today', 'tag:important') (optional)"
          }
        },
        required: ["auth_token"]
      }
    },
    async (args) => {
      const startTime = Date.now();
      
      try {
        const validatedArgs = GetTasksSchema.parse(args);
        
        // Build cache key
        const cacheKey = `tasks:${validatedArgs.list_id || 'all'}:${validatedArgs.filter || 'none'}`;
        
        // Try to get from cache
        const cached = await cacheManager.getOrFetch(
          cacheKey,
          async () => {
            const params: Record<string, string> = { 
              auth_token: validatedArgs.auth_token 
            };
            
            if (validatedArgs.list_id) params.list_id = validatedArgs.list_id;
            if (validatedArgs.filter) params.filter = validatedArgs.filter;
            
            return await makeRTMRequest(
              'rtm.tasks.getList',
              params,
              env.RTM_API_KEY,
              env.RTM_SHARED_SECRET
            );
          },
          {
            ttl: 60, // 1 minute cache
            staleWhileRevalidate: 30 // Allow stale for 30 seconds while refreshing
          }
        );

        const formattedTasks = formatTasks(cached.tasks);
        
        Logger.info('Tasks retrieved', { 
          list_id: validatedArgs.list_id,
          filter: validatedArgs.filter,
          task_count: cached.tasks?.list?.length || 0
        });
        
        await metrics.recordToolCall('rtm_get_tasks', Date.now() - startTime, true);

        return {
          content: [{
            type: "text",
            text: formattedTasks
          }]
        };

      } catch (error: any) {
        Logger.error('Failed to get tasks', { error: error.message });
        await metrics.recordToolCall('rtm_get_tasks', Date.now() - startTime, false, error.message);
        
        if (error instanceof ValidationError) {
          throw new Error(`Validation Error: ${error.message}`);
        }
        if (error instanceof RTMAPIError) {
          throw new Error(`RTM API Error: ${error.message}`);
        }
        throw error;
      }
    }
  );

  // Tool: rtm_add_task
  server.registerTool(
    "rtm_add_task",
    {
      title: "Add New Task",
      description: "Creates a new task with Smart Add support for natural language input.",
      readOnlyHint: false,
      inputSchema: {
        type: "object",
        properties: {
          auth_token: {
            type: "string",
            description: "Your Remember The Milk authentication token"
          },
          timeline: {
            type: "string",
            description: "Timeline ID for undoable operations"
          },
          name: {
            type: "string",
            description: "Task description (supports Smart Add: 'Buy milk tomorrow at 3pm #shopping !2')"
          },
          list_id: {
            type: "string",
            description: "ID of the list to add the task to (optional, defaults to Inbox)"
          }
        },
        required: ["auth_token", "timeline", "name"]
      }
    },
    async (args) => {
      const startTime = Date.now();
      
      try {
        const validatedArgs = AddTaskSchema.parse(args);
        
        const params: Record<string, string> = {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          name: validatedArgs.name,
          parse: "1" // Enable Smart Add parsing
        };
        
        if (validatedArgs.list_id) {
          params.list_id = validatedArgs.list_id;
        }

        const response = await makeRTMRequest(
          'rtm.tasks.add',
          params,
          env.RTM_API_KEY,
          env.RTM_SHARED_SECRET
        );

        const list = response.list;
        const series = list.taskseries[0];
        const task = series.task[0];

        // Invalidate relevant caches
        await cacheManager.invalidatePattern('tasks:*');
        
        Logger.info('Task created', { 
          task_name: series.name,
          list_id: list.id,
          series_id: series.id,
          task_id: task.id
        });
        
        await metrics.recordToolCall('rtm_add_task', Date.now() - startTime, true);

        return {
          content: [{
            type: "text",
            text: `✅ Task created!\n\n` +
                  `Name: ${series.name}\n` +
                  `List: ${list.id}\n` +
                  `Due: ${task.due ? formatDueDate(task.due) : "No due date"}\n` +
                  `Priority: ${task.priority === "N" ? "None" : task.priority}\n\n` +
                  `IDs: list=${list.id}, series=${series.id}, task=${task.id}`
          }]
        };

      } catch (error: any) {
        Logger.error('Failed to add task', { error: error.message });
        await metrics.recordToolCall('rtm_add_task', Date.now() - startTime, false, error.message);
        
        if (error instanceof ValidationError) {
          throw new Error(`Validation Error: ${error.message}`);
        }
        if (error instanceof RTMAPIError) {
          throw new Error(`RTM API Error: ${error.message}`);
        }
        throw error;
      }
    }
  );

  // Tool: rtm_complete_task
  server.registerTool(
    "rtm_complete_task",
    {
      title: "Complete Task",
      description: "Marks a task as completed in Remember The Milk.",
      readOnlyHint: false,
      inputSchema: {
        type: "object",
        properties: {
          auth_token: {
            type: "string",
            description: "Your Remember The Milk authentication token"
          },
          timeline: {
            type: "string",
            description: "Timeline ID for undoable operations"
          },
          list_id: {
            type: "string",
            description: "ID of the list containing the task"
          },
          taskseries_id: {
            type: "string",
            description: "Task series ID"
          },
          task_id: {
            type: "string",
            description: "Specific task ID within the series"
          }
        },
        required: ["auth_token", "timeline", "list_id", "taskseries_id", "task_id"]
      }
    },
    async (args) => {
      const startTime = Date.now();
      
      try {
        const validatedArgs = CompleteTaskSchema.parse(args);
        
        const response = await makeRTMRequest(
          'rtm.tasks.complete',
          {
            auth_token: validatedArgs.auth_token,
            timeline: validatedArgs.timeline,
            list_id: validatedArgs.list_id,
            taskseries_id: validatedArgs.taskseries_id,
            task_id: validatedArgs.task_id
          },
          env.RTM_API_KEY,
          env.RTM_SHARED_SECRET
        );

        // Invalidate caches
        await cacheManager.invalidatePattern('tasks:*');
        
        Logger.info('Task completed', { 
          list_id: validatedArgs.list_id,
          series_id: validatedArgs.taskseries_id,
          task_id: validatedArgs.task_id,
          transaction_id: response.transaction?.id
        });
        
        await metrics.recordToolCall('rtm_complete_task', Date.now() - startTime, true);

        return {
          content: [{
            type: "text",
            text: `✅ Task completed!\n\n` +
                  `Transaction ID: ${response.transaction?.id || "N/A"}\n\n` +
                  `Use rtm_undo with this transaction ID to undo this action.`
          }]
        };

      } catch (error: any) {
        Logger.error('Failed to complete task', { error: error.message });
        await metrics.recordToolCall('rtm_complete_task', Date.now() - startTime, false, error.message);
        
        if (error instanceof ValidationError) {
          throw new Error(`Validation Error: ${error.message}`);
        }
        if (error instanceof RTMAPIError) {
          throw new Error(`RTM API Error: ${error.message}`);
        }
        throw error;
      }
    }
  );

  // Tool: rtm_delete_task
  server.registerTool(
    "rtm_delete_task",
    {
      title: "Delete Task",
      description: "Permanently deletes a task from Remember The Milk.",
      readOnlyHint: false,
      inputSchema: {
        type: "object",
        properties: {
          auth_token: {
            type: "string",
            description: "Your Remember The Milk authentication token"
          },
          timeline: {
            type: "string",
            description: "Timeline ID for undoable operations"
          },
          list_id: {
            type: "string",
            description: "ID of the list containing the task"
          },
          taskseries_id: {
            type: "string",
            description: "Task series ID"
          },
          task_id: {
            type: "string",
            description: "Specific task ID within the series"
          }
        },
        required: ["auth_token", "timeline", "list_id", "taskseries_id", "task_id"]
      }
    },
    async (args) => {
      const startTime = Date.now();
      
      try {
        const validatedArgs = DeleteTaskSchema.parse(args);
        
        const response = await makeRTMRequest(
          'rtm.tasks.delete',
          {
            auth_token: validatedArgs.auth_token,
            timeline: validatedArgs.timeline,
            list_id: validatedArgs.list_id,
            taskseries_id: validatedArgs.taskseries_id,
            task_id: validatedArgs.task_id
          },
          env.RTM_API_KEY,
          env.RTM_SHARED_SECRET
        );

        // Invalidate caches
        await cacheManager.invalidatePattern('tasks:*');
        
        Logger.info('Task deleted', { 
          list_id: validatedArgs.list_id,
          series_id: validatedArgs.taskseries_id,
          task_id: validatedArgs.task_id,
          transaction_id: response.transaction?.id
        });
        
        await metrics.recordToolCall('rtm_delete_task', Date.now() - startTime, true);

        return {
          content: [{
            type: "text",
            text: `✅ Task deleted!\n\n` +
                  `Transaction ID: ${response.transaction?.id || "N/A"}\n\n` +
                  `⚠️ This action can be undone using rtm_undo with the transaction ID.`
          }]
        };

      } catch (error: any) {
        Logger.error('Failed to delete task', { error: error.message });
        await metrics.recordToolCall('rtm_delete_task', Date.now() - startTime, false, error.message);
        
        if (error instanceof ValidationError) {
          throw new Error(`Validation Error: ${error.message}`);
        }
        if (error instanceof RTMAPIError) {
          throw new Error(`RTM API Error: ${error.message}`);
        }
        throw error;
      }
    }
  );

  // Tool: rtm_set_due_date
  server.registerTool(
    "rtm_set_due_date",
    {
      title: "Set Task Due Date",
      description: "Sets or updates the due date for a task.",
      readOnlyHint: false,
      inputSchema: {
        type: "object",
        properties: {
          auth_token: {
            type: "string",
            description: "Your Remember The Milk authentication token"
          },
          timeline: {
            type: "string",
            description: "Timeline ID for undoable operations"
          },
          list_id: {
            type: "string",
            description: "ID of the list containing the task"
          },
          taskseries_id: {
            type: "string",
            description: "Task series ID"
          },
          task_id: {
            type: "string",
            description: "Specific task ID within the series"
          },
          due: {
            type: "string",
            description: "Due date in ISO format (YYYY-MM-DD) or RTM natural language (e.g., 'tomorrow', 'next Friday')"
          },
          has_due_time: {
            type: "string",
            enum: ["0", "1"],
            description: "Whether the due date includes a specific time (0=date only, 1=date and time)"
          }
        },
        required: ["auth_token", "timeline", "list_id", "taskseries_id", "task_id"]
      }
    },
    async (args) => {
      const startTime = Date.now();
      
      try {
        const validatedArgs = SetDueDateSchema.parse(args);
        
        const params: Record<string, string> = {
          auth_token: validatedArgs.auth_token,
          timeline: validatedArgs.timeline,
          list_id: validatedArgs.list_id,
          taskseries_id: validatedArgs.taskseries_id,
          task_id: validatedArgs.task_id,
          parse: "1" // Enable natural language parsing
        };
        
        if (validatedArgs.due) {
          params.due = validatedArgs.due;
        } else {
          params.due = ""; // Clear due date
        }
        
        if (validatedArgs.has_due_time !== undefined) {
          params.has_due_time = validatedArgs.has_due_time;
        }

        const response = await makeRTMRequest(
          'rtm.tasks.setDueDate',
          params,
          env.RTM_API_KEY,
          env.RTM_SHARED_SECRET
        );

        // Invalidate caches
        await cacheManager.invalidatePattern('tasks:*');
        
        Logger.info('Due date updated', { 
          list_id: validatedArgs.list_id,
          series_id: validatedArgs.taskseries_id,
          task_id: validatedArgs.task_id,
          due: validatedArgs.due,
          transaction_id: response.transaction?.id
        });
        
        await metrics.recordToolCall('rtm_set_due_date', Date.now() - startTime, true);

        return {
          content: [{
            type: "text",
            text: `✅ Due date updated!\n\n` +
                  `New due date: ${validatedArgs.due || "Cleared"}\n` +
                  `Transaction ID: ${response.transaction?.id || "N/A"}`
          }]
        };

      } catch (error: any) {
        Logger.error('Failed to set due date', { error: error.message });
        await metrics.recordToolCall('rtm_set_due_date', Date.now() - startTime, false, error.message);
        
        if (error instanceof ValidationError) {
          throw new Error(`Validation Error: ${error.message}`);
        }
        if (error instanceof RTMAPIError) {
          throw new Error(`RTM API Error: ${error.message}`);
        }
        throw error;
      }
    }
  );

  // Register additional task tools...
  // (rtm_add_tags, rtm_move_task, rtm_set_priority would follow the same pattern)
}