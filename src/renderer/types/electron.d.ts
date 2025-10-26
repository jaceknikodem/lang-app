/**
 * Type declarations for Electron API exposed to renderer process
 */

import { Word, Sentence, StudyStats, GeneratedWord, GeneratedSentence, CreateWordRequest } from '../../shared/types/core.js';

declare global {
  interface Window {
    electronAPI: {
      database: {
        insertWord: (word: CreateWordRequest) => Promise<number>;
        updateWordStrength: (wordId: number, strength: number) => Promise<void>;
        markWordKnown: (wordId: number, known: boolean) => Promise<void>;
        markWordIgnored: (wordId: number, ignored: boolean) => Promise<void>;
        getWordsToStudy: (limit: number) => Promise<Word[]>;
        getWordById: (wordId: number) => Promise<Word | null>;
        getAllWords: (includeKnown?: boolean, includeIgnored?: boolean) => Promise<Word[]>;
        getWordsWithSentences: (includeKnown?: boolean, includeIgnored?: boolean) => Promise<Word[]>;
        getRecentStudySessions: (limit?: number) => Promise<Array<{id: number, wordsStudied: number, whenStudied: Date}>>;
        insertSentence: (wordId: number, sentence: string, translation: string, audioPath: string) => Promise<number>;
        getSentencesByWord: (wordId: number) => Promise<Sentence[]>;
        updateLastStudied: (wordId: number) => Promise<void>;
        getStudyStats: () => Promise<StudyStats>;
        recordStudySession: (wordsStudied: number) => Promise<void>;
        getCurrentLanguage: () => Promise<string>;
        setCurrentLanguage: (language: string) => Promise<void>;
        getAvailableLanguages: () => Promise<string[]>;
        getLanguageStats: () => Promise<Array<{language: string, totalWords: number, studiedWords: number}>>;
      };
      llm: {
        generateWords: (topic: string | undefined, language: string) => Promise<GeneratedWord[]>;
        generateSentences: (word: string, language: string) => Promise<GeneratedSentence[]>;
        isAvailable: () => Promise<boolean>;
      };
      audio: {
        generateAudio: (text: string, language: string) => Promise<string>;
        playAudio: (audioPath: string) => Promise<void>;
        audioExists: (audioPath: string) => Promise<boolean>;
      };
      quiz: {
        getWeakestWords: (limit: number) => Promise<Word[]>;
        getRandomSentenceForWord: (wordId: number) => Promise<Sentence | null>;
      };
      lifecycle: {
        createBackup: () => Promise<string>;
        restoreFromBackup: (backupPath: string) => Promise<void>;
        checkForUpdates: () => Promise<boolean>;
        getAppVersion: () => Promise<string>;
        restartAll: () => Promise<void>;
        openBackupDialog: () => Promise<string | null>;
      };
    };
  }
}