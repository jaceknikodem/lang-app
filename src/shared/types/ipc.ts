/**
 * IPC bridge interfaces for secure communication between main and renderer processes
 */

import { Word, Sentence, StudyStats, GeneratedWord, GeneratedSentence, CreateWordRequest, DictionaryEntry } from './core.js';
import { JobWordInfo, WordProcessingStatus } from './database.js';
import { RecordingOptions, RecordingSession, TranscriptionOptions, TranscriptionResult, TranscriptionComparison } from './audio.js';

export interface IPCBridge {
  // Database operations
  database: {
    insertWord: (word: CreateWordRequest) => Promise<number>;
    updateWordStrength: (wordId: number, strength: number) => Promise<void>;
    markWordKnown: (wordId: number, known: boolean) => Promise<void>;
    markWordIgnored: (wordId: number, ignored: boolean) => Promise<void>;
    getWordsToStudy: (limit: number) => Promise<Word[]>;
    getWordById: (wordId: number) => Promise<Word | null>;
    getWordsByIds: (wordIds: number[]) => Promise<Word[]>;
    getAllWords: (includeKnown?: boolean, includeIgnored?: boolean) => Promise<Word[]>;
    getWordsWithSentences: (includeKnown?: boolean, includeIgnored?: boolean) => Promise<Word[]>;
    getWordsWithSentencesOrderedByStrength: (includeKnown?: boolean, includeIgnored?: boolean) => Promise<Word[]>;
    getRecentStudySessions: (limit?: number) => Promise<Array<{ id: number, wordsStudied: number, whenStudied: Date }>>;
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
      audioGenerationModel?: string
    ) => Promise<number>;
    getSentencesByWord: (wordId: number) => Promise<Sentence[]>;
    getSentencesByIds: (sentenceIds: number[]) => Promise<Sentence[]>;
    deleteSentence: (sentenceId: number) => Promise<void>;
    updateSentenceLastShown: (sentenceId: number) => Promise<void>;
    updateSentenceAudioPath: (sentenceId: number, audioPath: string) => Promise<void>;
    updateLastStudied: (wordId: number) => Promise<void>;
    getStudyStats: () => Promise<StudyStats>;
    recordStudySession: (wordsStudied: number) => Promise<void>;
    getSetting: (key: string) => Promise<string | null>;
    setSetting: (key: string, value: string) => Promise<void>;
    getCurrentLanguage: () => Promise<string>;
    setCurrentLanguage: (language: string) => Promise<void>;
    getAvailableLanguages: () => Promise<string[]>;
    getLanguageStats: () => Promise<Array<{ language: string, totalWords: number, studiedWords: number }>>;
    lookupDictionary: (word: string, language?: string) => Promise<DictionaryEntry[]>;
  };

  // SRS operations
  srs: {
    processReview: (wordId: number, recall: 0 | 1 | 2 | 3) => Promise<void>;
    processQuizResults: (results: Array<{
      wordId: number;
      correct: boolean;
      responseTime?: number;
      difficulty?: 'easy' | 'medium' | 'hard';
    }>) => Promise<void>;
    getTodaysStudyWords: (maxWords?: number, language?: string) => Promise<Word[]>;
    getDashboardStats: (language?: string) => Promise<{
      totalWords: number;
      dueToday: number;
      overdue: number;
      averageInterval: number;
      averageEaseFactor: number;
      recommendedStudySize: number;
    }>;
    markWordDifficulty: (wordId: number, difficulty: 'easy' | 'hard') => Promise<void>;
    resetWordProgress: (wordId: number) => Promise<void>;
    getOverdueWords: (language?: string) => Promise<Word[]>;
    initializeExistingWords: (language?: string) => Promise<number>;
  };

  // LLM operations
  llm: {
    generateWords: (topic: string | undefined, language: string) => Promise<GeneratedWord[]>;
    generateSentences: (word: string, language: string, topic?: string) => Promise<GeneratedSentence[]>;
    isAvailable: () => Promise<boolean>;
    getAvailableModels: () => Promise<string[]>;
    setModel: (model: string) => Promise<void>;
    getCurrentModel: () => Promise<string>;
    setWordGenerationModel: (model: string) => Promise<void>;
    setSentenceGenerationModel: (model: string) => Promise<void>;
    getWordGenerationModel: () => Promise<string>;
    getSentenceGenerationModel: () => Promise<string>;
    // Provider management
    getCurrentProvider: () => Promise<'ollama' | 'gemini'>;
    switchProvider: (provider: 'ollama' | 'gemini', geminiApiKey?: string) => Promise<void>;
    setGeminiApiKey: (apiKey: string, switchToGemini?: boolean) => Promise<void>;
    getAvailableProviders: () => Promise<Array<'ollama' | 'gemini'>>;
    getModelsForProvider: (provider: 'ollama' | 'gemini') => Promise<string[]>;
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
    getWordStatus: (wordId: number) => Promise<{ processingStatus: WordProcessingStatus; sentenceCount: number } | null>;
    getQueueSummary: (language?: string) => Promise<{
      queued: number;
      processing: number;
      failed: number;
      queuedWords: JobWordInfo[];
      processingWords: JobWordInfo[];
    }>;
    onWordUpdated: (
      callback: (payload: { wordId: number; processingStatus: WordProcessingStatus; sentenceCount: number }) => void
    ) => () => void;
  };

  // Audio operations
  audio: {
    generateAudio: (text: string, language?: string, word?: string) => Promise<string>;
    playAudio: (audioPath: string) => Promise<void>;
    stopAudio: () => Promise<void>;
    audioExists: (audioPath: string) => Promise<boolean>;
    regenerateAudio: (options: {
      text: string;
      language?: string;
      word?: string;
      existingPath?: string;
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
    transcribeAudio: (filePath: string, options?: TranscriptionOptions) => Promise<TranscriptionResult>;
    compareTranscription: (transcribed: string, expected: string) => Promise<TranscriptionComparison>;
    getAvailableSpeechModels: () => Promise<string[]>;
    setSpeechModel: (model: string) => Promise<void>;
    getCurrentSpeechModel: () => Promise<string>;
    isSpeechRecognitionReady: () => Promise<boolean>;
    switchToElevenLabs: (apiKey: string) => Promise<void>;
    switchToMinimax: (apiKey: string) => Promise<void>;
    switchToSystemTTS: () => Promise<void>;
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
    GET_WORDS_WITH_SENTENCES: 'database:getWordsWithSentences',
    GET_WORDS_WITH_SENTENCES_ORDERED_BY_STRENGTH: 'database:getWordsWithSentencesOrderedByStrength',
    GET_RECENT_STUDY_SESSIONS: 'database:getRecentStudySessions',
    INSERT_SENTENCE: 'database:insertSentence',
    GET_SENTENCES_BY_WORD: 'database:getSentencesByWord',
    GET_SENTENCES_BY_IDS: 'database:getSentencesByIds',
    DELETE_SENTENCE: 'database:deleteSentence',
    UPDATE_SENTENCE_LAST_SHOWN: 'database:updateSentenceLastShown',
    UPDATE_SENTENCE_AUDIO_PATH: 'database:updateSentenceAudioPath',
    UPDATE_LAST_STUDIED: 'database:updateLastStudied',
    GET_STUDY_STATS: 'database:getStudyStats',
    RECORD_STUDY_SESSION: 'database:recordStudySession',
    GET_SETTING: 'database:getSetting',
    SET_SETTING: 'database:setSetting',
    GET_CURRENT_LANGUAGE: 'database:getCurrentLanguage',
    SET_CURRENT_LANGUAGE: 'database:setCurrentLanguage',
    GET_AVAILABLE_LANGUAGES: 'database:getAvailableLanguages',
    GET_LANGUAGE_STATS: 'database:getLanguageStats',
    LOOKUP_DICTIONARY: 'database:lookupDictionary'
  },
  LLM: {
    GENERATE_WORDS: 'llm:generateWords',
    GENERATE_SENTENCES: 'llm:generateSentences',
    IS_AVAILABLE: 'llm:isAvailable',
    GET_AVAILABLE_MODELS: 'llm:getAvailableModels',
    SET_MODEL: 'llm:setModel',
    GET_CURRENT_MODEL: 'llm:getCurrentModel',
    SET_WORD_GENERATION_MODEL: 'llm:setWordGenerationModel',
    SET_SENTENCE_GENERATION_MODEL: 'llm:setSentenceGenerationModel',
    GET_WORD_GENERATION_MODEL: 'llm:getWordGenerationModel',
    GET_SENTENCE_GENERATION_MODEL: 'llm:getSentenceGenerationModel',
    // Provider management
    GET_CURRENT_PROVIDER: 'llm:getCurrentProvider',
    SWITCH_PROVIDER: 'llm:switchProvider',
    SET_GEMINI_API_KEY: 'llm:setGeminiApiKey',
    GET_AVAILABLE_PROVIDERS: 'llm:getAvailableProviders',
    GET_MODELS_FOR_PROVIDER: 'llm:getModelsForProvider'
  },
  AUDIO: {
    GENERATE_AUDIO: 'audio:generateAudio',
    PLAY_AUDIO: 'audio:playAudio',
    STOP_AUDIO: 'audio:stopAudio',
    AUDIO_EXISTS: 'audio:audioExists',
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
    COMPARE_TRANSCRIPTION: 'audio:compareTranscription',
    GET_AVAILABLE_SPEECH_MODELS: 'audio:getAvailableSpeechModels',
    SET_SPEECH_MODEL: 'audio:setSpeechModel',
    GET_CURRENT_SPEECH_MODEL: 'audio:getCurrentSpeechModel',
    IS_SPEECH_RECOGNITION_READY: 'audio:isSpeechRecognitionReady',
    SWITCH_TO_ELEVENLABS: 'audio:switchToElevenLabs',
    SWITCH_TO_MINIMAX: 'audio:switchToMinimax',
    SWITCH_TO_SYSTEM_TTS: 'audio:switchToSystemTTS'
  },
  QUIZ: {
    GET_WEAKEST_WORDS: 'quiz:getWeakestWords',
    GET_RANDOM_SENTENCE_FOR_WORD: 'quiz:getRandomSentenceForWord'
  },
  LIFECYCLE: {
    CREATE_BACKUP: 'lifecycle:createBackup',
    RESTORE_FROM_BACKUP: 'lifecycle:restoreFromBackup',
    CHECK_FOR_UPDATES: 'lifecycle:checkForUpdates',
    GET_APP_VERSION: 'lifecycle:getAppVersion',
    RESTART_ALL: 'lifecycle:restartAll',
    OPEN_BACKUP_DIALOG: 'lifecycle:openBackupDialog',
    OPEN_BACKUP_DIRECTORY: 'lifecycle:openBackupDirectory'
  },
  FREQUENCY: {
    GET_PROGRESS: 'frequency:getProgress',
    GET_AVAILABLE_LANGUAGES: 'frequency:getAvailableLanguages'
  },
  SRS: {
    PROCESS_REVIEW: 'srs:processReview',
    PROCESS_QUIZ_RESULTS: 'srs:processQuizResults',
    GET_TODAYS_STUDY_WORDS: 'srs:getTodaysStudyWords',
    GET_DASHBOARD_STATS: 'srs:getDashboardStats',
    MARK_WORD_DIFFICULTY: 'srs:markWordDifficulty',
    RESET_WORD_PROGRESS: 'srs:resetWordProgress',
    GET_OVERDUE_WORDS: 'srs:getOverdueWords',
    INITIALIZE_EXISTING_WORDS: 'srs:initializeExistingWords'
  },
  JOBS: {
    ENQUEUE_WORD_GENERATION: 'jobs:enqueueWordGeneration',
    GET_WORD_STATUS: 'jobs:getWordStatus',
    GET_QUEUE_SUMMARY: 'jobs:getQueueSummary',
    WORD_UPDATED: 'jobs:word-updated'
  }
} as const;
