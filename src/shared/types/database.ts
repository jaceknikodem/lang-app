/**
 * Database layer interfaces and types
 */

import { Word, Sentence, StudyStats, CreateWordRequest, DictionaryEntry } from './core.js';

export interface DatabaseLayer {
  // Word management
  insertWord(word: CreateWordRequest): Promise<number>;
  updateWordStrength(wordId: number, strength: number): Promise<void>;
  markWordKnown(wordId: number, known: boolean): Promise<void>;
  markWordIgnored(wordId: number, ignored: boolean): Promise<void>;
  getWordsToStudy(limit: number, language?: string): Promise<Word[]>;
  getWordsByStrength(minStrength: number, maxStrength: number, limit?: number, language?: string): Promise<Word[]>;
  getAllWords(includeKnown?: boolean, includeIgnored?: boolean, language?: string): Promise<Word[]>;
  getWordsWithSentences(includeKnown?: boolean, includeIgnored?: boolean, language?: string): Promise<Word[]>;
  getWordsWithSentencesOrderedByStrength(includeKnown?: boolean, includeIgnored?: boolean, language?: string): Promise<Word[]>;
  getWordById(wordId: number): Promise<Word | null>;
  
  // SRS-specific operations
  updateWordSRS(
    wordId: number,
    strength: number,
    intervalDays: number,
    easeFactor: number,
    nextDue: Date,
    options?: {
      fsrsDifficulty?: number;
      fsrsStability?: number;
      fsrsLapses?: number;
      fsrsLastRating?: number | null;
      fsrsVersion?: string;
    }
  ): Promise<void>;
  getWordsDueForReview(limit?: number, language?: string): Promise<Word[]>;
  getWordsDueCount(language?: string): Promise<number>;
  getWordsDueWithPriority(limit?: number, language?: string): Promise<Word[]>;
  getSRSStats(language?: string): Promise<{
    totalWords: number;
    dueToday: number;
    overdue: number;
    averageInterval: number;
    averageEaseFactor: number;
  }>;
  
  // Sentence management
  insertSentence(wordId: number, sentence: string, translation: string, audioPath: string): Promise<number>;
  getSentencesByWord(wordId: number): Promise<Sentence[]>;
  getSentenceById(sentenceId: number): Promise<Sentence | null>;
  deleteSentence(sentenceId: number): Promise<void>;
  updateSentenceLastShown(sentenceId: number): Promise<void>;
  
  // Progress tracking
  updateLastStudied(wordId: number): Promise<void>;
  getStudyStats(language?: string): Promise<StudyStats>;
  recordStudySession(wordsStudied: number): Promise<void>;
  getRecentStudySessions(limit?: number): Promise<Array<{id: number, wordsStudied: number, whenStudied: Date}>>;
  
  // Quiz-specific operations
  getWeakestWords(limit: number, language?: string): Promise<Word[]>;
  getRandomSentenceForWord(wordId: number): Promise<Sentence | null>;
  
  // Settings management
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  getCurrentLanguage(): Promise<string>;
  setCurrentLanguage(language: string): Promise<void>;
  getAvailableLanguages(): Promise<string[]>;
  getLanguageStats(): Promise<Array<{language: string, totalWords: number, studiedWords: number}>>;
  lookupDictionary(word: string, language?: string): Promise<DictionaryEntry[]>;
  
  // Database lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;
}

export interface DatabaseConfig {
  databasePath: string;
  enableWAL?: boolean;
  timeout?: number;
}
