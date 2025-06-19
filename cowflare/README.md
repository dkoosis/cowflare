# RTM MCP Server Improvement Task

## Context

You're working on a Cloudflare Workers-based MCP server for the Remember The Milk (RTM) API. The current implementation is functional but needs improvements for production readiness. This document outlines the required improvements and suggests new features to enhance the server's capabilities.

## Required Improvements

### 1. Fix Rate Limiting

* **Prompt:** Update the rate-limiting logic in `src/auth.ts`. The current implementation only uses `CF-Connecting-IP` for client identification. Modify it to use the following fallback chain: `request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0] || 'anonymous'`.

### 2. Add Robust Input Validation

* **Prompt:** Implement comprehensive input validation for all tool calls in `src/index.ts` to ensure data integrity before making API calls to RTM. Use the `zod` library for schema validation. Define a `zod` schema for each tool's arguments and validate the incoming `args` object within each `case` block in the `handleToolCall` function.

### 3. Implement Proper Error Types

* **Prompt:** Refactor the error handling in `src/index.ts`. Replace the generic `Error` class with specific, typed errors for different failure scenarios. Create and use the following custom error classes: `RTMAPIError`, `ValidationError`, and `RateLimitError`.

### 4. Replace `any` Types with Specific Interfaces

* **Prompt:** Eliminate all uses of the `any` type in the project. Analyze the RTM API documentation and the existing `handleToolCall` function in `src/index.ts` to create specific TypeScript interfaces for all RTM API responses and tool arguments. For example, create an `RTMAuthResponse` interface for the authentication response.

### 5. Implement Full OAuth Callback Flow

* **Prompt:** Implement a proper OAuth callback flow as described in the RTM API documentation for web-based applications. In the `rtm_authenticate` tool in `src/index.ts`, use the `SERVER_URL` environment variable to construct a `callbackUrl`. This `callbackUrl` should be for an endpoint on the worker that handles the `frob` from the RTM redirect and exchanges it for a permanent `auth_token` by calling `rtm.auth.getToken`.

### 6. Fix and Expand Tests

* **Prompt:** Update the test suite in `test/index.spec.ts`.
    * Change the expected response in the existing tests from "Hello World!" to "RTM MCP Server v1.1.0" to match the current `fetch` handler in `src/index.ts`.
    * Add a new test case to verify that the `initialize` method returns the correct server information and capabilities.
    * Add new tests for at least three RTM tools (e.g., `rtm_get_lists`, `rtm_add_task`, `rtm_complete_task`) to ensure they handle valid inputs and errors correctly.

### 7. Add Request Logging

* **Prompt:** Implement basic request logging in `src/index.ts` for debugging purposes. Before a tool is executed, log the method name and parameters to the console. The log entry should be in the format: `[${new Date().toISOString()}] ${method} ${JSON.stringify(params)}`.

## Suggested New Features

### High-Value Resources

* **Prompt: Implement a `rtm/user-profile` resource.** This resource should call `rtm.settings.getList` to provide the LLM with the user's settings, including timezone, date format, and language. This will allow for more personalized and context-aware interactions.
* **Prompt: Implement an `rtm/lists-summary` resource.** This resource should call `rtm.lists.getList` to give the LLM a quick overview of all the user's lists. This is essential for any operations involving moving or adding tasks to a specific list.
* **Prompt: Implement an `rtm/tags-summary` resource.** This resource should call `rtm.tags.getList` to provide a list of all tags the user has created. This will help the LLM suggest relevant tags when creating tasks.

### High-Value Prompts

* **Prompt: Implement a `daily_briefing` prompt.** This prompt should trigger a call to the `rtm_get_tasks` tool with a filter for tasks due today and any overdue tasks. The LLM should then format the response for the user, summarizing their tasks for the day.
* **Prompt: Implement a `plan_my_day` interactive prompt.** This prompt should help a user schedule their day by first calling `rtm_get_tasks` to find unscheduled tasks. It should then interactively loop through them, asking the user for due dates and priorities, and calling the `rtm_set_due_date` and `rtm_set_priority` tools accordingly.
* **Prompt: Implement a `find_and_update_task` prompt.** This guided prompt should first ask the user for keywords to find a task, then use `rtm_get_tasks` with a filter. Once the task is found, the prompt should present a menu of possible updates (e.g., "change due date," "add tags," "mark complete") and call the appropriate tool based on user selection.