/**
 * Sentence CRUD, lemma indexing and random selection.
 */

import Database from 'better-sqlite3';
import { Sentence, PrecomputedToken, AnkiExportRow } from '../../shared/types/core.js';
import {
  splitSentenceIntoParts,
  serializeSentenceParts,
  serializeTokenizedTokens,
} from '../../shared/utils/sentence.js';
import { wrapError } from '../../shared/utils/error.js';
import { mapRowToSentence } from './mappers.js';
import { BaseRepository } from './base-repository.js';
import { DatabaseConnection } from './connection.js';
import { Logger } from '../../shared/utils/logger.js';
import { WordRepository } from './word-repository.js';

export class SentenceRepository extends BaseRepository {
  constructor(
    connection: DatabaseConnection,
    logger: Logger,
    private readonly words: WordRepository
  ) {
    super(connection, logger);
  }
  private storeLemmas(
    db: Database.Database,
    sentenceId: number,
    tokens: PrecomputedToken[],
    replace = false
  ): void {
    const lemmas = new Set<string>();
    for (const token of tokens) {
      const lemma = token.lemma || token.dictionaryForm;
      if (lemma) lemmas.add(lemma.toLowerCase().trim());
    }
    if (lemmas.size === 0) return;
    if (replace) {
      db.prepare('DELETE FROM sentence_lemmas WHERE sentence_id = ?').run(sentenceId);
    }
    const insertLemma = db.prepare(
      'INSERT OR IGNORE INTO sentence_lemmas (sentence_id, lemma) VALUES (?, ?)'
    );
    for (const lemma of lemmas) {
      if (lemma.length > 0) insertLemma.run(sentenceId, lemma);
    }
    this.logger.debug(
      { sentenceId, lemmaCount: lemmas.size },
      `Stored ${lemmas.size} lemmas for sentence ${sentenceId}`
    );
  }
  // Inserts into both sentences.word_id (primary word) and the sentence_words junction table
  // (all learning words found in the sentence). Junction table is the source of truth for lookups.
  async insertSentence(
    wordId: number,
    sentence: string,
    translation: string,
    audioPath: string,
    contextBefore?: string,
    contextAfter?: string,
    contextBeforeTranslation?: string,
    contextAfterTranslation?: string,
    sentenceParts?: string[],
    sentenceGenerationModel?: string,
    audioGenerationService?: string,
    audioGenerationModel?: string,
    audioGenerationVoiceId?: string,
    tokenizedTokens?: PrecomputedToken[],
    pronunciation?: string,
    contextBeforePronunciation?: string,
    contextAfterPronunciation?: string,
    proficiencyLevel?: string
  ): Promise<number> {
    const db = this.getDb();

    try {
      const parts = sentenceParts ?? splitSentenceIntoParts(sentence);
      const serializedParts = serializeSentenceParts(parts);
      const serializedTokens = serializeTokenizedTokens(tokenizedTokens);

      // Get the word to determine language before inserting
      const word = await this.words.getWordById(wordId);
      if (!word) {
        throw new Error(`Word with ID ${wordId} not found`);
      }

      // Insert sentence with primary wordId and language
      const stmt = db.prepare(`
        INSERT INTO sentences (
          word_id, language, sentence, translation, audio_path,
          context_before, context_after, context_before_translation, context_after_translation,
          sentence_parts, sentence_generation_model, audio_generation_service, audio_generation_model,
          audio_generation_voice_id, sentence_tokens, pronunciation, context_before_pronunciation, context_after_pronunciation,
          proficiency_level
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        wordId,
        word.language,
        sentence,
        translation,
        audioPath,
        contextBefore || null,
        contextAfter || null,
        contextBeforeTranslation || null,
        contextAfterTranslation || null,
        serializedParts,
        sentenceGenerationModel || null,
        audioGenerationService || null,
        audioGenerationModel || null,
        audioGenerationVoiceId || null,
        serializedTokens,
        pronunciation || null,
        contextBeforePronunciation || null,
        contextAfterPronunciation || null,
        proficiencyLevel || null
      );

      const sentenceId = result.lastInsertRowid as number;

      // Find all learning words that appear in the sentence
      const matchingWords = this.words.findMatchingLearningWords(sentence, word.language);

      // Prepare junction table insert statement
      const insertJunction = db.prepare(`
        INSERT OR IGNORE INTO sentence_words (sentence_id, word_id)
        VALUES (?, ?)
      `);

      const updateSentenceCount = db.prepare(`
        UPDATE words 
        SET sentence_count = sentence_count + 1
        WHERE id = ?
      `);

      // Always ensure the primary word is in the junction table
      // This guarantees that sentences.word_id is always backed by a sentence_words entry
      // See documentation at top of insertSentence method for why this is important
      insertJunction.run(sentenceId, wordId);

      // Insert entries in junction table for all other matching words found in the sentence
      // This allows sentences to be discoverable when studying any word they contain,
      // not just the primary word they were generated for
      if (matchingWords.length > 0) {
        for (const matchedWord of matchingWords) {
          try {
            insertJunction.run(sentenceId, matchedWord.id);
            updateSentenceCount.run(matchedWord.id);
          } catch (error) {
            // Ignore duplicate key errors (if entry already exists)
            if (error instanceof Error && !error.message.includes('UNIQUE constraint')) {
              this.logger.warn(
                { error, sentenceId, wordId: matchedWord.id },
                `Failed to insert junction table entry for sentence ${sentenceId}, word ${matchedWord.id}`
              );
            }
          }
        }
      }

      // Update sentenceCount for the primary word (if it wasn't already updated above)
      if (!matchingWords.find((w) => w.id === wordId)) {
        updateSentenceCount.run(wordId);
      }

      if (tokenizedTokens && tokenizedTokens.length > 0) {
        try {
          this.storeLemmas(db, sentenceId, tokenizedTokens);
        } catch (error) {
          this.logger.warn(
            { error, sentenceId },
            `Failed to store lemmas for sentence ${sentenceId} during insertion`
          );
        }
      }

      return sentenceId;
    } catch (error) {
      throw wrapError(error, `Failed to insert sentence`);
    }
  }
  async getSentencesByWord(wordId: number): Promise<Sentence[]> {
    return this.query(`Failed to get sentences by word`, (db) => {
      // Get sentence IDs from junction table (the single source of truth)
      const sentenceIdsStmt = db.prepare(`
        SELECT sentence_id FROM sentence_words WHERE word_id = ?
      `);

      const sentenceIdsResult = sentenceIdsStmt.all(wordId) as Array<{ sentence_id: number }>;
      const sentenceIds = sentenceIdsResult.map((row) => row.sentence_id);

      if (sentenceIds.length === 0) {
        return [];
      }

      // Fetch sentences by IDs (excluding ignored sentences)
      const placeholders = sentenceIds.map(() => '?').join(',');
      const stmt = db.prepare(`
        SELECT * FROM sentences 
        WHERE id IN (${placeholders})
          AND (ignored IS NULL OR ignored = FALSE)
        ORDER BY RANDOM()
      `);

      const rows = stmt.all(...sentenceIds) as any[];

      return rows.map(mapRowToSentence);
    });
  }

  /**
   * Fetch all non-ignored sentences for a language together with their primary
   * word, for export (e.g. to an Anki deck). One row per sentence.
   */
  async getSentencesForExport(language: string): Promise<AnkiExportRow[]> {
    return this.query(`Failed to get sentences for export`, (db) => {
      const stmt = db.prepare(`
        SELECT
          s.id            AS sentenceId,
          s.sentence      AS sentence,
          s.translation   AS translation,
          s.pronunciation AS pronunciation,
          s.audio_path    AS audioPath,
          w.word          AS word,
          w.translation   AS wordTranslation,
          w.interval_days AS intervalDays,
          w.ease_factor   AS easeFactor,
          w.fsrs_lapses   AS lapses,
          w.last_review   AS lastReview,
          w.next_due      AS nextDue
        FROM sentences s
        JOIN words w ON w.id = s.word_id
        WHERE s.language = ?
          AND (s.ignored IS NULL OR s.ignored = FALSE)
        ORDER BY w.word, s.id
      `);

      return stmt.all(language) as AnkiExportRow[];
    });
  }

  async getSentencesByIds(sentenceIds: number[]): Promise<Sentence[]> {
    return this.query(`Failed to get sentences by IDs`, (db) => {
      if (sentenceIds.length === 0) {
        return [];
      }

      const placeholders = sentenceIds.map(() => '?').join(',');
      const stmt = db.prepare(
        `SELECT * FROM sentences WHERE id IN (${placeholders}) AND (ignored IS NULL OR ignored = FALSE)`
      );
      const rows = stmt.all(...sentenceIds) as any[];

      return rows.map((row) => mapRowToSentence(row));
    });
  }
  async updateSentenceLastShown(sentenceId: number): Promise<void> {
    this.query(`Failed to update sentence last shown`, (db) => {
      const result = db
        .prepare('UPDATE sentences SET last_shown = CURRENT_TIMESTAMP WHERE id = ?')
        .run(sentenceId);
      this.requireChange(result, 'Sentence', sentenceId);
    });
  }
  async updateSentenceTokens(sentenceId: number, tokens: PrecomputedToken[]): Promise<void> {
    this.query(`Failed to update sentence tokens`, (db) => {
      const result = db
        .prepare('UPDATE sentences SET sentence_tokens = ? WHERE id = ?')
        .run(serializeTokenizedTokens(tokens), sentenceId);
      this.requireChange(result, 'Sentence', sentenceId);
      if (tokens && tokens.length > 0) {
        this.storeLemmas(db, sentenceId, tokens, true);
      }
    });
  }
  async incrementSentencePlayCount(sentenceId: number): Promise<void> {
    this.query(`Failed to increment sentence play count`, (db) => {
      const result = db
        .prepare('UPDATE sentences SET play_count = play_count + 1 WHERE id = ?')
        .run(sentenceId);
      this.requireChange(result, 'Sentence', sentenceId);
    });
  }

  async getSentenceById(sentenceId: number): Promise<Sentence | null> {
    return this.query(`Failed to get sentence by ID`, (db) => {
      const stmt = db.prepare('SELECT * FROM sentences WHERE id = ?');
      const row = stmt.get(sentenceId) as any;

      return row ? mapRowToSentence(row) : null;
    });
  }
  async deleteSentence(sentenceId: number): Promise<void> {
    this.query(`Failed to mark sentence as ignored`, (db) => {
      const result = db.prepare('UPDATE sentences SET ignored = TRUE WHERE id = ?').run(sentenceId);
      this.requireChange(result, 'Sentence', sentenceId);
    });
  }
  async getRandomSentenceForWord(wordId: number): Promise<Sentence | null> {
    return this.query(`Failed to get random sentence for word`, (db) => {
      // First get sentence IDs from junction table
      const sentenceIdsStmt = db.prepare(`
        SELECT sentence_id FROM sentence_words WHERE word_id = ?
      `);

      const sentenceIdsResult = sentenceIdsStmt.all(wordId) as Array<{ sentence_id: number }>;

      if (sentenceIdsResult.length === 0) {
        return null;
      }

      const sentenceIds = sentenceIdsResult.map((row) => row.sentence_id);

      // Then fetch a random sentence by IDs using the junction table (excluding ignored sentences)
      const placeholders = sentenceIds.map(() => '?').join(',');
      const stmt = db.prepare(`
        SELECT * FROM sentences 
        WHERE id IN (${placeholders})
          AND (ignored IS NULL OR ignored = FALSE)
        ORDER BY RANDOM()
        LIMIT 1
      `);

      const row = stmt.get(...sentenceIds) as any;

      return row ? mapRowToSentence(row) : null;
    });
  }
  async getFlowSentences(language: string): Promise<
    Array<{
      audioPath: string;
      englishAudioPath?: string;
      beforeSentenceAudio?: string;
      afterSentenceAudio?: string;
      continuationAudios: string[];
      variantSentenceAudios: string[];
    }>
  > {
    const db = this.getDb();

    try {
      // First, check how many sentences are available
      const countStmt = db.prepare(`
        SELECT COUNT(*) as count
        FROM sentences
        WHERE language = ?
          AND audio_path IS NOT NULL
          AND TRIM(audio_path) != ''
          AND (ignored IS NULL OR ignored = FALSE)
      `);
      const countResult = countStmt.get(language) as { count: number };
      const totalCount = countResult.count;

      // If more than 100 sentences available, randomly select 100
      // Otherwise, get all sentences
      const orderBy = totalCount > 100 ? 'ORDER BY RANDOM()' : 'ORDER BY id ASC';
      const limit = totalCount > 100 ? 'LIMIT 100' : '';

      const stmt = db.prepare(`
        SELECT id, audio_path, before_sentence_audio_path, after_sentence_audio_path
        FROM sentences
        WHERE language = ?
          AND audio_path IS NOT NULL
          AND TRIM(audio_path) != ''
          AND (ignored IS NULL OR ignored = FALSE)
        ${orderBy}
        ${limit}
      `);

      const sentenceRows = stmt.all(language) as Array<{
        id: number;
        audio_path: string;
        before_sentence_audio_path: string | null;
        after_sentence_audio_path: string | null;
      }>;

      const result: Array<{
        audioPath: string;
        englishAudioPath?: string;
        beforeSentenceAudio?: string;
        afterSentenceAudio?: string;
        continuationAudios: string[];
        variantSentenceAudios: string[];
      }> = [];

      // Fetch every sentence's dialogue variants in one query rather than one
      // query per sentence: this loop runs up to 100 times.
      const variantsBySentence = new Map<
        number,
        Array<{ continuation_audio: string | null; variant_sentence_audio: string | null }>
      >();
      if (sentenceRows.length > 0) {
        const placeholders = sentenceRows.map(() => '?').join(',');
        const allVariantRows = db
          .prepare(
            `SELECT sentence_id, continuation_audio, variant_sentence_audio
             FROM dialogue_variants
             WHERE sentence_id IN (${placeholders})`
          )
          .all(...sentenceRows.map((row) => row.id)) as Array<{
          sentence_id: number;
          continuation_audio: string | null;
          variant_sentence_audio: string | null;
        }>;
        for (const variantRow of allVariantRows) {
          const bucket = variantsBySentence.get(variantRow.sentence_id);
          if (bucket) {
            bucket.push(variantRow);
          } else {
            variantsBySentence.set(variantRow.sentence_id, [variantRow]);
          }
        }
      }

      // For each sentence, get continuation audio paths and construct English audio path
      for (const row of sentenceRows) {
        const variantRows = variantsBySentence.get(row.id) ?? [];
        const continuationAudios = variantRows
          .map((variantRow) => variantRow.continuation_audio)
          .filter((audio): audio is string => !!audio && audio.trim() !== '');
        const variantSentenceAudios = variantRows
          .map((variantRow) => variantRow.variant_sentence_audio)
          .filter((audio): audio is string => !!audio && audio.trim() !== '');

        // Construct English audio path from sentence audio path
        // English audio is stored as: <lang>/word_<wordId>/english_sentence_<sentenceId>.<ext>
        // Sentence audio is: <lang>/word_<wordId>/sentence_<sentenceId>.<ext>
        let englishAudioPath: string | undefined;
        const audioPathParts = row.audio_path.split('/');
        if (audioPathParts.length >= 3) {
          const sentenceFile = audioPathParts[2];
          // Replace sentence_ with english_sentence_
          const englishFile = sentenceFile.replace(/^sentence_/, 'english_sentence_');
          if (englishFile !== sentenceFile) {
            // Only set if we successfully replaced (i.e., it was a sentence file)
            englishAudioPath = `${audioPathParts[0]}/${audioPathParts[1]}/${englishFile}`;
          }
        }

        result.push({
          audioPath: row.audio_path,
          englishAudioPath,
          beforeSentenceAudio: row.before_sentence_audio_path || undefined,
          afterSentenceAudio: row.after_sentence_audio_path || undefined,
          continuationAudios,
          variantSentenceAudios,
        });
      }

      // Also get entries from read_aloud_cache
      const readAloudStmt = db.prepare(`
        SELECT raw_text, audio_path
        FROM read_aloud_cache
        WHERE language = ?
          AND audio_path IS NOT NULL
          AND TRIM(audio_path) != ''
      `);

      const readAloudRows = readAloudStmt.all(language) as Array<{
        raw_text: string;
        audio_path: string;
      }>;

      // Add read_aloud_cache entries (no English audio path for these)
      for (const row of readAloudRows) {
        result.push({
          audioPath: row.audio_path,
          continuationAudios: [],
          variantSentenceAudios: [],
        });
      }

      return result;
    } catch (error) {
      throw wrapError(error, `Failed to get flow sentences`);
    }
  }
  async getRandomSentenceWithTopic(
    language: string,
    excludeIds?: number[]
  ): Promise<Sentence | null> {
    return this.query(`Failed to get random sentence with topic`, (db) => {
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
          AND w.topic IS NOT NULL
          AND TRIM(w.topic) != ''
          ${excludeClause}
        ORDER BY s.play_count DESC, RANDOM()
        LIMIT 1
      `);

      const params: unknown[] = [language, ...(excludeIds ?? [])];
      const row = stmt.get(...params) as any;

      if (!row) {
        return null;
      }

      return mapRowToSentence(row);
    });
  }
  async updateSentenceRelatedWords(sentenceId: number, relatedWords: string[]): Promise<void> {
    this.query(`Failed to update sentence related words`, (db) => {
      const serialized = JSON.stringify(relatedWords);
      const stmt = db.prepare('UPDATE sentences SET related_words = ? WHERE id = ?');
      const result = stmt.run(serialized, sentenceId);

      if (result.changes === 0) {
        throw new Error(`Sentence with ID ${sentenceId} not found`);
      }
    });
  }
}
