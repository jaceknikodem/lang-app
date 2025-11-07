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
