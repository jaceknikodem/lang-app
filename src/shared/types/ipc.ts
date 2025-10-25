/**
 * IPC bridge interfaces for secure communication between main and renderer processes
 */

import { Word, Sentence, StudyStats, GeneratedWord, GeneratedSentence, CreateWordRequest } from './core.js';

export interface IPCBridge {
  // Database operations
  database: {
    insertWord: (word: CreateWordRequest) => Promise<number>;
    updateWordStrength: (wordId: number, strength: number) => Promise<void>;
    markWordKnown: (wordId: number, known: boolean) => Promise<void>;
    markWordIgnored: (wordId: number, ignored: boolean) => Promise<void>;
    getWordsToStudy: (limit: number) => Promise<Word[]>;
    getWordById: (wordId: number) => Promise<Word | null>;
    getAllWords: (includeKnown?: boolean, includeIgnored?: boolean) => Promise<Word[]>;
    getRecentStudySessions: (limit?: number) => Promise<Array<{id: number, wordsStudied: number, whenStudied: Date}>>;
    insertSentence: (wordId: number, sentence: string, translation: string, audioPath: string) => Promise<number>;
    getSentencesByWord: (wordId: number) => Promise<Sentence[]>;
    updateLastStudied: (wordId: number) => Promise<void>;
    getStudyStats: () => Promise<StudyStats>;
    recordStudySession: (wordsStudied: number) => Promise<void>;
  };
  
  // LLM operations
  llm: {
    generateWords: (topic: string | undefined, language: string) => Promise<GeneratedWord[]>;
    generateSentences: (word: string, language: string) => Promise<GeneratedSentence[]>;
    isAvailable: () => Promise<boolean>;
    getAvailableModels: () => Promise<string[]>;
    setModel: (model: string) => Promise<void>;
    getCurrentModel: () => Promise<string>;
  };
  
  // Audio operations
  audio: {
    generateAudio: (text: string, language: string) => Promise<string>;
    playAudio: (audioPath: string) => Promise<void>;
    audioExists: (audioPath: string) => Promise<boolean>;
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
    GET_ALL_WORDS: 'database:getAllWords',
    GET_RECENT_STUDY_SESSIONS: 'database:getRecentStudySessions',
    INSERT_SENTENCE: 'database:insertSentence',
    GET_SENTENCES_BY_WORD: 'database:getSentencesByWord',
    UPDATE_LAST_STUDIED: 'database:updateLastStudied',
    GET_STUDY_STATS: 'database:getStudyStats',
    RECORD_STUDY_SESSION: 'database:recordStudySession'
  },
  LLM: {
    GENERATE_WORDS: 'llm:generateWords',
    GENERATE_SENTENCES: 'llm:generateSentences',
    IS_AVAILABLE: 'llm:isAvailable',
    GET_AVAILABLE_MODELS: 'llm:getAvailableModels',
    SET_MODEL: 'llm:setModel',
    GET_CURRENT_MODEL: 'llm:getCurrentModel'
  },
  AUDIO: {
    GENERATE_AUDIO: 'audio:generateAudio',
    PLAY_AUDIO: 'audio:playAudio',
    AUDIO_EXISTS: 'audio:audioExists'
  },
  QUIZ: {
    GET_WEAKEST_WORDS: 'quiz:getWeakestWords',
    GET_RANDOM_SENTENCE_FOR_WORD: 'quiz:getRandomSentenceForWord'
  },
  LIFECYCLE: {
    CREATE_BACKUP: 'lifecycle:createBackup',
    RESTORE_FROM_BACKUP: 'lifecycle:restoreFromBackup',
    CHECK_FOR_UPDATES: 'lifecycle:checkForUpdates',
    GET_APP_VERSION: 'lifecycle:getAppVersion'
  }
} as const;