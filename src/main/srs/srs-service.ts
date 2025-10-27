/**
 * SRS Service - High-level interface for spaced repetition functionality
 */

import { DatabaseLayer } from '../../shared/types/database.js';
import { Word } from '../../shared/types/core.js';
import { SRSAlgorithm, SRSReviewResult } from './srs-algorithm.js';

export class SRSService {
  constructor(private database: DatabaseLayer) {}

  /**
   * Process a word review and update SRS values
   */
  async processReview(wordId: number, reviewResult: SRSReviewResult): Promise<void> {
    const word = await this.database.getWordById(wordId);
    if (!word) {
      throw new Error(`Word with ID ${wordId} not found`);
    }

    // Calculate new SRS values
    const update = SRSAlgorithm.updateAfterReview(
      word.strength,
      word.intervalDays,
      word.easeFactor,
      word.lastReview,
      word.nextDue,
      reviewResult
    );

    // Update database
    await this.database.updateWordSRS(
      wordId,
      update.newStrength,
      update.newIntervalDays,
      update.newEaseFactor,
      update.nextDue
    );
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
    for (const result of results) {
      const reviewResult = SRSAlgorithm.convertQuizPerformanceToRecall(
        result.correct,
        result.responseTime,
        result.difficulty
      );
      
      await this.processReview(result.wordId, reviewResult);
    }
  }

  /**
   * Get words for today's study session
   */
  async getTodaysStudyWords(maxWords?: number, language?: string): Promise<Word[]> {
    const dueCount = await this.database.getWordsDueCount(language);
    const recommendedBatch = SRSAlgorithm.getRecommendedBatchSize(dueCount);
    const limit = maxWords ? Math.min(maxWords, recommendedBatch) : recommendedBatch;
    
    return await this.database.getWordsDueWithPriority(limit, language);
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
    const initValues = SRSAlgorithm.initializeWord();
    
    await this.database.updateWordSRS(
      wordId,
      initValues.strength,
      initValues.intervalDays,
      initValues.easeFactor,
      initValues.nextDue
    );
  }

  /**
   * Get words that are overdue (for prioritization)
   */
  async getOverdueWords(language?: string): Promise<Word[]> {
    const allDue = await this.database.getWordsDueForReview(undefined, language);
    const now = new Date();
    
    return allDue.filter(word => {
      const daysOverdue = Math.floor((now.getTime() - word.nextDue.getTime()) / (1000 * 60 * 60 * 24));
      return daysOverdue > 0;
    });
  }

  /**
   * Bulk initialize SRS values for existing words (migration helper)
   */
  async initializeExistingWords(language?: string): Promise<number> {
    const words = await this.database.getAllWords(false, false, language);
    let updatedCount = 0;
    
    for (const word of words) {
      // Only initialize if SRS values are at defaults
      if (word.intervalDays === 1 && word.easeFactor === 2.5 && !word.lastReview) {
        const initValues = SRSAlgorithm.initializeWord();
        
        await this.database.updateWordSRS(
          word.id,
          initValues.strength,
          initValues.intervalDays,
          initValues.easeFactor,
          initValues.nextDue
        );
        
        updatedCount++;
      }
    }
    
    return updatedCount;
  }
}