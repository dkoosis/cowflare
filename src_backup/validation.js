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
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = 'RTMAPIError';
    }
}
/**
 * Represents a validation error for incoming tool arguments.
 * @param {string} message - The validation error message.
 * @param {string} [field] - The optional field that failed validation.
 */
export class ValidationError extends Error {
    field;
    constructor(message, field) {
        super(message);
        this.field = field;
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
