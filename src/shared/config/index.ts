/**
 * Centralized configuration management using TOML + convict
 * Provides validation, type safety, and environment variable overrides
 */

import convict from 'convict';
import * as dotenv from 'dotenv';

// Check if we're in a Node.js environment (not browser)
const isNodeEnv = typeof process !== 'undefined' && process.versions?.node != null;

/**
 * Convert snake_case keys to camelCase recursively
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Recursively convert object keys from snake_case to camelCase
 */
function convertKeysToCamelCase(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => convertKeysToCamelCase(item));
  }

  if (typeof obj === 'object') {
    const converted: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const camelKey = snakeToCamel(key);
        converted[camelKey] = convertKeysToCamelCase(obj[key]);
      }
    }
    return converted;
  }

  return obj;
}

let tomlData: any = {};

// Only load TOML file in Node.js environment (main process)
if (isNodeEnv) {
  try {
    const toml = require('@iarna/toml');
    const fs = require('fs');
    const path = require('path');

    // Load .env file for secrets (if it exists)
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
    }

    // Load TOML config file
    const configPath = path.resolve(process.cwd(), 'config.toml');
    if (fs.existsSync(configPath)) {
      try {
        const tomlContent = fs.readFileSync(configPath, 'utf-8');
        const parsed = toml.parse(tomlContent);
        // Convert snake_case keys to camelCase to match convict schema
        tomlData = convertKeysToCamelCase(parsed);
      } catch (error) {
        console.warn(`Failed to load config.toml: ${error}. Using defaults.`);
      }
    }
  } catch (error) {
    // If TOML loading fails, just use defaults
    console.warn(`Failed to load config dependencies: ${error}. Using defaults.`);
  }
}

// Add custom format validators for convict
convict.addFormat({
  name: 'url',
  validate: (val: any) => {
    if (typeof val !== 'string') {
      throw new Error('must be a string');
    }
    try {
      new URL(val);
    } catch {
      throw new Error('must be a valid URL');
    }
  },
  coerce: (val: any) => {
    return String(val);
  },
});

convict.addFormat({
  name: 'port',
  validate: (val: any) => {
    const port = Number(val);
    if (isNaN(port) || port < 1 || port > 65535 || !Number.isInteger(port)) {
      throw new Error('must be a valid port number (1-65535)');
    }
  },
  coerce: (val: any) => {
    return Number(val);
  },
});

convict.addFormat({
  name: 'float',
  validate: (val: any) => {
    const num = Number(val);
    if (isNaN(num)) {
      throw new Error('must be a valid number');
    }
  },
  coerce: (val: any) => {
    return Number(val);
  },
});

// Define configuration schema with validation
const config = convict({
  env: {
    doc: 'The application environment',
    format: ['development', 'production', 'test'],
    default: 'development',
    env: 'NODE_ENV',
  },

  // Service Management
  services: {
    manageServices: {
      doc: 'Whether to manage external services (whisper, lemmatization)',
      format: Boolean,
      default: false,
      env: 'MANAGE_SERVICES',
    },
    whisper: {
      port: {
        doc: 'Whisper server port',
        format: 'port',
        default: 8080,
        env: 'WHISPER_PORT',
      },
      serverUrl: {
        doc: 'Whisper server URL',
        format: 'url',
        default: 'http://127.0.0.1:8080',
        env: 'WHISPER_SERVER_URL',
      },
    },
    lemmatization: {
      port: {
        doc: 'Lemmatization server port',
        format: 'port',
        default: 8888,
        env: 'LEMMATIZATION_PORT',
      },
      serverUrl: {
        doc: 'Lemmatization server URL',
        format: 'url',
        default: 'http://127.0.0.1:8888',
        env: 'LEMMATIZATION_SERVER_URL',
      },
    },
    maxRestarts: {
      doc: 'Maximum service restart attempts',
      format: 'int',
      default: 10,
      env: 'MAX_SERVICE_RESTARTS',
    },
  },

  // LLM Configuration
  llm: {
    baseUrl: {
      doc: 'Ollama base URL',
      format: 'url',
      default: 'http://localhost:11434',
      env: 'OLLAMA_BASE_URL',
    },
    defaultModel: {
      doc: 'Default LLM model',
      format: String,
      default: 'granite4:tiny-h',
      env: 'LLM_DEFAULT_MODEL',
    },
    wordGenerationModel: {
      doc: 'Model for word generation',
      format: String,
      default: 'granite4:tiny-h',
      env: 'LLM_WORD_GENERATION_MODEL',
    },
    sentenceGenerationModel: {
      doc: 'Model for sentence generation',
      format: String,
      default: 'granite4:tiny-h',
      env: 'LLM_SENTENCE_GENERATION_MODEL',
    },
    timeout: {
      doc: 'LLM request timeout in milliseconds',
      format: 'int',
      default: 80000,
      env: 'LLM_TIMEOUT',
    },
    maxRetries: {
      doc: 'Maximum retry attempts for LLM requests',
      format: 'int',
      default: 3,
      env: 'LLM_MAX_RETRIES',
    },
    minWordCountThreshold: {
      doc: 'Minimum word count threshold ratio (0-1)',
      format: 'float',
      default: 0.4,
      env: 'LLM_MIN_WORD_COUNT_THRESHOLD',
    },
    minSentenceCountThreshold: {
      doc: 'Minimum sentence count threshold ratio (0-1)',
      format: 'float',
      default: 0.7,
      env: 'LLM_MIN_SENTENCE_COUNT_THRESHOLD',
    },
    maxExistingWordsInPrompt: {
      doc: 'Maximum existing words to include in prompt',
      format: 'int',
      default: 50,
      env: 'LLM_MAX_EXISTING_WORDS_IN_PROMPT',
    },
    gemini: {
      defaultModel: {
        doc: 'Default Gemini model',
        format: String,
        default: 'gemini-2.5-flash',
        env: 'GEMINI_DEFAULT_MODEL',
      },
      wordModel: {
        doc: 'Gemini model for word generation',
        format: String,
        default: 'gemini-2.5-flash-lite',
        env: 'GEMINI_WORD_MODEL',
      },
      sentenceModel: {
        doc: 'Gemini model for sentence generation',
        format: String,
        default: 'gemini-2.5-flash',
        env: 'GEMINI_SENTENCE_MODEL',
      },
      timeout: {
        doc: 'Gemini request timeout in milliseconds',
        format: 'int',
        default: 30000,
        env: 'GEMINI_TIMEOUT',
      },
    },
  },

  // Application Configuration
  app: {
    databaseName: {
      doc: 'SQLite database filename',
      format: String,
      default: 'language_learning.db',
      env: 'APP_DATABASE_NAME',
    },
    audioDirectory: {
      doc: 'Audio files directory',
      format: String,
      default: 'audio',
      env: 'APP_AUDIO_DIRECTORY',
    },
    defaultLanguage: {
      doc: 'Default learning language',
      format: ['spanish', 'italian', 'portuguese', 'polish', 'indonesian'],
      default: 'spanish',
      env: 'APP_DEFAULT_LANGUAGE',
    },
    defaultWordCount: {
      doc: 'Default number of words to generate',
      format: 'int',
      default: 5,
      env: 'APP_DEFAULT_WORD_COUNT',
    },
    defaultSentenceCount: {
      doc: 'Default number of sentences to generate',
      format: 'int',
      default: 3,
      env: 'APP_DEFAULT_SENTENCE_COUNT',
    },
    maxWordStrength: {
      doc: 'Maximum word strength value',
      format: 'int',
      default: 100,
      env: 'APP_MAX_WORD_STRENGTH',
    },
    minWordStrength: {
      doc: 'Minimum word strength value',
      format: 'int',
      default: 0,
      env: 'APP_MIN_WORD_STRENGTH',
    },
    quizWordLimit: {
      doc: 'Maximum words in quiz mode',
      format: 'int',
      default: 10,
      env: 'APP_QUIZ_WORD_LIMIT',
    },
    openDevtools: {
      doc: 'Automatically open DevTools on startup',
      format: Boolean,
      default: false,
      env: 'APP_OPEN_DEVTOOLS',
    },
  },

  // Audio Configuration
  audio: {
    fileExtension: {
      doc: 'Audio file extension',
      format: String,
      default: '.aiff',
      env: 'AUDIO_FILE_EXTENSION',
    },
    ttsCommand: {
      doc: 'Text-to-speech command',
      format: String,
      default: 'say',
      env: 'AUDIO_TTS_COMMAND',
    },
    defaultRate: {
      doc: 'Default TTS speech rate',
      format: 'int',
      default: 160,
      env: 'AUDIO_DEFAULT_RATE',
    },
  },

  // Strength Boost Configuration
  strengthBoost: {
    sentencePlayed: {
      doc: 'Strength boost when a sentence is played',
      format: 'int',
      default: 1,
      env: 'STRENGTH_BOOST_SENTENCE_PLAYED',
    },
    pronunciationBoosts: {
      minSimilarity: {
        doc: 'Minimum similarity score (0-1) to qualify for any boost',
        format: 'float',
        default: 0.85,
        env: 'STRENGTH_BOOST_MIN_SIMILARITY',
      },
      good: {
        doc: 'Boost amount for good pronunciation (85-89%)',
        format: 'int',
        default: 2,
        env: 'STRENGTH_BOOST_GOOD',
      },
      veryGood: {
        doc: 'Boost amount for very good pronunciation (90-94%)',
        format: 'int',
        default: 3,
        env: 'STRENGTH_BOOST_VERY_GOOD',
      },
      excellent: {
        doc: 'Boost amount for excellent pronunciation (95%+)',
        format: 'int',
        default: 4,
        env: 'STRENGTH_BOOST_EXCELLENT',
      },
    },
  },

  // Testing Configuration
  testing: {
    e2eForceLocalServices: {
      doc: 'Force local services in E2E tests',
      format: Boolean,
      default: false,
      env: 'E2E_FORCE_LOCAL_SERVICES',
    },
  },

  // UI Configuration
  ui: {
    topicSuggestionsCount: {
      doc: 'Number of topic suggestions to show',
      format: 'int',
      default: 3,
      env: 'UI_TOPIC_SUGGESTIONS_COUNT',
    },
    topicFilteringMinAvailable: {
      doc: 'Minimum number of topics to keep after filtering',
      format: 'int',
      default: 3,
      env: 'UI_TOPIC_FILTERING_MIN_AVAILABLE',
    },
    topicFilteringExcludeTopN: {
      doc: 'Number of top-used topics to exclude from suggestions',
      format: 'int',
      default: 10,
      env: 'UI_TOPIC_FILTERING_EXCLUDE_TOP_N',
    },
    strengthThresholdWeak: {
      doc: 'Word strength threshold for weak category',
      format: 'int',
      default: 25,
      env: 'UI_STRENGTH_THRESHOLD_WEAK',
    },
    strengthThresholdMedium: {
      doc: 'Word strength threshold for medium category',
      format: 'int',
      default: 50,
      env: 'UI_STRENGTH_THRESHOLD_MEDIUM',
    },
    strengthThresholdStrong: {
      doc: 'Word strength threshold for strong category',
      format: 'int',
      default: 75,
      env: 'UI_STRENGTH_THRESHOLD_STRONG',
    },
    wordStatsThresholdWeak: {
      doc: 'Word statistics threshold for weak category',
      format: 'int',
      default: 30,
      env: 'UI_WORD_STATS_THRESHOLD_WEAK',
    },
    wordStatsThresholdStrong: {
      doc: 'Word statistics threshold for strong category',
      format: 'int',
      default: 70,
      env: 'UI_WORD_STATS_THRESHOLD_STRONG',
    },
  },

  // Languages Configuration
  languages: {
    doc: 'Supported languages with their metadata',
    format: Array,
    default: [],
    items: {
      code: {
        doc: '2-letter ISO language code',
        format: String,
        default: '',
      },
      name: {
        doc: 'Internal language name',
        format: String,
        default: '',
      },
      displayName: {
        doc: 'UI display name',
        format: String,
        default: '',
      },
      tatoebaCode: {
        doc: 'Tatoeba API language code',
        format: String,
        default: '',
      },
      lemmatizationCode: {
        doc: 'Lemmatization service language code',
        format: String,
        default: '',
      },
      speechRecognitionCode: {
        doc: 'Speech recognition language code',
        format: String,
        default: '',
      },
      elevenlabsVoiceIds: {
        doc: 'Array of ElevenLabs voice IDs',
        format: Array,
        default: [],
        items: {
          format: String,
        },
      },
      audioGeneratorVoice: {
        doc: 'macOS say command voice name',
        format: String,
        default: '',
      },
    },
  },
});

// Load TOML data into convict (if file exists)
if (Object.keys(tomlData).length > 0) {
  config.load(tomlData);
}

// Perform validation
config.validate({ allowed: 'strict' });

// Export typed configuration
export default config.getProperties();

// Export individual config sections for convenience
export const serviceConfig = {
  manageServices: config.get('services.manageServices'),
  whisper: {
    port: config.get('services.whisper.port'),
    serverUrl: config.get('services.whisper.serverUrl'),
  },
  lemmatization: {
    port: config.get('services.lemmatization.port'),
    serverUrl: config.get('services.lemmatization.serverUrl'),
  },
  maxRestarts: config.get('services.maxRestarts'),
};

export const llmConfig = {
  baseUrl: config.get('llm.baseUrl'),
  defaultModel: config.get('llm.defaultModel'),
  wordGenerationModel: config.get('llm.wordGenerationModel'),
  sentenceGenerationModel: config.get('llm.sentenceGenerationModel'),
  timeout: config.get('llm.timeout'),
  maxRetries: config.get('llm.maxRetries'),
  minWordCountThreshold: config.get('llm.minWordCountThreshold'),
  minSentenceCountThreshold: config.get('llm.minSentenceCountThreshold'),
  maxExistingWordsInPrompt: config.get('llm.maxExistingWordsInPrompt'),
  gemini: {
    defaultModel: config.get('llm.gemini.defaultModel'),
    wordModel: config.get('llm.gemini.wordModel'),
    sentenceModel: config.get('llm.gemini.sentenceModel'),
    timeout: config.get('llm.gemini.timeout'),
  },
};

export const appConfig = {
  databaseName: config.get('app.databaseName'),
  audioDirectory: config.get('app.audioDirectory'),
  defaultLanguage: config.get('app.defaultLanguage'),
  defaultWordCount: config.get('app.defaultWordCount'),
  defaultSentenceCount: config.get('app.defaultSentenceCount'),
  maxWordStrength: config.get('app.maxWordStrength'),
  minWordStrength: config.get('app.minWordStrength'),
  quizWordLimit: config.get('app.quizWordLimit'),
  openDevtools: config.get('app.openDevtools'),
};

export const audioConfig = {
  fileExtension: config.get('audio.fileExtension'),
  ttsCommand: config.get('audio.ttsCommand'),
  defaultRate: config.get('audio.defaultRate'),
};

export const strengthBoostConfig = {
  sentencePlayed: config.get('strengthBoost.sentencePlayed'),
  pronunciationBoosts: {
    minSimilarity: config.get('strengthBoost.pronunciationBoosts.minSimilarity'),
    good: config.get('strengthBoost.pronunciationBoosts.good'),
    veryGood: config.get('strengthBoost.pronunciationBoosts.veryGood'),
    excellent: config.get('strengthBoost.pronunciationBoosts.excellent'),
  },
};

export const testingConfig = {
  e2eForceLocalServices: config.get('testing.e2eForceLocalServices'),
};

export const uiConfig = {
  topicSuggestionsCount: config.get('ui.topicSuggestionsCount'),
  topicFilteringMinAvailable: config.get('ui.topicFilteringMinAvailable'),
  topicFilteringExcludeTopN: config.get('ui.topicFilteringExcludeTopN'),
  strengthThresholdWeak: config.get('ui.strengthThresholdWeak'),
  strengthThresholdMedium: config.get('ui.strengthThresholdMedium'),
  strengthThresholdStrong: config.get('ui.strengthThresholdStrong'),
  wordStatsThresholdWeak: config.get('ui.wordStatsThresholdWeak'),
  wordStatsThresholdStrong: config.get('ui.wordStatsThresholdStrong'),
};

export const languagesConfig = config.get('languages') as Array<{
  code: string;
  name: string;
  displayName: string;
  tatoebaCode: string;
  lemmatizationCode: string;
  speechRecognitionCode: string;
  elevenlabsVoiceIds: string[];
  audioGeneratorVoice: string;
}>;

// Export environment
export const env = config.get('env');
