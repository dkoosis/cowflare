// src/rtm-api.ts - RTM API types and request handler

import { RTMAPIError } from '../src_backup/validation.js';

// Environment interface for Cloudflare Workers
export interface Env {
  RTM_API_KEY: string;
  RTM_SHARED_SECRET: string;
  SERVER_URL: string;
  AUTH_STORE: KVNamespace;
}

// RTM API Response structure
export interface RTMApiResponse {
  rsp: {
    stat: 'ok' | 'fail';
    err?: {
      code: string;
      msg: string;
    };
    [key: string]: any;
  };
}

// RTM API specific response types
export interface RTMAuthGetFrobResponse {
  frob: string;
}

export interface RTMAuthGetTokenResponse {
  auth: {
    token: string;
    user: {
      id: string;
      username: string;
      fullname: string;
    };
  };
}

export interface RTMTimelineResponse {
  timeline: string;
}

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

export interface RTMTaskInstance {
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
  task: RTMTaskInstance | RTMTaskInstance[];
}

export interface RTMTasksList {
  id: string;
  taskseries?: RTMTaskSeries[];
}

export interface RTMGetListsResponse {
  lists: {
    list: RTMList[];
  };
}

export interface RTMGetTasksResponse {
  tasks: {
    list: RTMTasksList[];
  };
}

export interface RTMAddListResponse {
  list: RTMList;
  transaction?: {
    id: string;
    undoable: string;
  };
}

export interface RTMAddTaskResponse {
  list: {
    id: string;
    taskseries: RTMTaskSeries[];
  };
  transaction?: {
    id: string;
    undoable: string;
  };
}

export interface RTMTransactionResponse {
  transaction?: {
    id: string;
    undoable: string;
  };
}

export interface RTMParseTimeResponse {
  time: {
    $t: string;
    precision: string;
  };
}

export interface RTMUserSettings {
  timezone: string;
  dateformat: string;
  timeformat: string;
  defaultlist: string;
  language: string;
}

// RTM API request parameters
export interface RTMApiParams {
  method: string;
  params: Record<string, string>;
  apiKey: string;
  sharedSecret: string;
}

/**
 * Makes an authenticated request to the Remember The Milk API
 * @param method - RTM API method name (e.g., 'rtm.lists.getList')
 * @param params - Method-specific parameters
 * @param apiKey - RTM API key
 * @param sharedSecret - RTM shared secret for signing requests
 * @returns Promise resolving to the API response data
 * @throws RTMAPIError if the API returns an error
 */
export async function makeRTMRequest(
  method: string, 
  params: Record<string, string>, 
  apiKey: string, 
  sharedSecret: string
): Promise<any> {
  const allParams: Record<string, string> = {
    method,
    api_key: apiKey,
    format: 'json',
    ...params
  };

  // Generate MD5 signature
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys.map(key => `${key}${allParams[key]}`).join('');
  const signatureBase = sharedSecret + paramString;
  
  const encoder = new TextEncoder();
  const signatureData = encoder.encode(signatureBase);
  const hashBuffer = await crypto.subtle.digest('MD5', signatureData);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const apiSig = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  allParams.api_sig = apiSig;

  // Build URL with parameters
  const url = new URL('https://api.rememberthemilk.com/services/rest/');
  Object.entries(allParams).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });

  try {
    const response = await fetch(url.toString());
    
    if (!response.ok) {
      throw new RTMAPIError(`HTTP error! status: ${response.status}`);
    }

    const responseData = await response.json() as RTMApiResponse;
    
    if (responseData.rsp.stat !== 'ok') {
      const error = responseData.rsp.err;
      throw new RTMAPIError(
        error?.msg || 'Unknown RTM API error',
        error?.code
      );
    }

    return responseData.rsp;
  } catch (error) {
    if (error instanceof RTMAPIError) {
      throw error;
    }
    throw new RTMAPIError(`Network or parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Formats task lists for display
 */
export function formatLists(lists: RTMList[]): string {
  if (!lists || lists.length === 0) {
    return "No lists found.";
  }

  let output = "## Your RTM Lists\n\n";
  const activeLists = lists.filter(l => l.deleted === "0" && l.archived === "0");
  const archivedLists = lists.filter(l => l.archived === "1");

  if (activeLists.length > 0) {
    output += "### Active Lists\n";
    for (const list of activeLists) {
      const smart = list.smart === "1" ? " (Smart List)" : "";
      output += `- **${list.name}**${smart} - ID: ${list.id}\n`;
    }
  }

  if (archivedLists.length > 0) {
    output += "\n### Archived Lists\n";
    for (const list of archivedLists) {
      output += `- ${list.name} - ID: ${list.id}\n`;
    }
  }

  return output;
}

/**
 * Formats a due date for display with better date handling
 */
function formatDueDate(dueDate: string | undefined): string {
  if (!dueDate) return "";
  
  try {
    const date = new Date(dueDate);
    if (isNaN(date.getTime())) {
      // Invalid date, return as-is
      return dueDate;
    }
    
    const now = new Date();
    // Reset time parts for date-only comparison
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const compareDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    // Calculate difference in days
    const diffTime = compareDate.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return "today";
    } else if (diffDays === 1) {
      return "tomorrow";
    } else if (diffDays === -1) {
      return "yesterday";
    } else if (diffDays > 0 && diffDays <= 7) {
      // Next week - show day name
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return `${dayNames[date.getDay()]} (${date.toLocaleDateString()})`;
    } else if (diffDays < 0) {
      return `overdue (${date.toLocaleDateString()})`;
    } else {
      return date.toLocaleDateString();
    }
  } catch (error) {
    // Fallback for any parsing errors
    return dueDate;
  }
}

/**
 * Formats tasks for display with improved structure
 */
// rtm-api.ts - Fixed formatTasks function

export function formatTasks(tasks: RTMGetTasksResponse['tasks']): string {
  if (!tasks.list || tasks.list.length === 0) {
    return "No tasks found.";
  }

  let output = "";
  let totalTasks = 0;
  let overdueTasks = 0;
  
  for (const list of tasks.list) {
    if (!list.taskseries || list.taskseries.length === 0) continue;

    const listName = list.id === "0" ? "Inbox" : `List ${list.id}`;
    const taskCount = list.taskseries.length;
    output += `\n### ${listName} (${taskCount} task${taskCount !== 1 ? 's' : ''})\n\n`;

    for (const series of list.taskseries) {
      const taskArray = Array.isArray(series.task) ? series.task : [series.task];
      const task = taskArray[0];
      
      // Guard against undefined task
      if (!task) continue;
      
      // Skip completed or deleted tasks
      if (task.completed || task.deleted) continue;
      
      totalTasks++;
      
      // Format priority with color indicators for better visual scanning
      const prioritySymbols: Record<string, string> = {
        "1": "🔴", // High (red for urgency)
        "2": "🟡", // Medium (yellow for caution)
        "3": "🔵", // Low (blue for calm)
        "N": ""    // None
      };
      const priority = prioritySymbols[task.priority] || "";
      
      // Format due date
      const dueFormatted = task.due ? formatDueDate(task.due) : "";
      const dueText = dueFormatted ? ` (due: ${dueFormatted})` : "";
      
      // Check if overdue
      if (task.due && new Date(task.due) < new Date()) {
        overdueTasks++;
      }
      
      // Format tags
      let tags = "";
      if (series.tags) {
        const tagArray = Array.isArray(series.tags.tag) ? series.tags.tag : [series.tags.tag];
        if (tagArray.length > 0 && tagArray[0]) { // Check for non-empty tags
          tags = ` #${tagArray.join(" #")}`;
        }
      }

      output += `- ${priority} ${series.name}${dueText}${tags}\n`;
      output += `  IDs: list=${list.id}, series=${series.id}, task=${task.id}\n`;
      
      // Include task notes if present
      if (series.notes && series.notes.note) {
        const notes = Array.isArray(series.notes.note) ? series.notes.note : [series.notes.note];
        for (const note of notes) {
          if (note.$t) {
            output += `  📝 ${note.$t}\n`;
          }
        }
      }
    }
  }

  // Add summary at the top
  if (totalTasks > 0) {
    let summary = `📊 Summary: ${totalTasks} active task${totalTasks !== 1 ? 's' : ''}`;
    if (overdueTasks > 0) {
      summary += ` (⚠️ ${overdueTasks} overdue)`;
    }
    output = summary + "\n" + output;
  }

  return output || "No tasks found.";
}

/**
 * Generates a new session ID
 */
export function generateSessionId(): string {
  return crypto.randomUUID();
}