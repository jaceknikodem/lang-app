/**
 * Shared constants for the Local Language Learning App
 */

export const APP_CONFIG = {
  DATABASE_NAME: 'language_learning.db',
  AUDIO_DIRECTORY: 'audio',
  DEFAULT_LANGUAGE: 'spanish',
  DEFAULT_WORD_COUNT: 5,
  DEFAULT_SENTENCE_COUNT: 3,
  MAX_WORD_STRENGTH: 100,
  MIN_WORD_STRENGTH: 0,
  QUIZ_WORD_LIMIT: 10,
  SUPPORTED_LANGUAGES: [
    'spanish',
    'italian',
    'portuguese',
    'polish',
    'indonesian'
  ]
} as const;

export const LLM_CONFIG = {
  DEFAULT_BASE_URL: 'http://localhost:11434',
  DEFAULT_MODEL: 'granite4:tiny-h',
  DEFAULT_WORD_GENERATION_MODEL: 'granite4:tiny-h', // Small model for word generation
  DEFAULT_SENTENCE_GENERATION_MODEL: 'granite4:tiny-h', // Big model for sentence generation (can be changed to larger model)
  DEFAULT_TIMEOUT: 80000, // Increased to 80 seconds for better reliability
  MAX_RETRIES: 2,
  // Gemini configuration
  GEMINI_DEFAULT_MODEL: 'gemini-1.5-flash',
  GEMINI_DEFAULT_WORD_MODEL: 'gemini-1.5-flash-8b', // Fastest, most cost-effective for word generation
  GEMINI_DEFAULT_SENTENCE_MODEL: 'gemini-1.5-pro', // Higher quality model for complex sentences
  GEMINI_DEFAULT_TIMEOUT: 30000
} as const;

export const AUDIO_CONFIG = {
  FILE_EXTENSION: '.aiff',
  TTS_COMMAND: 'say',
  DEFAULT_RATE: 160
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