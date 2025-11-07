/**
 * Scoring service for calculating priority scores for learning modes
 * Scores help prioritize which mode the user should engage with
 */

import { DatabaseLayer } from '../../shared/types/database.js';
import { ModeScores } from '../../shared/types/core.js';

export class ScoringService {
  private database: DatabaseLayer;
  private previousMode: 'topic-selection' | 'learning' | 'quiz' | 'dialog' | 'flow' | null = null;

  constructor(database: DatabaseLayer) {
    this.database = database;
  }

  /**
   * Calculate score for Add Words mode
   * Input: number of new words (where lastStudied IS NULL)
   * Logic: score = max(0, 10 - 0.7 * new_word_count)
   * Meaning: score = 10 when zero new words (high need to add), drops to 0 at ~20 new words
   */
  async calculateAddWordsScore(language: string): Promise<number> {
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
  async calculateReviewScore(language: string): Promise<number> {
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
  async calculateQuizScore(language: string): Promise<number> {
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
  async calculateDialogScore(language: string): Promise<number> {
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
  async calculateFlowScore(language: string): Promise<number> {
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
  async calculateAllScores(language: string): Promise<ModeScores> {
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
   * Get the next recommended mode based on scores with navigation decision logic
   * Returns the next mode to navigate to, along with a ranked list of all modes by score.
   * 
   * This method tracks the previous mode internally to prevent bouncing between modes.
   * It excludes the previous mode from selection, and only returns a mode if the highest scoring mode
   * is different from the current mode and at least 1 point better (unless initialTakeover is true).
   * Topic-selection is always excluded from navigation.
   * The current mode is included in consideration, allowing users to stay in the same mode when it has the highest score.
   */
  async getNextMode(options: {
    currentMode: 'topic-selection' | 'learning' | 'quiz' | 'dialog' | 'flow' | null;
    language: string | null;
    initialTakeover: boolean;
  }): Promise<{
    nextMode: 'learning' | 'quiz' | 'dialog' | 'flow' | null;
    rankedModes: Array<'topic-selection' | 'learning' | 'quiz' | 'dialog' | 'flow'>;
  }> {
    try {
      const currentMode = options.currentMode ?? undefined;
      const language = options.language ?? await this.database.getCurrentLanguage();
      const initialTakeover = options.initialTakeover;

      // Calculate scores internally (never exposed)
      const scores = await this.calculateAllScores(language);

      // Map scores to modes
      const modeScores = [
        { mode: 'topic-selection' as const, score: scores.addWords },
        { mode: 'learning' as const, score: scores.review },
        { mode: 'quiz' as const, score: scores.quiz },
        { mode: 'dialog' as const, score: scores.dialog },
        { mode: 'flow' as const, score: scores.flow }
      ];

      // Get current mode score
      const currentModeScore = currentMode 
        ? (modeScores.find(m => m.mode === currentMode)?.score ?? 0)
        : 0;

      // Build exclude modes list - always exclude previous mode and topic-selection
      // Always exclude topic-selection from navigation (we'll handle it separately via auto-add)
      // Note: current mode is NOT excluded - we want to allow staying in the same mode if it has the highest score
      const excludeModes: Array<'topic-selection' | 'learning' | 'quiz' | 'dialog' | 'flow'> = ['topic-selection'];
      
      if (this.previousMode) {
        excludeModes.push(this.previousMode);
      }

      // Create ranked list of all modes by score (descending) - do this before filtering
      const allModeScores = [
        { mode: 'topic-selection' as const, score: scores.addWords },
        { mode: 'learning' as const, score: scores.review },
        { mode: 'quiz' as const, score: scores.quiz },
        { mode: 'dialog' as const, score: scores.dialog },
        { mode: 'flow' as const, score: scores.flow }
      ].sort((a, b) => b.score - a.score);
      
      const rankedModes = allModeScores.map(m => m.mode);

      // Filter out excluded modes
      const availableModes = modeScores.filter(m => !excludeModes.includes(m.mode));

      if (availableModes.length === 0) {
        return {
          nextMode: null,
          rankedModes
        };
      }

      // Sort by score descending and get the highest available mode
      availableModes.sort((a, b) => b.score - a.score);
      const highestMode = availableModes[0];

      // Only proceed if score > 0
      if (highestMode.score === 0) {
        return {
          nextMode: null,
          rankedModes
        };
      }

      // Calculate score difference
      const scoreDifference = highestMode.score - currentModeScore;

      // Determine if navigation should happen
      // On initial takeover, navigate if there's any mode with score > 0, regardless of current mode
      // Otherwise, only navigate if highest mode is different from current mode AND score is at least 1 point higher
      // This allows staying in the same mode when it has the highest score
      const shouldNavigate = initialTakeover
        ? (highestMode.score > 0 && highestMode.mode !== currentMode)
        : (highestMode.score > 0 && highestMode.mode !== currentMode && scoreDifference >= 1);

      // Only return the mode if navigation should happen
      if (!shouldNavigate) {
        return {
          nextMode: null,
          rankedModes
        };
      }

      // Update previous mode when navigation will happen
      if (currentMode) {
        this.previousMode = currentMode;
      }

      // Log all scores in one line for debugging
      console.log(`Mode scores: topic-selection=${scores.addWords}, learning=${scores.review}, quiz=${scores.quiz}, dialog=${scores.dialog}, flow=${scores.flow} -> navigating to ${highestMode.mode}`);

      // highestMode.mode cannot be 'topic-selection' because it's excluded from availableModes
      return {
        nextMode: highestMode.mode as 'learning' | 'quiz' | 'dialog' | 'flow',
        rankedModes
      };
    } catch (error) {
      console.error('Error getting next mode:', error);
      return {
        nextMode: null,
        rankedModes: []
      };
    }
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
