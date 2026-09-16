/**
 * Learning sessions, pronunciation attempts and grammar explanations.
 */

import { wrapError } from '../../shared/utils/error.js';
import { BaseRepository } from './base-repository.js';

export class TrackingRepository extends BaseRepository {
  async incrementGrammarExplanationCount(wordId: number): Promise<void> {
    this.query(`Failed to increment grammar explanation count`, (db) => {
      const result = db
        .prepare(
          'UPDATE words SET grammar_explanation_count = grammar_explanation_count + 1 WHERE id = ?'
        )
        .run(wordId);
      this.requireChange(result, 'Word', wordId);
    });
  }
  async insertGrammarExplanation(
    wordId: number,
    sentenceId: number,
    explanation: string
  ): Promise<number> {
    return this.query(`Failed to insert grammar explanation`, (db) => {
      const stmt = db.prepare(`
        INSERT INTO grammar_explanations (word_id, sentence_id, explanation)
        VALUES (?, ?, ?)
      `);
      const result = stmt.run(wordId, sentenceId, explanation);
      return result.lastInsertRowid as number;
    });
  }
  async getGrammarExplanation(wordId: number, sentenceId: number): Promise<string | null> {
    return this.query(`Failed to get grammar explanation`, (db) => {
      const stmt = db.prepare(`
        SELECT explanation FROM grammar_explanations
        WHERE word_id = ? AND sentence_id = ?
        LIMIT 1
      `);
      const result = stmt.get(wordId, sentenceId) as { explanation: string } | undefined;
      return result?.explanation ?? null;
    });
  }
  async recordPronunciationAttempt(
    sentenceId: number,
    similarityScore: number,
    expectedText: string,
    transcribedText: string,
    audioPath?: string | null
  ): Promise<void> {
    this.query(`Failed to record pronunciation attempt`, (db) => {
      // Insert into pronunciation_attempts history table
      const insertAttempt = db.prepare(`
        INSERT INTO pronunciation_attempts (sentence_id, similarity_score, expected_text, transcribed_text, audio_path)
        VALUES (?, ?, ?, ?, ?)
      `);
      insertAttempt.run(
        sentenceId,
        similarityScore,
        expectedText,
        transcribedText,
        audioPath || null
      );
    });
  }
  async getPronunciationHistory(
    sentenceId: number,
    limit?: number
  ): Promise<
    Array<{
      id: number;
      sentenceId: number;
      similarityScore: number;
      expectedText: string;
      transcribedText: string;
      audioPath: string | null;
      createdAt: Date;
    }>
  > {
    const db = this.getDb();

    try {
      const query = limit
        ? `SELECT * FROM pronunciation_attempts WHERE sentence_id = ? ORDER BY created_at DESC LIMIT ?`
        : `SELECT * FROM pronunciation_attempts WHERE sentence_id = ? ORDER BY created_at DESC`;

      const stmt = db.prepare(query);
      const rows = limit ? stmt.all(sentenceId, limit) : (stmt.all(sentenceId) as any[]);

      return rows.map((row) => ({
        id: row.id,
        sentenceId: row.sentence_id,
        similarityScore: row.similarity_score,
        expectedText: row.expected_text,
        transcribedText: row.transcribed_text,
        audioPath: row.audio_path || null,
        createdAt: new Date(row.created_at),
      }));
    } catch (error) {
      throw wrapError(error, `Failed to get pronunciation history`);
    }
  }
  async createLearningSession(data: {
    mode: 'learning' | 'quiz' | 'dialog' | 'flow';
    language: string;
  }): Promise<number> {
    return this.query(`Failed to create learning session`, (db) => {
      const stmt = db.prepare(`
        INSERT INTO learning_sessions (mode, language, started_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `);

      const result = stmt.run(data.mode, data.language);
      return result.lastInsertRowid as number;
    });
  }
  async updateLearningSession(
    sessionId: number,
    data: {
      wordCount?: number;
      sentenceCount?: number;
      audioPlayedCount?: number;
    }
  ): Promise<void> {
    const db = this.getDb();

    try {
      const session = await this.getLearningSession(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      const startedAt = new Date(session.startedAt);
      const endedAt = new Date();
      const durationSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);

      const stmt = db.prepare(`
        UPDATE learning_sessions
        SET ended_at = CURRENT_TIMESTAMP,
            duration_seconds = ?,
            word_count = COALESCE(?, word_count),
            sentence_count = COALESCE(?, sentence_count),
            audio_played_count = COALESCE(?, audio_played_count)
        WHERE id = ?
      `);

      stmt.run(
        durationSeconds,
        data.wordCount ?? null,
        data.sentenceCount ?? null,
        data.audioPlayedCount ?? null,
        sessionId
      );
    } catch (error) {
      throw wrapError(error, `Failed to update learning session`);
    }
  }
  async getLearningSession(sessionId: number): Promise<{
    id: number;
    mode: string;
    language: string;
    startedAt: Date;
  } | null> {
    return this.query(`Failed to get learning session`, (db) => {
      const stmt = db.prepare(`
        SELECT id, mode, language, started_at
        FROM learning_sessions
        WHERE id = ?
      `);

      const row = stmt.get(sessionId) as any;
      if (!row) {
        return null;
      }

      return {
        id: row.id,
        mode: row.mode,
        language: row.language,
        startedAt: new Date(row.started_at),
      };
    });
  }
  async recordNeglectedWords(
    data: Array<{
      word: string;
      language: string;
      topic?: string;
      translation?: string;
      sessionId?: number;
      frequencyPosition?: number;
    }>
  ): Promise<number> {
    const db = this.getDb();

    if (data.length === 0) {
      return 0;
    }

    try {
      const stmt = db.prepare(`
        INSERT INTO neglected_words (word, language, topic, translation, session_id, frequency_position)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const transaction = db.transaction((items: Array<(typeof data)[0]>) => {
        for (const item of items) {
          stmt.run(
            item.word,
            item.language,
            item.topic || null,
            item.translation || null,
            item.sessionId || null,
            item.frequencyPosition ?? null
          );
        }
      });

      transaction(data);
      return data.length;
    } catch (error) {
      throw wrapError(error, `Failed to record neglected words`);
    }
  }
}
