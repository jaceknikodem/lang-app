import { Word } from '../../shared/types/core.js';
import { SRSAlgorithm, SRSReviewResult } from './srs-algorithm.js';
import { SchedulerEngine, SchedulerEngineUpdate } from './engine.js';

export class ClassicSrsEngine implements SchedulerEngine {
  readonly name = 'classic' as const;

  initialize(_: Date = new Date()): SchedulerEngineUpdate {
    const init = SRSAlgorithm.initializeWord();
    return {
      strength: init.strength,
      intervalDays: init.intervalDays,
      easeFactor: init.easeFactor,
      nextDue: init.nextDue
    };
  }

  update(word: Word, review: SRSReviewResult, _now: Date = new Date()): SchedulerEngineUpdate {
    const update = SRSAlgorithm.updateAfterReview(
      word.strength,
      word.intervalDays,
      word.easeFactor,
      word.lastReview,
      word.nextDue,
      review
    );

    return {
      strength: update.newStrength,
      intervalDays: update.newIntervalDays,
      easeFactor: update.newEaseFactor,
      nextDue: update.nextDue
    };
  }

  isDue(word: Word, _now: Date = new Date()): boolean {
    return SRSAlgorithm.isDue(word.nextDue);
  }

  sortByPriority(words: Word[], _now: Date = new Date()): Word[] {
    const priorities = SRSAlgorithm.sortWordsByReviewPriority(
      words.map(word => ({
        id: word.id,
        strength: word.strength,
        nextDue: word.nextDue
      }))
    );

    const wordMap = new Map(words.map(word => [word.id, word]));
    return priorities
      .map(priority => wordMap.get(priority.id))
      .filter((word): word is Word => Boolean(word));
  }
}
