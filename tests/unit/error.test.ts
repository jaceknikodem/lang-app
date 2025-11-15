/**
 * Unit tests for error utility functions
 */

import {
  ensureError,
  getErrorMessage,
  wrapError,
  getErrorCause,
  getErrorChain,
  createAudioError,
  createLLMError,
  createSpeechRecognitionError,
} from '../../src/shared/utils/error.js';
import { AudioError } from '../../src/shared/types/audio.js';
import { LLMError } from '../../src/shared/types/llm.js';

describe('ensureError', () => {
  it('should return Error instance as-is', () => {
    const error = new Error('Test error');
    const result = ensureError(error);
    expect(result).toBe(error);
    expect(result).toBeInstanceOf(Error);
  });

  it('should convert string to Error', () => {
    const result = ensureError('String error');
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('String error');
  });

  it('should handle null', () => {
    const result = ensureError(null);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('Unknown error occurred');
  });

  it('should handle undefined', () => {
    const result = ensureError(undefined);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('Unknown error occurred');
  });

  it('should extract message from object with message property', () => {
    const obj = { message: 'Object error message' };
    const result = ensureError(obj);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('Object error message');
  });

  it('should handle object with message that is [object Object]', () => {
    const obj = { message: '[object Object]' };
    const result = ensureError(obj);
    expect(result).toBeInstanceOf(Error);
    // Should fall through to String() conversion
    expect(result.message).toContain('object');
  });

  it('should convert object without message to Error', () => {
    const obj = { code: 404, status: 'not found' };
    const result = ensureError(obj);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toContain('object');
  });

  it('should handle number', () => {
    const result = ensureError(42);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('42');
  });

  it('should handle boolean', () => {
    const result = ensureError(true);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('true');
  });

  it('should handle empty string message', () => {
    const obj = { message: '' };
    const result = ensureError(obj);
    expect(result).toBeInstanceOf(Error);
    // Should fall through to String() conversion
    expect(result.message).toContain('object');
  });
});

describe('getErrorMessage', () => {
  it('should extract message from Error instance', () => {
    const error = new Error('Test error');
    expect(getErrorMessage(error)).toBe('Test error');
  });

  it('should return default message for Error without message', () => {
    const error = new Error();
    expect(getErrorMessage(error, 'Default message')).toBe('Default message');
  });

  it('should return default message for null', () => {
    expect(getErrorMessage(null, 'Default message')).toBe('Default message');
  });

  it('should return default message for undefined', () => {
    expect(getErrorMessage(undefined, 'Default message')).toBe('Default message');
  });

  it('should return string as-is', () => {
    expect(getErrorMessage('String error', 'Default')).toBe('String error');
  });

  it('should return default for empty string', () => {
    expect(getErrorMessage('', 'Default')).toBe('Default');
  });

  it('should convert number to string', () => {
    expect(getErrorMessage(42, 'Default')).toBe('42');
  });

  it('should convert object to string', () => {
    const obj = { code: 404 };
    const result = getErrorMessage(obj, 'Default');
    expect(result).toContain('object');
  });

  it('should use default message when conversion fails', () => {
    // Create an object that throws when converted to string
    const obj = {
      toString: () => {
        throw new Error('Conversion failed');
      },
    };
    expect(getErrorMessage(obj, 'Default')).toBe('Default');
  });

  it('should use default message when no default provided', () => {
    expect(getErrorMessage(null)).toBe('Unknown error');
  });
});

describe('wrapError', () => {
  it('should wrap Error with new message and cause', () => {
    const originalError = new Error('Original error');
    const wrapped = wrapError(originalError, 'Wrapped error');

    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toBe('Wrapped error');
    expect((wrapped as any).cause).toBe(originalError);
  });

  it('should wrap string error', () => {
    const wrapped = wrapError('String error', 'Wrapped error');

    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toBe('Wrapped error');
    expect((wrapped as any).cause).toBeInstanceOf(Error);
    expect((wrapped as any).cause.message).toBe('String error');
  });

  it('should wrap with optional cause', () => {
    const originalError = new Error('Original');
    const additionalCause = 'Additional context';
    const wrapped = wrapError(originalError, 'Wrapped', { cause: additionalCause });

    expect(wrapped.message).toBe('Wrapped');
    // The options.cause overrides the originalError cause due to spread operator
    expect((wrapped as any).cause).toBe(additionalCause);
  });

  it('should handle null error', () => {
    const wrapped = wrapError(null, 'Wrapped error');

    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toBe('Wrapped error');
    expect((wrapped as any).cause).toBeInstanceOf(Error);
    expect((wrapped as any).cause.message).toBe('Unknown error occurred');
  });
});

describe('getErrorCause', () => {
  it('should extract cause from error with cause property', () => {
    const cause = new Error('Cause error');
    const error = new Error('Main error') as Error & { cause?: Error };
    error.cause = cause;

    const result = getErrorCause(error);
    expect(result).toBe(cause);
  });

  it('should return undefined for error without cause', () => {
    const error = new Error('No cause');
    expect(getErrorCause(error)).toBeUndefined();
  });

  it('should convert non-Error cause to Error', () => {
    const error = new Error('Main error') as Error & { cause?: unknown };
    error.cause = 'String cause';

    const result = getErrorCause(error);
    expect(result).toBeInstanceOf(Error);
    expect(result?.message).toBe('String cause');
  });

  it('should return undefined for null cause', () => {
    const error = new Error('Main error') as Error & { cause?: unknown };
    error.cause = null;

    expect(getErrorCause(error)).toBeUndefined();
  });

  it('should return undefined for undefined cause', () => {
    const error = new Error('Main error') as Error & { cause?: unknown };
    error.cause = undefined;

    expect(getErrorCause(error)).toBeUndefined();
  });

  it('should handle non-Error value', () => {
    expect(getErrorCause('not an error')).toBeUndefined();
  });
});

describe('getErrorChain', () => {
  it('should return single error in chain', () => {
    const error = new Error('Single error');
    const chain = getErrorChain(error);

    expect(chain).toHaveLength(1);
    expect(chain[0]).toBe(error);
  });

  it('should extract full error chain', () => {
    const cause3 = new Error('Cause 3');
    const cause2 = new Error('Cause 2') as Error & { cause?: Error };
    cause2.cause = cause3;
    const cause1 = new Error('Cause 1') as Error & { cause?: Error };
    cause1.cause = cause2;
    const main = new Error('Main error') as Error & { cause?: Error };
    main.cause = cause1;

    const chain = getErrorChain(main);

    expect(chain).toHaveLength(4);
    expect(chain[0]).toBe(main);
    expect(chain[1]).toBe(cause1);
    expect(chain[2]).toBe(cause2);
    expect(chain[3]).toBe(cause3);
  });

  it('should convert non-Error to Error in chain', () => {
    const main = new Error('Main error') as Error & { cause?: unknown };
    main.cause = 'String cause';

    const chain = getErrorChain(main);

    expect(chain).toHaveLength(2);
    expect(chain[0]).toBe(main);
    expect(chain[1]).toBeInstanceOf(Error);
    expect(chain[1].message).toBe('String cause');
  });

  it('should handle string input', () => {
    const chain = getErrorChain('String error');

    expect(chain).toHaveLength(1);
    expect(chain[0]).toBeInstanceOf(Error);
    expect(chain[0].message).toBe('String error');
  });
});

describe('createAudioError', () => {
  it('should create AudioError with code', () => {
    const error = createAudioError('Test error', 'FILE_NOT_FOUND');

    expect(error).toBeInstanceOf(Error);
    expect((error as AudioError).code).toBe('FILE_NOT_FOUND');
    expect(error.message).toBe('Test error');
  });

  it('should create AudioError with audioPath', () => {
    const error = createAudioError('Test error', 'FILE_NOT_FOUND', {
      audioPath: '/path/to/audio.wav',
    });

    expect((error as AudioError).audioPath).toBe('/path/to/audio.wav');
  });

  it('should create AudioError with cause', () => {
    const cause = new Error('Original error');
    const error = createAudioError('Test error', 'GENERATION_FAILED', { cause });

    expect((error as any).cause).toBe(cause);
  });

  it('should create AudioError with all options', () => {
    const cause = new Error('Original');
    const error = createAudioError('Test error', 'PLAYBACK_FAILED', {
      audioPath: '/path/to/audio.wav',
      cause,
    });

    expect((error as AudioError).code).toBe('PLAYBACK_FAILED');
    expect((error as AudioError).audioPath).toBe('/path/to/audio.wav');
    expect((error as any).cause).toBe(cause);
  });

  it('should handle all AudioError codes', () => {
    const codes: AudioError['code'][] = [
      'GENERATION_FAILED',
      'PLAYBACK_FAILED',
      'PLAYBACK_STOPPED',
      'FILE_NOT_FOUND',
      'INVALID_PATH',
      'RECORDING_FAILED',
      'FILE_OPERATION_FAILED',
      'API_ERROR',
    ];

    codes.forEach((code) => {
      const error = createAudioError('Test', code);
      expect((error as AudioError).code).toBe(code);
    });
  });
});

describe('createLLMError', () => {
  it('should create LLMError with defaults', () => {
    const error = createLLMError('Test error');

    expect(error).toBeInstanceOf(Error);
    expect((error as LLMError).code).toBe('MODEL_ERROR');
    expect((error as LLMError).retryable).toBe(true);
    expect(error.message).toBe('Test error');
  });

  it('should create LLMError with custom code', () => {
    const error = createLLMError('Test error', 'TIMEOUT');

    expect((error as LLMError).code).toBe('TIMEOUT');
  });

  it('should create LLMError with retryable flag', () => {
    const error = createLLMError('Test error', 'CONNECTION_ERROR', false);

    expect((error as LLMError).retryable).toBe(false);
  });

  it('should create LLMError with cause', () => {
    const cause = new Error('Original error');
    const error = createLLMError('Test error', 'MODEL_ERROR', true, cause);

    expect((error as any).cause).toBe(cause);
  });

  it('should handle all LLMError codes', () => {
    const codes: LLMError['code'][] = [
      'CONNECTION_ERROR',
      'TIMEOUT',
      'INVALID_RESPONSE',
      'MODEL_ERROR',
    ];

    codes.forEach((code) => {
      const error = createLLMError('Test', code);
      expect((error as LLMError).code).toBe(code);
    });
  });
});

describe('createSpeechRecognitionError', () => {
  it('should create SpeechRecognitionError with code', () => {
    const error = createSpeechRecognitionError('Test error', 'MODEL_NOT_FOUND');

    expect(error).toBeInstanceOf(Error);
    expect((error as any).code).toBe('MODEL_NOT_FOUND');
    expect(error.message).toBe('Test error');
  });

  it('should create SpeechRecognitionError with filePath', () => {
    const error = createSpeechRecognitionError('Test error', 'FILE_NOT_FOUND', {
      filePath: '/path/to/audio.wav',
    });

    expect((error as any).filePath).toBe('/path/to/audio.wav');
  });

  it('should create SpeechRecognitionError with cause', () => {
    const cause = new Error('Original error');
    const error = createSpeechRecognitionError('Test error', 'TRANSCRIPTION_FAILED', {
      cause,
    });

    expect((error as any).cause).toBe(cause);
  });

  it('should create SpeechRecognitionError with all options', () => {
    const cause = new Error('Original');
    const error = createSpeechRecognitionError('Test error', 'INVALID_AUDIO_FORMAT', {
      filePath: '/path/to/audio.wav',
      cause,
    });

    expect((error as any).code).toBe('INVALID_AUDIO_FORMAT');
    expect((error as any).filePath).toBe('/path/to/audio.wav');
    expect((error as any).cause).toBe(cause);
  });

  it('should handle all SpeechRecognitionError codes', () => {
    const codes: Array<
      | 'MODEL_NOT_FOUND'
      | 'TRANSCRIPTION_FAILED'
      | 'FILE_NOT_FOUND'
      | 'INVALID_AUDIO_FORMAT'
      | 'WHISPER_NOT_AVAILABLE'
    > = [
      'MODEL_NOT_FOUND',
      'TRANSCRIPTION_FAILED',
      'FILE_NOT_FOUND',
      'INVALID_AUDIO_FORMAT',
      'WHISPER_NOT_AVAILABLE',
    ];

    codes.forEach((code) => {
      const error = createSpeechRecognitionError('Test', code);
      expect((error as any).code).toBe(code);
    });
  });
});
