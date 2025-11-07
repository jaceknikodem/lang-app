/**
 * SRS Service - High-level interface for spaced repetition functionality
 */

import { DatabaseLayer } from '../../shared/types/database.js';
import { Word } from '../../shared/types/core.js';
import { SRSAlgorithm, SRSReviewResult } from './srs-algorithm.js';
import { FsrsEngine } from './fsrs-engine.js';
import { SchedulerEngine, SchedulerEngineName, SchedulerEngineUpdate } from './engine.js';

type UpdateWordSRSOptions = Parameters<DatabaseLayer['updateWordSRS']>[5];

export class SRSService {
  private readonly engine: SchedulerEngine;

  constructor(private database: DatabaseLayer) {
    this.engine = new FsrsEngine();
  }

  /**
   * Process a word review and update SRS values
   */
  async processReview(wordId: number, reviewResult: SRSReviewResult): Promise<void> {
    await this.processReviewWithEngine(wordId, reviewResult, this.engine, new Date());
  }

  /**
   * Process quiz results and update multiple words
   */
  async processQuizResults(results: Array<{
    wordId: number;
    correct: boolean;
    responseTime?: number;
    difficulty?: 'easy' | 'medium' | 'hard';
  }>, language: string, sessionId?: number): Promise<void> {
    if (results.length === 0) {
      return;
    }

    for (const result of results) {
      const reviewResult = SRSAlgorithm.convertQuizPerformanceToRecall(
        result.correct,
        result.responseTime,
        result.difficulty
      );

      await this.processReviewWithEngine(result.wordId, reviewResult, this.engine, new Date(), true, language, sessionId);
    }
  }

  /**
   * Get words for today's study session
   */
  async getTodaysStudyWords(language: string, maxWords?: number): Promise<Word[]> {
    const dueCount = await this.database.getWordsDueCount(language);
    const recommendedBatch = SRSAlgorithm.getRecommendedBatchSize(dueCount);
    const limit = maxWords ? Math.min(maxWords, recommendedBatch) : recommendedBatch;

    const fetchLimit = Math.max(Math.min(limit * 3, limit + 50), limit);
    const dueWords = await this.database.getWordsDueWithPriority(language, fetchLimit);

    return this.engine.sortByPriority(dueWords, new Date()).slice(0, limit);
  }

  /**
   * Get SRS dashboard statistics
   */
  async getDashboardStats(language: string): Promise<{
    totalWords: number;
    dueToday: number;
    overdue: number;
    averageInterval: number;
    averageEaseFactor: number;
    recommendedStudySize: number;
  }> {
    const stats = await this.database.getSRSStats(language);
    const recommendedStudySize = SRSAlgorithm.getRecommendedBatchSize(stats.dueToday);

    return {
      ...stats,
      recommendedStudySize
    };
  }

  /**
   * Mark a word as easy/hard during learning (not quiz)
   */
  async markWordDifficulty(wordId: number, difficulty: 'easy' | 'hard'): Promise<void> {
    const reviewResult: SRSReviewResult = {
      recall: difficulty === 'easy' ? 3 : 1
    };

    await this.processReview(wordId, reviewResult);
  }

  /**
   * Reset a word's SRS progress (useful for words marked as "unknown" again)
   */
  async resetWordProgress(wordId: number): Promise<void> {
    const initValues = this.engine.initialize(new Date());

    await this.database.updateWordSRS(
      wordId,
      initValues.strength,
      initValues.intervalDays,
      initValues.easeFactor,
      initValues.nextDue,
      this.extractFsrsOptions(initValues)
    );
  }

  /**
   * Get words that are overdue (for prioritization)
   */
  async getOverdueWords(language: string): Promise<Word[]> {
    const allDue = await this.database.getWordsDueForReview(language);
    const now = new Date();

    return allDue.filter(word => this.engine.isDue(word, now));
  }

  /**
   * Bulk initialize SRS values for existing words (migration helper)
   */
  async initializeExistingWords(language: string): Promise<number> {
    const words = await this.database.getAllWords(language, false, false);
    const now = new Date();
    let updatedCount = 0;

    for (const word of words) {
      const shouldInitialize =
        (word.intervalDays === 1 && word.easeFactor === 2.5 && !word.lastReview) ||
        word.fsrsDifficulty === undefined ||
        word.fsrsStability === undefined;

      if (!shouldInitialize) {
        continue;
      }

      const initValues = this.engine.initialize(now);

      await this.database.updateWordSRS(
        word.id,
        initValues.strength,
        initValues.intervalDays,
        initValues.easeFactor,
        initValues.nextDue,
        this.extractFsrsOptions(initValues)
      );

      updatedCount++;
    }

    return updatedCount;
  }

  private async processReviewWithEngine(
    wordId: number,
    reviewResult: SRSReviewResult,
    engine: SchedulerEngine,
    now: Date,
    isQuiz: boolean = false,
    language?: string,
    sessionId?: number
  ): Promise<void> {
    const word = await this.database.getWordById(wordId);
    if (!word) {
      throw new Error(`Word with ID ${wordId} not found`);
    }

    const previousStrength = word.strength;

    console.log(`[SRS Service] Processing review for word "${word.word}" (ID: ${wordId})`);
    console.log(`[SRS Service] Using engine: ${this.engine.name}`);
    console.log(`[SRS Service] Review result: recall=${reviewResult.recall} (${reviewResult.recall === 0 ? 'Failed' : reviewResult.recall === 1 ? 'Hard' : reviewResult.recall === 2 ? 'Good' : 'Easy'})`);

    const update = this.engine.update(word, reviewResult, now);

    console.log(`[SRS Service] Saving update to database for word "${word.word}" (ID: ${wordId})`);
    
    await this.database.updateWordSRS(
      wordId,
      update.strength,
      update.intervalDays,
      update.easeFactor,
      update.nextDue,
      this.extractFsrsOptions(update)
    );

    // Record SRS adjustment only in quiz mode
    if (isQuiz && language) {
      try {
        const strengthDelta = update.strength - previousStrength;
        await this.database.recordSRSAdjustment({
          wordId,
          sessionId,
          recallRating: reviewResult.recall,
          strengthDelta,
          language
        });
        const ratingText = reviewResult.recall === 0 ? 'failed' : reviewResult.recall === 1 ? 'hard' : reviewResult.recall === 2 ? 'good' : 'easy';
        console.log(`[Tracking] Quiz performance: wordId=${wordId}, recall=${ratingText}, strengthDelta=${strengthDelta > 0 ? '+' : ''}${strengthDelta}, sessionId=${sessionId || 'none'}`);
      } catch (error) {
        console.warn(`[SRS Service] Failed to record SRS adjustment:`, error);
      }
    }

    console.log(`[SRS Service] Successfully saved SRS update for word "${word.word}" (ID: ${wordId})\n`);
  }


  private extractFsrsOptions(update: SchedulerEngineUpdate): UpdateWordSRSOptions {
    const {
      fsrsDifficulty,
      fsrsStability,
      fsrsLapses,
      fsrsLastRating
    } = update;

    const hasFsrsValues =
      fsrsDifficulty !== undefined ||
      fsrsStability !== undefined ||
      fsrsLapses !== undefined ||
      fsrsLastRating !== undefined;

    if (!hasFsrsValues) {
      return undefined;
    }

    return {
      fsrsDifficulty,
      fsrsStability,
      fsrsLapses,
      fsrsLastRating: fsrsLastRating ?? null
    };
  }
}
