/**
 * @file schemas/index.ts
 * @description Unified schema definitions using Zod as single source of truth
 * Generates both runtime validation and JSON Schema for MCP from one definition
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Re-export all domain schemas
export * from './auth-schemas';
export * from './task-schemas';
export * from './list-schemas';
export * from './utility-schemas';

/**
 * Converts a Zod schema to MCP-compatible JSON Schema
 * Removes Zod-specific properties and ensures correct format
 */
export function toInputSchema(zodSchema: z.ZodType<any, any>) {
  const jsonSchema = zodToJsonSchema(zodSchema, {
    target: 'openApi3',
    $refStrategy: 'none',
  });
  
  // Remove Zod-specific properties that MCP doesn't need
  const { $schema, additionalProperties, ...cleanSchema } = jsonSchema as any;
  
  return {
    ...cleanSchema,
    additionalProperties: false
  };
}