/**
 * Shared constants for the Local Language Learning App
 */

export const APP_CONFIG = {
  DATABASE_NAME: 'language_learning.db',
  AUDIO_DIRECTORY: 'audio',
  DEFAULT_LANGUAGE: 'spanish',
  DEFAULT_WORD_COUNT: 10,
  DEFAULT_SENTENCE_COUNT: 3,
  MAX_WORD_STRENGTH: 100,
  MIN_WORD_STRENGTH: 0,
  QUIZ_WORD_LIMIT: 20
} as const;

export const LLM_CONFIG = {
  DEFAULT_BASE_URL: 'http://localhost:11434',
  DEFAULT_MODEL: 'qwen3:8b',
  DEFAULT_TIMEOUT: 30000,
  MAX_RETRIES: 3
} as const;

export const AUDIO_CONFIG = {
  FILE_EXTENSION: '.aiff',
  TTS_COMMAND: 'say',
  DEFAULT_VOICE: 'system',
  DEFAULT_RATE: 200
} as const;

export const UI_CONFIG = {
  WORD_COLORS: {
    NEW: 'neutral',
    KNOWN: 'green',
    LEARNING: 'yellow',
    IGNORED: 'grey'
  },
  STRENGTH_THRESHOLDS: {
    WEAK: 25,
    MEDIUM: 50,
    STRONG: 75
  }
} as const;