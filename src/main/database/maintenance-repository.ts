/**
 * Cross-cutting maintenance operations.
 */

import { addDays } from 'date-fns';
import { BaseRepository } from './base-repository.js';

export class MaintenanceRepository extends BaseRepository {
  async resetLanguageProgress(language: string): Promise<void> {
    this.query(`Failed to reset language progress`, (db) => {
      // Calculate tomorrow's date for next_due
      const tomorrow = addDays(new Date(), 1);
      const tomorrowIso = tomorrow.toISOString();

      // Delete words that were marked as known or ignored for this language
      // This will cascade delete their sentences due to foreign key constraints
      // This will also cascade delete their word generation queue entries
      const deleteKnownIgnoredStmt = db.prepare(`
        DELETE FROM words 
        WHERE language = ? AND (known = TRUE OR ignored = TRUE)
      `);

      deleteKnownIgnoredStmt.run(language);

      // Clear any queued/processing word generation jobs for remaining words in this language
      // to prevent regeneration when progress is reset
      const clearQueueStmt = db.prepare(`
        DELETE FROM word_generation_queue 
        WHERE language = ? AND status IN ('queued', 'processing')
      `);

      clearQueueStmt.run(language);

      // Reset all word progress fields for the remaining words in the language
      // Note: We do NOT reset sentence_count or processing_status to avoid triggering regenerations
      const resetWordsStmt = db.prepare(`
        UPDATE words 
        SET 
          strength = 20,
          interval_days = 1,
          ease_factor = 2.5,
          next_due = ?,
          last_review = NULL,
          last_studied = NULL,
          fsrs_difficulty = 5.0,
          fsrs_stability = 1.0,
          fsrs_lapses = 0,
          fsrs_last_rating = NULL
        WHERE language = ?
      `);

      resetWordsStmt.run(tomorrowIso, language);

      // Reset all sentence progress fields for the language
      const resetSentencesStmt = db.prepare(`
        UPDATE sentences 
        SET 
          last_shown = NULL,
          play_count = 0
        WHERE language = ?
      `);

      resetSentencesStmt.run(language);

      // Delete all pronunciation attempts for sentences in that language
      const deletePronunciationStmt = db.prepare(`
        DELETE FROM pronunciation_attempts 
        WHERE sentence_id IN (
          SELECT id FROM sentences WHERE language = ?
        )
      `);

      deletePronunciationStmt.run(language);

      this.logger.info({ language }, `Successfully reset progress for language: ${language}`);
    });
  }
}
