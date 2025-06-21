/**
 * @file tools/index.ts
 * @description Clean tool registration using MCP SDK
 */

import { McpServer } from '@modelcontextprotocol/sdk/server';
import { Env } from '../types';
import { MetricsCollector } from '../monitoring/metrics';
import { Logger } from '../utils/logger';
import { AuthenticationTools } from './authentication';
import { TaskTools } from './tasks';
import { ListTools } from './lists';
import { UtilityTools } from './utilities';

/**
 * Registers all RTM tools with the MCP server
 */
export function registerTools(
  server: McpServer,
  env: Env,
  metrics: MetricsCollector,
  logger: Logger
): void {
  // Initialize tool handlers
  const authTools = new AuthenticationTools(env, metrics, logger);
  const taskTools = new TaskTools(env, metrics, logger);
  const listTools = new ListTools(env, metrics, logger);
  const utilityTools = new UtilityTools(env, metrics, logger);

  // Register authentication tools
  authTools.register(server);
  
  // Register task management tools
  taskTools.register(server);
  
  // Register list management tools
  listTools.register(server);
  
  // Register utility tools
  utilityTools.register(server);
  
  logger.info('All tools registered successfully', {
    toolCategories: ['authentication', 'tasks', 'lists', 'utilities']
  });
}