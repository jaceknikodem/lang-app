import Database from 'better-sqlite3';
import path from 'path';
import { promises as fsPromises } from 'fs';
import { addDays, subHours, addMilliseconds, differenceInDays, endOfDay } from 'date-fns';
import {
  DatabaseLayer,
  DatabaseConfig,
  JobWordInfo,
  WordGenerationJob,
  WordGenerationJobStatus,
  WordProcessingStatus,
} from '../../shared/types/database.js';
import {
  Word,
  Sentence,
  StudyStats,
  CreateWordRequest,
  DictionaryEntry,
  DialogueVariant,
  PrecomputedToken,
  AnkiExportRow,
} from '../../shared/types/core.js';
import { DatabaseConnection } from './connection.js';
import { initializeSchema } from './schema.js';
import {
  splitSentenceIntoParts,
  serializeSentenceParts,
  parseSentenceParts,
  serializeTokenizedTokens,
  parseTokenizedTokens,
} from '../../shared/utils/sentence.js';
import { wrapError } from '../../shared/utils/error.js';
import { getLogger } from '../utils/logger.js';
import { Logger } from '../../shared/utils/logger.js';

export class SQLiteDatabaseLayer implements DatabaseLayer {
  private connection: DatabaseConnection;
  private readonly logger: Logger;

  constructor(config: DatabaseConfig) {
    this.logger = getLogger();
    this.connection = new DatabaseConnection(config);
  }
  async initialize(): Promise<void> {
    try {
      const db = await this.connection.connect();

      // Initialize schema
      initializeSchema(db);

      // Populate dictionary data from bundled files in background (non-blocking)
      // This is a very expensive operation that can take several seconds
      setImmediate(async () => {
        try {
          await this.populateDictionaryFromFiles();
        } catch (dictError) {
          this.logger.warn({ error: dictError }, 'Dictionary population skipped due to error');
        }
      });

      this.logger.info('Database initialized successfully');
    } catch (error) {
      throw wrapError(error, `Failed to initialize database`);
    }
  }
  async close(): Promise<void> {
    await this.connection.close();
  }

  private getDb(): Database.Database {
    return this.connection.getDatabase();
  }
  // Also back-links the word to any existing sentences that contain its lemma.
  async insertWord(wordData: CreateWordRequest): Promise<number> {
    const db = this.getDb();

    // Initialize SRS values for new word
    const tomorrow = addDays(new Date(), 1);

    const stmt = db.prepare(`
      INSERT INTO words (
        word, language, translation, topic, added_via,
        strength, interval_days, ease_factor, next_due
      )
      VALUES (?, ?, ?, ?, ?, 20, 1, 2.5, ?)
    `);

    const result = stmt.run(
      wordData.word,
      wordData.language,
      wordData.translation,
      wordData.topic || null,
      wordData.addedVia || null,
      tomorrow.toISOString()
    );

    const wordId = result.lastInsertRowid as number;

    // Find existing sentences that contain this word's lemma (same language only)
    const normalizedWord = wordData.word.toLowerCase().trim();

    const findSentencesStmt = db.prepare(`
      SELECT DISTINCT sl.sentence_id 
      FROM sentence_lemmas sl
      INNER JOIN sentences s ON sl.sentence_id = s.id
      WHERE sl.lemma = ? AND s.language = ?
    `);

    const matchingSentences = findSentencesStmt.all(normalizedWord, wordData.language) as Array<{
      sentence_id: number;
    }>;

    if (matchingSentences.length > 0) {
      // Link these sentences to the new word via sentence_words junction table
      const insertJunction = db.prepare(`
        INSERT OR IGNORE INTO sentence_words (sentence_id, word_id)
        VALUES (?, ?)
      `);

      const updateSentenceCount = db.prepare(`
        UPDATE words 
        SET sentence_count = sentence_count + 1
        WHERE id = ?
      `);

      for (const row of matchingSentences) {
        insertJunction.run(row.sentence_id, wordId);
        updateSentenceCount.run(wordId);
      }

      this.logger.debug(
        { wordId, word: wordData.word, linkedSentences: matchingSentences.length },
        `[insertWord] Linked ${matchingSentences.length} existing sentences to new word ${wordData.word} (ID: ${wordId})`
      );
    }

    return wordId;
  }
  async updateWordStrength(wordId: number, strength: number): Promise<void> {
    const db = this.getDb();

    const stmt = db.prepare(`
      UPDATE words 
      SET strength = ?, last_studied = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    const result = stmt.run(strength, wordId);

    if (result.changes === 0) {
      throw new Error(`Word with ID ${wordId} not found`);
    }
  }
  async markWordKnown(wordId: number, known: boolean): Promise<void> {
    const db = this.getDb();

    const stmt = db.prepare(`
      UPDATE words 
      SET known = ?, last_studied = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    const result = stmt.run(known ? 1 : 0, wordId);

    if (result.changes === 0) {
      throw new Error(`Word with ID ${wordId} not found`);
    }
  }
  async markWordIgnored(wordId: number, ignored: boolean): Promise<void> {
    const db = this.getDb();

    const stmt = db.prepare(`
      UPDATE words 
      SET ignored = ?, last_studied = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    const result = stmt.run(ignored ? 1 : 0, wordId);

    if (result.changes === 0) {
      throw new Error(`Word with ID ${wordId} not found`);
    }
  }
  async getWordsToStudy(limit: number, language: string): Promise<Word[]> {
    const db = this.getDb();

    // First, get words due for review (SRS priority)
    const dueWords = await this.getWordsDueWithPriority(language, limit);

    // If we have enough due words, return them
    if (dueWords.length >= limit) {
      return dueWords.slice(0, limit);
    }

    // If we need more words, get additional words by strength (only words with sentences)
    const remainingLimit = limit - dueWords.length;
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      SELECT DISTINCT w.* FROM words w
      INNER JOIN sentence_words sw ON w.id = sw.word_id
      WHERE w.known = FALSE AND w.ignored = FALSE AND w.language = ?
      AND w.next_due > ?
      ORDER BY w.strength ASC, RANDOM()
      LIMIT ?
    `);

    const rows = stmt.all(language, now, remainingLimit) as any[];
    const additionalWords = rows.map(this.mapRowToWord);

    // Combine due words with additional words
    return [...dueWords, ...additionalWords];
  }
  async getWordsByStrength(
    minStrength: number,
    maxStrength: number,
    language: string,
    limit?: number
  ): Promise<Word[]> {
    const db = this.getDb();

    let query = `
      SELECT * FROM words 
      WHERE known = FALSE AND ignored = FALSE 
      AND strength >= ? AND strength <= ? AND language = ?
      ORDER BY last_studied ASC NULLS FIRST
    `;

    if (limit) {
      query += ' LIMIT ?';
    }

    const stmt = db.prepare(query);
    const params = limit
      ? [minStrength, maxStrength, language, limit]
      : [minStrength, maxStrength, language];
    const rows = stmt.all(...params) as any[];

    return rows.map(this.mapRowToWord);
  }
  async getWordsWithSentences(
    language: string,
    includeKnown: boolean = true,
    includeIgnored: boolean = false
  ): Promise<Word[]> {
    const db = this.getDb();

    const whereConditions: string[] = [`w.language = ?`];

    if (!includeKnown) {
      whereConditions.push('w.known = FALSE');
    }

    if (!includeIgnored) {
      whereConditions.push('w.ignored = FALSE');
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    // Use sentence_words junction table instead of direct join on sentences.word_id
    const stmt = db.prepare(`
      SELECT DISTINCT w.* FROM words w
      INNER JOIN sentence_words sw ON w.id = sw.word_id
      ${whereClause}
      ORDER BY w.strength ASC, RANDOM()
    `);

    const rows = stmt.all(language) as any[];
    const words = rows.map(this.mapRowToWord);

    return this.shuffleArray(words);
  }
  async getWordsWithSentencesOrderedByStrength(
    language: string,
    includeKnown: boolean = true,
    includeIgnored: boolean = false
  ): Promise<Word[]> {
    const db = this.getDb();

    const whereConditions: string[] = [`w.language = ?`];

    if (!includeKnown) {
      whereConditions.push('w.known = FALSE');
    }

    if (!includeIgnored) {
      whereConditions.push('w.ignored = FALSE');
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    // Use sentence_words junction table instead of direct join on sentences.word_id
    const stmt = db.prepare(`
      SELECT DISTINCT w.* FROM words w
      INNER JOIN sentence_words sw ON w.id = sw.word_id
      ${whereClause}
      ORDER BY w.last_studied ASC NULLS FIRST
    `);

    const rows = stmt.all(language) as any[];
    return rows.map(this.mapRowToWord);
  }
  // TODO: Review - querying the whole table is not efficient, we should use a more efficient query
  async getAllWords(
    language: string,
    includeKnown: boolean = true,
    includeIgnored: boolean = false
  ): Promise<Word[]> {
    const db = this.getDb();

    const whereConditions: string[] = [`language = ?`];

    if (!includeKnown) {
      whereConditions.push('known = FALSE');
    }

    if (!includeIgnored) {
      whereConditions.push('ignored = FALSE');
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    // If we're getting words for learning (not including known/ignored), shuffle them
    const orderClause =
      !includeKnown && !includeIgnored
        ? 'ORDER BY strength ASC, RANDOM()'
        : 'ORDER BY created_at DESC';

    const stmt = db.prepare(`
      SELECT * FROM words 
      ${whereClause}
      ${orderClause}
    `);

    const rows = stmt.all(language) as any[];
    const words = rows.map(this.mapRowToWord);

    // Additional shuffling for learning words to ensure variety
    if (!includeKnown && !includeIgnored) {
      return this.shuffleArray(words);
    }

    return words;
  }
  async getAllWordsWithSentences(language: string): Promise<Word[]> {
    const db = this.getDb();

    const stmt = db.prepare(`
      SELECT DISTINCT w.* FROM words w
      INNER JOIN sentence_words sw ON w.id = sw.word_id
      WHERE w.language = ? AND w.ignored = FALSE
      ORDER BY w.created_at DESC
    `);

    const rows = stmt.all(language) as any[];
    return rows.map(this.mapRowToWord);
  }
  async getWordById(wordId: number): Promise<Word | null> {
    const db = this.getDb();

    const stmt = db.prepare('SELECT * FROM words WHERE id = ?');
    const row = stmt.get(wordId) as any;

    return row ? this.mapRowToWord(row) : null;
  }
  async getKnownWordsForSentenceGeneration(
    language: string,
    limit: number = 50
  ): Promise<string[]> {
    const db = this.getDb();

    // Get all known words for the language, shuffled
    const stmt = db.prepare(`
      SELECT word FROM words 
      WHERE language = ? AND known = TRUE AND ignored = FALSE
      ORDER BY RANDOM()
      LIMIT ?
    `);

    const rows = stmt.all(language, limit) as Array<{ word: string }>;
    return rows.map((row) => row.word);
  }

  async getKnownWords(
    language: string,
    minWordStrength: number,
    maxWords: number
  ): Promise<string[]> {
    const db = this.getDb();

    // Get words that are either known OR have strength >= minWordStrength
    const stmt = db.prepare(`
      SELECT word FROM words 
      WHERE language = ? AND ignored = FALSE AND (known = TRUE OR strength >= ?)
      ORDER BY RANDOM()
      LIMIT ?
    `);

    const rows = stmt.all(language, minWordStrength, maxWords) as Array<{ word: string }>;
    return rows.map((row) => row.word);
  }
  async getExistingWordsForDuplicateChecking(
    language: string,
    topic?: string,
    limit?: number
  ): Promise<string[]> {
    const db = this.getDb();

    // Get words (learning, known, and ignored) for the language, optionally filtered by topic and limited
    // This includes ignored words to ensure they are filtered out during generation
    let query = `SELECT word FROM words WHERE language = ?`;
    const params: unknown[] = [language];

    if (topic) {
      query += ` AND topic = ?`;
      params.push(topic);
    }

    if (limit && limit > 0) {
      query += ` LIMIT ${Math.floor(limit)}`;
    }

    const stmt = db.prepare(query);
    const rows = stmt.all(...params) as Array<{ word: string }>;
    return rows.map((row) => row.word);
  }
  async getIgnoredWords(language: string, topic?: string): Promise<string[]> {
    const db = this.getDb();

    let query = `SELECT word FROM words WHERE language = ? AND ignored = TRUE`;
    const params: unknown[] = [language];

    if (topic) {
      query += ` AND topic = ?`;
      params.push(topic);
    }

    const stmt = db.prepare(query);
    const rows = stmt.all(...params) as Array<{ word: string }>;
    return rows.map((row) => row.word);
  }
  // Also filters out words neglected 3+ times in the last 7 days (from neglected_words table).
  async checkWordsExist(language: string, words: string[], topic?: string): Promise<Set<string>> {
    const db = this.getDb();

    if (words.length === 0) {
      return new Set();
    }

    // Normalize words to lowercase for comparison
    const normalizedWords = words.map((w) => w.toLowerCase());

    // Create placeholders for IN clause
    const placeholders = normalizedWords.map(() => '?').join(',');

    // Query 1: Check words table (existing words - learning, known, or ignored)
    let wordsQuery = `
      SELECT LOWER(word) as word 
      FROM words 
      WHERE language = ? AND LOWER(word) IN (${placeholders})
    `;

    const wordsParams: unknown[] = [language, ...normalizedWords];

    if (topic) {
      wordsQuery += ` AND topic = ?`;
      wordsParams.push(topic);
    }

    const wordsStmt = db.prepare(wordsQuery);
    const wordsRows = wordsStmt.all(...wordsParams) as Array<{ word: string }>;
    const existingWordsSet = new Set(wordsRows.map((row) => row.word));

    // Query 2: Check neglected_words table (words neglected 3+ times in last 7 days)
    // Filter by language only (no topic filtering - if neglected in any topic, filter it out)
    const neglectedQuery = `
      SELECT LOWER(word) as word
      FROM neglected_words
      WHERE language = ? 
        AND LOWER(word) IN (${placeholders})
        AND ignored_at >= DATE('now', '-7 days')
      GROUP BY LOWER(word)
      HAVING COUNT(*) >= 3
    `;

    const neglectedParams: unknown[] = [language, ...normalizedWords];
    const neglectedStmt = db.prepare(neglectedQuery);
    const neglectedRows = neglectedStmt.all(...neglectedParams) as Array<{ word: string }>;
    const neglectedWordsSet = new Set(neglectedRows.map((row) => row.word));

    // Combine both sets
    const combinedSet = new Set([...existingWordsSet, ...neglectedWordsSet]);

    return combinedSet;
  }
  async getWordsByIds(wordIds: number[]): Promise<Word[]> {
    const db = this.getDb();

    if (wordIds.length === 0) {
      return [];
    }

    const placeholders = wordIds.map(() => '?').join(',');
    const stmt = db.prepare(`SELECT * FROM words WHERE id IN (${placeholders})`);
    const rows = stmt.all(...wordIds) as any[];

    return rows.map((row) => this.mapRowToWord(row));
  }
  // TODO: This needs some SQL optimization.
  private findMatchingLearningWords(sentence: string, language: string): Word[] {
    const db = this.getDb();

    try {
      // Tokenize sentence: split by whitespace and punctuation
      const parts = splitSentenceIntoParts(sentence);
      const wordsInSentence = new Set<string>();

      // Extract and normalize words from sentence parts
      for (const part of parts) {
        // Skip whitespace and punctuation-only parts
        if (/^\s*$/.test(part) || /^[.,!?;:]+$/.test(part)) {
          continue;
        }

        // Normalize word: remove punctuation, convert to lowercase
        const normalized = part
          .replace(/[.,!?;:]/g, '')
          .toLowerCase()
          .trim();
        if (normalized && normalized.length > 0) {
          wordsInSentence.add(normalized);
        }
      }

      if (wordsInSentence.size === 0) {
        return [];
      }

      // Get all learning words (not known, not ignored) in the same language
      const stmt = db.prepare(`
        SELECT * FROM words
        WHERE language = ? AND known = FALSE AND ignored = FALSE
      `);

      const learningWords = stmt.all(language) as any[];

      // Match sentence words against learning words (case-insensitive)
      const matchingWords: Word[] = [];
      const wordLookup = new Map<string, Word>();

      // Build lookup map for learning words
      for (const word of learningWords) {
        const mappedWord = this.mapRowToWord(word);
        const normalizedWord = word.word.toLowerCase().trim();
        wordLookup.set(normalizedWord, mappedWord);
      }

      // Find matches
      for (const sentenceWord of wordsInSentence) {
        const matchedWord = wordLookup.get(sentenceWord);
        if (matchedWord) {
          matchingWords.push(matchedWord);
        }
      }

      return matchingWords;
    } catch (error) {
      this.logger.error({ error }, 'Failed to find matching learning words');
      // Return empty array on error to avoid breaking sentence insertion
      return [];
    }
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
    contextAfterPronunciation?: string
  ): Promise<number> {
    const db = this.getDb();

    try {
      const parts = sentenceParts ?? splitSentenceIntoParts(sentence);
      const serializedParts = serializeSentenceParts(parts);
      const serializedTokens = serializeTokenizedTokens(tokenizedTokens);

      // Get the word to determine language before inserting
      const word = await this.getWordById(wordId);
      if (!word) {
        throw new Error(`Word with ID ${wordId} not found`);
      }

      // Insert sentence with primary wordId and language
      const stmt = db.prepare(`
        INSERT INTO sentences (
          word_id, language, sentence, translation, audio_path,
          context_before, context_after, context_before_translation, context_after_translation,
          sentence_parts, sentence_generation_model, audio_generation_service, audio_generation_model,
          audio_generation_voice_id, sentence_tokens, pronunciation, context_before_pronunciation, context_after_pronunciation
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        contextAfterPronunciation || null
      );

      const sentenceId = result.lastInsertRowid as number;

      // Find all learning words that appear in the sentence
      const matchingWords = this.findMatchingLearningWords(sentence, word.language);

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

      // If tokenizedTokens were provided, also store lemmas immediately
      if (tokenizedTokens && tokenizedTokens.length > 0) {
        try {
          const lemmas = new Set<string>();

          tokenizedTokens.forEach((token: PrecomputedToken) => {
            if (token.lemma) {
              lemmas.add(token.lemma.toLowerCase().trim());
            } else if (token.dictionaryForm) {
              lemmas.add(token.dictionaryForm.toLowerCase().trim());
            }
          });

          if (lemmas.size > 0) {
            const insertLemma = db.prepare(`
              INSERT OR IGNORE INTO sentence_lemmas (sentence_id, lemma)
              VALUES (?, ?)
            `);

            lemmas.forEach((lemma) => {
              if (lemma && lemma.length > 0) {
                insertLemma.run(sentenceId, lemma);
              }
            });

            this.logger.debug(
              { sentenceId, lemmaCount: lemmas.size },
              `[insertSentence] Stored ${lemmas.size} lemmas for sentence ${sentenceId}`
            );
          }
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
    const db = this.getDb();

    try {
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

      return rows.map(this.mapRowToSentence);
    } catch (error) {
      throw wrapError(error, `Failed to get sentences by word`);
    }
  }

  /**
   * Fetch all non-ignored sentences for a language together with their primary
   * word, for export (e.g. to an Anki deck). One row per sentence.
   */
  async getSentencesForExport(language: string): Promise<AnkiExportRow[]> {
    const db = this.getDb();

    try {
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
    } catch (error) {
      throw wrapError(error, `Failed to get sentences for export`);
    }
  }

  async getSentencesByIds(sentenceIds: number[]): Promise<Sentence[]> {
    const db = this.getDb();

    try {
      if (sentenceIds.length === 0) {
        return [];
      }

      const placeholders = sentenceIds.map(() => '?').join(',');
      const stmt = db.prepare(
        `SELECT * FROM sentences WHERE id IN (${placeholders}) AND (ignored IS NULL OR ignored = FALSE)`
      );
      const rows = stmt.all(...sentenceIds) as any[];

      return rows.map((row) => this.mapRowToSentence(row));
    } catch (error) {
      throw wrapError(error, `Failed to get sentences by IDs`);
    }
  }
  async updateSentenceLastShown(sentenceId: number): Promise<void> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        UPDATE sentences 
        SET last_shown = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      const result = stmt.run(sentenceId);

      if (result.changes === 0) {
        throw new Error(`Sentence with ID ${sentenceId} not found`);
      }
    } catch (error) {
      throw wrapError(error, `Failed to update sentence last shown`);
    }
  }
  async updateSentenceAudioPath(
    sentenceId: number,
    audioPath: string,
    audioGenerationVoiceId?: string
  ): Promise<void> {
    const db = this.getDb();
    try {
      if (audioGenerationVoiceId !== undefined) {
        // Update both audio path and voice ID
        const stmt = db.prepare(`
          UPDATE sentences
          SET audio_path = ?, audio_generation_voice_id = ?
          WHERE id = ?
        `);
        const result = stmt.run(audioPath, audioGenerationVoiceId || null, sentenceId);
        if (result.changes === 0) {
          throw new Error(`Sentence with ID ${sentenceId} not found`);
        }
      } else {
        // Update only audio path
        const stmt = db.prepare(`
          UPDATE sentences
          SET audio_path = ?
          WHERE id = ?
        `);
        const result = stmt.run(audioPath, sentenceId);
        if (result.changes === 0) {
          throw new Error(`Sentence with ID ${sentenceId} not found`);
        }
      }
    } catch (error) {
      throw wrapError(error, `Failed to update sentence audio path`);
    }
  }
  async updateBeforeSentenceAudioPath(sentenceId: number, audioPath: string): Promise<void> {
    const db = this.getDb();
    try {
      const stmt = db.prepare(`
        UPDATE sentences
        SET before_sentence_audio_path = ?
        WHERE id = ?
      `);
      const result = stmt.run(audioPath, sentenceId);
      if (result.changes === 0) {
        throw new Error(`Sentence with ID ${sentenceId} not found`);
      }
    } catch (error) {
      throw wrapError(error, `Failed to update before sentence audio path`);
    }
  }

  async updateAfterSentenceAudioPath(sentenceId: number, audioPath: string): Promise<void> {
    const db = this.getDb();
    try {
      const stmt = db.prepare(`
        UPDATE sentences
        SET after_sentence_audio_path = ?
        WHERE id = ?
      `);
      const result = stmt.run(audioPath, sentenceId);
      if (result.changes === 0) {
        throw new Error(`Sentence with ID ${sentenceId} not found`);
      }
    } catch (error) {
      throw wrapError(error, `Failed to update after sentence audio path`);
    }
  }
  async updateSentenceTokens(sentenceId: number, tokens: PrecomputedToken[]): Promise<void> {
    const db = this.getDb();

    try {
      const serializedTokens = serializeTokenizedTokens(tokens);
      const stmt = db.prepare(`
        UPDATE sentences
        SET sentence_tokens = ?
        WHERE id = ?
      `);
      const result = stmt.run(serializedTokens, sentenceId);
      if (result.changes === 0) {
        throw new Error(`Sentence with ID ${sentenceId} not found`);
      }

      if (!tokens || tokens.length === 0) {
        return;
      }

      const lemmas = new Set<string>();

      tokens.forEach((token: PrecomputedToken) => {
        // Collect lemmas (normalized)
        if (token.lemma) {
          lemmas.add(token.lemma.toLowerCase().trim());
        }
        // Also use dictionaryForm as fallback if no lemma
        else if (token.dictionaryForm) {
          lemmas.add(token.dictionaryForm.toLowerCase().trim());
        }
      });

      // Store all lemmas in sentence_lemmas table (even for words not in database yet)
      const insertLemma = db.prepare(`
        INSERT OR IGNORE INTO sentence_lemmas (sentence_id, lemma)
        VALUES (?, ?)
      `);

      // Remove old lemmas for this sentence
      const deleteOldLemmas = db.prepare(`
        DELETE FROM sentence_lemmas WHERE sentence_id = ?
      `);
      deleteOldLemmas.run(sentenceId);

      // Insert all lemmas
      lemmas.forEach((lemma) => {
        if (lemma && lemma.length > 0) {
          insertLemma.run(sentenceId, lemma);
        }
      });

      this.logger.debug(
        { sentenceId, lemmaCount: lemmas.size },
        `[updateSentenceTokens] Stored ${lemmas.size} lemmas for sentence ${sentenceId}`
      );
    } catch (error) {
      throw wrapError(error, `Failed to update sentence tokens`);
    }
  }
  async incrementSentencePlayCount(sentenceId: number): Promise<void> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        UPDATE sentences
        SET play_count = play_count + 1
        WHERE id = ?
      `);
      const result = stmt.run(sentenceId);
      if (result.changes === 0) {
        throw new Error(`Sentence with ID ${sentenceId} not found`);
      }
    } catch (error) {
      throw wrapError(error, `Failed to increment sentence play count`);
    }
  }
  async incrementGrammarExplanationCount(wordId: number): Promise<void> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        UPDATE words
        SET grammar_explanation_count = grammar_explanation_count + 1
        WHERE id = ?
      `);
      const result = stmt.run(wordId);
      if (result.changes === 0) {
        throw new Error(`Word with ID ${wordId} not found`);
      }
    } catch (error) {
      throw wrapError(error, `Failed to increment grammar explanation count`);
    }
  }
  async insertGrammarExplanation(
    wordId: number,
    sentenceId: number,
    explanation: string
  ): Promise<number> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        INSERT INTO grammar_explanations (word_id, sentence_id, explanation)
        VALUES (?, ?, ?)
      `);
      const result = stmt.run(wordId, sentenceId, explanation);
      return result.lastInsertRowid as number;
    } catch (error) {
      throw wrapError(error, `Failed to insert grammar explanation`);
    }
  }
  async getGrammarExplanation(wordId: number, sentenceId: number): Promise<string | null> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        SELECT explanation FROM grammar_explanations
        WHERE word_id = ? AND sentence_id = ?
        LIMIT 1
      `);
      const result = stmt.get(wordId, sentenceId) as { explanation: string } | undefined;
      return result?.explanation ?? null;
    } catch (error) {
      throw wrapError(error, `Failed to get grammar explanation`);
    }
  }
  async recordPronunciationAttempt(
    sentenceId: number,
    similarityScore: number,
    expectedText: string,
    transcribedText: string,
    audioPath?: string | null
  ): Promise<void> {
    const db = this.getDb();

    try {
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
    } catch (error) {
      throw wrapError(error, `Failed to record pronunciation attempt`);
    }
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
  async insertDialogueVariant(
    sentenceId: number,
    variantSentence: string,
    variantTranslation: string,
    variantPronunciation?: string
  ): Promise<number> {
    const db = this.getDb();

    try {
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
    } catch (error) {
      throw wrapError(error, `Failed to insert dialogue variant`);
    }
  }

  async updateDialogueVariantPronunciation(
    variantId: number,
    pronunciation: string
  ): Promise<void> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        UPDATE dialogue_variants SET variant_pronunciation = ? WHERE id = ?
      `);
      stmt.run(pronunciation, variantId);
    } catch (error) {
      throw wrapError(error, `Failed to update dialogue variant pronunciation`);
    }
  }
  async getDialogueVariantsBySentenceId(
    sentenceId: number,
    limit?: number
  ): Promise<DialogueVariant[]> {
    const db = this.getDb();

    try {
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

      return rows.map((row) => ({
        id: row.id,
        sentenceId: row.sentence_id,
        variantSentence: row.variant_sentence,
        variantTranslation: row.variant_translation,
        variantPronunciation: row.variant_pronunciation || undefined,
        createdAt: new Date(row.created_at),
        continuationText: row.continuation_text || undefined,
        continuationTranslation: row.continuation_translation || undefined,
        continuationAudio: row.continuation_audio || undefined,
      }));
    } catch (error) {
      throw wrapError(error, `Failed to get dialogue variants`);
    }
  }
  async getDialogueVariantCount(sentenceId: number): Promise<number> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        SELECT COUNT(*) as count FROM dialogue_variants
        WHERE sentence_id = ?
      `);

      const result = stmt.get(sentenceId) as { count: number };
      return result.count;
    } catch (error) {
      throw wrapError(error, `Failed to get dialogue variant count`);
    }
  }
  async getDialogueVariantById(variantId: number): Promise<DialogueVariant | null> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        SELECT * FROM dialogue_variants
        WHERE id = ?
      `);

      const row = stmt.get(variantId) as any;
      if (!row) {
        return null;
      }

      return {
        id: row.id,
        sentenceId: row.sentence_id,
        variantSentence: row.variant_sentence,
        variantTranslation: row.variant_translation,
        variantPronunciation: row.variant_pronunciation || undefined,
        createdAt: new Date(row.created_at),
        continuationText: row.continuation_text || undefined,
        continuationTranslation: row.continuation_translation || undefined,
        continuationAudio: row.continuation_audio || undefined,
      };
    } catch (error) {
      throw wrapError(error, `Failed to get dialogue variant`);
    }
  }
  async updateDialogueVariantContinuation(
    variantId: number,
    continuationText: string,
    continuationTranslation: string,
    continuationAudio?: string
  ): Promise<void> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        UPDATE dialogue_variants
        SET continuation_text = ?, continuation_translation = ?, continuation_audio = ?
        WHERE id = ?
      `);

      stmt.run(continuationText, continuationTranslation, continuationAudio || null, variantId);
    } catch (error) {
      throw wrapError(error, `Failed to update dialogue variant continuation`);
    }
  }
  async getSentenceById(sentenceId: number): Promise<Sentence | null> {
    const db = this.getDb();

    try {
      const stmt = db.prepare('SELECT * FROM sentences WHERE id = ?');
      const row = stmt.get(sentenceId) as any;

      return row ? this.mapRowToSentence(row) : null;
    } catch (error) {
      throw wrapError(error, `Failed to get sentence by ID`);
    }
  }
  async deleteSentence(sentenceId: number): Promise<void> {
    const db = this.getDb();

    try {
      // Mark the sentence as ignored instead of deleting it
      const stmt = db.prepare('UPDATE sentences SET ignored = TRUE WHERE id = ?');
      const result = stmt.run(sentenceId);

      if (result.changes === 0) {
        throw new Error(`Sentence with ID ${sentenceId} not found`);
      }
    } catch (error) {
      throw wrapError(error, `Failed to mark sentence as ignored`);
    }
  }
  async updateLastStudied(wordId: number): Promise<void> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        UPDATE words 
        SET last_studied = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      const result = stmt.run(wordId);

      if (result.changes === 0) {
        throw new Error(`Word with ID ${wordId} not found`);
      }
    } catch (error) {
      throw wrapError(error, `Failed to update last studied`);
    }
  }
  async getStudyStats(language: string): Promise<StudyStats> {
    const db = this.getDb();

    try {
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
    } catch (error) {
      throw wrapError(error, `Failed to get study stats`);
    }
  }
  async recordStudySession(wordsStudied: number): Promise<void> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        INSERT INTO progress (words_studied, when_studied)
        VALUES (?, CURRENT_TIMESTAMP)
      `);

      stmt.run(wordsStudied);
    } catch (error) {
      throw wrapError(error, `Failed to record study session`);
    }
  }
  async getRecentStudySessions(
    limit: number = 10
  ): Promise<Array<{ id: number; wordsStudied: number; whenStudied: Date }>> {
    const db = this.getDb();

    try {
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
    } catch (error) {
      throw wrapError(error, `Failed to get recent study sessions`);
    }
  }
  async getWeakestWords(limit: number, language: string): Promise<Word[]> {
    const db = this.getDb();

    try {
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
      const additionalWords = rows.map(this.mapRowToWord);

      return [...dueWords, ...additionalWords];
    } catch (error) {
      throw wrapError(error, `Failed to get weakest words`);
    }
  }
  async getRandomSentenceForWord(wordId: number): Promise<Sentence | null> {
    const db = this.getDb();

    try {
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

      return row ? this.mapRowToSentence(row) : null;
    } catch (error) {
      throw wrapError(error, `Failed to get random sentence for word`);
    }
  }
  async getFlowSentences(language: string): Promise<
    Array<{
      audioPath: string;
      englishAudioPath?: string;
      beforeSentenceAudio?: string;
      afterSentenceAudio?: string;
      continuationAudios: string[];
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
      }> = [];

      // For each sentence, get continuation audio paths and construct English audio path
      for (const row of sentenceRows) {
        // Get dialogue variants and their continuation audio
        const variantsStmt = db.prepare(`
          SELECT continuation_audio FROM dialogue_variants
          WHERE sentence_id = ? AND continuation_audio IS NOT NULL AND TRIM(continuation_audio) != ''
        `);
        const variantRows = variantsStmt.all(row.id) as Array<{ continuation_audio: string }>;
        const continuationAudios = variantRows
          .map((variantRow) => variantRow.continuation_audio)
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
          // No englishAudioPath for read_aloud_cache entries
          continuationAudios: [],
        });
      }

      return result;
    } catch (error) {
      throw wrapError(error, `Failed to get flow sentences`);
    }
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
    const db = this.getDb();

    try {
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

      return rows.map((row) => this.mapRowToSentence(row));
    } catch (error) {
      throw wrapError(error, `Failed to get random dialog sentences`);
    }
  }
  async insertDialogCorrection(data: {
    sentenceId: number;
    sessionId?: number;
    correctionText: string;
    language: string;
  }): Promise<number> {
    const db = this.getDb();

    try {
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
    } catch (error) {
      throw wrapError(error, `Failed to insert dialog correction`);
    }
  }
  async getDialogCorrections(
    sentenceId: number,
    language: string,
    limit: number = 3
  ): Promise<Array<{ id: number; correctionText: string; createdAt: Date }>> {
    const db = this.getDb();

    try {
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
    } catch (error) {
      throw wrapError(error, `Failed to get dialog corrections`);
    }
  }
  async getRandomSentenceWithTopic(
    language: string,
    excludeIds?: number[]
  ): Promise<Sentence | null> {
    const db = this.getDb();

    try {
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

      return this.mapRowToSentence(row);
    } catch (error) {
      throw wrapError(error, `Failed to get random sentence with topic`);
    }
  }
  async updateSentenceRelatedWords(sentenceId: number, relatedWords: string[]): Promise<void> {
    const db = this.getDb();

    try {
      const serialized = JSON.stringify(relatedWords);
      const stmt = db.prepare('UPDATE sentences SET related_words = ? WHERE id = ?');
      const result = stmt.run(serialized, sentenceId);

      if (result.changes === 0) {
        throw new Error(`Sentence with ID ${sentenceId} not found`);
      }
    } catch (error) {
      throw wrapError(error, `Failed to update sentence related words`);
    }
  }
  async getSetting(key: string): Promise<string | null> {
    const db = this.getDb();

    try {
      const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
      const row = stmt.get(key) as any;

      return row ? row.value : null;
    } catch (error) {
      throw wrapError(error, `Failed to get setting`);
    }
  }
  async setSetting(key: string, value: string): Promise<void> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `);

      stmt.run(key, value);
    } catch (error) {
      throw wrapError(error, `Failed to set setting`);
    }
  }
  async getCurrentLanguage(): Promise<string> {
    const language = await this.getSetting('current_language');
    return language || 'spanish'; // Default fallback
  }
  async setCurrentLanguage(language: string): Promise<void> {
    await this.setSetting('current_language', language);
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
  async getTopicWordCounts(language: string): Promise<Array<{ topic: string; count: number }>> {
    const db = this.getDb();

    try {
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
    } catch (error) {
      throw wrapError(error, `Failed to get topic word counts`);
    }
  }
  async lookupDictionary(word: string, language: string): Promise<DictionaryEntry[]> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        SELECT word, pos, glosses, lang
        FROM dict
        WHERE LOWER(word) = LOWER(?) AND lang = ?
        ORDER BY pos ASC, word ASC
      `);

      const rows = stmt.all(word, language) as Array<{
        word: string;
        pos: string;
        glosses: string;
        lang: string;
      }>;

      return rows.map((row) => ({
        word: row.word,
        pos: row.pos,
        glosses: this.parseGlossesField(row.glosses),
        lang: row.lang,
      }));
    } catch (error) {
      throw wrapError(error, `Failed to lookup dictionary entry`);
    }
  }

  async updateWordProcessingStatus(wordId: number, status: WordProcessingStatus): Promise<void> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        UPDATE words
        SET processing_status = ?
        WHERE id = ?
      `);
      stmt.run(status, wordId);
    } catch (error) {
      throw wrapError(error, `Failed to update word processing status`);
    }
  }

  async getWordProcessingInfo(
    wordId: number
  ): Promise<{ processingStatus: WordProcessingStatus; sentenceCount: number } | null> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        SELECT processing_status, sentence_count
        FROM words
        WHERE id = ?
      `);

      const row = stmt.get(wordId) as
        | { processing_status: WordProcessingStatus; sentence_count: number }
        | undefined;
      return row
        ? {
            processingStatus: row.processing_status ?? 'ready',
            sentenceCount: row.sentence_count ?? 0,
          }
        : null;
    } catch (error) {
      throw wrapError(error, `Failed to get word processing info`);
    }
  }

  async getWordGenerationQueueSummary(language?: string): Promise<{
    queued: number;
    processing: number;
    failed: number;
    queuedWords: JobWordInfo[];
    processingWords: JobWordInfo[];
  }> {
    const db = this.getDb();

    try {
      const statusQuery = `
        SELECT status, COUNT(*) as total
        FROM word_generation_queue
        ${language ? 'WHERE language = ?' : ''}
        GROUP BY status
      `;

      const rows = (
        language ? db.prepare(statusQuery).all(language) : db.prepare(statusQuery).all()
      ) as Array<{ status: string; total: number }>;

      const summary = rows.reduce(
        (acc, row) => {
          if (row.status === 'queued') acc.queued += row.total;
          if (row.status === 'processing') acc.processing += row.total;
          if (row.status === 'failed') acc.failed += row.total;
          return acc;
        },
        {
          queued: 0,
          processing: 0,
          failed: 0,
          queuedWords: [] as JobWordInfo[],
          processingWords: [] as JobWordInfo[],
        }
      );

      const jobWordQuery = `
        SELECT 
          q.word_id as wordId,
          q.status as status,
          q.language as language,
          q.topic as topic,
          w.word as word
        FROM word_generation_queue q
        INNER JOIN words w ON w.id = q.word_id
        WHERE q.status IN ('queued', 'processing')
          AND w.processing_status != 'failed'
          ${language ? 'AND q.language = ?' : ''}
        ORDER BY 
          CASE q.status WHEN 'processing' THEN 0 ELSE 1 END,
          q.updated_at ASC
      `;

      const jobWordRows = (
        language ? db.prepare(jobWordQuery).all(language) : db.prepare(jobWordQuery).all()
      ) as Array<{
        wordId: number;
        status: string;
        language: string;
        topic: string | null;
        word: string;
      }>;

      for (const job of jobWordRows) {
        const info: JobWordInfo = {
          wordId: job.wordId,
          word: job.word,
          status: job.status as WordGenerationJobStatus,
          language: job.language,
          topic: job.topic ?? undefined,
        };
        if (job.status === 'processing') {
          summary.processingWords.push(info);
        } else if (job.status === 'queued') {
          summary.queuedWords.push(info);
        }
      }

      return summary;
    } catch (error) {
      throw wrapError(error, `Failed to get queue summary`);
    }
  }

  async enqueueWordGeneration(
    wordId: number,
    language: string,
    topic?: string,
    desiredSentenceCount: number = 3
  ): Promise<void> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        INSERT INTO word_generation_queue (
          word_id, language, topic, desired_sentence_count, status, attempts, last_error, created_at, updated_at, started_at
        )
        VALUES (?, ?, ?, ?, 'queued', 0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)
        ON CONFLICT(word_id) DO UPDATE SET
          language = excluded.language,
          topic = excluded.topic,
          desired_sentence_count = excluded.desired_sentence_count,
          status = 'queued',
          attempts = 0,
          last_error = NULL,
          updated_at = CURRENT_TIMESTAMP,
          started_at = NULL
      `);

      stmt.run(wordId, language, topic || null, desiredSentenceCount);

      await this.updateWordProcessingStatus(wordId, 'queued');
    } catch (error) {
      throw wrapError(error, `Failed to enqueue word generation`);
    }
  }

  async getNextWordGenerationJob(): Promise<WordGenerationJob | null> {
    const db = this.getDb();

    try {
      const row = db
        .prepare(
          `
        SELECT * FROM word_generation_queue
        WHERE status = 'queued'
        ORDER BY updated_at ASC, created_at ASC
        LIMIT 1
      `
        )
        .get() as any | undefined;

      return row ? this.mapRowToWordGenerationJob(row) : null;
    } catch (error) {
      throw wrapError(error, `Failed to get next word generation job`);
    }
  }

  async markWordGenerationJobProcessing(jobId: number): Promise<void> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        UPDATE word_generation_queue
        SET status = 'processing',
            attempts = attempts + 1,
            started_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      stmt.run(jobId);
    } catch (error) {
      throw wrapError(error, `Failed to mark job processing`);
    }
  }

  async rescheduleWordGenerationJob(
    jobId: number,
    delayMs: number,
    lastError?: string
  ): Promise<void> {
    const db = this.getDb();
    const nextAttempt = addMilliseconds(new Date(), delayMs).toISOString();

    try {
      const stmt = db.prepare(`
        UPDATE word_generation_queue
        SET status = 'queued',
            updated_at = ?,
            started_at = NULL,
            last_error = COALESCE(?, last_error)
        WHERE id = ?
      `);
      stmt.run(nextAttempt, lastError || null, jobId);
    } catch (error) {
      throw wrapError(error, `Failed to reschedule job`);
    }
  }

  async completeWordGenerationJob(jobId: number): Promise<void> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        UPDATE word_generation_queue
        SET status = 'completed',
            updated_at = CURRENT_TIMESTAMP,
            started_at = NULL
        WHERE id = ?
      `);
      stmt.run(jobId);
    } catch (error) {
      throw wrapError(error, `Failed to complete job`);
    }
  }

  async failWordGenerationJob(jobId: number, errorMessage: string): Promise<void> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        UPDATE word_generation_queue
        SET status = 'failed',
            last_error = ?,
            updated_at = CURRENT_TIMESTAMP,
            started_at = NULL
        WHERE id = ?
      `);
      stmt.run(errorMessage, jobId);
    } catch (error) {
      throw wrapError(error, `Failed to mark job failed`);
    }
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

      if (result.changes === 0) {
        throw new Error(`Word with ID ${wordId} not found`);
      }
    } catch (error) {
      throw wrapError(error, `Failed to update word SRS`);
    }
  }
  async getWordsDueForReview(language: string, limit?: number): Promise<Word[]> {
    const db = this.getDb();

    try {
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

      return rows.map(this.mapRowToWord);
    } catch (error) {
      throw wrapError(error, `Failed to get words due for review`);
    }
  }
  async getWordsDueCount(language: string): Promise<number> {
    const db = this.getDb();

    try {
      const now = new Date().toISOString();

      const stmt = db.prepare(`
        SELECT COUNT(*) as count FROM words 
        WHERE known = FALSE AND ignored = FALSE 
        AND language = ? AND next_due <= ?
      `);

      const result = stmt.get(language, now) as { count: number };
      return result.count;
    } catch (error) {
      throw wrapError(error, `Failed to get words due count`);
    }
  }
  async getWordsDueWithPriority(language: string, limit?: number): Promise<Word[]> {
    const db = this.getDb();

    try {
      const now = new Date().toISOString();

      // Get all due words that have sentences (required for quiz mode)
      const stmt = db.prepare(`
        SELECT DISTINCT w.* FROM words w
        INNER JOIN sentence_words sw ON w.id = sw.word_id
        WHERE w.known = FALSE AND w.ignored = FALSE 
        AND w.language = ? AND w.next_due <= ?
      `);

      const rows = stmt.all(language, now) as any[];
      const words = rows.map(this.mapRowToWord);

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
    } catch (error) {
      throw wrapError(error, `Failed to get words due with priority`);
    }
  }
  async getSRSStats(language: string): Promise<{
    totalWords: number;
    dueToday: number;
    overdue: number;
    averageInterval: number;
    averageEaseFactor: number;
  }> {
    const db = this.getDb();

    try {
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
    } catch (error) {
      throw wrapError(error, `Failed to get SRS stats`);
    }
  }
  private async populateDictionaryFromFiles(): Promise<void> {
    const dictDir = path.join(process.cwd(), 'dicts');

    // Check if directory exists before proceeding
    try {
      await fsPromises.access(dictDir);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code !== 'ENOENT') {
        this.logger.warn({ error }, 'Failed to access dictionary directory');
      } else {
        this.logger.warn('Dictionary directory not found, skipping dictionary population');
      }
      return;
    }

    let files: string[];
    try {
      files = await fsPromises.readdir(dictDir);
    } catch (error) {
      this.logger.warn({ error }, 'Failed to read dictionary directory');
      return;
    }

    const jsonlFiles = files.filter((file) => file.endsWith('_dict.jsonl'));
    if (jsonlFiles.length === 0) {
      return;
    }

    const db = this.getDb();
    const deleteStmt = db.prepare('DELETE FROM dict WHERE lang = ?');
    const insertStmt = db.prepare(
      'INSERT INTO dict (word, pos, glosses, lang) VALUES (?, ?, ?, ?)'
    );
    const hasEntriesStmt = db.prepare('SELECT 1 FROM dict WHERE lang = ? LIMIT 1');
    const languagesToProcess: string[] = [];
    for (const file of jsonlFiles) {
      const language = file.replace('_dict.jsonl', '');
      const markerKey = `dictionary_populated_${language}`;
      const alreadyMarked = await this.getSetting(markerKey);
      const existingEntry = hasEntriesStmt.get(language);

      // Skip if already marked as populated AND entries exist
      if (alreadyMarked === 'true' && existingEntry) {
        continue; // Skip this language entirely
      }

      // If entries exist but not marked, just mark it and skip
      if (existingEntry && alreadyMarked !== 'true') {
        await this.setSetting(markerKey, 'true');
        this.logger.info(
          { language },
          `Dictionary entries already present for ${language}, marked as populated`
        );
        continue;
      }

      // Only process languages that need importing
      languagesToProcess.push(language);
    }

    // Early return if all dictionaries are already populated
    if (languagesToProcess.length === 0) {
      this.logger.info('All dictionaries already populated, skipping import');
      return;
    }

    // Now process only the languages that need importing
    for (const language of languagesToProcess) {
      const file = `${language}_dict.jsonl`;
      const filePath = path.join(dictDir, file);
      const markerKey = `dictionary_populated_${language}`;

      try {
        const entries = await this.parseDictionaryFile(filePath, language);

        const transaction = db.transaction(
          (
            dictionaryEntries: Array<{ word: string; pos: string; glosses: string; lang: string }>
          ) => {
            deleteStmt.run(language);
            for (const entry of dictionaryEntries) {
              insertStmt.run(entry.word, entry.pos, entry.glosses, entry.lang);
            }
          }
        );

        transaction(entries);
        await this.setSetting(markerKey, 'true');
        this.logger.info(
          { language, entryCount: entries.length },
          `Dictionary populated for ${language} (${entries.length} entries)`
        );
      } catch (error) {
        this.logger.warn({ error, language }, `Failed to import dictionary for ${language}`);
      }
    }
  }
  private async parseDictionaryFile(
    filePath: string,
    language: string
  ): Promise<Array<{ word: string; pos: string; glosses: string; lang: string }>> {
    let rawContents: string;

    try {
      rawContents = await fsPromises.readFile(filePath, 'utf-8');
    } catch (error) {
      throw wrapError(error, `Unable to read dictionary file ${filePath}`);
    }

    const lines = rawContents.split('\n');
    const entries: Array<{ word: string; pos: string; glosses: string; lang: string }> = [];
    const seen = new Set<string>();

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      try {
        const parsed = JSON.parse(trimmed) as {
          word?: unknown;
          pos?: unknown;
          glosses?: unknown;
        };

        const word = typeof parsed.word === 'string' ? parsed.word.trim() : '';
        if (!word) {
          return;
        }

        const pos = typeof parsed.pos === 'string' ? parsed.pos.trim() : '';

        let glossesArray: string[] = [];
        if (Array.isArray(parsed.glosses)) {
          glossesArray = parsed.glosses.map((gloss) => String(gloss).trim()).filter(Boolean);
        } else if (parsed.glosses) {
          glossesArray = [String(parsed.glosses).trim()].filter(Boolean);
        }

        const dedupeKey = `${word.toLowerCase()}|${pos.toLowerCase()}|${glossesArray.join('|').toLowerCase()}|${language}`;
        if (seen.has(dedupeKey)) {
          return;
        }

        seen.add(dedupeKey);
        entries.push({
          word,
          pos,
          glosses: JSON.stringify(glossesArray),
          lang: language,
        });
      } catch (error) {
        this.logger.warn(
          { error, filePath: path.basename(filePath), lineNumber: index + 1 },
          `Failed to parse dictionary entry in ${path.basename(filePath)} at line ${index + 1}`
        );
      }
    });

    return entries;
  }

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  private mapRowToWord(row: Record<string, unknown>): Word {
    return {
      id: row.id as number,
      word: row.word as string,
      language: row.language as string,
      translation: row.translation as string,
      strength: row.strength as number,
      known: Boolean(row.known),
      ignored: Boolean(row.ignored),
      createdAt: new Date(row.created_at as string | number | Date),
      lastStudied: row.last_studied
        ? new Date(row.last_studied as string | number | Date)
        : undefined,
      intervalDays: (row.interval_days as number) || 1,
      easeFactor: (row.ease_factor as number) || 2.5,
      lastReview: row.last_review ? new Date(row.last_review as string | number | Date) : undefined,
      nextDue: row.next_due ? new Date(row.next_due as string | number | Date) : new Date(),
      fsrsDifficulty: (row.fsrs_difficulty as number) ?? undefined,
      fsrsStability: (row.fsrs_stability as number) ?? undefined,
      fsrsLapses: (row.fsrs_lapses as number) ?? undefined,
      fsrsLastRating: (row.fsrs_last_rating as number) ?? undefined,
      processingStatus: (row.processing_status as WordProcessingStatus) ?? 'ready',
      sentenceCount: (row.sentence_count as number) ?? 0,
      grammarExplanationCount: (row.grammar_explanation_count as number) ?? 0,
      topic: (row.topic as string) ?? undefined,
      addedVia: (row.added_via as string) ?? undefined,
      zipfFrequency: (row.zipf_frequency as number) ?? undefined,
    };
  }

  private mapRowToSentence(row: Record<string, unknown>): Sentence {
    // Parse related_words JSON if present
    let relatedWords: string[] | undefined;
    if (row.related_words) {
      try {
        const parsed = JSON.parse(row.related_words as string);
        if (Array.isArray(parsed)) {
          relatedWords = parsed.map((w) => String(w));
        }
      } catch {
        // Ignore JSON parsing errors
      }
    }

    return {
      id: row.id as number,
      wordId: row.word_id as number,
      language: row.language as string,
      sentence: row.sentence as string,
      sentenceParts: parseSentenceParts(row.sentence_parts as string | null | undefined),
      tokenizedTokens: parseTokenizedTokens(row.sentence_tokens as string | null | undefined),
      translation: row.translation as string,
      audioPath: (row.audio_path as string) || '',
      createdAt: new Date(row.created_at as string | number | Date),
      lastShown: row.last_shown ? new Date(row.last_shown as string | number | Date) : undefined,
      playCount: (row.play_count as number) || 0,
      contextBefore: (row.context_before as string) || undefined,
      contextAfter: (row.context_after as string) || undefined,
      contextBeforeTranslation: (row.context_before_translation as string) || undefined,
      contextAfterTranslation: (row.context_after_translation as string) || undefined,
      sentenceGenerationModel: (row.sentence_generation_model as string) || undefined,
      audioGenerationService: (row.audio_generation_service as string) || undefined,
      audioGenerationModel: (row.audio_generation_model as string) || undefined,
      audioGenerationVoiceId: (row.audio_generation_voice_id as string) || undefined,
      beforeSentenceAudioPath: (row.before_sentence_audio_path as string) || undefined,
      afterSentenceAudioPath: (row.after_sentence_audio_path as string) || undefined,
      ignored: row.ignored === 1 || row.ignored === true,
      relatedWords,
      pronunciation: (row.pronunciation as string) || undefined,
      contextBeforePronunciation: (row.context_before_pronunciation as string) || undefined,
      contextAfterPronunciation: (row.context_after_pronunciation as string) || undefined,
    };
  }

  private mapRowToWordGenerationJob(row: Record<string, unknown>): WordGenerationJob {
    return {
      id: row.id as number,
      wordId: row.word_id as number,
      language: row.language as string,
      topic: (row.topic as string) ?? undefined,
      desiredSentenceCount: (row.desired_sentence_count as number) ?? 3,
      status: row.status as WordGenerationJobStatus,
      attempts: (row.attempts as number) ?? 0,
      lastError: (row.last_error as string) ?? undefined,
      createdAt: row.created_at ? new Date(row.created_at as string | number | Date) : new Date(),
      updatedAt: row.updated_at ? new Date(row.updated_at as string | number | Date) : new Date(),
      startedAt: row.started_at ? new Date(row.started_at as string | number | Date) : undefined,
    };
  }

  private parseGlossesField(glosses: string): string[] {
    if (!glosses) {
      return [];
    }

    try {
      const parsed = JSON.parse(glosses);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch {
      // Ignore JSON parsing errors and fall back to string parsing
    }

    return glosses
      .split(/[;,]/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  async getNewWordCount(language: string): Promise<number> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        SELECT COUNT(*) as count FROM words 
        WHERE language = ? 
        AND known = FALSE 
        AND ignored = FALSE 
        AND last_studied IS NULL
      `);

      const result = stmt.get(language) as { count: number };
      return result.count;
    } catch (error) {
      throw wrapError(error, `Failed to get new word count`);
    }
  }
  async getWeakWordCount(language: string): Promise<number> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        SELECT COUNT(*) as count FROM words 
        WHERE language = ? 
        AND known = FALSE 
        AND ignored = FALSE 
        AND strength < 30
      `);

      const result = stmt.get(language) as { count: number };
      return result.count;
    } catch (error) {
      throw wrapError(error, `Failed to get weak word count`);
    }
  }
  // "cluster" = words associated with sentences that have contextBefore (dialog sentences).
  async getDialogueReadinessRatio(language: string, minStrength: number = 40): Promise<number> {
    const db = this.getDb();

    try {
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
    } catch (error) {
      throw wrapError(error, `Failed to get dialogue readiness ratio`);
    }
  }
  // similarity_score is stored 0-1; this returns it on a 0-10 scale.
  async getAveragePronunciationScore(language: string): Promise<number> {
    const db = this.getDb();

    try {
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
    } catch (error) {
      throw wrapError(error, `Failed to get average pronunciation score`);
    }
  }
  async getAvailableSentencesCount(language: string): Promise<number> {
    const db = this.getDb();

    try {
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
    } catch (error) {
      throw wrapError(error, `Failed to get available sentences count`);
    }
  }
  async getTimeSinceLastActivePractice(language: string): Promise<number> {
    const db = this.getDb();

    try {
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
    } catch (error) {
      throw wrapError(error, `Failed to get time since last active practice`);
    }
  }
  async resetLanguageProgress(language: string): Promise<void> {
    const db = this.getDb();

    try {
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
    } catch (error) {
      throw wrapError(error, `Failed to reset language progress`);
    }
  }
  async recordSRSAdjustment(data: {
    wordId: number;
    sessionId?: number;
    recallRating?: number;
    strengthDelta: number;
    language: string;
  }): Promise<number> {
    const db = this.getDb();

    try {
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
    } catch (error) {
      throw wrapError(error, `Failed to record SRS adjustment`);
    }
  }
  async createLearningSession(data: {
    mode: 'learning' | 'quiz' | 'dialog' | 'flow';
    language: string;
  }): Promise<number> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        INSERT INTO learning_sessions (mode, language, started_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `);

      const result = stmt.run(data.mode, data.language);
      return result.lastInsertRowid as number;
    } catch (error) {
      throw wrapError(error, `Failed to create learning session`);
    }
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
    const db = this.getDb();

    try {
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
    } catch (error) {
      throw wrapError(error, `Failed to get learning session`);
    }
  }
  async recordAudioPlayback(data: {
    sessionId?: number;
    sentenceId?: number;
    audioPath: string;
    language: string;
    mode: 'learning' | 'quiz' | 'dialog' | 'flow';
    playbackSpeed?: number;
  }): Promise<number> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        INSERT INTO audio_playback_events (session_id, sentence_id, audio_path, language, mode, playback_speed)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        data.sessionId || null,
        data.sentenceId || null,
        data.audioPath,
        data.language,
        data.mode,
        data.playbackSpeed ?? 1.0
      );

      return result.lastInsertRowid as number;
    } catch (error) {
      throw wrapError(error, `Failed to record audio playback`);
    }
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
  async recordDictionaryHover(data: {
    word: string;
    language: string;
    sentenceId?: number;
    sessionId?: number;
    hoverDurationMs: number;
    dictionaryKey?: string;
    foundInDict: boolean;
  }): Promise<number> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        INSERT INTO dictionary_hover_events (word, language, sentence_id, session_id, hover_duration_ms, dictionary_key, found_in_dict)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        data.word,
        data.language,
        data.sentenceId || null,
        data.sessionId || null,
        data.hoverDurationMs,
        data.dictionaryKey || null,
        data.foundInDict ? 1 : 0
      );

      return result.lastInsertRowid as number;
    } catch (error) {
      throw wrapError(error, `Failed to record dictionary hover event`);
    }
  }
  async processFrequentlyLookedUpWords(
    language: string,
    minHoverCount: number = 3,
    lookbackDays: number = 30
  ): Promise<number> {
    const db = this.getDb();

    try {
      // Calculate the lookback date
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);
      const lookbackDateStr = lookbackDate.toISOString();

      // Find frequently looked-up words from dictionary_hover_events
      // Group by word and language, count occurrences, filter by min count and lookback period
      const frequentlyLookedUpStmt = db.prepare(`
        SELECT 
          word,
          language,
          COUNT(*) as hover_count,
          MAX(created_at) as last_hover
        FROM dictionary_hover_events
        WHERE language = ?
          AND created_at >= ?
          AND found_in_dict = 1
        GROUP BY word, language
        HAVING COUNT(*) >= ?
        ORDER BY hover_count DESC, last_hover DESC
      `);

      const frequentlyLookedUp = frequentlyLookedUpStmt.all(
        language,
        lookbackDateStr,
        minHoverCount
      ) as Array<{
        word: string;
        language: string;
        hover_count: number;
        last_hover: string;
      }>;

      if (frequentlyLookedUp.length === 0) {
        this.logger.debug(
          { language: language },
          `[processFrequentlyLookedUpWords] No frequently looked-up words found for ${language}`
        );
        return 0;
      }

      this.logger.debug(
        { language: language, wordCount: frequentlyLookedUp.length },
        `[processFrequentlyLookedUpWords] Found ${frequentlyLookedUp.length} frequently looked-up words for ${language}`
      );

      // Check which words already exist in the words table
      const checkWordExistsStmt = db.prepare(`
        SELECT id FROM words 
        WHERE LOWER(word) = LOWER(?) AND language = ?
      `);

      // Get dictionary lookup for translation
      const getDictTranslationStmt = db.prepare(`
        SELECT glosses 
        FROM dict 
        WHERE LOWER(word) = LOWER(?) AND lang = ?
        LIMIT 1
      `);

      let wordsAdded = 0;
      const wordsToAdd: Array<{ word: string; language: string; translation: string }> = [];

      for (const item of frequentlyLookedUp) {
        // Check if word already exists
        const existingWord = checkWordExistsStmt.get(item.word, item.language) as
          | { id: number }
          | undefined;

        if (existingWord) {
          // Word already exists, skip
          continue;
        }

        // Try to get translation from dictionary
        const dictEntry = getDictTranslationStmt.get(item.word, item.language) as
          | { glosses: string }
          | undefined;

        let translation: string;
        if (dictEntry && dictEntry.glosses) {
          try {
            const glosses = JSON.parse(dictEntry.glosses);
            if (Array.isArray(glosses) && glosses.length > 0) {
              translation = glosses[0]; // Use first gloss as translation
            } else {
              translation = item.word; // Fallback to word itself
            }
          } catch {
            // If parsing fails, try to extract from string
            const glossesStr = dictEntry.glosses.trim();
            if (glossesStr) {
              translation = glossesStr.split(/[;,]/)[0].trim() || item.word;
            } else {
              translation = item.word;
            }
          }
        } else {
          // No dictionary entry found, use word as placeholder
          translation = item.word;
        }

        wordsToAdd.push({
          word: item.word,
          language: item.language,
          translation,
        });
      }

      if (wordsToAdd.length === 0) {
        this.logger.debug(
          `[processFrequentlyLookedUpWords] All frequently looked-up words already exist`
        );
        return 0;
      }

      this.logger.info(
        { wordCount: wordsToAdd.length },
        `[processFrequentlyLookedUpWords] Adding ${wordsToAdd.length} new words from dictionary hovers`
      );

      // Insert words and enqueue for generation
      for (const wordData of wordsToAdd) {
        try {
          // Insert word
          const wordId = await this.insertWord({
            word: wordData.word,
            language: wordData.language,
            translation: wordData.translation,
          });

          // Enqueue for sentence generation
          await this.enqueueWordGeneration(wordId, wordData.language, undefined, 3);

          wordsAdded++;
          this.logger.debug(
            { wordId, word: wordData.word },
            `[processFrequentlyLookedUpWords] Added word: ${wordData.word} (ID: ${wordId})`
          );
        } catch (error) {
          this.logger.warn(
            { error, word: wordData.word },
            `[processFrequentlyLookedUpWords] Failed to add word "${wordData.word}"`
          );
          // Continue with next word
        }
      }

      this.logger.info(
        { wordsAdded },
        `[processFrequentlyLookedUpWords] Successfully added ${wordsAdded} words from dictionary hovers`
      );
      return wordsAdded;
    } catch (error) {
      throw wrapError(error, `Failed to process frequently looked-up words`);
    }
  }
  async getZipfFrequencies(words: string[], language: string): Promise<Record<string, number>> {
    const db = this.getDb();

    try {
      if (words.length === 0) {
        return {};
      }

      // Create placeholders for IN clause
      const placeholders = words.map(() => '?').join(',');
      const stmt = db.prepare(`
        SELECT word, zipf_frequency 
        FROM words 
        WHERE word IN (${placeholders}) 
        AND language = ? 
        AND zipf_frequency IS NOT NULL
      `);

      const rows = stmt.all(...words, language) as Array<{ word: string; zipf_frequency: number }>;
      const result: Record<string, number> = {};

      for (const row of rows) {
        result[row.word] = row.zipf_frequency;
      }

      return result;
    } catch (error) {
      throw wrapError(error, `Failed to get zipf frequencies`);
    }
  }
  async updateZipfFrequencies(
    frequencies: Record<string, number>,
    language: string
  ): Promise<void> {
    const db = this.getDb();

    try {
      if (Object.keys(frequencies).length === 0) {
        return;
      }

      const updateStmt = db.prepare(`
        UPDATE words 
        SET zipf_frequency = ? 
        WHERE word = ? AND language = ?
      `);

      const transaction = db.transaction((freqs: Record<string, number>) => {
        for (const [word, frequency] of Object.entries(freqs)) {
          updateStmt.run(frequency, word, language);
        }
      });

      transaction(frequencies);

      this.logger.debug(
        { wordCount: Object.keys(frequencies).length, language },
        '[updateZipfFrequencies] Updated zipf frequencies'
      );
    } catch (error) {
      throw wrapError(error, `Failed to update zipf frequencies`);
    }
  }
  async getReadAloudCache(
    text: string,
    language: string
  ): Promise<{ id: number; rawText: string; audioPath: string } | null> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        SELECT id, raw_text, audio_path
        FROM read_aloud_cache
        WHERE raw_text = ? AND language = ?
      `);

      const row = stmt.get(text, language) as
        | { id: number; raw_text: string; audio_path: string }
        | undefined;

      if (!row) {
        return null;
      }

      return {
        id: row.id,
        rawText: row.raw_text,
        audioPath: row.audio_path,
      };
    } catch (error) {
      throw wrapError(error, `Failed to get read aloud cache`);
    }
  }
  async insertReadAloudCache(text: string, language: string, audioPath: string): Promise<number> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO read_aloud_cache (raw_text, language, audio_path)
        VALUES (?, ?, ?)
      `);

      const result = stmt.run(text, language, audioPath);
      return result.lastInsertRowid as number;
    } catch (error) {
      throw wrapError(error, `Failed to insert read aloud cache`);
    }
  }
}
