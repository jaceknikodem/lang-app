/**
 * Database layer interfaces and types
 */

import { Word, Sentence, StudyStats, CreateWordRequest, DictionaryEntry } from './core.js';

export type WordProcessingStatus = 'queued' | 'processing' | 'ready' | 'failed';
export type WordGenerationJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface WordGenerationJob {
  id: number;
  wordId: number;
  language: string;
  topic?: string;
  desiredSentenceCount: number;
  status: WordGenerationJobStatus;
  attempts: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
}

export interface JobWordInfo {
  wordId: number;
  word: string;
  status: WordGenerationJobStatus;
  language: string;
  topic?: string;
}

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
  getWordsByIds(wordIds: number[]): Promise<Word[]>;
  
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
  insertSentence(
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
    tokenizedTokens?: any[]
  ): Promise<number>;
  getSentencesByWord(wordId: number): Promise<Sentence[]>;
  getSentencesByIds(sentenceIds: number[]): Promise<Sentence[]>;
  getSentenceById(sentenceId: number): Promise<Sentence | null>;
  deleteSentence(sentenceId: number): Promise<void>;
  updateSentenceLastShown(sentenceId: number): Promise<void>;
  updateSentenceAudioPath(sentenceId: number, audioPath: string): Promise<void>;
  updateSentenceTokens(sentenceId: number, tokens: any[]): Promise<void>;
  
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
  updateWordProcessingStatus(wordId: number, status: WordProcessingStatus): Promise<void>;
  getWordProcessingInfo(wordId: number): Promise<{ processingStatus: WordProcessingStatus; sentenceCount: number } | null>;
  getWordGenerationQueueSummary(language?: string): Promise<{
    queued: number;
    processing: number;
    failed: number;
    queuedWords: JobWordInfo[];
    processingWords: JobWordInfo[];
  }>;

  // Word generation queue
  enqueueWordGeneration(wordId: number, language: string, topic?: string, desiredSentenceCount?: number): Promise<void>;
  getNextWordGenerationJob(): Promise<WordGenerationJob | null>;
  markWordGenerationJobProcessing(jobId: number): Promise<void>;
  rescheduleWordGenerationJob(jobId: number, delayMs: number, lastError?: string): Promise<void>;
  completeWordGenerationJob(jobId: number): Promise<void>;
  failWordGenerationJob(jobId: number, error: string): Promise<void>;

  // Database lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;
}

export interface DatabaseConfig {
  databasePath: string;
  enableWAL?: boolean;
  timeout?: number;
}
