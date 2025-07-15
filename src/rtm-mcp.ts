// File: src/rtm-mcp.ts
import { McpAgent, McpServer } from 'agents/mcp';
import { z } from 'zod';
import { RtmApi } from './rtm-api';
import type { Env, RTMList } from './types';
import * as schemas from './schemas/task-schemas';

/**
 * Remember The Milk MCP Server
 * Implements MCP tools for task management via RTM API
 */
export class RtmMCP extends McpAgent<Env, {}, { rtmToken?: string; userName?: string; userId?: string }> {
  private rtmToken?: string;
  private userName?: string;
  private userId?: string;
  private sessionInitialized = false; // Renamed to avoid base class property conflict

  server = new McpServer({
    name: 'rtm',
    version: '1.0.0',
  });

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    console.log('[RtmMCP] Constructor called');
    this.init(); // Ensure tools are registered on startup
  }

  /**
   * REFACTORED FETCH METHOD
   *
   * This method now correctly implements the two-phase MCP handshake.
   * 1. On the first POST, it treats it as the 'initialize' handshake and
   * passes it to the parent handler without an auth check.
   * 2. On all subsequent requests, it requires an auth token.
   */
  async fetch(request: Request): Promise<Response> {
    console.log('[RtmMCP] fetch called', {
      url: request.url,
      method: request.method,
      isInitialized: this.sessionInitialized
    });

    // If the session is not yet initialized, this MUST be the handshake.
    if (!this.sessionInitialized) {
      console.log('[RtmMCP] Connection is not initialized. Assuming this is the handshake.');
      this.sessionInitialized = true; // Mark as initialized
      return super.fetch(request);
    }

    // --- All subsequent requests require authentication ---

    const token = request.headers.get('X-RTM-Token');
    if (!token) {
      console.error('[RtmMCP] Error: Missing X-RTM-Token header on authenticated request.');
      // Manually construct the error response as the jsonrpc helper is not available here.
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32000,
          message: 'Authentication failed: Missing token.'
        }
      }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    // Store auth details for the lifetime of this request/tool call.
    this.rtmToken = token;
    this.userId = request.headers.get('X-RTM-UserId') || undefined;
    this.userName = request.headers.get('X-RTM-UserName') || undefined;
    this.props.rtmToken = this.rtmToken;
    this.props.userId = this.userId;
    this.props.userName = this.userName;

    console.log(`[RtmMCP] Authenticated request for user ${this.userId}`);

    // Now that auth is established, let the parent handle the request.
    return super.fetch(request);
  }

  /**
   * Initialize the MCP server and register tools.
   */
  async init() {
    console.log('[RtmMCP] Init called');
    this.initializeTools();
    console.log('[RtmMCP] Init complete, tools registered');
  }

  /**
   * Register all RTM tools with the MCP server
   */
  private initializeTools() {
    console.log('[RtmMCP] Registering RTM tools');

    // Tool: Start RTM authentication process
    this.server.tool('rtm_authenticate', 'Start RTM authentication process', {}, async () => {
      console.log('[RtmMCP] Tool called: rtm_authenticate');
      const api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);
      const frob = await api.getFrob();
      const authUrl = await api.getAuthUrl(frob, 'delete');
      return { content: [{ type: 'text', text: `To authenticate with Remember The Milk:\n\n1. Open this URL in a new tab: ${authUrl}\n2. Authorize the application\n3. Return here and use the rtm_complete_auth tool with frob: ${frob}` }] };
    });

    // Tool: Complete RTM authentication
    this.server.tool('rtm_complete_auth', 'Complete RTM authentication after authorizing in browser', { frob: z.string().describe('The frob token from rtm_authenticate') }, async (args: { frob: string }) => {
      console.log('[RtmMCP] Tool called: rtm_complete_auth');
      const api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);
      const tokenResponse = await api.getToken(args.frob);
      return { content: [{ type: 'text', text: `Authentication successful! Your token is: ${tokenResponse.token}. Please use this token in the 'X-RTM-Token' header for all future requests.` }] };
    });

    // Tool: Check current authentication status
    this.server.tool('rtm_check_auth_status', 'Check current RTM authentication status', {}, async () => {
      console.log('[RtmMCP] Tool called: rtm_check_auth_status');
      if (this.rtmToken && this.userName) {
        return { content: [{ type: 'text', text: `Authenticated as: ${this.userName} (ID: ${this.userId})` }] };
      }
      return { content: [{ type: 'text', text: 'Not authenticated. Use rtm_authenticate and rtm_complete_auth tools.' }] };
    });

    // Tool: Create a new timeline
    this.server.tool('timeline/create', 'Create a new timeline for undoable operations', {}, async () => {
      console.log('[RtmMCP] Tool called: timeline/create');
      if (!this.rtmToken) return { content: [{ type: 'text', text: 'Error: Not authenticated.' }] };
      const api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);
      const timeline = await api.createTimeline(this.rtmToken);
      return { content: [{ type: 'text', text: `Timeline created: ${timeline}` }] };
    });

    // Tool: Get tasks
    this.server.tool('tasks/get', 'Get tasks from a specific list or all lists', schemas.GetTasksSchema.shape, async (args: z.infer<typeof schemas.GetTasksSchema>) => {
      console.log('[RtmMCP] Tool called: tasks/get');
      if (!this.rtmToken) return { content: [{ type: 'text', text: 'Error: Not authenticated.' }] };
      const api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);
      const tasksResponse = await api.getTasks(this.rtmToken, args.list_id, args.filter);
      const taskLists = tasksResponse.lists.list;
      const taskCount = taskLists ? (Array.isArray(taskLists) ? taskLists : [taskLists]).reduce((count: number, list: RTMList) => count + (list.taskseries ? (Array.isArray(list.taskseries) ? list.taskseries.length : 1) : 0), 0) : 0;
      return { content: [{ type: 'text', text: `Found ${taskCount} tasks.` }] };
    });

    // Tool: Add a task
    this.server.tool('task/add', 'Add a new task to Remember The Milk', schemas.AddTaskSchema.shape, async (args: z.infer<typeof schemas.AddTaskSchema>) => {
      console.log('[RtmMCP] Tool called: task/add');
      if (!this.rtmToken || !args.timeline) return { content: [{ type: 'text', text: 'Error: Authentication token and timeline are required.' }] };
      const api = new RtmApi(this.env.RTM_API_KEY, this.env.RTM_SHARED_SECRET);
      await api.addTask(this.rtmToken, args.timeline, args.name, args.list_id);
      return { content: [{ type: 'text', text: `Task added successfully: "${args.name}"` }] };
    });

    // Tool: Complete a task
    this.server.tool('task/complete', 'Mark a task as completed', schemas.CompleteTaskSchema.shape, async (args: z.infer<typeof schemas.CompleteTaskSchema>) => {
      console.log('[RtmMCP] Tool called: task/complete');
      if (!this.rtmToken || !args.timeline) return { content: [{ type: 'text', text: 'Error: Authentication and timeline are required.' }] };
      return { content: [{ type: 'text', text: `Complete task functionality is not yet implemented for task: ${args.task_id}` }] };
    });

    console.log('[RtmMCP] All tools registered');
  }
}