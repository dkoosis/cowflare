// src/rtm-api.ts - RTM API types and request handler

import { RTMAPIError } from './validation.js';

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
 * Formats tasks for display
 */
export function formatTasks(tasks: RTMGetTasksResponse['tasks']): string {
  if (!tasks.list || tasks.list.length === 0) {
    return "No tasks found.";
  }

  let output = "";
  for (const list of tasks.list) {
    if (!list.taskseries || list.taskseries.length === 0) continue;

    output += `\n### ${list.id === "0" ? "Inbox" : `List ${list.id}`}\n\n`;

    for (const series of list.taskseries) {
      const taskArray = Array.isArray(series.task) ? series.task : [series.task];
      const task = taskArray[0];
      
      const priority = task.priority === "N" ? "" : `!${task.priority} `;
      const due = task.due ? ` (due: ${task.due})` : "";
      
      let tags = "";
      if (series.tags) {
        const tagArray = Array.isArray(series.tags.tag) ? series.tags.tag : [series.tags.tag];
        tags = ` #${tagArray.join(" #")}`;
      }

      output += `- ${priority}${series.name}${due}${tags}\n`;
      output += `  IDs: list=${list.id}, series=${series.id}, task=${task.id}\n`;
    }
  }

  return output || "No tasks found.";
}

/**
 * Generates a new session ID
 */
export function generateSessionId(): string {
  return crypto.randomUUID();
}