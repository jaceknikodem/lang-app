/**
 * Database layer interfaces and types
 */

import {
  Word,
  Sentence,
  StudyStats,
  CreateWordRequest,
  DictionaryEntry,
  DialogueVariant,
} from './core.js';

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
  getWordsToStudy(limit: number, language: string): Promise<Word[]>;
  getWordsByStrength(
    minStrength: number,
    maxStrength: number,
    language: string,
    limit?: number
  ): Promise<Word[]>;
  getAllWords(
    language: string,
    includeKnown?: boolean,
    includeIgnored?: boolean,
    maxWords?: number
  ): Promise<Word[]>;
  getWordsWithSentences(
    language: string,
    includeKnown?: boolean,
    includeIgnored?: boolean
  ): Promise<Word[]>;
  getWordsWithSentencesOrderedByStrength(
    language: string,
    includeKnown?: boolean,
    includeIgnored?: boolean
  ): Promise<Word[]>;
  getWordById(wordId: number): Promise<Word | null>;
  getWordsByIds(wordIds: number[]): Promise<Word[]>;
  getKnownWordsForSentenceGeneration(language: string, limit?: number): Promise<string[]>;
  getKnownWords(language: string, minWordStrength: number, maxWords: number): Promise<string[]>;
  getExistingWordsForDuplicateChecking(
    language: string,
    topic?: string,
    limit?: number
  ): Promise<string[]>;
  getIgnoredWords(language: string, topic?: string): Promise<string[]>;
  checkWordsExist(language: string, words: string[], topic?: string): Promise<Set<string>>;

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
    }
  ): Promise<void>;
  getWordsDueForReview(language: string, limit?: number): Promise<Word[]>;
  getWordsDueCount(language: string): Promise<number>;
  getWordsDueWithPriority(language: string, limit?: number): Promise<Word[]>;
  getSRSStats(language: string): Promise<{
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
    audioGenerationVoiceId?: string,
    tokenizedTokens?: any[]
  ): Promise<number>;
  getSentencesByWord(wordId: number): Promise<Sentence[]>;
  getSentencesByIds(sentenceIds: number[]): Promise<Sentence[]>;
  getSentenceById(sentenceId: number): Promise<Sentence | null>;
  deleteSentence(sentenceId: number): Promise<void>;
  updateSentenceLastShown(sentenceId: number): Promise<void>;
  updateSentenceAudioPath(
    sentenceId: number,
    audioPath: string,
    audioGenerationVoiceId?: string
  ): Promise<void>;
  updateBeforeSentenceAudioPath(sentenceId: number, audioPath: string): Promise<void>;
  updateAfterSentenceAudioPath(sentenceId: number, audioPath: string): Promise<void>;
  updateSentenceTokens(sentenceId: number, tokens: any[]): Promise<void>;
  incrementSentencePlayCount(sentenceId: number): Promise<void>;
  recordPronunciationAttempt(
    sentenceId: number,
    similarityScore: number,
    expectedText: string,
    transcribedText: string,
    audioPath?: string | null
  ): Promise<void>;
  getPronunciationHistory(
    sentenceId: number,
    limit?: number
  ): Promise<
    Array<{
      id: number;
      sentenceId: number;
      similarityScore: number;
      expectedText: string;
      transcribedText: string;
      audioPath: string | null;
      createdAt: Date;
    }>
  >;

  // Dialogue variants management
  insertDialogueVariant(
    sentenceId: number,
    variantSentence: string,
    variantTranslation: string
  ): Promise<number>;
  getDialogueVariantsBySentenceId(sentenceId: number, limit?: number): Promise<DialogueVariant[]>;
  getDialogueVariantCount(sentenceId: number): Promise<number>;
  getDialogueVariantById(variantId: number): Promise<DialogueVariant | null>;
  updateDialogueVariantContinuation(
    variantId: number,
    continuationText: string,
    continuationTranslation: string,
    continuationAudio?: string
  ): Promise<void>;

  // Progress tracking
  updateLastStudied(wordId: number): Promise<void>;
  getStudyStats(language: string): Promise<StudyStats>;
  recordStudySession(wordsStudied: number): Promise<void>;
  getRecentStudySessions(
    limit?: number
  ): Promise<Array<{ id: number; wordsStudied: number; whenStudied: Date }>>;

  // Quiz-specific operations
  getWeakestWords(limit: number, language: string): Promise<Word[]>;
  getRandomSentenceForWord(wordId: number): Promise<Sentence | null>;

  // Dialog-specific operations
  getRandomDialogSentence(language: string): Promise<Sentence | null>;
  getRandomDialogSentences(count: number, language: string): Promise<Sentence[]>;

  // Settings management
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  getCurrentLanguage(): Promise<string>;
  setCurrentLanguage(language: string): Promise<void>;
  getAvailableLanguages(): Promise<string[]>;
  getLanguageStats(): Promise<
    Array<{
      language: string;
      totalWords: number;
      studiedWords: number;
      averagePronunciationScore: number | null;
      pronunciationAttemptCount: number;
    }>
  >;
  lookupDictionary(word: string, language: string): Promise<DictionaryEntry[]>;
  updateWordProcessingStatus(wordId: number, status: WordProcessingStatus): Promise<void>;
  getWordProcessingInfo(
    wordId: number
  ): Promise<{ processingStatus: WordProcessingStatus; sentenceCount: number } | null>;
  getWordGenerationQueueSummary(language?: string): Promise<{
    queued: number;
    processing: number;
    failed: number;
    queuedWords: JobWordInfo[];
    processingWords: JobWordInfo[];
  }>;

  // Word generation queue
  enqueueWordGeneration(
    wordId: number,
    language: string,
    topic?: string,
    desiredSentenceCount?: number
  ): Promise<void>;
  getNextWordGenerationJob(): Promise<WordGenerationJob | null>;
  markWordGenerationJobProcessing(jobId: number): Promise<void>;
  rescheduleWordGenerationJob(jobId: number, delayMs: number, lastError?: string): Promise<void>;
  completeWordGenerationJob(jobId: number): Promise<void>;
  failWordGenerationJob(jobId: number, error: string): Promise<void>;

  // Flow feature operations
  getFlowSentences(language: string): Promise<
    Array<{
      sentence: Sentence;
      words: Word[];
      beforeSentenceAudio?: string;
      afterSentenceAudio?: string;
      continuationAudios: string[];
    }>
  >;

  // Scoring-specific operations
  getNewWordCount(language: string): Promise<number>;
  getWeakWordCount(language: string): Promise<number>;
  getDialogueReadinessRatio(language: string, minStrength?: number): Promise<number>;
  getAveragePronunciationScore(language: string): Promise<number>;
  getAvailableSentencesCount(language: string): Promise<number>;
  getTimeSinceLastActivePractice(language: string): Promise<number>;

  // Database lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;

  // Language progress reset
  resetLanguageProgress(language: string): Promise<void>;

  // Topic word counts
  getTopicWordCounts(language: string): Promise<Array<{ topic: string; count: number }>>;

  // Tracking operations
  recordSRSAdjustment(data: {
    wordId: number;
    sessionId?: number;
    recallRating?: number;
    strengthDelta: number;
    language: string;
  }): Promise<number>;

  createLearningSession(data: {
    mode: 'learning' | 'quiz' | 'dialog' | 'flow';
    language: string;
  }): Promise<number>;

  updateLearningSession(
    sessionId: number,
    data: {
      wordCount?: number;
      sentenceCount?: number;
      audioPlayedCount?: number;
    }
  ): Promise<void>;

  getLearningSession(sessionId: number): Promise<{
    id: number;
    mode: string;
    language: string;
    startedAt: Date;
  } | null>;

  recordAudioPlayback(data: {
    sessionId?: number;
    sentenceId?: number;
    audioPath: string;
    language: string;
    mode: 'learning' | 'quiz' | 'dialog' | 'flow';
    playbackSpeed?: number;
  }): Promise<number>;

  recordNeglectedWords(
    data: Array<{
      word: string;
      language: string;
      topic?: string;
      translation?: string;
      sessionId?: number;
      frequencyPosition?: number;
    }>
  ): Promise<number>;

  recordDictionaryHover(data: {
    word: string;
    language: string;
    sentenceId?: number;
    sessionId?: number;
    hoverDurationMs: number;
    dictionaryKey?: string;
    foundInDict: boolean;
  }): Promise<number>;

  // Process frequently looked-up words from dictionary hovers
  processFrequentlyLookedUpWords(
    language: string,
    minHoverCount?: number,
    lookbackDays?: number
  ): Promise<number>;
}

export interface DatabaseConfig {
  databasePath: string;
  enableWAL?: boolean;
  timeout?: number;
}
