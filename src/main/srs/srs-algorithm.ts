/**
 * Spaced Repetition System (SRS) Algorithm Implementation
 * Based on simplified Anki-style algorithm with practical optimizations
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
   * Initialize SRS values for a new word
   */
  static initializeWord(): {
    strength: number;
    intervalDays: number;
    easeFactor: number;
    nextDue: Date;
  } {
    const now = new Date();
    const nextDue = new Date(now);
    nextDue.setDate(now.getDate() + 1); // Due tomorrow

    return {
      strength: 20,
      intervalDays: 1,
      easeFactor: 2.5,
      nextDue
    };
  }

  /**
   * Update SRS values based on review performance
   */
  static updateAfterReview(
    currentStrength: number,
    currentIntervalDays: number,
    currentEaseFactor: number,
    lastReview: Date | undefined,
    nextDue: Date,
    reviewResult: SRSReviewResult
  ): SRSUpdateResult {
    const now = new Date();
    const { recall } = reviewResult;

    // Calculate how late the review is
    const daysLate = Math.max(0, Math.floor((now.getTime() - nextDue.getTime()) / (1000 * 60 * 60 * 24)));
    const latenessMultiplier = Math.max(1.0, 1 + daysLate / currentIntervalDays);

    let newStrength = currentStrength;
    let newIntervalDays = currentIntervalDays;
    let newEaseFactor = currentEaseFactor;

    if (recall === 0) {
      // Failed recall - reset interval and reduce ease factor
      newIntervalDays = 1;
      newEaseFactor = Math.max(1.3, currentEaseFactor - 0.2);
      newStrength = Math.max(0, currentStrength - 20);
    } else {
      // Successful recall - increase interval and adjust ease factor
      const easeDeltas = [0, 0, 0.1, 0.15]; // For recall values 0, 1, 2, 3
      newEaseFactor = currentEaseFactor + easeDeltas[recall];
      
      // Calculate new interval with lateness penalty
      newIntervalDays = Math.round(
        (currentIntervalDays * newEaseFactor) * (1 + 0.1 * latenessMultiplier)
      );
      
      // Ensure minimum interval progression
      newIntervalDays = Math.max(newIntervalDays, currentIntervalDays + 1);
      
      // Update strength based on performance
      newStrength = Math.min(100, currentStrength + 20 * recall);
    }

    // Calculate next due date
    const newNextDue = new Date(now);
    newNextDue.setDate(now.getDate() + newIntervalDays);

    return {
      newStrength,
      newIntervalDays,
      newEaseFactor,
      nextDue: newNextDue
    };
  }

  /**
   * Determine if a word is due for review
   */
  static isDue(nextDue: Date): boolean {
    const now = new Date();
    return nextDue <= now;
  }

  /**
   * Get words that are due for review, sorted by priority
   * Priority: overdue words first (by how overdue), then by strength (weakest first)
   */
  static sortWordsByReviewPriority(words: Array<{
    id: number;
    strength: number;
    nextDue: Date;
  }>): Array<{ id: number; priority: number }> {
    const now = new Date();
    
    return words
      .map(word => {
        const daysOverdue = Math.max(0, 
          Math.floor((now.getTime() - word.nextDue.getTime()) / (1000 * 60 * 60 * 24))
        );
        
        // Priority calculation:
        // - Overdue words get higher priority (more overdue = higher priority)
        // - Among words due today, lower strength = higher priority
        // - Future words get negative priority
        let priority: number;
        
        if (daysOverdue > 0) {
          // Overdue: priority increases with days overdue, modified by strength
          priority = 1000 + daysOverdue * 10 + (100 - word.strength);
        } else if (word.nextDue <= now) {
          // Due today: priority based on inverse strength
          priority = 100 - word.strength;
        } else {
          // Future: negative priority (shouldn't be selected)
          const daysFuture = Math.floor((word.nextDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          priority = -daysFuture;
        }
        
        return {
          id: word.id,
          priority
        };
      })
      .sort((a, b) => b.priority - a.priority); // Higher priority first
  }

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
        'hard': 1,
        'medium': 2,
        'easy': 3
      } as const;
      return { recall: difficultyMap[difficulty] };
    }

    // If response time is available, use it to infer difficulty
    if (responseTime !== undefined) {
      if (responseTime < 3000) { // Less than 3 seconds
        return { recall: 3 }; // Easy
      } else if (responseTime < 8000) { // Less than 8 seconds
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