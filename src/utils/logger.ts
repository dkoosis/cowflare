/**
 * @file utils/logger.ts
 * @description Structured logger for Cloudflare Workers
 */

import { Env, LogEntry } from '../types';

export class Logger {
  private level: string;

  constructor(private env: Env) {
    this.level = env.LOG_LEVEL || 'info';
  }

  private shouldLog(level: string): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(this.level);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, metadata?: any): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      metadata
    };

    // In production, you might send this to an external service
    // For now, we'll use console with structured output
    console.log(JSON.stringify(entry));
  }

  debug(message: string, metadata?: any): void {
    this.log('debug', message, metadata);
  }

  info(message: string, metadata?: any): void {
    this.log('info', message, metadata);
  }

  warn(message: string, metadata?: any): void {
    this.log('warn', message, metadata);
  }

  error(message: string, metadata?: any): void {
    this.log('error', message, metadata);
  }

  /**
   * Creates a child logger with additional context
   */
  child(context: Record<string, any>): Logger {
    const childLogger = new Logger(this.env);
    const originalLog = childLogger.log.bind(childLogger);
    
    childLogger.log = (level, message, metadata) => {
      originalLog(level, message, { ...context, ...metadata });
    };
    
    return childLogger;
  }
}