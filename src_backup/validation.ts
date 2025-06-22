/**
 * @file validation.ts
 * @description Custom error classes for RTM MCP Server
 * Schema definitions have been moved to src/schemas/
 */

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

// RTM API Response interfaces remain here as they're not schemas but type definitions
export interface RTMAuthResponse {
  token: string;
  user: {
    id: string;
    username: string;
    fullname: string;
  };
}

export interface RTMTimelineResponse {
  timeline: string;
}

export interface RTMList {
  id: string;
  name: string;
  deleted: string;
  locked: string;
  archived: string;
  position: string;
  smart: string;
  sort_order?: string;
  filter?: string;
}

export interface RTMTask {
  id: string;
  due?: string;
  has_due_time: string;
  added: string;
  completed?: string;
  deleted?: string;
  priority: string;
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
  task: RTMTask[];
}