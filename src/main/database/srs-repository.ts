/**
 * Spaced-repetition scheduling and review queues.
 */

import { subHours, differenceInDays, endOfDay } from 'date-fns';
import { Word } from '../../shared/types/core.js';
import { wrapError } from '../../shared/utils/error.js';
import { mapRowToWord } from './mappers.js';
import { BaseRepository } from './base-repository.js';

export class SrsRepository extends BaseRepository {
  async updateLastStudied(wordId: number): Promise<void> {
    this.query(`Failed to update last studied`, (db) => {
      const result = db
        .prepare('UPDATE words SET last_studied = CURRENT_TIMESTAMP WHERE id = ?')
        .run(wordId);
      this.requireChange(result, 'Word', wordId);
    });
  }
  async getWeakestWords(limit: number, language: string): Promise<Word[]> {
    return this.queryAsync(`Failed to get weakest words`, async (db) => {
      // Prioritize words due for review, then weakest words
      const dueWords = await this.getWordsDueWithPriority(language, limit);

      if (dueWords.length >= limit) {
        return dueWords.slice(0, limit);
      }

      // Get additional weak words if needed (only words with sentences)
      // Exclude words that were recently reviewed/studied to prevent immediate re-quizzing
      const remainingLimit = limit - dueWords.length;
      const now = new Date();
      const nowIso = now.toISOString();
      // Exclude words reviewed/studied within the last 24 hours
      const cutoffTime = subHours(now, 24);
      const cutoffTimeIso = cutoffTime.toISOString();

      const stmt = db.prepare(`
        SELECT DISTINCT w.* FROM words w
        INNER JOIN sentence_words sw ON w.id = sw.word_id
        WHERE w.known = FALSE AND w.ignored = FALSE AND w.language = ?
        AND w.next_due > ?
        AND (w.last_review IS NULL OR w.last_review < ?)
        AND (w.last_studied IS NULL OR w.last_studied < ?)
        ORDER BY w.strength ASC, RANDOM()
        LIMIT ?
      `);

      const rows = stmt.all(
        language,
        nowIso,
        cutoffTimeIso,
        cutoffTimeIso,
        remainingLimit
      ) as any[];
      const additionalWords = rows.map(mapRowToWord);

      return [...dueWords, ...additionalWords];
    });
  }
  async updateWordSRS(
    wordId: number,
    strength: number,
    intervalDays: number,
    easeFactor: number,
    nextDue: Date,
    options?: {
      fsrsDifficulty?: number;
      fsrsStability?: number;
      fsrsLapses?: number;
      fsrsLastRating?: number | null;
    }
  ): Promise<void> {
    const db = this.getDb();

    try {
      const nowIso = new Date().toISOString();
      const updates = [
        'strength = ?',
        'interval_days = ?',
        'ease_factor = ?',
        'last_review = ?',
        'next_due = ?',
        'last_studied = ?',
      ];
      const params: Array<number | string | null> = [
        strength,
        intervalDays,
        easeFactor,
        nowIso,
        nextDue.toISOString(),
        nowIso,
      ];

      if (options) {
        if (options.fsrsDifficulty !== undefined) {
          updates.push('fsrs_difficulty = ?');
          params.push(options.fsrsDifficulty);
        }
        if (options.fsrsStability !== undefined) {
          updates.push('fsrs_stability = ?');
          params.push(options.fsrsStability);
        }
        if (options.fsrsLapses !== undefined) {
          updates.push('fsrs_lapses = ?');
          params.push(options.fsrsLapses);
        }
        if (options.fsrsLastRating !== undefined) {
          updates.push('fsrs_last_rating = ?');
          params.push(options.fsrsLastRating);
        }
      }

      const stmt = db.prepare(`
        UPDATE words 
        SET ${updates.join(', ')}
        WHERE id = ?
      `);

      const result = stmt.run(...params, wordId);
      this.requireChange(result, 'Word', wordId);
    } catch (error) {
      throw wrapError(error, `Failed to update word SRS`);
    }
  }
  async getWordsDueForReview(language: string, limit?: number): Promise<Word[]> {
    return this.query(`Failed to get words due for review`, (db) => {
      const now = new Date().toISOString();

      let query = `
        SELECT * FROM words 
        WHERE known = FALSE AND ignored = FALSE 
        AND language = ? AND next_due <= ?
        ORDER BY next_due ASC, strength ASC
      `;

      if (limit) {
        query += ' LIMIT ?';
      }

      const stmt = db.prepare(query);
      const params = limit ? [language, now, limit] : [language, now];
      const rows = stmt.all(...params) as any[];

      return rows.map(mapRowToWord);
    });
  }
  async getWordsDueCount(language: string): Promise<number> {
    return this.query(`Failed to get words due count`, (db) => {
      const now = new Date().toISOString();

      const stmt = db.prepare(`
        SELECT COUNT(*) as count FROM words 
        WHERE known = FALSE AND ignored = FALSE 
        AND language = ? AND next_due <= ?
      `);

      const result = stmt.get(language, now) as { count: number };
      return result.count;
    });
  }
  async getWordsDueWithPriority(language: string, limit?: number): Promise<Word[]> {
    return this.query(`Failed to get words due with priority`, (db) => {
      const now = new Date().toISOString();

      // Get all due words that have sentences (required for quiz mode)
      const stmt = db.prepare(`
        SELECT DISTINCT w.* FROM words w
        INNER JOIN sentence_words sw ON w.id = sw.word_id
        WHERE w.known = FALSE AND w.ignored = FALSE 
        AND w.language = ? AND w.next_due <= ?
      `);

      const rows = stmt.all(language, now) as any[];
      const words = rows.map(mapRowToWord);

      // Sort by SRS priority (overdue first, then by strength)
      const sortedWords = words.sort((a, b) => {
        const now = new Date();
        const aDaysOverdue = Math.max(0, differenceInDays(now, a.nextDue));
        const bDaysOverdue = Math.max(0, differenceInDays(now, b.nextDue));

        // First sort by overdue status
        if (aDaysOverdue !== bDaysOverdue) {
          return bDaysOverdue - aDaysOverdue; // More overdue first
        }

        // Then by strength (weaker first)
        return a.strength - b.strength;
      });

      return limit ? sortedWords.slice(0, limit) : sortedWords;
    });
  }
  async getSRSStats(language: string): Promise<{
    totalWords: number;
    dueToday: number;
    overdue: number;
    averageInterval: number;
    averageEaseFactor: number;
  }> {
    return this.query(`Failed to get SRS stats`, (db) => {
      const now = new Date().toISOString();
      const todayStr = endOfDay(new Date()).toISOString();

      const stmt = db.prepare(`
        SELECT 
          COUNT(*) as totalWords,
          COUNT(CASE WHEN next_due <= ? THEN 1 END) as dueToday,
          COUNT(CASE WHEN next_due < ? THEN 1 END) as overdue,
          AVG(interval_days) as averageInterval,
          AVG(ease_factor) as averageEaseFactor
        FROM words
        WHERE ignored = FALSE AND known = FALSE AND language = ?
      `);

      const result = stmt.get(todayStr, now, language) as any;

      return {
        totalWords: result.totalWords || 0,
        dueToday: result.dueToday || 0,
        overdue: result.overdue || 0,
        averageInterval: result.averageInterval || 1,
        averageEaseFactor: result.averageEaseFactor || 2.5,
      };
    });
  }
  async recordSRSAdjustment(data: {
    wordId: number;
    sessionId?: number;
    recallRating?: number;
    strengthDelta: number;
    language: string;
  }): Promise<number> {
    return this.query(`Failed to record SRS adjustment`, (db) => {
      const stmt = db.prepare(`
        INSERT INTO srs_adjustments (word_id, session_id, recall_rating, strength_delta, language)
        VALUES (?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        data.wordId,
        data.sessionId || null,
        data.recallRating ?? null,
        data.strengthDelta,
        data.language
      );

      return result.lastInsertRowid as number;
    });
  }
}
