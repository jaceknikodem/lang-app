import { Word } from '../../shared/types/core.js';
import { SchedulerEngine, SchedulerEngineUpdate } from './engine.js';
import { SRSReviewResult } from './srs-algorithm.js';

const MS_IN_DAY = 1000 * 60 * 60 * 24;
const DEFAULT_DIFFICULTY = 5;
const DEFAULT_STABILITY = 1;
const MAX_DIFFICULTY = 10;
const MIN_DIFFICULTY = 1;
const DIFFICULTY_ADJUSTMENTS: Record<0 | 1 | 2 | 3, number> = {
  0: -1.0,
  1: -0.4,
  2: 0,
  3: 0.3
};
const TARGET_RETENTION: Record<0 | 1 | 2 | 3, number> = {
  0: 0.5,
  1: 0.8,
  2: 0.9,
  3: 0.95
};
const STRENGTH_DELTA: Record<0 | 1 | 2 | 3, number> = {
  0: -30,
  1: 5,
  2: 15,
  3: 25
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function diffInDays(start: Date | undefined, end: Date): number {
  if (!start) {
    return 0;
  }
  return Math.max(0, (end.getTime() - start.getTime()) / MS_IN_DAY);
}

export class FsrsEngine implements SchedulerEngine {
  readonly name = 'fsrs' as const;

  initialize(now: Date): SchedulerEngineUpdate {
    const nextDue = new Date(now);
    nextDue.setDate(now.getDate() + 1);

    return {
      nextDue,
      strength: 20,
      intervalDays: 1,
      easeFactor: 2.5,
      fsrsDifficulty: DEFAULT_DIFFICULTY,
      fsrsStability: DEFAULT_STABILITY,
      fsrsLapses: 0,
      fsrsLastRating: null,
      fsrsVersion: 'fsrs-baseline'
    };
  }

  update(word: Word, review: SRSReviewResult, now: Date): SchedulerEngineUpdate {
    const recall = review.recall;
    const previousDifficulty = word.fsrsDifficulty ?? DEFAULT_DIFFICULTY;
    const previousStability = Math.max(word.fsrsStability ?? DEFAULT_STABILITY, 0.1);
    const elapsedDays = diffInDays(word.lastReview ?? word.lastStudied, now);
    const retrievability = Math.exp(-elapsedDays / previousStability);

    const difficultyAdjustment = DIFFICULTY_ADJUSTMENTS[recall];
    const newDifficulty = clamp(previousDifficulty + difficultyAdjustment, MIN_DIFFICULTY, MAX_DIFFICULTY);

    let lapses = word.fsrsLapses ?? 0;
    let newStability: number;

    if (!word.lastReview) {
      // Treat as learning phase
      const base = recall === 0 ? 0.8 : recall === 1 ? 1.2 : recall === 2 ? 2.5 : 4.0;
      newStability = base;
      if (recall === 0) {
        lapses += 1;
      }
    } else if (recall === 0) {
      lapses += 1;
      newStability = Math.max(0.4, previousStability * 0.35);
    } else {
      const growthFactor = recall === 1 ? 0.6 : recall === 2 ? 1.0 : 1.4;
      const difficultyFactor = Math.exp(-(newDifficulty - 5) / 6);
      const stabilityGain = previousStability * growthFactor * difficultyFactor * (1 - retrievability);
      newStability = clamp(previousStability + stabilityGain, 0.4, previousStability * (1 + growthFactor * 1.2));
    }

    const targetRetention = TARGET_RETENTION[recall];
    const scheduledIntervalDays =
      recall === 0
        ? 1
        : Math.max(1, Math.round(-newStability * Math.log(targetRetention)));

    const intervalWithFuzz = this.applyIntervalFuzz(scheduledIntervalDays, recall);

    const nextDue = new Date(now);
    nextDue.setDate(now.getDate() + intervalWithFuzz);

    const newStrength = clamp(
      (word.strength ?? 20) + STRENGTH_DELTA[recall],
      0,
      100
    );

    const easeFactor = clamp(1.3 + (10 - newDifficulty) * 0.12, 1.3, 3.0);

    return {
      nextDue,
      strength: newStrength,
      intervalDays: intervalWithFuzz,
      easeFactor,
      fsrsDifficulty: newDifficulty,
      fsrsStability: newStability,
      fsrsLapses: lapses,
      fsrsLastRating: recall,
      fsrsVersion: 'fsrs-baseline'
    };
  }

  isDue(word: Word, now: Date): boolean {
    return word.nextDue <= now;
  }

  sortByPriority(words: Word[], now: Date): Word[] {
    return [...words].sort((a, b) => {
      const priorityA = this.computePriorityScore(a, now);
      const priorityB = this.computePriorityScore(b, now);
      return priorityB - priorityA;
    });
  }

  private computePriorityScore(word: Word, now: Date): number {
    const stability = Math.max(word.fsrsStability ?? DEFAULT_STABILITY, 0.1);
    const difficulty = word.fsrsDifficulty ?? DEFAULT_DIFFICULTY;
    const overdueDays = (now.getTime() - word.nextDue.getTime()) / MS_IN_DAY;
    const elapsedSinceReview = diffInDays(word.lastReview ?? word.lastStudied, now);
    const retrievability = Math.exp(-elapsedSinceReview / stability);
    const dueBonus = overdueDays > 0 ? overdueDays + 1 : 0;
    const futurePenalty = overdueDays <= 0 ? -retrievability : 0;
    const stabilityPenalty = stability / 10;
    const difficultyBonus = (10 - difficulty) / 10;
    const lapsePenalty = (word.fsrsLapses ?? 0) * 0.2;

    return dueBonus + futurePenalty + difficultyBonus - stabilityPenalty - lapsePenalty;
  }

  private applyIntervalFuzz(intervalDays: number, recall: 0 | 1 | 2 | 3): number {
    if (intervalDays <= 1) {
      return intervalDays;
    }

    const fuzzRange = recall === 3 ? 0.15 : recall === 2 ? 0.1 : 0.05;
    const min = intervalDays * (1 - fuzzRange);
    const max = intervalDays * (1 + fuzzRange);
    const fuzzed = Math.round(this.randomInRange(min, max));

    return Math.max(1, fuzzed);
  }

  private randomInRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }
}
