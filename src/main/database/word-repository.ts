/**
 * Word CRUD, lookup and duplicate checking.
 */

import { addDays } from 'date-fns';
import { Word, CreateWordRequest } from '../../shared/types/core.js';
import { splitSentenceIntoParts } from '../../shared/utils/sentence.js';
import { shuffleArray, mapRowToWord } from './mappers.js';
import { BaseRepository } from './base-repository.js';
import { DatabaseConnection } from './connection.js';
import { Logger } from '../../shared/utils/logger.js';
import { SrsRepository } from './srs-repository.js';

export class WordRepository extends BaseRepository {
  constructor(
    connection: DatabaseConnection,
    logger: Logger,
    private readonly srs: SrsRepository
  ) {
    super(connection, logger);
  }
  private getWordsWithSentencesBase(
    language: string,
    includeKnown: boolean,
    includeIgnored: boolean,
    order: 'random' | 'studied'
  ): Word[] {
    const db = this.getDb();
    const where: string[] = ['w.language = ?'];
    if (!includeKnown) where.push('w.known = FALSE');
    if (!includeIgnored) where.push('w.ignored = FALSE');
    const orderBy =
      order === 'random'
        ? 'ORDER BY w.strength ASC, RANDOM()'
        : 'ORDER BY w.last_studied ASC NULLS FIRST';
    const stmt = db.prepare(`
      SELECT DISTINCT w.* FROM words w
      INNER JOIN sentence_words sw ON w.id = sw.word_id
      WHERE ${where.join(' AND ')}
      ${orderBy}
    `);
    return (stmt.all(language) as any[]).map(mapRowToWord);
  }

  private setWordBooleanField(wordId: number, field: 'known' | 'ignored', value: boolean): void {
    const result = this.getDb()
      .prepare(`UPDATE words SET ${field} = ?, last_studied = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(value ? 1 : 0, wordId);
    this.requireChange(result, 'Word', wordId);
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
    const result = this.getDb()
      .prepare('UPDATE words SET strength = ?, last_studied = CURRENT_TIMESTAMP WHERE id = ?')
      .run(strength, wordId);
    this.requireChange(result, 'Word', wordId);
  }
  async markWordKnown(wordId: number, known: boolean): Promise<void> {
    this.setWordBooleanField(wordId, 'known', known);
  }
  async markWordIgnored(wordId: number, ignored: boolean): Promise<void> {
    this.setWordBooleanField(wordId, 'ignored', ignored);
  }
  async getWordsToStudy(limit: number, language: string): Promise<Word[]> {
    const db = this.getDb();

    // First, get words due for review (SRS priority)
    const dueWords = await this.srs.getWordsDueWithPriority(language, limit);

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
    const additionalWords = rows.map(mapRowToWord);

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

    return rows.map(mapRowToWord);
  }
  async getWordsWithSentences(
    language: string,
    includeKnown: boolean = true,
    includeIgnored: boolean = false
  ): Promise<Word[]> {
    return shuffleArray(
      this.getWordsWithSentencesBase(language, includeKnown, includeIgnored, 'random')
    );
  }
  async getWordsWithSentencesOrderedByStrength(
    language: string,
    includeKnown: boolean = true,
    includeIgnored: boolean = false
  ): Promise<Word[]> {
    return this.getWordsWithSentencesBase(language, includeKnown, includeIgnored, 'studied');
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
    const words = rows.map(mapRowToWord);

    // Additional shuffling for learning words to ensure variety
    if (!includeKnown && !includeIgnored) {
      return shuffleArray(words);
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
    return rows.map(mapRowToWord);
  }
  async getWordById(wordId: number): Promise<Word | null> {
    const db = this.getDb();

    const stmt = db.prepare('SELECT * FROM words WHERE id = ?');
    const row = stmt.get(wordId) as any;

    return row ? mapRowToWord(row) : null;
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

    return rows.map((row) => mapRowToWord(row));
  }
  // TODO: This needs some SQL optimization.
  findMatchingLearningWords(sentence: string, language: string): Word[] {
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
        const mappedWord = mapRowToWord(word);
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
}
