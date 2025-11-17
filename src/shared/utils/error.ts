/**
 * Centralized error handling utilities
 *
 * Provides standardized error handling patterns using Node.js built-in error.cause
 * (Node 16.9.0+) and the make-error-cause package for better error chaining.
 */

import { BaseError } from 'make-error-cause';
import { AudioError } from '../types/audio.js';
import { LLMError } from '../types/llm.js';

/**
 * SpeechRecognitionError interface (defined in speech-recognition.ts)
 */
export interface SpeechRecognitionError extends Error {
  code:
    | 'MODEL_NOT_FOUND'
    | 'TRANSCRIPTION_FAILED'
    | 'FILE_NOT_FOUND'
    | 'INVALID_AUDIO_FORMAT'
    | 'WHISPER_NOT_AVAILABLE';
  filePath?: string;
}

/**
 * Converts any value to an Error instance.
 * Replaces patterns like: `error instanceof Error ? error : new Error(String(error))`
 *
 * @param value - Any value that might be an error
 * @returns An Error instance
 */
export function ensureError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  if (value === null || value === undefined) {
    return new Error('Unknown error occurred');
  }

  if (typeof value === 'string') {
    return new Error(value);
  }

  // If it's an object with a message property, try to extract it
  if (typeof value === 'object' && value !== null && 'message' in value) {
    const message = String((value as any).message);
    if (message && message !== '[object Object]') {
      return new Error(message);
    }
  }

  try {
    return new Error(String(value));
  } catch {
    return new Error('Unknown error occurred');
  }
}

/**
 * Safely extracts error message from any value.
 * Replaces patterns like: `error instanceof Error ? error.message : 'Unknown error'`
 *
 * @param value - Any value that might be an error
 * @param defaultMessage - Default message if value is not an error (default: 'Unknown error')
 * @returns Error message string
 */
export function getErrorMessage(value: unknown, defaultMessage: string = 'Unknown error'): string {
  if (value instanceof Error) {
    return value.message || defaultMessage;
  }

  if (value === null || value === undefined) {
    return defaultMessage;
  }

  if (typeof value === 'string') {
    return value || defaultMessage;
  }

  try {
    const str = String(value);
    return str || defaultMessage;
  } catch {
    return defaultMessage;
  }
}

/**
 * Wraps an error with context using error.cause for chaining.
 * Replaces manual error wrapping patterns.
 *
 * @param error - The original error to wrap
 * @param message - Context message for the new error
 * @param options - Optional error options including cause
 * @returns A new Error with the original error as cause
 */
export function wrapError(error: unknown, message: string, options?: { cause?: unknown }): Error {
  const originalError = ensureError(error);
  // @ts-expect-error - Error constructor with cause is supported in Node.js 16.9.0+ but TypeScript types may not include it
  return new Error(message, { cause: originalError, ...options });
}

/**
 * Safely extracts error cause chain.
 *
 * @param error - Error to extract cause from
 * @returns The cause error if available, undefined otherwise
 */
export function getErrorCause(error: unknown): Error | undefined {
  if (error instanceof Error && 'cause' in error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error) {
      return cause;
    }
    if (cause !== undefined && cause !== null) {
      return ensureError(cause);
    }
  }
  return undefined;
}

/**
 * Gets the full error chain as an array of errors.
 *
 * @param error - Error to extract chain from
 * @returns Array of errors in the chain (most recent first)
 */
export function getErrorChain(error: unknown): Error[] {
  const chain: Error[] = [];
  let current: Error | undefined = ensureError(error);

  while (current) {
    chain.push(current);
    current = getErrorCause(current);
  }

  return chain;
}

/**
 * Base class for custom errors with cause support.
 * Extends make-error-cause BaseError for consistent error chaining.
 */
export class AppError extends BaseError {
  constructor(message: string, cause?: unknown) {
    super(message, cause as Error | undefined);
  }
}

/**
 * Creates an AudioError with cause chaining support.
 *
 * @param message - Error message
 * @param code - Audio error code
 * @param options - Optional audio path and cause
 * @returns AudioError instance
 */
export function createAudioError(
  message: string,
  code: AudioError['code'],
  options?: { audioPath?: string; cause?: unknown }
): AudioError {
  // @ts-expect-error - Error constructor with cause is supported in Node.js 16.9.0+ but TypeScript types may not include it
  const error = new Error(message, { cause: options?.cause }) as AudioError;
  error.code = code;
  if (options?.audioPath) {
    error.audioPath = options.audioPath;
  }
  return error;
}

/**
 * Creates an LLMError with cause chaining support.
 *
 * @param message - Error message
 * @param code - LLM error code
 * @param retryable - Whether the error is retryable
 * @param cause - Optional cause error
 * @returns LLMError instance
 */
export function createLLMError(
  message: string,
  code: LLMError['code'] = 'MODEL_ERROR',
  retryable: boolean = true,
  cause?: unknown
): LLMError {
  // @ts-expect-error - Error constructor with cause is supported in Node.js 16.9.0+ but TypeScript types may not include it
  const error = new Error(message, { cause }) as LLMError;
  error.code = code;
  error.retryable = retryable;
  return error;
}

/**
 * Creates a SpeechRecognitionError with cause chaining support.
 *
 * @param message - Error message
 * @param code - Speech recognition error code
 * @param options - Optional file path and cause
 * @returns SpeechRecognitionError instance
 */
export function createSpeechRecognitionError(
  message: string,
  code: SpeechRecognitionError['code'],
  options?: { filePath?: string; cause?: unknown }
): SpeechRecognitionError {
  // @ts-expect-error - Error constructor with cause is supported in Node.js 16.9.0+ but TypeScript types may not include it
  const error = new Error(message, { cause: options?.cause }) as SpeechRecognitionError;
  error.code = code;
  if (options?.filePath) {
    error.filePath = options.filePath;
  }
  return error;
}

/**
 * Serializes an error for logging purposes.
 * Extracts all relevant error information including custom properties.
 *
 * @param error - Error to serialize
 * @returns Serializable error object
 */
export function serializeErrorForLogging(error: unknown): Record<string, any> {
  // Handle null/undefined
  if (error === null || error === undefined) {
    return {
      message: 'Error was null or undefined',
      type: error === null ? 'null' : 'undefined',
    };
  }

  // Handle Error instances
  if (error instanceof Error) {
    const serialized: Record<string, any> = {
      message: error.message || '(no message)',
      name: error.name || 'Error',
    };

    // Add stack trace if available
    if (error.stack) {
      serialized.stack = error.stack;
    }

    // Add custom properties for LLMError
    if ('code' in error) {
      serialized.code = (error as any).code;
    }
    if ('retryable' in error) {
      serialized.retryable = (error as any).retryable;
    }
    if ('audioPath' in error) {
      serialized.audioPath = (error as any).audioPath;
    }
    if ('filePath' in error) {
      serialized.filePath = (error as any).filePath;
    }

    // Add cause if present
    if ('cause' in error && error.cause) {
      serialized.cause = serializeErrorForLogging(error.cause);
    }

    // Try to get all enumerable properties from the error object
    // This catches any other custom properties that might be set
    try {
      const errorObj = error as any;
      for (const key in errorObj) {
        if (key !== 'message' && key !== 'name' && key !== 'stack' && key !== 'cause') {
          try {
            const value = errorObj[key];
            // Only include serializable values
            if (
              value !== undefined &&
              (typeof value === 'string' ||
                typeof value === 'number' ||
                typeof value === 'boolean' ||
                value === null)
            ) {
              serialized[key] = value;
            }
          } catch {
            // Skip properties that can't be accessed
          }
        }
      }
    } catch {
      // Ignore errors when trying to enumerate properties
    }

    return serialized;
  }

  // Handle objects that might be error-like
  if (typeof error === 'object') {
    try {
      const obj = error as Record<string, any>;
      const serialized: Record<string, any> = {
        type: 'object',
      };

      // Try to extract common error properties
      if ('message' in obj) {
        serialized.message = String(obj.message);
      }
      if ('name' in obj) {
        serialized.name = String(obj.name);
      }
      if ('code' in obj) {
        serialized.code = obj.code;
      }
      if ('stack' in obj) {
        serialized.stack = String(obj.stack);
      }

      // If we got at least a message, return it
      if (serialized.message) {
        return serialized;
      }

      // Otherwise, try to stringify the whole object
      try {
        serialized.raw = JSON.stringify(obj);
      } catch {
        serialized.raw = String(obj);
      }

      return serialized;
    } catch {
      // Fall through to string conversion
    }
  }

  // For other types, try to convert to string
  try {
    return {
      message: String(error),
      type: typeof error,
    };
  } catch {
    return {
      message: 'Unknown error (could not serialize)',
      type: 'unknown',
    };
  }
}
