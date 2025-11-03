/**
 * Helper utilities for creating IPC handlers with validation and error handling
 */

import { z } from 'zod';
import { IpcMainInvokeEvent } from 'electron';

type HandlerFunction<TInput extends any[], TOutput> = (...args: TInput) => Promise<TOutput> | TOutput;

/**
 * Creates an IPC handler with automatic validation and error handling
 * @param schema Zod schema(s) for validation. Can be:
 *   - undefined/null for no validation
 *   - A single schema for single parameter
 *   - An array of schemas for multiple parameters (positional matching)
 * @param handler Function to execute after validation
 * @param errorContext Optional context string for error messages (e.g., "insert word", "update sentence")
 * @returns IPC handler function
 */
export function createIPCHandler<
  TInput extends any[],
  TOutput
>(
  schema: z.ZodTypeAny | z.ZodTypeAny[] | undefined | null,
  handler: HandlerFunction<TInput, TOutput>,
  errorContext?: string
): (event: IpcMainInvokeEvent, ...args: any[]) => Promise<TOutput> {
  return async (event: IpcMainInvokeEvent, ...args: any[]): Promise<TOutput> => {
    try {
      let validatedArgs: any[];

      // No validation
      if (schema === undefined || schema === null) {
        validatedArgs = args;
      }
      // Handle single schema
      else if (!Array.isArray(schema)) {
        if (args.length === 0) {
          // No parameters - call handler without validation
          validatedArgs = [];
        } else {
          // Single parameter - validate with schema
          validatedArgs = [schema.parse(args[0])];
        }
      } 
      // Handle array of schemas
      else {
        if (schema.length === 0) {
          // No schemas - no validation
          validatedArgs = args;
        } else {
          // Validate each parameter with corresponding schema, or use original if no schema
          validatedArgs = args.map((arg, index) => {
            if (index < schema.length && schema[index] !== undefined && schema[index] !== null) {
              return schema[index].parse(arg);
            }
            return arg;
          });
        }
      }

      // Execute handler with validated arguments
      return await handler(...(validatedArgs as TInput));
    } catch (error) {
      const errorMessage = errorContext || 'operation';
      console.error(`Error ${errorMessage}:`, error);
      
      const errorDetail = error instanceof Error ? error.message : 'Unknown error';
      
      // For Zod validation errors, provide more detail
      if (error instanceof z.ZodError) {
        const issues = error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
        throw new Error(`Failed to ${errorMessage}: Validation failed - ${issues}`);
      }
      
      throw new Error(`Failed to ${errorMessage}: ${errorDetail}`);
    }
  };
}

