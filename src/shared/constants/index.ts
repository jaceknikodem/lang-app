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
  MAX_RETRIES: 3,
  // Minimum threshold ratios for retry logic
  MIN_WORD_COUNT_THRESHOLD: 0.4, // Require at least 40% of requested words to be new (non-duplicate)
  MIN_SENTENCE_COUNT_THRESHOLD: 0.7, // Require at least 70% of requested sentences to be generated
  // Gemini configuration
  GEMINI_DEFAULT_MODEL: 'gemini-2.5-flash',
  GEMINI_DEFAULT_WORD_MODEL: 'gemini-2.5-flash-lite', // Fastest, most cost-effective for word generation
  GEMINI_DEFAULT_SENTENCE_MODEL: 'gemini-2.5-flash', // Higher quality model for complex sentences
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

export const STRENGTH_BOOST_CONFIG = {
  /** Strength boost when a sentence is played */
  SENTENCE_PLAYED: 1,
  /** Strength boost thresholds for pronunciation quality */
  PRONUNCIATION_BOOSTS: {
    /** Minimum similarity score (0-1) to qualify for any boost */
    MIN_SIMILARITY: 0.85,
    /** Boost amount for good pronunciation (85-89%) */
    GOOD: 2,
    /** Boost amount for very good pronunciation (90-94%) */
    VERY_GOOD: 3,
    /** Boost amount for excellent pronunciation (95%+) */
    EXCELLENT: 4
  },
  /**
   * Calculate pronunciation boost based on similarity score (0-1)
   * Returns boost amount: 2-4 based on how well the sentence was pronounced
   */
  getPronunciationBoost(similarity: number): number {
    if (similarity < this.PRONUNCIATION_BOOSTS.MIN_SIMILARITY) {
      return 0;
    }
    if (similarity >= 0.95) {
      return this.PRONUNCIATION_BOOSTS.EXCELLENT; // 4 points
    }
    if (similarity >= 0.90) {
      return this.PRONUNCIATION_BOOSTS.VERY_GOOD; // 3 points
    }
    return this.PRONUNCIATION_BOOSTS.GOOD; // 2 points
  }
};