/**
 * Database layer interfaces and types
 */

import { Word, Sentence, StudyStats, CreateWordRequest } from './core.js';

export interface DatabaseLayer {
  // Word management
  insertWord(word: CreateWordRequest): Promise<number>;
  updateWordStrength(wordId: number, strength: number): Promise<void>;
  markWordKnown(wordId: number, known: boolean): Promise<void>;
  markWordIgnored(wordId: number, ignored: boolean): Promise<void>;
  getWordsToStudy(limit: number): Promise<Word[]>;
  getWordById(wordId: number): Promise<Word | null>;
  
  // Sentence management
  insertSentence(wordId: number, sentence: string, translation: string, audioPath: string): Promise<number>;
  getSentencesByWord(wordId: number): Promise<Sentence[]>;
  
  // Progress tracking
  updateLastStudied(wordId: number): Promise<void>;
  getStudyStats(): Promise<StudyStats>;
  
  // Database lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;
}

export interface DatabaseConfig {
  databasePath: string;
  enableWAL?: boolean;
  timeout?: number;
}