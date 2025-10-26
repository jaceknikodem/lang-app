/**
 * Electron preload script for secure IPC communication
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/types/ipc.js';

console.log('Preload script loaded!');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Database operations
  database: {
    insertWord: (word: any) => ipcRenderer.invoke(IPC_CHANNELS.DATABASE.INSERT_WORD, word),
    updateWordStrength: (wordId: number, strength: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.UPDATE_WORD_STRENGTH, wordId, strength),
    markWordKnown: (wordId: number, known: boolean) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.MARK_WORD_KNOWN, wordId, known),
    markWordIgnored: (wordId: number, ignored: boolean) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.MARK_WORD_IGNORED, wordId, ignored),
    getWordsToStudy: (limit: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_WORDS_TO_STUDY, limit),
    getWordById: (wordId: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_WORD_BY_ID, wordId),
    getAllWords: (includeKnown?: boolean, includeIgnored?: boolean) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_ALL_WORDS, includeKnown, includeIgnored),
    getWordsWithSentences: (includeKnown?: boolean, includeIgnored?: boolean) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_WORDS_WITH_SENTENCES, includeKnown, includeIgnored),
    getRecentStudySessions: (limit?: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_RECENT_STUDY_SESSIONS, limit),
    insertSentence: (wordId: number, sentence: string, translation: string, audioPath: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.INSERT_SENTENCE, wordId, sentence, translation, audioPath),
    getSentencesByWord: (wordId: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_SENTENCES_BY_WORD, wordId),
    updateLastStudied: (wordId: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.UPDATE_LAST_STUDIED, wordId),
    getStudyStats: () => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_STUDY_STATS),
    recordStudySession: (wordsStudied: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.RECORD_STUDY_SESSION, wordsStudied),
    getSetting: (key: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_SETTING, key),
    setSetting: (key: string, value: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.SET_SETTING, key, value),
    getCurrentLanguage: () => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_CURRENT_LANGUAGE),
    setCurrentLanguage: (language: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.SET_CURRENT_LANGUAGE, language),
    getAvailableLanguages: () => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_AVAILABLE_LANGUAGES),
    getLanguageStats: () => 
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_LANGUAGE_STATS)
  },

  // LLM operations
  llm: {
    generateWords: (topic: string | undefined, language: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.GENERATE_WORDS, topic, language),
    generateSentences: (word: string, language: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.GENERATE_SENTENCES, word, language),
    isAvailable: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.IS_AVAILABLE),
    getAvailableModels: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.GET_AVAILABLE_MODELS),
    setModel: (model: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.SET_MODEL, model),
    getCurrentModel: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LLM.GET_CURRENT_MODEL)
  },

  // Audio operations
  audio: {
    generateAudio: (text: string, language: string, word?: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.GENERATE_AUDIO, text, language, word),
    playAudio: (audioPath: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.PLAY_AUDIO, audioPath),
    audioExists: (audioPath: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.AUDIO.AUDIO_EXISTS, audioPath)
  },

  // Quiz operations
  quiz: {
    getWeakestWords: (limit: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.QUIZ.GET_WEAKEST_WORDS, limit),
    getRandomSentenceForWord: (wordId: number) => 
      ipcRenderer.invoke(IPC_CHANNELS.QUIZ.GET_RANDOM_SENTENCE_FOR_WORD, wordId)
  },

  // Lifecycle operations
  lifecycle: {
    createBackup: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LIFECYCLE.CREATE_BACKUP),
    restoreFromBackup: (backupPath: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.LIFECYCLE.RESTORE_FROM_BACKUP, backupPath),
    checkForUpdates: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LIFECYCLE.CHECK_FOR_UPDATES),
    getAppVersion: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LIFECYCLE.GET_APP_VERSION),
    restartAll: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LIFECYCLE.RESTART_ALL),
    openBackupDialog: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LIFECYCLE.OPEN_BACKUP_DIALOG),
    openBackupDirectory: () => 
      ipcRenderer.invoke(IPC_CHANNELS.LIFECYCLE.OPEN_BACKUP_DIRECTORY)
  },

  // Frequency word management
  frequency: {
    getProgress: (language: string) => 
      ipcRenderer.invoke(IPC_CHANNELS.FREQUENCY.GET_PROGRESS, language),
    getAvailableLanguages: () => 
      ipcRenderer.invoke(IPC_CHANNELS.FREQUENCY.GET_AVAILABLE_LANGUAGES)
  }
});

// Type declaration for the exposed API
declare global {
  interface Window {
    electronAPI: {
      database: {
        insertWord: (word: any) => Promise<number>;
        updateWordStrength: (wordId: number, strength: number) => Promise<void>;
        markWordKnown: (wordId: number, known: boolean) => Promise<void>;
        markWordIgnored: (wordId: number, ignored: boolean) => Promise<void>;
        getWordsToStudy: (limit: number) => Promise<any[]>;
        getWordById: (wordId: number) => Promise<any | null>;
        getAllWords: (includeKnown?: boolean, includeIgnored?: boolean) => Promise<any[]>;
        getWordsWithSentences: (includeKnown?: boolean, includeIgnored?: boolean) => Promise<any[]>;
        getRecentStudySessions: (limit?: number) => Promise<any[]>;
        insertSentence: (wordId: number, sentence: string, translation: string, audioPath: string) => Promise<number>;
        getSentencesByWord: (wordId: number) => Promise<any[]>;
        updateLastStudied: (wordId: number) => Promise<void>;
        getStudyStats: () => Promise<any>;
        recordStudySession: (wordsStudied: number) => Promise<void>;
        getSetting: (key: string) => Promise<string | null>;
        setSetting: (key: string, value: string) => Promise<void>;
        getCurrentLanguage: () => Promise<string>;
        setCurrentLanguage: (language: string) => Promise<void>;
        getAvailableLanguages: () => Promise<string[]>;
        getLanguageStats: () => Promise<Array<{language: string, totalWords: number, studiedWords: number}>>;
      };
      llm: {
        generateWords: (topic: string | undefined, language: string) => Promise<any[]>;
        generateSentences: (word: string, language: string) => Promise<any[]>;
        isAvailable: () => Promise<boolean>;
        getAvailableModels: () => Promise<string[]>;
        setModel: (model: string) => Promise<void>;
        getCurrentModel: () => Promise<string>;
      };
      audio: {
        generateAudio: (text: string, language?: string, word?: string) => Promise<string>;
        playAudio: (audioPath: string) => Promise<void>;
        audioExists: (audioPath: string) => Promise<boolean>;
      };
      quiz: {
        getWeakestWords: (limit: number) => Promise<any[]>;
        getRandomSentenceForWord: (wordId: number) => Promise<any | null>;
      };
      lifecycle: {
        createBackup: () => Promise<string>;
        restoreFromBackup: (backupPath: string) => Promise<void>;
        checkForUpdates: () => Promise<boolean>;
        getAppVersion: () => Promise<string>;
        restartAll: () => Promise<void>;
        openBackupDialog: () => Promise<string | null>;
        openBackupDirectory: () => Promise<void>;
      };
      frequency: {
        getProgress: (language: string) => Promise<{
          totalWords: number;
          processedWords: number;
          currentPosition: number;
          percentComplete: number;
        }>;
        getAvailableLanguages: () => Promise<string[]>;
      };
    };
  }
}