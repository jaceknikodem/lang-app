/**
 * Read-only aggregate queries for progress and scoring.
 */

import { StudyStats } from '../../shared/types/core.js';
import { wrapError } from '../../shared/utils/error.js';
import { BaseRepository } from './base-repository.js';

export class StatsRepository extends BaseRepository {
  async getStudyStats(language: string): Promise<StudyStats> {
    return this.query(`Failed to get study stats`, (db) => {
      const statsStmt = db.prepare(`
        SELECT 
          COUNT(*) as totalWords,
          COUNT(CASE WHEN last_studied IS NOT NULL THEN 1 END) as wordsStudied,
          AVG(CASE WHEN last_studied IS NOT NULL THEN strength ELSE NULL END) as averageStrength,
          MAX(last_studied) as lastStudyDate
        FROM words
        WHERE ignored = FALSE AND language = ?
      `);

      const stats = statsStmt.get(language) as any;

      return {
        totalWords: stats.totalWords || 0,
        wordsStudied: stats.wordsStudied || 0,
        averageStrength: stats.averageStrength || 0,
        lastStudyDate: stats.lastStudyDate ? new Date(stats.lastStudyDate) : undefined,
      };
    });
  }
  async recordStudySession(wordsStudied: number): Promise<void> {
    this.query(`Failed to record study session`, (db) => {
      const stmt = db.prepare(`
        INSERT INTO progress (words_studied, when_studied)
        VALUES (?, CURRENT_TIMESTAMP)
      `);

      stmt.run(wordsStudied);
    });
  }
  async getRecentStudySessions(
    limit: number = 10
  ): Promise<Array<{ id: number; wordsStudied: number; whenStudied: Date }>> {
    return this.query(`Failed to get recent study sessions`, (db) => {
      const stmt = db.prepare(`
        SELECT id, words_studied, when_studied
        FROM progress
        ORDER BY when_studied DESC
        LIMIT ?
      `);

      const rows = stmt.all(limit) as any[];

      return rows.map((row) => ({
        id: row.id,
        wordsStudied: row.words_studied,
        whenStudied: new Date(row.when_studied),
      }));
    });
  }
  // TODO: This needs some caching
  async getLanguageStats(): Promise<
    Array<{
      language: string;
      totalWords: number;
      studiedWords: number;
      averagePronunciationScore: number | null;
      pronunciationAttemptCount: number;
    }>
  > {
    const db = this.getDb();

    try {
      // Get word counts per language
      const wordStatsStmt = db.prepare(`
        SELECT 
          language,
          COUNT(*) as totalWords,
          COUNT(CASE WHEN last_studied IS NOT NULL THEN 1 END) as studiedWords
        FROM words
        WHERE ignored = FALSE AND sentence_count > 0
        GROUP BY language
        ORDER BY language ASC
      `);

      const wordStatsRows = wordStatsStmt.all() as any[];

      // Get average pronunciation scores and count per language
      const pronunciationStatsStmt = db.prepare(`
        SELECT 
          s.language,
          AVG(pa.similarity_score) * 10 as averagePronunciationScore,
          COUNT(*) as pronunciationAttemptCount
        FROM pronunciation_attempts pa
        INNER JOIN sentences s ON pa.sentence_id = s.id
        GROUP BY s.language
      `);

      const pronunciationStatsRows = pronunciationStatsStmt.all() as Array<Record<string, unknown>>;

      // Create a map of language -> pronunciation data for quick lookup
      const pronunciationDataMap = new Map<string, { score: number; count: number }>();
      pronunciationStatsRows.forEach((row: Record<string, unknown>) => {
        if (row.averagePronunciationScore !== null) {
          pronunciationDataMap.set(row.language as string, {
            score: row.averagePronunciationScore as number,
            count: (row.pronunciationAttemptCount as number) || 0,
          });
        }
      });

      // Combine word stats with pronunciation scores
      return wordStatsRows.map((row) => {
        const pronunciationData = pronunciationDataMap.get(row.language);
        return {
          language: row.language,
          totalWords: row.totalWords || 0,
          studiedWords: row.studiedWords || 0,
          averagePronunciationScore: pronunciationData?.score ?? null,
          pronunciationAttemptCount: pronunciationData?.count ?? 0,
        };
      });
    } catch (error) {
      throw wrapError(error, `Failed to get language stats`);
    }
  }
  async getStartupStats(language: string): Promise<{
    timesPlayed: number;
    reviewCount: number;
  }> {
    return this.query(`Failed to get startup stats`, (db) => {
      const playCountStmt = db.prepare(`
        SELECT SUM(play_count) as timesPlayed
        FROM sentences
        WHERE language = ?
      `);
      const playCountRow = playCountStmt.get(language) as { timesPlayed: number | null };

      const reviewCountStmt = db.prepare(`
        SELECT COUNT(*) as reviewCount
        FROM audio_playback_events
        WHERE language = ? AND mode = 'learning'
      `);
      const reviewCountRow = reviewCountStmt.get(language) as { reviewCount: number };

      return {
        timesPlayed: playCountRow.timesPlayed ?? 0,
        reviewCount: reviewCountRow.reviewCount ?? 0,
      };
    });
  }
  async getTopicWordCounts(language: string): Promise<Array<{ topic: string; count: number }>> {
    return this.query(`Failed to get topic word counts`, (db) => {
      const stmt = db.prepare(`
        SELECT 
          topic,
          COUNT(*) as count
        FROM words
        WHERE language = ? AND topic IS NOT NULL AND topic != ''
        GROUP BY topic
        ORDER BY count DESC
      `);

      const rows = stmt.all(language) as Array<{ topic: string; count: number }>;
      return rows;
    });
  }
  async getNewWordCount(language: string): Promise<number> {
    return this.query(`Failed to get new word count`, (db) => {
      const stmt = db.prepare(`
        SELECT COUNT(*) as count FROM words 
        WHERE language = ? 
        AND known = FALSE 
        AND ignored = FALSE 
        AND last_studied IS NULL
      `);

      const result = stmt.get(language) as { count: number };
      return result.count;
    });
  }
  async getWeakWordCount(language: string): Promise<number> {
    return this.query(`Failed to get weak word count`, (db) => {
      const stmt = db.prepare(`
        SELECT COUNT(*) as count FROM words 
        WHERE language = ? 
        AND known = FALSE 
        AND ignored = FALSE 
        AND strength < 30
      `);

      const result = stmt.get(language) as { count: number };
      return result.count;
    });
  }
  // "cluster" = words associated with sentences that have contextBefore (dialog sentences).
  async getDialogueReadinessRatio(language: string, minStrength: number = 40): Promise<number> {
    return this.query(`Failed to get dialogue readiness ratio`, (db) => {
      // Get total unique words associated with dialog sentences (sentences with contextBefore)
      const totalWordsStmt = db.prepare(`
        SELECT COUNT(DISTINCT w.id) as count
        FROM words w
        INNER JOIN sentence_words sw ON w.id = sw.word_id
        INNER JOIN sentences s ON sw.sentence_id = s.id
        WHERE s.language = ?
        AND w.ignored = FALSE
        AND s.context_before IS NOT NULL
        AND TRIM(s.context_before) != ''
      `);

      const totalResult = totalWordsStmt.get(language) as { count: number };
      const totalWords = totalResult.count;

      if (totalWords === 0) {
        return 0; // No dialog sentences yet
      }

      // Get known words (known=true OR strength >= minStrength) associated with dialog sentences
      const knownWordsStmt = db.prepare(`
        SELECT COUNT(DISTINCT w.id) as count
        FROM words w
        INNER JOIN sentence_words sw ON w.id = sw.word_id
        INNER JOIN sentences s ON sw.sentence_id = s.id
        WHERE s.language = ?
        AND w.ignored = FALSE
        AND s.context_before IS NOT NULL
        AND TRIM(s.context_before) != ''
        AND (w.known = TRUE OR w.strength >= ?)
      `);

      const knownResult = knownWordsStmt.get(language, minStrength) as { count: number };
      const knownWords = knownResult.count;

      return knownWords / totalWords;
    });
  }
  // similarity_score is stored 0-1; this returns it on a 0-10 scale.
  async getAveragePronunciationScore(language: string): Promise<number> {
    return this.query(`Failed to get average pronunciation score`, (db) => {
      // Get average similarity score from pronunciation_attempts
      // Join with sentences to filter by language
      const stmt = db.prepare(`
        SELECT AVG(pa.similarity_score) as avg_score
        FROM pronunciation_attempts pa
        INNER JOIN sentences s ON pa.sentence_id = s.id
        WHERE s.language = ?
      `);

      const result = stmt.get(language) as { avg_score: number | null };

      if (result.avg_score === null) {
        return 0; // No pronunciation attempts yet
      }

      // Convert from 0-1 scale to 0-10 scale
      return result.avg_score * 10;
    });
  }
  async getAvailableSentencesCount(language: string): Promise<number> {
    return this.query(`Failed to get available sentences count`, (db) => {
      // Count sentences with audio for the language
      const stmt = db.prepare(`
        SELECT COUNT(*) as count
        FROM sentences
        WHERE language = ?
        AND audio_path IS NOT NULL
        AND TRIM(audio_path) != ''
      `);

      const result = stmt.get(language) as { count: number };
      return result.count;
    });
  }
  async getTimeSinceLastActivePractice(language: string): Promise<number> {
    return this.query(`Failed to get time since last active practice`, (db) => {
      const now = new Date();

      // Get most recent study session
      const sessionStmt = db.prepare(`
        SELECT MAX(when_studied) as last_session
        FROM progress
      `);
      const sessionResult = sessionStmt.get() as { last_session: string | null };

      // Get most recent word review/study
      // Use the later of last_review or last_studied for each word, then find the max
      const wordStmt = db.prepare(`
        SELECT MAX(
          CASE 
            WHEN last_review IS NULL THEN last_studied
            WHEN last_studied IS NULL THEN last_review
            WHEN last_review > last_studied THEN last_review
            ELSE last_studied
          END
        ) as last_practice
        FROM words
        WHERE language = ?
        AND (last_review IS NOT NULL OR last_studied IS NOT NULL)
      `);
      const wordResult = wordStmt.get(language) as { last_practice: string | null };

      // Find the most recent timestamp
      let lastPractice: Date | null = null;

      if (sessionResult.last_session) {
        lastPractice = new Date(sessionResult.last_session);
      }

      if (wordResult.last_practice) {
        const wordDate = new Date(wordResult.last_practice);
        if (!lastPractice || wordDate > lastPractice) {
          lastPractice = wordDate;
        }
      }

      if (!lastPractice) {
        // No practice recorded yet - return a very large number to penalize heavily
        return 1000; // 1000 hours (~41 days)
      }

      // Calculate hours since last practice
      const diffMs = now.getTime() - lastPractice.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      return diffHours;
    });
  }
}
