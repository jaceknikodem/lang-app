/**
 * IPC bridge interfaces for secure communication between main and renderer processes
 */

import {
  Word,
  Sentence,
  StudyStats,
  GeneratedWord,
  GeneratedSentence,
  CreateWordRequest,
  DictionaryEntry,
  DialogueVariant,
  DialogSession,
  TranscriptionAnalysis,
} from './core.js';
import { JobWordInfo, WordProcessingStatus } from './database.js';
import {
  RecordingOptions,
  RecordingSession,
  TranscriptionOptions,
  TranscriptionResult,
  TranscriptionComparison,
} from './audio.js';

export interface IPCBridge {
  // Database operations
  database: {
    insertWord: (word: CreateWordRequest) => Promise<number>;
    updateWordStrength: (wordId: number, strength: number) => Promise<void>;
    markWordKnown: (wordId: number, known: boolean) => Promise<void>;
    markWordIgnored: (wordId: number, ignored: boolean) => Promise<void>;
    getWordsToStudy: (limit: number, language: string) => Promise<Word[]>;
    getWordById: (wordId: number) => Promise<Word | null>;
    getWordsByIds: (wordIds: number[]) => Promise<Word[]>;
    getAllWords: (
      language: string,
      includeKnown?: boolean,
      includeIgnored?: boolean
    ) => Promise<Word[]>;
    getAllWordsWithSentences: (language: string) => Promise<Word[]>;
    getWordsWithSentences: (
      language: string,
      includeKnown?: boolean,
      includeIgnored?: boolean
    ) => Promise<Word[]>;
    getWordsWithSentencesOrderedByStrength: (
      language: string,
      includeKnown?: boolean,
      includeIgnored?: boolean
    ) => Promise<Word[]>;
    getRecentStudySessions: (
      limit?: number
    ) => Promise<Array<{ id: number; wordsStudied: number; whenStudied: Date }>>;
    insertSentence: (
      wordId: number,
      sentence: string,
      translation: string,
      audioPath: string,
      contextBefore?: string,
      contextAfter?: string,
      contextBeforeTranslation?: string,
      contextAfterTranslation?: string,
      sentenceParts?: string[],
      sentenceGenerationModel?: string,
      audioGenerationService?: string,
      audioGenerationModel?: string,
      audioGenerationVoiceId?: string,
      pronunciation?: string,
      contextBeforePronunciation?: string,
      contextAfterPronunciation?: string,
      proficiencyLevel?: string
    ) => Promise<number>;
    getSentencesByWord: (wordId: number) => Promise<Sentence[]>;
    getSentencesByIds: (sentenceIds: number[]) => Promise<Sentence[]>;
    deleteSentence: (sentenceId: number) => Promise<void>;
    updateSentenceLastShown: (sentenceId: number) => Promise<void>;
    updateSentenceAudioPath: (
      sentenceId: number,
      audioPath: string,
      audioGenerationVoiceId?: string
    ) => Promise<void>;
    incrementSentencePlayCount: (sentenceId: number) => Promise<void>;
    incrementGrammarExplanationCount: (wordId: number) => Promise<void>;
    recordPronunciationAttempt: (
      sentenceId: number,
      similarityScore: number,
      expectedText: string,
      transcribedText: string
    ) => Promise<void>;
    getPronunciationHistory: (
      sentenceId: number,
      limit?: number
    ) => Promise<
      Array<{
        id: number;
        sentenceId: number;
        similarityScore: number;
        expectedText: string;
        transcribedText: string;
        createdAt: Date;
      }>
    >;
    insertDialogCorrection: (data: {
      sentenceId: number;
      sessionId?: number;
      correctionText: string;
      language: string;
    }) => Promise<number>;
    getDialogCorrections: (
      sentenceId: number,
      language: string,
      limit?: number
    ) => Promise<Array<{ id: number; correctionText: string; createdAt: Date }>>;
    updateLastStudied: (wordId: number) => Promise<void>;
    getStudyStats: () => Promise<StudyStats>;
    recordStudySession: (wordsStudied: number) => Promise<void>;
    getSetting: (key: string) => Promise<string | null>;
    setSetting: (key: string, value: string) => Promise<void>;
    getCurrentLanguage: () => Promise<string>;
    setCurrentLanguage: (language: string) => Promise<void>;
    getLanguageStats: () => Promise<
      Array<{
        language: string;
        totalWords: number;
        studiedWords: number;
        averagePronunciationScore: number | null;
        pronunciationAttemptCount: number;
      }>
    >;
    lookupDictionary: (word: string, language: string) => Promise<DictionaryEntry[]>;
    getNewWordCount: (language: string) => Promise<number>;
    getAvailableSentencesCount: (language: string) => Promise<number>;
    resetLanguageProgress: (language: string) => Promise<void>;
    getTopicWordCounts: (language: string) => Promise<Array<{ topic: string; count: number }>>;
    getReadAloudCache: (
      text: string,
      language: string
    ) => Promise<{ id: number; rawText: string; audioPath: string } | null>;
    insertReadAloudCache: (text: string, language: string, audioPath: string) => Promise<number>;
  };

  // SRS operations
  srs: {
    processReview: (wordId: number, recall: 0 | 1 | 2 | 3) => Promise<void>;
    processQuizResults: (
      results: Array<{
        wordId: number;
        correct: boolean;
        responseTime?: number;
        difficulty?: 'easy' | 'medium' | 'hard';
      }>
    ) => Promise<void>;
    getTodaysStudyWords: (language: string, maxWords?: number) => Promise<Word[]>;
    getDashboardStats: (language: string) => Promise<{
      totalWords: number;
      dueToday: number;
      overdue: number;
      averageInterval: number;
      averageEaseFactor: number;
      recommendedStudySize: number;
    }>;
    markWordDifficulty: (wordId: number, difficulty: 'easy' | 'hard') => Promise<void>;
    resetWordProgress: (wordId: number) => Promise<void>;
    getOverdueWords: (language: string) => Promise<Word[]>;
    initializeExistingWords: (language: string) => Promise<number>;
  };

  // LLM operations
  llm: {
    generateWords: (topic: string | undefined, language: string) => Promise<GeneratedWord[]>;
    generateSentences: (
      word: string,
      language: string,
      topic?: string
    ) => Promise<GeneratedSentence[]>;
    isAvailable: () => Promise<boolean>;
    getAvailableModels: () => Promise<string[]>;
    setModel: (model: string) => Promise<void>;
    getCurrentModel: () => Promise<string>;
    setWordGenerationModel: (model: string) => Promise<void>;
    setSentenceGenerationModel: (model: string) => Promise<void>;
    getWordGenerationModel: () => Promise<string>;
    getSentenceGenerationModel: () => Promise<string>;
    explainGrammar: (
      word: string,
      sentence: string,
      language: string,
      proficiencyLevel: string | undefined,
      wordId: number,
      sentenceId: number
    ) => Promise<string>;
    // Provider management
    getCurrentProvider: () => Promise<'ollama' | 'gemini' | 'mlx-lm'>;
    switchProvider: (
      provider: 'ollama' | 'gemini' | 'mlx-lm',
      geminiApiKey?: string,
      mlxLmBaseUrl?: string
    ) => Promise<void>;
    setGeminiApiKey: (apiKey: string, switchToGemini?: boolean) => Promise<void>;
    getAvailableProviders: () => Promise<Array<'ollama' | 'gemini' | 'mlx-lm'>>;
    getModelsForProvider: (provider: 'ollama' | 'gemini' | 'mlx-lm') => Promise<string[]>;
  };

  // Frequency word management
  frequency: {
    getProgress: (language: string) => Promise<{
      totalWords: number;
      processedWords: number;
      currentPosition: number;
      percentComplete: number;
    }>;
    getAvailableLanguages: () => Promise<string[]>;
  };

  jobs: {
    enqueueWordGeneration: (
      wordId: number,
      options?: {
        language?: string;
        topic?: string;
        desiredSentenceCount?: number;
      }
    ) => Promise<void>;
    getWordStatus: (
      wordId: number
    ) => Promise<{ processingStatus: WordProcessingStatus; sentenceCount: number } | null>;
    getQueueSummary: (language?: string) => Promise<{
      queued: number;
      processing: number;
      failed: number;
      queuedWords: JobWordInfo[];
      processingWords: JobWordInfo[];
    }>;
    onWordUpdated: (
      callback: (payload: {
        wordId: number;
        processingStatus: WordProcessingStatus;
        sentenceCount: number;
      }) => void
    ) => () => void;
  };

  // Audio operations
  audio: {
    generateAudio: (
      text: string,
      language: string,
      word?: string,
      wordId?: number,
      sentenceId?: number,
      variantId?: number
    ) => Promise<string>;
    playAudio: (audioPath: string) => Promise<void>;
    stopAudio: () => Promise<void>;
    audioExists: (audioPath: string) => Promise<boolean>;
    normalizeAudioVolume: (audioPath: string, targetDb?: number) => Promise<string | null>;
    regenerateAudio: (options: {
      text: string;
      language: string;
      word?: string;
      wordId?: number;
      sentenceId?: number;
      variantId?: number;
      existingPath?: string;
      audioType?: 'before' | 'main' | 'after';
      forceElevenLabs?: boolean;
    }) => Promise<{ audioPath: string }>;
    startRecording: (options?: RecordingOptions) => Promise<RecordingSession>;
    stopRecording: () => Promise<RecordingSession | null>;
    cancelRecording: () => Promise<void>;
    getCurrentRecordingSession: () => Promise<RecordingSession | null>;
    isRecording: () => Promise<boolean>;
    getAvailableRecordingDevices: () => Promise<string[]>;
    deleteRecording: (filePath: string) => Promise<void>;
    getRecordingInfo: (filePath: string) => Promise<{ size: number; duration?: number } | null>;
    initializeSpeechRecognition: () => Promise<void>;
    transcribeAudio: (
      filePath: string,
      options?: TranscriptionOptions
    ) => Promise<TranscriptionResult>;
    compareTranscription: (
      transcribed: string,
      expected: string,
      proficiencyLevel?: string | null
    ) => Promise<TranscriptionComparison>;
    isSpeechRecognitionReady: () => Promise<boolean>;
    switchToElevenLabs: (apiKey: string) => Promise<void>;
    switchToSystemTTS: () => Promise<void>;
    getVoiceMappings: () => Promise<Record<string, string[]>>;
    saveVoiceMappings: (mappings: Record<string, string[]>) => Promise<void>;
    resetVoiceMappingsToDefaults: () => Promise<void>;
  };

  // Quiz operations
  quiz: {
    getWeakestWords: (limit: number) => Promise<Word[]>;
    getRandomSentenceForWord: (wordId: number) => Promise<Sentence | null>;
  };

  // Lifecycle operations
  lifecycle: {
    createBackup: () => Promise<string>;
    restoreFromBackup: (backupPath: string) => Promise<void>;
    checkForUpdates: () => Promise<boolean>;
    getAppVersion: () => Promise<string>;
    restartAll: () => Promise<void>;
    openBackupDialog: () => Promise<string | null>;
    openBackupDirectory: () => Promise<void>;
    closeApp: () => Promise<void>;
  };

  // Lemmatization operations
  lemmatization: {
    getStatus: () => Promise<{ status: string; loadedModels: string[]; service: string }>;
    loadModel: (language: string) => Promise<void>;
    lemmatizeWords: (words: string[], language: string) => Promise<Record<string, string>>;
    getWordFrequencies: (words: string[], language: string) => Promise<Record<string, number>>;
  };

  // Japanese tokenization operations
  japaneseTokenization: {
    tokenize: (
      sentence: string
    ) => Promise<Array<{ text: string; type: 'word' | 'whitespace' | 'punctuation' }>>;
    getWordReadings: (words: string[]) => Promise<Record<string, string>>;
  };

  // Dialog operations
  dialog: {
    selectSentence: (excludeIds?: number[]) => Promise<Sentence | null>;
    selectSentenceWithTopic: (excludeIds?: number[]) => Promise<Sentence | null>;
    generateVariants: (sentenceId: number) => Promise<DialogueVariant[]>;
    generateFollowUp: (
      variantId: number,
      conversationHistory?: string[]
    ) => Promise<{ text: string; translation: string; audio?: string; pronunciation?: string }>;
    analyzeTranscription: (
      transcription: string,
      language: string,
      assistantSentence: string,
      topic?: string
    ) => Promise<TranscriptionAnalysis>;
    explainGrammar: (
      word: string,
      sentence: string,
      language: string,
      proficiencyLevel: string | undefined,
      wordId: number,
      sentenceId: number
    ) => Promise<string>;
    pregenerateSession: () => Promise<DialogSession | null>;
    pregenerateSessions: (count: number) => Promise<DialogSession[]>;
  };

  // Flow operations
  flow: {
    getFlowSentences: (language: string) => Promise<
      Array<{
        audioPath: string;
        englishAudioPath?: string;
        beforeSentenceAudio?: string;
        afterSentenceAudio?: string;
        continuationAudios: string[];
        variantSentenceAudios: string[];
      }>
    >;
    stitchAudio: (audioPaths: string[], language: string) => Promise<string>;
    stitchAudioWithEnglish: (
      audioPathPairs: Array<[string, string]>,
      language: string
    ) => Promise<string>;
    getFileStats: (filePath: string) => Promise<{ mtime: Date } | null>;
  };

  // Scoring operations
  scoring: {
    getNextMode: (options: {
      currentMode: 'topic-selection' | 'learning' | 'quiz' | 'dialog' | 'flow' | null;
      language: string | null;
      initialTakeover: boolean;
    }) => Promise<{
      nextMode: 'learning' | 'quiz' | 'dialog' | 'flow' | null;
      rankedModes: Array<'topic-selection' | 'learning' | 'quiz' | 'dialog' | 'flow'>;
    }>;
  };

  // Logging operations
  log: {
    log: (
      level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
      message: string,
      data?: any
    ) => Promise<void>;
  };

  // Topics operations
  topics: {
    getTopics: () => Promise<string[]>;
  };
}

// IPC channel names
export const IPC_CHANNELS = {
  DATABASE: {
    INSERT_WORD: 'database:insertWord',
    UPDATE_WORD_STRENGTH: 'database:updateWordStrength',
    MARK_WORD_KNOWN: 'database:markWordKnown',
    MARK_WORD_IGNORED: 'database:markWordIgnored',
    GET_WORDS_TO_STUDY: 'database:getWordsToStudy',
    GET_WORD_BY_ID: 'database:getWordById',
    GET_WORDS_BY_IDS: 'database:getWordsByIds',
    GET_ALL_WORDS: 'database:getAllWords',
    GET_ALL_WORDS_WITH_SENTENCES: 'database:getAllWordsWithSentences',
    GET_WORDS_WITH_SENTENCES: 'database:getWordsWithSentences',
    GET_WORDS_WITH_SENTENCES_ORDERED_BY_STRENGTH: 'database:getWordsWithSentencesOrderedByStrength',
    GET_RECENT_STUDY_SESSIONS: 'database:getRecentStudySessions',
    INSERT_SENTENCE: 'database:insertSentence',
    GET_SENTENCES_BY_WORD: 'database:getSentencesByWord',
    GET_SENTENCES_BY_IDS: 'database:getSentencesByIds',
    DELETE_SENTENCE: 'database:deleteSentence',
    UPDATE_SENTENCE_LAST_SHOWN: 'database:updateSentenceLastShown',
    UPDATE_SENTENCE_AUDIO_PATH: 'database:updateSentenceAudioPath',
    INCREMENT_SENTENCE_PLAY_COUNT: 'database:incrementSentencePlayCount',
    INCREMENT_GRAMMAR_EXPLANATION_COUNT: 'database:incrementGrammarExplanationCount',
    RECORD_PRONUNCIATION_ATTEMPT: 'database:recordPronunciationAttempt',
    GET_PRONUNCIATION_HISTORY: 'database:getPronunciationHistory',
    INSERT_DIALOG_CORRECTION: 'database:insertDialogCorrection',
    GET_DIALOG_CORRECTIONS: 'database:getDialogCorrections',
    UPDATE_LAST_STUDIED: 'database:updateLastStudied',
    GET_STUDY_STATS: 'database:getStudyStats',
    RECORD_STUDY_SESSION: 'database:recordStudySession',
    GET_SETTING: 'database:getSetting',
    SET_SETTING: 'database:setSetting',
    GET_CURRENT_LANGUAGE: 'database:getCurrentLanguage',
    SET_CURRENT_LANGUAGE: 'database:setCurrentLanguage',
    GET_LANGUAGE_STATS: 'database:getLanguageStats',
    LOOKUP_DICTIONARY: 'database:lookupDictionary',
    GET_NEW_WORD_COUNT: 'database:getNewWordCount',
    GET_AVAILABLE_SENTENCES_COUNT: 'database:getAvailableSentencesCount',
    RESET_LANGUAGE_PROGRESS: 'database:resetLanguageProgress',
    GET_TOPIC_WORD_COUNTS: 'database:getTopicWordCounts',
    GET_READ_ALOUD_CACHE: 'database:getReadAloudCache',
    INSERT_READ_ALOUD_CACHE: 'database:insertReadAloudCache',
  },
  LLM: {
    GENERATE_WORDS: 'llm:generateWords',
    EXTRACT_ARTICLE_WORDS: 'llm:extractArticleWords',
    GENERATE_SENTENCES: 'llm:generateSentences',
    IS_AVAILABLE: 'llm:isAvailable',
    GET_AVAILABLE_MODELS: 'llm:getAvailableModels',
    SET_MODEL: 'llm:setModel',
    GET_CURRENT_MODEL: 'llm:getCurrentModel',
    SET_WORD_GENERATION_MODEL: 'llm:setWordGenerationModel',
    SET_SENTENCE_GENERATION_MODEL: 'llm:setSentenceGenerationModel',
    GET_WORD_GENERATION_MODEL: 'llm:getWordGenerationModel',
    GET_SENTENCE_GENERATION_MODEL: 'llm:getSentenceGenerationModel',
    EXPLAIN_GRAMMAR: 'llm:explainGrammar',
    // Provider management
    GET_CURRENT_PROVIDER: 'llm:getCurrentProvider',
    SWITCH_PROVIDER: 'llm:switchProvider',
    SET_GEMINI_API_KEY: 'llm:setGeminiApiKey',
    GET_AVAILABLE_PROVIDERS: 'llm:getAvailableProviders',
    GET_MODELS_FOR_PROVIDER: 'llm:getModelsForProvider',
  },
  AUDIO: {
    GENERATE_AUDIO: 'audio:generateAudio',
    GENERATE_AUDIO_BATCH: 'audio:generateAudioBatch',
    GENERATE_TEXT_AUDIO_RAW: 'audio:generateTextAudioRaw',
    PLAY_AUDIO: 'audio:playAudio',
    STOP_AUDIO: 'audio:stopAudio',
    AUDIO_EXISTS: 'audio:audioExists',
    NORMALIZE_AUDIO_VOLUME: 'audio:normalizeAudioVolume',
    LOAD_AUDIO_BASE64: 'audio:loadAudioBase64',
    REGENERATE_AUDIO: 'audio:regenerateAudio',
    START_RECORDING: 'audio:startRecording',
    STOP_RECORDING: 'audio:stopRecording',
    CANCEL_RECORDING: 'audio:cancelRecording',
    GET_CURRENT_RECORDING_SESSION: 'audio:getCurrentRecordingSession',
    IS_RECORDING: 'audio:isRecording',
    GET_AVAILABLE_RECORDING_DEVICES: 'audio:getAvailableRecordingDevices',
    DELETE_RECORDING: 'audio:deleteRecording',
    GET_RECORDING_INFO: 'audio:getRecordingInfo',
    INITIALIZE_SPEECH_RECOGNITION: 'audio:initializeSpeechRecognition',
    TRANSCRIBE_AUDIO: 'audio:transcribeAudio',
    TRANSCRIBE_AUDIO_PROGRESS: 'audio:transcribeAudioProgress',
    COMPARE_TRANSCRIPTION: 'audio:compareTranscription',
    IS_SPEECH_RECOGNITION_READY: 'audio:isSpeechRecognitionReady',
    SWITCH_TO_ELEVENLABS: 'audio:switchToElevenLabs',
    SWITCH_TO_SYSTEM_TTS: 'audio:switchToSystemTTS',
    GET_VOICE_MAPPINGS: 'audio:getVoiceMappings',
    SAVE_VOICE_MAPPINGS: 'audio:saveVoiceMappings',
    RESET_VOICE_MAPPINGS_TO_DEFAULTS: 'audio:resetVoiceMappingsToDefaults',
  },
  QUIZ: {
    GET_WEAKEST_WORDS: 'quiz:getWeakestWords',
    GET_RANDOM_SENTENCE_FOR_WORD: 'quiz:getRandomSentenceForWord',
  },
  LIFECYCLE: {
    CREATE_BACKUP: 'lifecycle:createBackup',
    RESTORE_FROM_BACKUP: 'lifecycle:restoreFromBackup',
    CHECK_FOR_UPDATES: 'lifecycle:checkForUpdates',
    GET_APP_VERSION: 'lifecycle:getAppVersion',
    RESTART_ALL: 'lifecycle:restartAll',
    OPEN_BACKUP_DIALOG: 'lifecycle:openBackupDialog',
    OPEN_BACKUP_DIRECTORY: 'lifecycle:openBackupDirectory',
    CLOSE_APP: 'lifecycle:closeApp',
  },
  FREQUENCY: {
    GET_PROGRESS: 'frequency:getProgress',
    GET_AVAILABLE_LANGUAGES: 'frequency:getAvailableLanguages',
  },
  SRS: {
    PROCESS_REVIEW: 'srs:processReview',
    PROCESS_QUIZ_RESULTS: 'srs:processQuizResults',
    GET_TODAYS_STUDY_WORDS: 'srs:getTodaysStudyWords',
    GET_DASHBOARD_STATS: 'srs:getDashboardStats',
    MARK_WORD_DIFFICULTY: 'srs:markWordDifficulty',
    RESET_WORD_PROGRESS: 'srs:resetWordProgress',
    GET_OVERDUE_WORDS: 'srs:getOverdueWords',
    INITIALIZE_EXISTING_WORDS: 'srs:initializeExistingWords',
  },
  JOBS: {
    ENQUEUE_WORD_GENERATION: 'jobs:enqueueWordGeneration',
    GET_WORD_STATUS: 'jobs:getWordStatus',
    GET_QUEUE_SUMMARY: 'jobs:getQueueSummary',
    WORD_UPDATED: 'jobs:word-updated',
  },
  LEMMATIZATION: {
    GET_STATUS: 'lemmatization:getStatus',
    LOAD_MODEL: 'lemmatization:loadModel',
    LEMMATIZE_WORDS: 'lemmatization:lemmatizeWords',
    GET_WORD_FREQUENCIES: 'lemmatization:getWordFrequencies',
  },
  JAPANESE_TOKENIZATION: {
    TOKENIZE: 'japanese-tokenization:tokenize',
    GET_WORD_READINGS: 'japanese-tokenization:getWordReadings',
  },
  DIALOG: {
    SELECT_SENTENCE: 'dialog:selectSentence',
    SELECT_SENTENCE_WITH_TOPIC: 'dialog:selectSentenceWithTopic',
    GENERATE_VARIANTS: 'dialog:generateVariants',
    GENERATE_FOLLOW_UP: 'dialog:generateFollowUp',
    ANALYZE_TRANSCRIPTION: 'dialog:analyzeTranscription',
    PREGENERATE_SESSION: 'dialog:pregenerateSession',
    PREGENERATE_SESSIONS: 'dialog:pregenerateSessions',
  },
  FLOW: {
    GET_FLOW_SENTENCES: 'flow:getFlowSentences',
    STITCH_AUDIO: 'flow:stitchAudio',
    STITCH_AUDIO_WITH_ENGLISH: 'flow:stitchAudioWithEnglish',
    GET_FILE_STATS: 'flow:getFileStats',
    EXPORT_FLOW_MP3: 'flow:exportMp3',
  },
  SCORING: {
    GET_NEXT_MODE: 'scoring:getNextMode',
    GET_LANGUAGE_PROFICIENCY: 'scoring:getLanguageProficiency',
  },
  TRACKING: {
    CREATE_SESSION: 'tracking:createSession',
    UPDATE_SESSION: 'tracking:updateSession',
    RECORD_AUDIO_PLAYBACK: 'tracking:recordAudioPlayback',
    RECORD_NEGLECTED_WORDS: 'tracking:recordNeglectedWords',
    RECORD_DICTIONARY_HOVER: 'tracking:recordDictionaryHover',
  },
  LOG: {
    LOG: 'log:log',
  },
  TOPICS: {
    GET_TOPICS: 'topics:getTopics',
  },
  EXPORT: {
    EXPORT_ANKI: 'export:exportAnki',
  },
} as const;
