/**
 * Scoring service for calculating priority scores for learning modes
 * Scores help prioritize which mode the user should engage with
 */

import { DatabaseLayer } from '../../shared/types/database.js';
import { ModeScores } from '../../shared/types/core.js';

export class ScoringService {
  private database: DatabaseLayer;

  constructor(database: DatabaseLayer) {
    this.database = database;
  }

  /**
   * Calculate score for Add Words mode
   * Input: number of new words (where lastStudied IS NULL)
   * Logic: score = max(0, 10 - 0.7 * new_word_count)
   * Meaning: score = 10 when zero new words (high need to add), drops to 0 at ~20 new words
   */
  async calculateAddWordsScore(language?: string): Promise<number> {
    try {
      const newWordCount = await this.database.getNewWordCount(language);
      return Math.max(0, 10 - 0.7 * newWordCount);
    } catch (error) {
      console.error('Error calculating add words score:', error);
      return 0;
    }
  }

  /**
   * Calculate score for Review mode
   * Inputs: new_word_count, weak_word_count
   * Logic: score = clamp((0.4 * new_word_count) + (0.25 * weak_word_count), 0, 10)
   * Meaning: prioritizes review when many new or shaky words exist
   */
  async calculateReviewScore(language?: string): Promise<number> {
    try {
      const newWordCount = await this.database.getNewWordCount(language);
      const weakWordCount = await this.database.getWeakWordCount(language);
      const score = (0.4 * newWordCount) + (0.25 * weakWordCount);
      return this.clamp(score, 0, 10);
    } catch (error) {
      console.error('Error calculating review score:', error);
      return 0;
    }
  }

  /**
   * Calculate score for Quiz mode
   * Input: due_word_count (from FSRS)
   * Logic: score = min(10, due_word_count / 5)
   * Meaning: spikes when spaced-repetition items are due; falls when memory is fresh
   */
  async calculateQuizScore(language?: string): Promise<number> {
    try {
      const dueWordCount = await this.database.getWordsDueCount(language);
      return Math.min(10, dueWordCount / 5);
    } catch (error) {
      console.error('Error calculating quiz score:', error);
      return 0;
    }
  }

  /**
   * Calculate score for Dialog mode
   * Input: dialogue_readiness_ratio = known_vocab_in_cluster / total_vocab_in_cluster
   * Logic: score = 10 * dialogue_readiness_ratio
   * Meaning: only activates when the learner knows nearly all words in a dialogue cluster
   */
  async calculateDialogScore(language?: string): Promise<number> {
    try {
      const ratio = await this.database.getDialogueReadinessRatio(language, 50);
      return 10 * ratio;
    } catch (error) {
      console.error('Error calculating dialog score:', error);
      return 0;
    }
  }

  /**
   * Calculate score for Flow mode
   * Inputs: available_sentences_count, avg_pronunciation_score (0-10 scale), time_since_last_active_practice (hours)
   * Logic: score = clamp((available_sentences_count / 10) + (avg_pronunciation_score - 7) - (time_since_last_quiz_or_dialog / 10), 0, 10)
   * Meaning: rises with content richness and pronunciation strength, but drops the longer it's been since any active practice
   */
  async calculateFlowScore(language?: string): Promise<number> {
    try {
      const availableSentencesCount = await this.database.getAvailableSentencesCount(language);
      const avgPronunciationScore = await this.database.getAveragePronunciationScore(language);
      const timeSinceLastPractice = await this.database.getTimeSinceLastActivePractice(language);
      const score = (availableSentencesCount / 10) + (avgPronunciationScore - 7) - (timeSinceLastPractice / 10);
      return this.clamp(score, 0, 10);
    } catch (error) {
      console.error('Error calculating flow score:', error);
      return 0;
    }
  }

  /**
   * Calculate all mode scores
   */
  async calculateAllScores(language?: string): Promise<ModeScores> {
    const [addWords, review, quiz, dialog, flow] = await Promise.all([
      this.calculateAddWordsScore(language),
      this.calculateReviewScore(language),
      this.calculateQuizScore(language),
      this.calculateDialogScore(language),
      this.calculateFlowScore(language)
    ]);

    return {
      addWords,
      review,
      quiz,
      dialog,
      flow
    };
  }

  /**
   * Start the scoring service (scores are now calculated on-demand via IPC)
   */
  start(): void {
    // Scoring service is now used on-demand via IPC handlers
    // No periodic logging needed
  }

  /**
   * Stop the scoring service
   */
  stop(): void {
    // No cleanup needed - service is used on-demand
  }

  /**
   * Clamp a value between min and max
   */
  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }
}
