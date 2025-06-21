/**
 * @file tools/tool-base.ts
 * @description Base class for all tool implementations
 */

import { CallToolResult } from '@modelcontextprotocol/sdk/types';
import { Env } from '../types';
import { MetricsCollector } from '../monitoring/metrics';
import { Logger } from '../utils/logger';

export abstract class ToolBase {
  constructor(
    protected env: Env,
    protected metrics: MetricsCollector,
    protected logger: Logger
  ) {}

  /**
   * Wraps a tool handler with metrics and error handling
   */
  protected wrapHandler(
    handler: (args: any) => Promise<CallToolResult>
  ): (args: any) => Promise<CallToolResult> {
    return async (args: any) => {
      const startTime = Date.now();
      const toolName = this.constructor.name;

      try {
        this.logger.debug(`Tool ${toolName} invoked`, { args });
        
        const result = await handler(args);
        
        const duration = Date.now() - startTime;
        await this.metrics.recordToolCall(toolName, duration, true);
        
        return result;
      } catch (error: any) {
        const duration = Date.now() - startTime;
        
        this.logger.error(`Tool ${toolName} failed`, {
          error: error.message,
          stack: error.stack,
          args
        });
        
        await this.metrics.recordToolCall(toolName, duration, false, error.message);
        
        // Return error as CallToolResult
        return {
          content: [{
            type: "text",
            text: `❌ Error: ${error.message}`
          }],
          isError: true
        };
      }
    };
  }

  /**
   * Creates a success result
   */
  protected success(text: string): CallToolResult {
    return {
      content: [{
        type: "text",
        text
      }]
    };
  }

  /**
   * Creates an error result
   */
  protected error(text: string): CallToolResult {
    return {
      content: [{
        type: "text",
        text: `❌ ${text}`
      }],
      isError: true
    };
  }

  /**
   * Creates a result with multiple content items
   */
  protected multiContent(items: Array<{ type: string; text?: string; data?: any }>): CallToolResult {
    return {
      content: items.map(item => {
        if (item.type === "text") {
          return { type: "text", text: item.text || "" };
        }
        // Add support for other content types as needed
        return { type: item.type, ...item };
      })
    };
  }
}