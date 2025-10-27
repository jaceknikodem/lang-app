import { Word } from '../../shared/types/core.js';
import { SRSReviewResult } from './srs-algorithm.js';

export type SchedulerEngineName = 'classic' | 'fsrs';

export interface SchedulerEngineUpdate {
  nextDue: Date;
  strength: number;
  intervalDays: number;
  easeFactor: number;
  fsrsDifficulty?: number;
  fsrsStability?: number;
  fsrsLapses?: number;
  fsrsLastRating?: number | null;
  fsrsVersion?: string;
}

export interface SchedulerEngine {
  readonly name: SchedulerEngineName;
  initialize(now: Date): SchedulerEngineUpdate;
  update(word: Word, review: SRSReviewResult, now: Date): SchedulerEngineUpdate;
  isDue(word: Word, now: Date): boolean;
  sortByPriority(words: Word[], now: Date): Word[];
}
