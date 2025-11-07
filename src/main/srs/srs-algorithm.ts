/**
 * SRS (Spaced Repetition System) utility functions
 */

export interface SRSReviewResult {
  recall: 0 | 1 | 2 | 3; // 0=fail, 1=hard, 2=ok, 3=easy
}

export interface SRSUpdateResult {
  newStrength: number;
  newIntervalDays: number;
  newEaseFactor: number;
  nextDue: Date;
}

export class SRSAlgorithm {
  /**
   * Convert traditional quiz performance to SRS recall rating
   */
  static convertQuizPerformanceToRecall(
    correct: boolean,
    responseTime?: number,
    difficulty?: 'easy' | 'medium' | 'hard'
  ): SRSReviewResult {
    if (!correct) {
      return { recall: 0 }; // Failed
    }

    // If difficulty is explicitly provided, use it
    if (difficulty) {
      const difficultyMap = {
        hard: 1,
        medium: 2,
        easy: 3,
      } as const;
      return { recall: difficultyMap[difficulty] };
    }

    // If response time is available, use it to infer difficulty
    if (responseTime !== undefined) {
      if (responseTime < 3000) {
        // Less than 3 seconds
        return { recall: 3 }; // Easy
      } else if (responseTime < 8000) {
        // Less than 8 seconds
        return { recall: 2 }; // OK
      } else {
        return { recall: 1 }; // Hard
      }
    }

    // Default to "OK" if no additional info
    return { recall: 2 };
  }

  /**
   * Get recommended study batch size based on due words
   */
  static getRecommendedBatchSize(totalDueWords: number): number {
    if (totalDueWords <= 10) return totalDueWords;
    if (totalDueWords <= 25) return 15;
    if (totalDueWords <= 50) return 20;
    return 25; // Cap at 25 for manageable sessions
  }
}
