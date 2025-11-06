/**
 * Shared constants for the Local Language Learning App
 * 
 * Configuration values are now loaded from config.toml via the config module.
 * This file maintains backward compatibility by re-exporting from the config module.
 * In the renderer (browser), uses defaults since config module requires Node.js.
 */

// Check if we're in a Node.js environment (main process)
// In Electron renderer, process exists but require might not be available
// Check for both Node.js runtime and require availability
const isNodeEnv = typeof process !== 'undefined' && 
                  process.versions?.node != null &&
                  typeof require !== 'undefined';

// Import config only in Node.js environment (main process)
// Use a function to prevent esbuild from analyzing the require at build time
let appConfig: any = null;
let llmConfig: any = null;
let audioConfig: any = null;
let strengthBoostConfig: any = null;

if (isNodeEnv) {
  try {
    // Use Function constructor to prevent static analysis by bundlers
    // This ensures esbuild doesn't try to bundle the config module
    const requireFunc = new Function('modulePath', 'return require(modulePath)');
    const config = requireFunc('../config/index.js');
    appConfig = config.appConfig;
    llmConfig = config.llmConfig;
    audioConfig = config.audioConfig;
    strengthBoostConfig = config.strengthBoostConfig;
  } catch (error) {
    // If config loading fails, use defaults
    // Only log in Node.js environment (not in browser)
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('Failed to load config, using defaults:', error);
    }
  }
}

// Default values (used in renderer or if config fails to load)
const DEFAULT_APP_CONFIG = {
  databaseName: 'language_learning.db',
  audioDirectory: 'audio',
  defaultLanguage: 'spanish',
  defaultWordCount: 5,
  defaultSentenceCount: 3,
  maxWordStrength: 100,
  minWordStrength: 0,
  quizWordLimit: 10,
  supportedLanguages: ['spanish', 'italian', 'portuguese', 'polish', 'indonesian'] as const
};

const DEFAULT_LLM_CONFIG = {
  baseUrl: 'http://localhost:11434',
  defaultModel: 'granite4:tiny-h',
  wordGenerationModel: 'granite4:tiny-h',
  sentenceGenerationModel: 'granite4:tiny-h',
  timeout: 80000,
  maxRetries: 3,
  minWordCountThreshold: 0.4,
  minSentenceCountThreshold: 0.7,
  maxExistingWordsInPrompt: 50,
  gemini: {
    defaultModel: 'gemini-2.5-flash',
    wordModel: 'gemini-2.5-flash-lite',
    sentenceModel: 'gemini-2.5-flash',
    timeout: 30000
  }
};

const DEFAULT_AUDIO_CONFIG = {
  fileExtension: '.aiff',
  ttsCommand: 'say',
  defaultRate: 160
};

const DEFAULT_STRENGTH_BOOST_CONFIG = {
  sentencePlayed: 1,
  pronunciationBoosts: {
    minSimilarity: 0.85,
    good: 2,
    veryGood: 3,
    excellent: 4
  }
};

// Re-export configs with uppercase names for backward compatibility
export const APP_CONFIG = {
  DATABASE_NAME: appConfig?.databaseName ?? DEFAULT_APP_CONFIG.databaseName,
  AUDIO_DIRECTORY: appConfig?.audioDirectory ?? DEFAULT_APP_CONFIG.audioDirectory,
  DEFAULT_LANGUAGE: appConfig?.defaultLanguage ?? DEFAULT_APP_CONFIG.defaultLanguage,
  DEFAULT_WORD_COUNT: appConfig?.defaultWordCount ?? DEFAULT_APP_CONFIG.defaultWordCount,
  DEFAULT_SENTENCE_COUNT: appConfig?.defaultSentenceCount ?? DEFAULT_APP_CONFIG.defaultSentenceCount,
  MAX_WORD_STRENGTH: appConfig?.maxWordStrength ?? DEFAULT_APP_CONFIG.maxWordStrength,
  MIN_WORD_STRENGTH: appConfig?.minWordStrength ?? DEFAULT_APP_CONFIG.minWordStrength,
  QUIZ_WORD_LIMIT: appConfig?.quizWordLimit ?? DEFAULT_APP_CONFIG.quizWordLimit,
  SUPPORTED_LANGUAGES: appConfig?.supportedLanguages ?? DEFAULT_APP_CONFIG.supportedLanguages
} as const;

export const LLM_CONFIG = {
  DEFAULT_BASE_URL: llmConfig?.baseUrl ?? DEFAULT_LLM_CONFIG.baseUrl,
  DEFAULT_MODEL: llmConfig?.defaultModel ?? DEFAULT_LLM_CONFIG.defaultModel,
  DEFAULT_WORD_GENERATION_MODEL: llmConfig?.wordGenerationModel ?? DEFAULT_LLM_CONFIG.wordGenerationModel,
  DEFAULT_SENTENCE_GENERATION_MODEL: llmConfig?.sentenceGenerationModel ?? DEFAULT_LLM_CONFIG.sentenceGenerationModel,
  DEFAULT_TIMEOUT: llmConfig?.timeout ?? DEFAULT_LLM_CONFIG.timeout,
  MAX_RETRIES: llmConfig?.maxRetries ?? DEFAULT_LLM_CONFIG.maxRetries,
  MIN_WORD_COUNT_THRESHOLD: llmConfig?.minWordCountThreshold ?? DEFAULT_LLM_CONFIG.minWordCountThreshold,
  MIN_SENTENCE_COUNT_THRESHOLD: llmConfig?.minSentenceCountThreshold ?? DEFAULT_LLM_CONFIG.minSentenceCountThreshold,
  MAX_EXISTING_WORDS_IN_PROMPT: llmConfig?.maxExistingWordsInPrompt ?? DEFAULT_LLM_CONFIG.maxExistingWordsInPrompt,
  GEMINI_DEFAULT_MODEL: llmConfig?.gemini?.defaultModel ?? DEFAULT_LLM_CONFIG.gemini.defaultModel,
  GEMINI_DEFAULT_WORD_MODEL: llmConfig?.gemini?.wordModel ?? DEFAULT_LLM_CONFIG.gemini.wordModel,
  GEMINI_DEFAULT_SENTENCE_MODEL: llmConfig?.gemini?.sentenceModel ?? DEFAULT_LLM_CONFIG.gemini.sentenceModel,
  GEMINI_DEFAULT_TIMEOUT: llmConfig?.gemini?.timeout ?? DEFAULT_LLM_CONFIG.gemini.timeout
} as const;

export const AUDIO_CONFIG = {
  FILE_EXTENSION: audioConfig?.fileExtension ?? DEFAULT_AUDIO_CONFIG.fileExtension,
  TTS_COMMAND: audioConfig?.ttsCommand ?? DEFAULT_AUDIO_CONFIG.ttsCommand,
  DEFAULT_RATE: audioConfig?.defaultRate ?? DEFAULT_AUDIO_CONFIG.defaultRate
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

// STRENGTH_BOOST_CONFIG uses values from TOML config but keeps the method in TypeScript
export const STRENGTH_BOOST_CONFIG = {
  /** Strength boost when a sentence is played */
  SENTENCE_PLAYED: strengthBoostConfig?.sentencePlayed ?? DEFAULT_STRENGTH_BOOST_CONFIG.sentencePlayed,
  /** Strength boost thresholds for pronunciation quality */
  PRONUNCIATION_BOOSTS: {
    /** Minimum similarity score (0-1) to qualify for any boost */
    MIN_SIMILARITY: strengthBoostConfig?.pronunciationBoosts?.minSimilarity ?? DEFAULT_STRENGTH_BOOST_CONFIG.pronunciationBoosts.minSimilarity,
    /** Boost amount for good pronunciation (85-89%) */
    GOOD: strengthBoostConfig?.pronunciationBoosts?.good ?? DEFAULT_STRENGTH_BOOST_CONFIG.pronunciationBoosts.good,
    /** Boost amount for very good pronunciation (90-94%) */
    VERY_GOOD: strengthBoostConfig?.pronunciationBoosts?.veryGood ?? DEFAULT_STRENGTH_BOOST_CONFIG.pronunciationBoosts.veryGood,
    /** Boost amount for excellent pronunciation (95%+) */
    EXCELLENT: strengthBoostConfig?.pronunciationBoosts?.excellent ?? DEFAULT_STRENGTH_BOOST_CONFIG.pronunciationBoosts.excellent
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