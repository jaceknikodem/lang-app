/**
 * SRS Service - High-level interface for spaced repetition functionality
 */

import { DatabaseLayer } from '../../shared/types/database.js';
import { Word } from '../../shared/types/core.js';
import { SRSAlgorithm, SRSReviewResult } from './srs-algorithm.js';
import { ClassicSrsEngine } from './classic-engine.js';
import { FsrsEngine } from './fsrs-engine.js';
import { SchedulerEngine, SchedulerEngineName, SchedulerEngineUpdate } from './engine.js';

type UpdateWordSRSOptions = Parameters<DatabaseLayer['updateWordSRS']>[5];

export class SRSService {
  private readonly engines: Record<SchedulerEngineName, SchedulerEngine>;

  constructor(private database: DatabaseLayer) {
    this.engines = {
      classic: new ClassicSrsEngine(),
      fsrs: new FsrsEngine()
    };
  }

  /**
   * Process a word review and update SRS values
   */
  async processReview(wordId: number, reviewResult: SRSReviewResult): Promise<void> {
    const engine = await this.getActiveEngine();
    await this.processReviewWithEngine(wordId, reviewResult, engine, new Date());
  }

  /**
   * Process quiz results and update multiple words
   */
  async processQuizResults(results: Array<{
    wordId: number;
    correct: boolean;
    responseTime?: number;
    difficulty?: 'easy' | 'medium' | 'hard';
  }>): Promise<void> {
    if (results.length === 0) {
      return;
    }

    const engine = await this.getActiveEngine();

    for (const result of results) {
      const reviewResult = SRSAlgorithm.convertQuizPerformanceToRecall(
        result.correct,
        result.responseTime,
        result.difficulty
      );

      await this.processReviewWithEngine(result.wordId, reviewResult, engine, new Date());
    }
  }

  /**
   * Get words for today's study session
   */
  async getTodaysStudyWords(maxWords?: number, language?: string): Promise<Word[]> {
    const dueCount = await this.database.getWordsDueCount(language);
    const recommendedBatch = SRSAlgorithm.getRecommendedBatchSize(dueCount);
    const limit = maxWords ? Math.min(maxWords, recommendedBatch) : recommendedBatch;

    const engine = await this.getActiveEngine();
    const fetchLimit =
      engine.name === 'fsrs'
        ? Math.max(Math.min(limit * 3, limit + 50), limit)
        : limit;
    const dueWords = await this.database.getWordsDueWithPriority(fetchLimit, language);

    return engine.sortByPriority(dueWords, new Date()).slice(0, limit);
  }

  /**
   * Get SRS dashboard statistics
   */
  async getDashboardStats(language?: string): Promise<{
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
    const engine = await this.getActiveEngine();
    const initValues = engine.initialize(new Date());

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
  async getOverdueWords(language?: string): Promise<Word[]> {
    const engine = await this.getActiveEngine();
    const allDue = await this.database.getWordsDueForReview(undefined, language);
    const now = new Date();

    return allDue.filter(word => engine.isDue(word, now));
  }

  /**
   * Bulk initialize SRS values for existing words (migration helper)
   */
  async initializeExistingWords(language?: string): Promise<number> {
    const words = await this.database.getAllWords(false, false, language);
    const engine = await this.getActiveEngine();
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

      const initValues = engine.initialize(now);

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
    now: Date
  ): Promise<void> {
    const word = await this.database.getWordById(wordId);
    if (!word) {
      throw new Error(`Word with ID ${wordId} not found`);
    }

    console.log(`[SRS Service] Processing review for word "${word.word}" (ID: ${wordId})`);
    console.log(`[SRS Service] Using engine: ${engine.name}`);
    console.log(`[SRS Service] Review result: recall=${reviewResult.recall} (${reviewResult.recall === 0 ? 'Failed' : reviewResult.recall === 1 ? 'Hard' : reviewResult.recall === 2 ? 'Good' : 'Easy'})`);

    const update = engine.update(word, reviewResult, now);

    console.log(`[SRS Service] Saving update to database for word "${word.word}" (ID: ${wordId})`);
    
    await this.database.updateWordSRS(
      wordId,
      update.strength,
      update.intervalDays,
      update.easeFactor,
      update.nextDue,
      this.extractFsrsOptions(update)
    );

    console.log(`[SRS Service] Successfully saved SRS update for word "${word.word}" (ID: ${wordId})\n`);
  }

  private async getActiveEngine(): Promise<SchedulerEngine> {
    try {
      const preference = await this.database.getSetting('srs_algorithm');
      if (preference && this.isValidEngineName(preference)) {
        return this.engines[preference];
      }
    } catch (error) {
      console.warn('Failed to load SRS engine preference; defaulting to classic algorithm:', error);
    }

    return this.engines.classic;
  }

  private isValidEngineName(value: string): value is SchedulerEngineName {
    return value === 'classic' || value === 'fsrs';
  }

  private extractFsrsOptions(update: SchedulerEngineUpdate): UpdateWordSRSOptions {
    const {
      fsrsDifficulty,
      fsrsStability,
      fsrsLapses,
      fsrsLastRating,
      fsrsVersion
    } = update;

    const hasFsrsValues =
      fsrsDifficulty !== undefined ||
      fsrsStability !== undefined ||
      fsrsLapses !== undefined ||
      fsrsLastRating !== undefined ||
      fsrsVersion !== undefined;

    if (!hasFsrsValues) {
      return undefined;
    }

    return {
      fsrsDifficulty,
      fsrsStability,
      fsrsLapses,
      fsrsLastRating: fsrsLastRating ?? null,
      fsrsVersion
    };
  }
}
