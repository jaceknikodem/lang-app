/**
 * Dialogue variants, dialog sentence selection and corrections.
 */

import { Sentence, DialogueVariant } from '../../shared/types/core.js';
import { mapRowToSentence, mapRowToDialogueVariant } from './mappers.js';
import { BaseRepository } from './base-repository.js';

export class DialogueRepository extends BaseRepository {
  async insertDialogueVariant(
    sentenceId: number,
    variantSentence: string,
    variantTranslation: string,
    variantPronunciation?: string
  ): Promise<number> {
    return this.query(`Failed to insert dialogue variant`, (db) => {
      const stmt = db.prepare(`
        INSERT INTO dialogue_variants (sentence_id, variant_sentence, variant_translation, variant_pronunciation)
        VALUES (?, ?, ?, ?)
      `);

      const result = stmt.run(
        sentenceId,
        variantSentence,
        variantTranslation,
        variantPronunciation ?? null
      );
      return result.lastInsertRowid as number;
    });
  }

  async updateDialogueVariantPronunciation(
    variantId: number,
    pronunciation: string
  ): Promise<void> {
    this.query(`Failed to update dialogue variant pronunciation`, (db) => {
      const stmt = db.prepare(`
        UPDATE dialogue_variants SET variant_pronunciation = ? WHERE id = ?
      `);
      stmt.run(pronunciation, variantId);
    });
  }
  async getDialogueVariantsBySentenceId(
    sentenceId: number,
    limit?: number
  ): Promise<DialogueVariant[]> {
    return this.query(`Failed to get dialogue variants`, (db) => {
      let query = `
        SELECT * FROM dialogue_variants
        WHERE sentence_id = ?
        ORDER BY created_at DESC
      `;

      if (limit) {
        query += ` LIMIT ?`;
      }

      const stmt = db.prepare(query);
      const rows = limit ? (stmt.all(sentenceId, limit) as any[]) : (stmt.all(sentenceId) as any[]);

      return rows.map((row) => mapRowToDialogueVariant(row));
    });
  }
  async getDialogueVariantCount(sentenceId: number): Promise<number> {
    return this.query(`Failed to get dialogue variant count`, (db) => {
      const stmt = db.prepare(`
        SELECT COUNT(*) as count FROM dialogue_variants
        WHERE sentence_id = ?
      `);

      const result = stmt.get(sentenceId) as { count: number };
      return result.count;
    });
  }
  async getDialogueVariantById(variantId: number): Promise<DialogueVariant | null> {
    return this.query(`Failed to get dialogue variant`, (db) => {
      const stmt = db.prepare(`
        SELECT * FROM dialogue_variants
        WHERE id = ?
      `);

      const row = stmt.get(variantId) as any;
      if (!row) {
        return null;
      }

      return mapRowToDialogueVariant(row);
    });
  }
  async updateDialogueVariantContinuation(
    variantId: number,
    continuationText: string,
    continuationTranslation: string,
    continuationAudio?: string
  ): Promise<void> {
    this.query(`Failed to update dialogue variant continuation`, (db) => {
      const stmt = db.prepare(`
        UPDATE dialogue_variants
        SET continuation_text = ?, continuation_translation = ?, continuation_audio = ?
        WHERE id = ?
      `);

      stmt.run(continuationText, continuationTranslation, continuationAudio || null, variantId);
    });
  }
  async updateDialogueVariantSentenceAudio(variantId: number, audioPath: string): Promise<void> {
    this.query(`Failed to update dialogue variant sentence audio`, (db) => {
      db.prepare(`UPDATE dialogue_variants SET variant_sentence_audio = ? WHERE id = ?`).run(
        audioPath,
        variantId
      );
    });
  }
  async getRandomDialogSentence(language: string, excludeIds?: number[]): Promise<Sentence | null> {
    const results = await this.getRandomDialogSentences(1, language, excludeIds);
    return results[0] ?? null;
  }
  async getRandomDialogSentences(
    count: number,
    language: string,
    excludeIds?: number[]
  ): Promise<Sentence[]> {
    return this.query(`Failed to get random dialog sentences`, (db) => {
      if (count <= 0) {
        return [];
      }

      const excludeClause =
        excludeIds && excludeIds.length > 0
          ? `AND s.id NOT IN (${excludeIds.map(() => '?').join(',')})`
          : '';

      const stmt = db.prepare(`
        SELECT DISTINCT s.*
        FROM sentences s
        INNER JOIN words w ON s.word_id = w.id
        WHERE s.language = ?
          AND w.ignored = FALSE
          AND s.context_before IS NOT NULL
          AND TRIM(s.context_before) != ''
          ${excludeClause}
        ORDER BY RANDOM()
        LIMIT ?
      `);

      const params: unknown[] = [language, ...(excludeIds ?? []), count];
      const rows = stmt.all(...params) as any[];

      return rows.map((row) => mapRowToSentence(row));
    });
  }
  async insertDialogCorrection(data: {
    sentenceId: number;
    sessionId?: number;
    correctionText: string;
    language: string;
  }): Promise<number> {
    return this.query(`Failed to insert dialog correction`, (db) => {
      const stmt = db.prepare(`
        INSERT INTO dialog_corrections (sentence_id, session_id, correction_text, language)
        VALUES (?, ?, ?, ?)
      `);

      const result = stmt.run(
        data.sentenceId,
        data.sessionId || null,
        data.correctionText,
        data.language
      );

      return result.lastInsertRowid as number;
    });
  }
  async getDialogCorrections(
    sentenceId: number,
    language: string,
    limit: number = 3
  ): Promise<Array<{ id: number; correctionText: string; createdAt: Date }>> {
    return this.query(`Failed to get dialog corrections`, (db) => {
      const stmt = db.prepare(`
        SELECT id, correction_text, created_at
        FROM dialog_corrections
        WHERE sentence_id = ? AND language = ?
        ORDER BY created_at DESC
        LIMIT ?
      `);

      const rows = stmt.all(sentenceId, language, limit) as Array<{
        id: number;
        correction_text: string;
        created_at: string;
      }>;

      return rows.map((row) => ({
        id: row.id,
        correctionText: row.correction_text,
        createdAt: new Date(row.created_at),
      }));
    });
  }
}
