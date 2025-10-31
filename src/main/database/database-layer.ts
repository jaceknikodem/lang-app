/**
 * Main database layer implementation
 */

import Database from 'better-sqlite3';
import path from 'path';
import { promises as fsPromises } from 'fs';
import { DatabaseLayer, DatabaseConfig, JobWordInfo, WordGenerationJob, WordGenerationJobStatus, WordProcessingStatus } from '../../shared/types/database.js';
import { Word, Sentence, StudyStats, CreateWordRequest, DictionaryEntry } from '../../shared/types/core.js';
import { DatabaseConnection } from './connection.js';
import { MigrationManager } from './migrations.js';
import { splitSentenceIntoParts, serializeSentenceParts, parseSentenceParts, serializeTokenizedTokens, parseTokenizedTokens } from '../../shared/utils/sentence.js';
import { backfillSentenceTokens } from './backfill-sentence-tokens.js';

export class SQLiteDatabaseLayer implements DatabaseLayer {
  private connection: DatabaseConnection;
  private migrationManager: MigrationManager | null = null;

  constructor(config: DatabaseConfig) {
    this.connection = new DatabaseConnection(config);
  }

  /**
   * Initialize database connection and run migrations
   */
  async initialize(): Promise<void> {
    try {
      const db = await this.connection.connect();
      
      // Initialize and run migrations
      this.migrationManager = new MigrationManager(db);
      await this.migrationManager.migrate();

      // Defer expensive operations to background - don't block startup
      // Backfill sentence parts in background (non-blocking)
      setImmediate(() => {
        this.backfillSentenceParts();
      });

      // Backfill sentence tokens in background (non-blocking)
      // This precomputes tokens for existing sentences
      setImmediate(async () => {
        try {
          await this.runSentenceTokenBackfill();
        } catch (tokenError) {
          console.warn('Sentence token backfill skipped due to error:', tokenError);
        }
      });

      // Populate dictionary data from bundled files in background (non-blocking)
      // This is a very expensive operation that can take several seconds
      setImmediate(async () => {
        try {
          await this.populateDictionaryFromFiles();
        } catch (dictError) {
          console.warn('Dictionary population skipped due to error:', dictError);
        }
      });
      
      console.log('Database initialized successfully');
    } catch (error) {
      throw new Error(`Failed to initialize database: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.connection.close();
  }

  /**
   * Get database instance for operations
   */
  private getDb(): Database.Database {
    return this.connection.getDatabase();
  }

  // Word management operations

  /**
   * Insert a new word into the database
   */
  async insertWord(wordData: CreateWordRequest): Promise<number> {
    const db = this.getDb();
    
    try {
      // Initialize SRS values for new word
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const stmt = db.prepare(`
        INSERT INTO words (
          word, language, translation, audio_path,
          strength, interval_days, ease_factor, next_due
        )
        VALUES (?, ?, ?, ?, 20, 1, 2.5, ?)
      `);
      
      const result = stmt.run(
        wordData.word,
        wordData.language,
        wordData.translation,
        wordData.audioPath || null,
        tomorrow.toISOString()
      );
      
      return result.lastInsertRowid as number;
    } catch (error) {
      throw new Error(`Failed to insert word: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update word strength based on user performance
   */
  async updateWordStrength(wordId: number, strength: number): Promise<void> {
    const db = this.getDb();
    
    // Ensure strength is non-negative
    const clampedStrength = Math.max(0, strength);
    
    try {
      const stmt = db.prepare(`
        UPDATE words 
        SET strength = ?, last_studied = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      
      const result = stmt.run(clampedStrength, wordId);
      
      if (result.changes === 0) {
        throw new Error(`Word with ID ${wordId} not found`);
      }
    } catch (error) {
      throw new Error(`Failed to update word strength: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Mark word as known or unknown
   */
  async markWordKnown(wordId: number, known: boolean): Promise<void> {
    const db = this.getDb();
    
    try {
      const stmt = db.prepare(`
        UPDATE words 
        SET known = ?, last_studied = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      
      const result = stmt.run(known ? 1 : 0, wordId);
      
      if (result.changes === 0) {
        throw new Error(`Word with ID ${wordId} not found`);
      }
    } catch (error) {
      throw new Error(`Failed to mark word as known: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Mark word as ignored or not ignored
   */
  async markWordIgnored(wordId: number, ignored: boolean): Promise<void> {
    const db = this.getDb();
    
    try {
      const stmt = db.prepare(`
        UPDATE words 
        SET ignored = ?, last_studied = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      
      const result = stmt.run(ignored ? 1 : 0, wordId);
      
      if (result.changes === 0) {
        throw new Error(`Word with ID ${wordId} not found`);
      }
    } catch (error) {
      throw new Error(`Failed to mark word as ignored: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get words to study, prioritizing SRS due words first, then by lowest strength
   */
  async getWordsToStudy(limit: number, language?: string): Promise<Word[]> {
    const db = this.getDb();
    
    try {
      const currentLanguage = language || await this.getCurrentLanguage();
      
      // First, get words due for review (SRS priority)
      const dueWords = await this.getWordsDueWithPriority(limit, currentLanguage);
      
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
      
      const rows = stmt.all(currentLanguage, now, remainingLimit) as any[];
      const additionalWords = rows.map(this.mapRowToWord);
      
      // Combine due words with additional words
      return [...dueWords, ...additionalWords];
    } catch (error) {
      throw new Error(`Failed to get words to study: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get words by strength range for targeted practice
   */
  async getWordsByStrength(minStrength: number, maxStrength: number, limit?: number, language?: string): Promise<Word[]> {
    const db = this.getDb();
    
    try {
      const currentLanguage = language || await this.getCurrentLanguage();
      
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
      const params = limit ? [minStrength, maxStrength, currentLanguage, limit] : [minStrength, maxStrength, currentLanguage];
      const rows = stmt.all(...params) as any[];
      
      return rows.map(this.mapRowToWord);
    } catch (error) {
      throw new Error(`Failed to get words by strength: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get words that have sentences available for learning
   */
  async getWordsWithSentences(includeKnown: boolean = true, includeIgnored: boolean = false, language?: string): Promise<Word[]> {
    const db = this.getDb();
    
    try {
      const currentLanguage = language || await this.getCurrentLanguage();
      let whereConditions: string[] = [`w.language = ?`];
      
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
      
      const rows = stmt.all(currentLanguage) as any[];
      const words = rows.map(this.mapRowToWord);
      
      return this.shuffleArray(words);
    } catch (error) {
      throw new Error(`Failed to get words with sentences: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get words that have sentences available for review, ordered by strength (weakest first)
   */
  async getWordsWithSentencesOrderedByStrength(includeKnown: boolean = true, includeIgnored: boolean = false, language?: string): Promise<Word[]> {
    const db = this.getDb();
    
    try {
      const currentLanguage = language || await this.getCurrentLanguage();
      let whereConditions: string[] = [`w.language = ?`];
      
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
        ORDER BY w.strength ASC, w.last_studied ASC NULLS FIRST
      `);
      
      const rows = stmt.all(currentLanguage) as any[];
      return rows.map(this.mapRowToWord);
    } catch (error) {
      throw new Error(`Failed to get words with sentences ordered by strength: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get all words with optional filtering and shuffling for learning
   */
  async getAllWords(includeKnown: boolean = true, includeIgnored: boolean = false, language?: string): Promise<Word[]> {
    const db = this.getDb();
    
    try {
      const currentLanguage = language || await this.getCurrentLanguage();
      let whereConditions: string[] = [`language = ?`];
      
      if (!includeKnown) {
        whereConditions.push('known = FALSE');
      }
      
      if (!includeIgnored) {
        whereConditions.push('ignored = FALSE');
      }
      
      const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
      
      // If we're getting words for learning (not including known/ignored), shuffle them
      const orderClause = (!includeKnown && !includeIgnored) 
        ? 'ORDER BY strength ASC, RANDOM()'
        : 'ORDER BY created_at DESC';
      
      const stmt = db.prepare(`
        SELECT * FROM words 
        ${whereClause}
        ${orderClause}
      `);
      
      const rows = stmt.all(currentLanguage) as any[];
      const words = rows.map(this.mapRowToWord);
      
      // Additional shuffling for learning words to ensure variety
      if (!includeKnown && !includeIgnored) {
        return this.shuffleArray(words);
      }
      
      return words;
    } catch (error) {
      throw new Error(`Failed to get all words: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get word by ID
   */
  async getWordById(wordId: number): Promise<Word | null> {
    const db = this.getDb();
    
    try {
      const stmt = db.prepare('SELECT * FROM words WHERE id = ?');
      const row = stmt.get(wordId) as any;
      
      return row ? this.mapRowToWord(row) : null;
    } catch (error) {
      throw new Error(`Failed to get word by ID: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get multiple words by IDs (batch query)
   */
  async getWordsByIds(wordIds: number[]): Promise<Word[]> {
    const db = this.getDb();
    
    try {
      if (wordIds.length === 0) {
        return [];
      }

      const placeholders = wordIds.map(() => '?').join(',');
      const stmt = db.prepare(`SELECT * FROM words WHERE id IN (${placeholders})`);
      const rows = stmt.all(...wordIds) as any[];
      
      return rows.map(row => this.mapRowToWord(row));
    } catch (error) {
      throw new Error(`Failed to get words by IDs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Sentence management operations

  /**
   * Helper function to find all learning words that appear in a sentence
   * Tokenizes the sentence and matches normalized words against learning words
   */
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
        const normalized = part.replace(/[.,!?;:]/g, '').toLowerCase().trim();
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
      console.error('Failed to find matching learning words:', error);
      // Return empty array on error to avoid breaking sentence insertion
      return [];
    }
  }

  /**
   * Insert a new sentence for a word
   */
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
    tokenizedTokens?: any[]
  ): Promise<number> {
    const db = this.getDb();
    
    try {
      const parts = sentenceParts ?? splitSentenceIntoParts(sentence);
      const serializedParts = serializeSentenceParts(parts);
      const serializedTokens = serializeTokenizedTokens(tokenizedTokens);

      // Insert sentence with original wordId (for backwards compatibility)
      const stmt = db.prepare(`
        INSERT INTO sentences (
          word_id, sentence, translation, audio_path,
          context_before, context_after, context_before_translation, context_after_translation,
          sentence_parts, sentence_generation_model, audio_generation_service, audio_generation_model,
          sentence_tokens
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const result = stmt.run(
        wordId, 
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
        serializedTokens
      );

      const sentenceId = result.lastInsertRowid as number;

      // Get the word to determine language
      const word = await this.getWordById(wordId);
      if (!word) {
        throw new Error(`Word with ID ${wordId} not found`);
      }

      // Find all learning words that appear in the sentence
      const matchingWords = this.findMatchingLearningWords(sentence, word.language);

      // Insert entries in junction table for all matching words
      if (matchingWords.length > 0) {
        const insertJunction = db.prepare(`
          INSERT OR IGNORE INTO sentence_words (sentence_id, word_id)
          VALUES (?, ?)
        `);

        const updateSentenceCount = db.prepare(`
          UPDATE words 
          SET sentence_count = sentence_count + 1
          WHERE id = ?
        `);

        for (const matchedWord of matchingWords) {
          try {
            insertJunction.run(sentenceId, matchedWord.id);
            updateSentenceCount.run(matchedWord.id);
          } catch (error) {
            // Ignore duplicate key errors (if entry already exists)
            if (error instanceof Error && !error.message.includes('UNIQUE constraint')) {
              console.warn(`Failed to insert junction table entry for sentence ${sentenceId}, word ${matchedWord.id}:`, error);
            }
          }
        }
      }

      // Also update sentenceCount for the original word (if not already matched)
      if (!matchingWords.find(w => w.id === wordId)) {
        db.prepare(`
          UPDATE words 
          SET sentence_count = sentence_count + 1
          WHERE id = ?
        `).run(wordId);
      }
      
      return sentenceId;
    } catch (error) {
      throw new Error(`Failed to insert sentence: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get all sentences for a specific word in randomized order
   */
  async getSentencesByWord(wordId: number): Promise<Sentence[]> {
    const db = this.getDb();
    
    try {
      // First get sentence IDs from junction table
      const sentenceIdsStmt = db.prepare(`
        SELECT sentence_id FROM sentence_words WHERE word_id = ?
      `);
      
      const sentenceIdsResult = sentenceIdsStmt.all(wordId) as Array<{ sentence_id: number }>;
      
      if (sentenceIdsResult.length === 0) {
        return [];
      }
      
      const sentenceIds = sentenceIdsResult.map(row => row.sentence_id);
      
      // Then fetch sentences by IDs using the junction table
      const placeholders = sentenceIds.map(() => '?').join(',');
      const stmt = db.prepare(`
        SELECT * FROM sentences 
        WHERE id IN (${placeholders})
        ORDER BY RANDOM()
      `);
      
      const rows = stmt.all(...sentenceIds) as any[];
      
      return rows.map(this.mapRowToSentence);
    } catch (error) {
      throw new Error(`Failed to get sentences by word: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get multiple sentences by IDs (batch query)
   */
  async getSentencesByIds(sentenceIds: number[]): Promise<Sentence[]> {
    const db = this.getDb();
    
    try {
      if (sentenceIds.length === 0) {
        return [];
      }

      const placeholders = sentenceIds.map(() => '?').join(',');
      const stmt = db.prepare(`SELECT * FROM sentences WHERE id IN (${placeholders})`);
      const rows = stmt.all(...sentenceIds) as any[];
      
      return rows.map(row => this.mapRowToSentence(row));
    } catch (error) {
      throw new Error(`Failed to get sentences by IDs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update sentence last shown timestamp
   */
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
      throw new Error(`Failed to update sentence last shown: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update sentence audio path after successful regeneration
   */
  async updateSentenceAudioPath(sentenceId: number, audioPath: string): Promise<void> {
    const db = this.getDb();
    try {
      const stmt = db.prepare(`
        UPDATE sentences
        SET audio_path = ?
        WHERE id = ?
      `);
      const result = stmt.run(audioPath, sentenceId);
      if (result.changes === 0) {
        throw new Error(`Sentence with ID ${sentenceId} not found`);
      }
    } catch (error) {
      throw new Error(`Failed to update sentence audio path: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update sentence tokens (precomputed tokenization)
   */
  async updateSentenceTokens(sentenceId: number, tokens: any[]): Promise<void> {
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
    } catch (error) {
      throw new Error(`Failed to update sentence tokens: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get all sentences (for backfill operations)
   */
  async getAllSentences(): Promise<Sentence[]> {
    const db = this.getDb();
    
    try {
      const stmt = db.prepare('SELECT * FROM sentences ORDER BY id');
      const rows = stmt.all() as any[];
      
      return rows.map(row => this.mapRowToSentence(row));
    } catch (error) {
      throw new Error(`Failed to get all sentences: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get sentence by ID
   */
  async getSentenceById(sentenceId: number): Promise<Sentence | null> {
    const db = this.getDb();
    
    try {
      const stmt = db.prepare('SELECT * FROM sentences WHERE id = ?');
      const row = stmt.get(sentenceId) as any;
      
      return row ? this.mapRowToSentence(row) : null;
    } catch (error) {
      throw new Error(`Failed to get sentence by ID: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete a sentence by ID
   */
  async deleteSentence(sentenceId: number): Promise<void> {
    const db = this.getDb();
    
    try {
      // Get original wordId before deletion (for backwards compatibility fallback)
      const sentence = db.prepare('SELECT word_id FROM sentences WHERE id = ?').get(sentenceId) as { word_id: number } | undefined;
      
      // Get all words linked to this sentence via junction table
      const linkedWords = db.prepare('SELECT word_id FROM sentence_words WHERE sentence_id = ?').all(sentenceId) as Array<{ word_id: number }>;
      
      // Delete the sentence (junction table entries will be cascade deleted)
      const stmt = db.prepare('DELETE FROM sentences WHERE id = ?');
      const result = stmt.run(sentenceId);
      
      if (result.changes === 0) {
        throw new Error(`Sentence with ID ${sentenceId} not found`);
      }

      // Update sentenceCount for all words that were linked to this sentence
      const updateSentenceCount = db.prepare(`
        UPDATE words 
        SET sentence_count = CASE 
          WHEN sentence_count > 0 THEN sentence_count - 1 
          ELSE 0 
        END
        WHERE id = ?
      `);

      if (linkedWords.length > 0) {
        for (const linkedWord of linkedWords) {
          updateSentenceCount.run(linkedWord.word_id);
        }
      } else if (sentence?.word_id) {
        // Fallback: if no junction table entries (old data), use original wordId
        updateSentenceCount.run(sentence.word_id);
      }
    } catch (error) {
      throw new Error(`Failed to delete sentence: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Progress tracking operations

  /**
   * Update last studied timestamp for a word
   */
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
      throw new Error(`Failed to update last studied: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get study statistics
   */
  async getStudyStats(language?: string): Promise<StudyStats> {
    const db = this.getDb();
    
    try {
      const currentLanguage = language || await this.getCurrentLanguage();
      
      const statsStmt = db.prepare(`
        SELECT 
          COUNT(*) as totalWords,
          COUNT(CASE WHEN last_studied IS NOT NULL THEN 1 END) as wordsStudied,
          AVG(CASE WHEN last_studied IS NOT NULL THEN strength ELSE NULL END) as averageStrength,
          MAX(last_studied) as lastStudyDate
        FROM words
        WHERE ignored = FALSE AND language = ?
      `);
      
      const stats = statsStmt.get(currentLanguage) as any;
      
      return {
        totalWords: stats.totalWords || 0,
        wordsStudied: stats.wordsStudied || 0,
        averageStrength: stats.averageStrength || 0,
        lastStudyDate: stats.lastStudyDate ? new Date(stats.lastStudyDate) : undefined
      };
    } catch (error) {
      throw new Error(`Failed to get study stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Record a study session in progress tracking
   */
  async recordStudySession(wordsStudied: number): Promise<void> {
    const db = this.getDb();
    
    try {
      const stmt = db.prepare(`
        INSERT INTO progress (words_studied, when_studied)
        VALUES (?, CURRENT_TIMESTAMP)
      `);
      
      stmt.run(wordsStudied);
    } catch (error) {
      throw new Error(`Failed to record study session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get recent study sessions
   */
  async getRecentStudySessions(limit: number = 10): Promise<Array<{id: number, wordsStudied: number, whenStudied: Date}>> {
    const db = this.getDb();
    
    try {
      const stmt = db.prepare(`
        SELECT id, words_studied, when_studied
        FROM progress
        ORDER BY when_studied DESC
        LIMIT ?
      `);
      
      const rows = stmt.all(limit) as any[];
      
      return rows.map(row => ({
        id: row.id,
        wordsStudied: row.words_studied,
        whenStudied: new Date(row.when_studied)
      }));
    } catch (error) {
      throw new Error(`Failed to get recent study sessions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Quiz-specific operations

  /**
   * Get weakest words for quiz generation, prioritizing SRS due words and lowest strength
   */
  async getWeakestWords(limit: number, language?: string): Promise<Word[]> {
    const db = this.getDb();
    
    try {
      const currentLanguage = language || await this.getCurrentLanguage();
      
      // Prioritize words due for review, then weakest words
      const dueWords = await this.getWordsDueWithPriority(limit, currentLanguage);
      
      if (dueWords.length >= limit) {
        return dueWords.slice(0, limit);
      }
      
      // Get additional weak words if needed (only words with sentences)
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
      
      const rows = stmt.all(currentLanguage, now, remainingLimit) as any[];
      const additionalWords = rows.map(this.mapRowToWord);
      
      return [...dueWords, ...additionalWords];
    } catch (error) {
      throw new Error(`Failed to get weakest words: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get a random sentence for a specific word (for quiz questions)
   */
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
      
      const sentenceIds = sentenceIdsResult.map(row => row.sentence_id);
      
      // Then fetch a random sentence by IDs using the junction table
      const placeholders = sentenceIds.map(() => '?').join(',');
      const stmt = db.prepare(`
        SELECT * FROM sentences 
        WHERE id IN (${placeholders})
        ORDER BY RANDOM()
        LIMIT 1
      `);
      
      const row = stmt.get(...sentenceIds) as any;
      
      return row ? this.mapRowToSentence(row) : null;
    } catch (error) {
      throw new Error(`Failed to get random sentence for word: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Settings management operations

  /**
   * Get a setting value by key
   */
  async getSetting(key: string): Promise<string | null> {
    const db = this.getDb();
    
    try {
      const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
      const row = stmt.get(key) as any;
      
      return row ? row.value : null;
    } catch (error) {
      throw new Error(`Failed to get setting: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Set a setting value
   */
  async setSetting(key: string, value: string): Promise<void> {
    const db = this.getDb();
    
    try {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `);
      
      stmt.run(key, value);
    } catch (error) {
      throw new Error(`Failed to set setting: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get current language setting
   */
  async getCurrentLanguage(): Promise<string> {
    const language = await this.getSetting('current_language');
    return language || 'spanish'; // Default fallback
  }

  /**
   * Set current language setting
   */
  async setCurrentLanguage(language: string): Promise<void> {
    await this.setSetting('current_language', language);
  }

  /**
   * Get all available languages that have words in the database
   */
  async getAvailableLanguages(): Promise<string[]> {
    const db = this.getDb();
    
    try {
      const stmt = db.prepare(`
        SELECT DISTINCT language 
        FROM words 
        ORDER BY language ASC
      `);
      
      const rows = stmt.all() as any[];
      
      return rows.map(row => row.language);
    } catch (error) {
      throw new Error(`Failed to get available languages: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get word count statistics per language
   */
  async getLanguageStats(): Promise<Array<{language: string, totalWords: number, studiedWords: number}>> {
    const db = this.getDb();
    
    try {
      const stmt = db.prepare(`
        SELECT 
          language,
          COUNT(*) as totalWords,
          COUNT(CASE WHEN last_studied IS NOT NULL THEN 1 END) as studiedWords
        FROM words
        WHERE ignored = FALSE
        GROUP BY language
        ORDER BY language ASC
      `);
      
      const rows = stmt.all() as any[];
      
      return rows.map(row => ({
        language: row.language,
        totalWords: row.totalWords || 0,
        studiedWords: row.studiedWords || 0
      }));
    } catch (error) {
      throw new Error(`Failed to get language stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Lookup dictionary entries for a word in the specified language
   */
  async lookupDictionary(word: string, language?: string): Promise<DictionaryEntry[]> {
    const db = this.getDb();

    try {
      const currentLanguage = language || await this.getCurrentLanguage();

      const stmt = db.prepare(`
        SELECT word, pos, glosses, lang
        FROM dict
        WHERE LOWER(word) = LOWER(?) AND lang = ?
        ORDER BY pos ASC, word ASC
      `);

      const rows = stmt.all(word, currentLanguage) as Array<{
        word: string;
        pos: string;
        glosses: string;
        lang: string;
      }>;

      return rows.map(row => ({
        word: row.word,
        pos: row.pos,
        glosses: this.parseGlossesField(row.glosses),
        lang: row.lang
      }));
    } catch (error) {
      throw new Error(`Failed to lookup dictionary entry: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      throw new Error(`Failed to update word processing status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getWordProcessingInfo(wordId: number): Promise<{ processingStatus: WordProcessingStatus; sentenceCount: number } | null> {
    const db = this.getDb();

    try {
      const stmt = db.prepare(`
        SELECT processing_status, sentence_count
        FROM words
        WHERE id = ?
      `);

      const row = stmt.get(wordId) as { processing_status: WordProcessingStatus; sentence_count: number } | undefined;
      return row
        ? { processingStatus: row.processing_status ?? 'ready', sentenceCount: row.sentence_count ?? 0 }
        : null;
    } catch (error) {
      throw new Error(`Failed to get word processing info: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

      const rows = (language
        ? db.prepare(statusQuery).all(language)
        : db.prepare(statusQuery).all()) as Array<{ status: string; total: number }>;

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
          processingWords: [] as JobWordInfo[]
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

      const jobWordRows = (language
        ? db.prepare(jobWordQuery).all(language)
        : db.prepare(jobWordQuery).all()) as Array<{ wordId: number; status: string; language: string; topic: string | null; word: string }>;

      for (const job of jobWordRows) {
        const info: JobWordInfo = {
          wordId: job.wordId,
          word: job.word,
          status: job.status as WordGenerationJobStatus,
          language: job.language,
          topic: job.topic ?? undefined
        };
        if (job.status === 'processing') {
          summary.processingWords.push(info);
        } else if (job.status === 'queued') {
          summary.queuedWords.push(info);
        }
      }

      return summary;
    } catch (error) {
      throw new Error(`Failed to get queue summary: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async enqueueWordGeneration(wordId: number, language: string, topic?: string, desiredSentenceCount: number = 3): Promise<void> {
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
      throw new Error(`Failed to enqueue word generation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getNextWordGenerationJob(): Promise<WordGenerationJob | null> {
    const db = this.getDb();

    try {
      const row = db.prepare(`
        SELECT * FROM word_generation_queue
        WHERE status = 'queued'
        ORDER BY updated_at ASC, created_at ASC
        LIMIT 1
      `).get() as any | undefined;

      return row ? this.mapRowToWordGenerationJob(row) : null;
    } catch (error) {
      throw new Error(`Failed to get next word generation job: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      throw new Error(`Failed to mark job processing: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async rescheduleWordGenerationJob(jobId: number, delayMs: number, lastError?: string): Promise<void> {
    const db = this.getDb();
    const nextAttempt = new Date(Date.now() + delayMs).toISOString();

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
      throw new Error(`Failed to reschedule job: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      throw new Error(`Failed to complete job: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      throw new Error(`Failed to mark job failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // SRS-specific operations

  /**
   * Update word with SRS values after review
   */
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
      fsrsVersion?: string;
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
        'last_studied = ?'
      ];
      const params: Array<number | string | null> = [
        Math.max(0, strength),
        intervalDays,
        easeFactor,
        nowIso,
        nextDue.toISOString(),
        nowIso
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
        if (options.fsrsVersion !== undefined) {
          updates.push('fsrs_version = ?');
          params.push(options.fsrsVersion);
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
      throw new Error(`Failed to update word SRS: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get words that are due for review (SRS-based selection)
   */
  async getWordsDueForReview(limit?: number, language?: string): Promise<Word[]> {
    const db = this.getDb();
    
    try {
      const currentLanguage = language || await this.getCurrentLanguage();
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
      const params = limit ? [currentLanguage, now, limit] : [currentLanguage, now];
      const rows = stmt.all(...params) as any[];
      
      return rows.map(this.mapRowToWord);
    } catch (error) {
      throw new Error(`Failed to get words due for review: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get count of words due for review
   */
  async getWordsDueCount(language?: string): Promise<number> {
    const db = this.getDb();
    
    try {
      const currentLanguage = language || await this.getCurrentLanguage();
      const now = new Date().toISOString();
      
      const stmt = db.prepare(`
        SELECT COUNT(*) as count FROM words 
        WHERE known = FALSE AND ignored = FALSE 
        AND language = ? AND next_due <= ?
      `);
      
      const result = stmt.get(currentLanguage, now) as { count: number };
      return result.count;
    } catch (error) {
      throw new Error(`Failed to get words due count: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get words due for review with priority sorting for SRS
   */
  async getWordsDueWithPriority(limit?: number, language?: string): Promise<Word[]> {
    const db = this.getDb();
    
    try {
      const currentLanguage = language || await this.getCurrentLanguage();
      const now = new Date().toISOString();
      
      // Get all due words that have sentences (required for quiz mode)
      const stmt = db.prepare(`
        SELECT DISTINCT w.* FROM words w
        INNER JOIN sentence_words sw ON w.id = sw.word_id
        WHERE w.known = FALSE AND w.ignored = FALSE 
        AND w.language = ? AND w.next_due <= ?
      `);
      
      const rows = stmt.all(currentLanguage, now) as any[];
      const words = rows.map(this.mapRowToWord);
      
      // Sort by SRS priority (overdue first, then by strength)
      const sortedWords = words.sort((a, b) => {
        const nowTime = new Date().getTime();
        const aDaysOverdue = Math.max(0, Math.floor((nowTime - a.nextDue.getTime()) / (1000 * 60 * 60 * 24)));
        const bDaysOverdue = Math.max(0, Math.floor((nowTime - b.nextDue.getTime()) / (1000 * 60 * 60 * 24)));
        
        // First sort by overdue status
        if (aDaysOverdue !== bDaysOverdue) {
          return bDaysOverdue - aDaysOverdue; // More overdue first
        }
        
        // Then by strength (weaker first)
        return a.strength - b.strength;
      });
      
      return limit ? sortedWords.slice(0, limit) : sortedWords;
    } catch (error) {
      throw new Error(`Failed to get words due with priority: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get SRS statistics for dashboard
   */
  async getSRSStats(language?: string): Promise<{
    totalWords: number;
    dueToday: number;
    overdue: number;
    averageInterval: number;
    averageEaseFactor: number;
  }> {
    const db = this.getDb();
    
    try {
      const currentLanguage = language || await this.getCurrentLanguage();
      const now = new Date().toISOString();
      const today = new Date();
      today.setHours(23, 59, 59, 999); // End of today
      const todayStr = today.toISOString();
      
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
      
      const result = stmt.get(todayStr, now, currentLanguage) as any;
      
      return {
        totalWords: result.totalWords || 0,
        dueToday: result.dueToday || 0,
        overdue: result.overdue || 0,
        averageInterval: result.averageInterval || 1,
        averageEaseFactor: result.averageEaseFactor || 2.5
      };
    } catch (error) {
      throw new Error(`Failed to get SRS stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Load dictionary entries from JSONL files in the dicts directory
   * Optimized: Checks markers first before doing any file system operations
   */
  private async populateDictionaryFromFiles(): Promise<void> {
    const dictDir = path.join(process.cwd(), 'dicts');
    
    // Check if directory exists before proceeding
    try {
      await fsPromises.access(dictDir);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code !== 'ENOENT') {
        console.warn('Failed to access dictionary directory:', error);
      } else {
        console.warn('Dictionary directory not found, skipping dictionary population');
      }
      return;
    }

    let files: string[];
    try {
      files = await fsPromises.readdir(dictDir);
    } catch (error) {
      console.warn('Failed to read dictionary directory:', error);
      return;
    }

    const jsonlFiles = files.filter(file => file.endsWith('_dict.jsonl'));
    if (jsonlFiles.length === 0) {
      return;
    }

    const db = this.getDb();
    const deleteStmt = db.prepare('DELETE FROM dict WHERE lang = ?');
    const insertStmt = db.prepare('INSERT INTO dict (word, pos, glosses, lang) VALUES (?, ?, ?, ?)');
    const hasEntriesStmt = db.prepare('SELECT 1 FROM dict WHERE lang = ? LIMIT 1');

    // Check all markers FIRST before doing any expensive file operations
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
        console.log(`Dictionary entries already present for ${language}, marked as populated`);
        continue;
      }

      // Only process languages that need importing
      languagesToProcess.push(language);
    }

    // Early return if all dictionaries are already populated
    if (languagesToProcess.length === 0) {
      console.log('All dictionaries already populated, skipping import');
      return;
    }

    // Now process only the languages that need importing
    for (const language of languagesToProcess) {
      const file = `${language}_dict.jsonl`;
      const filePath = path.join(dictDir, file);
      const markerKey = `dictionary_populated_${language}`;

      try {
        const entries = await this.parseDictionaryFile(filePath, language);

        const transaction = db.transaction((dictionaryEntries: Array<{ word: string; pos: string; glosses: string; lang: string }>) => {
          deleteStmt.run(language);
          for (const entry of dictionaryEntries) {
            insertStmt.run(entry.word, entry.pos, entry.glosses, entry.lang);
          }
        });

        transaction(entries);
        await this.setSetting(markerKey, 'true');
        console.log(`Dictionary populated for ${language} (${entries.length} entries)`);
      } catch (error) {
        console.warn(`Failed to import dictionary for ${language}:`, error);
      }
    }
  }

  /**
   * Parse a JSONL dictionary file into database-ready rows
   */
  private async parseDictionaryFile(
    filePath: string,
    language: string
  ): Promise<Array<{ word: string; pos: string; glosses: string; lang: string }>> {
    let rawContents: string;

    try {
      rawContents = await fsPromises.readFile(filePath, 'utf-8');
    } catch (error) {
      throw new Error(`Unable to read dictionary file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
          glossesArray = parsed.glosses
            .map(gloss => String(gloss).trim())
            .filter(Boolean);
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
          lang: language
        });
      } catch (error) {
        console.warn(`Failed to parse dictionary entry in ${path.basename(filePath)} at line ${index + 1}:`, error);
      }
    });

    return entries;
  }

  // Helper methods for mapping database rows to objects and utilities

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  private backfillSentenceParts(): void {
    const db = this.getDb();

    try {
      // Check if backfill is needed - early return if already done
      const checkStmt = db.prepare(`
        SELECT COUNT(*) as count 
        FROM sentences 
        WHERE sentence_parts IS NULL OR sentence_parts = ''
      `);
      const checkResult = checkStmt.get() as { count: number };
      
      if (!checkResult.count || checkResult.count === 0) {
        // No sentences need backfilling - skip entirely
        return;
      }

      const rows = db.prepare(`
        SELECT id, sentence 
        FROM sentences 
        WHERE sentence_parts IS NULL OR sentence_parts = ''
      `).all() as Array<{ id: number; sentence: string }>;

      const updates = rows
        .map(row => {
          const parts = splitSentenceIntoParts(row.sentence);
          const serialized = serializeSentenceParts(parts);
          if (!serialized) {
            return null;
          }
          return { id: row.id, serialized };
        })
        .filter((entry): entry is { id: number; serialized: string } => entry !== null);

      if (!updates.length) {
        return;
      }

      const updateStmt = db.prepare('UPDATE sentences SET sentence_parts = ? WHERE id = ?');
      const updateTransaction = db.transaction((items: Array<{ id: number; serialized: string }>) => {
        for (const item of items) {
          updateStmt.run(item.serialized, item.id);
        }
      });

      updateTransaction(updates);
      console.log(`Backfilled sentence_parts for ${updates.length} sentences`);
    } catch (error) {
      console.warn('Failed to backfill sentence parts:', error);
    }
  }

  /**
   * Backfill sentence tokens for all existing sentences.
   * This precomputes tokenization and dictionary lookups for sentences that don't have them.
   */
  private async runSentenceTokenBackfill(): Promise<void> {
    try {
      // Check if the sentence_tokens column exists before running backfill
      const db = this.getDb();
      try {
        // Try to select from the column to check if it exists
        db.prepare('SELECT sentence_tokens FROM sentences LIMIT 1').get();
      } catch (error) {
        // Column doesn't exist yet - migration may not have run
        console.log('Sentence tokens column not found, skipping backfill (migration may not have run)');
        return;
      }

      await backfillSentenceTokens({
        database: this,
        batchSize: 10,
        onProgress: (processed, total) => {
          if (processed % 50 === 0) {
            console.log(`Backfilling sentence tokens: ${processed}/${total} processed`);
          }
        }
      });
      console.log('Sentence token backfill completed');
    } catch (error) {
      console.error('Failed to backfill sentence tokens:', error);
      // Non-fatal - continue without backfill
    }
  }

  private mapRowToWord(row: any): Word {
    return {
      id: row.id,
      word: row.word,
      language: row.language,
      translation: row.translation,
      audioPath: row.audio_path || '',
      strength: row.strength,
      known: Boolean(row.known),
      ignored: Boolean(row.ignored),
      createdAt: new Date(row.created_at),
      lastStudied: row.last_studied ? new Date(row.last_studied) : undefined,
      // SRS fields
      intervalDays: row.interval_days || 1,
      easeFactor: row.ease_factor || 2.5,
      lastReview: row.last_review ? new Date(row.last_review) : undefined,
      nextDue: row.next_due ? new Date(row.next_due) : new Date(),
      fsrsDifficulty: row.fsrs_difficulty ?? undefined,
      fsrsStability: row.fsrs_stability ?? undefined,
      fsrsLapses: row.fsrs_lapses ?? undefined,
      fsrsLastRating: row.fsrs_last_rating ?? undefined,
      fsrsVersion: row.fsrs_version ?? undefined,
      processingStatus: row.processing_status ?? 'ready',
      sentenceCount: row.sentence_count ?? 0
    };
  }

  private mapRowToSentence(row: any): Sentence {
    return {
      id: row.id,
      wordId: row.word_id,
      sentence: row.sentence,
      sentenceParts: parseSentenceParts(row.sentence_parts),
      tokenizedTokens: parseTokenizedTokens(row.sentence_tokens),
      translation: row.translation,
      audioPath: row.audio_path || '',
      createdAt: new Date(row.created_at),
      lastShown: row.last_shown ? new Date(row.last_shown) : undefined,
      contextBefore: row.context_before || undefined,
      contextAfter: row.context_after || undefined,
      contextBeforeTranslation: row.context_before_translation || undefined,
      contextAfterTranslation: row.context_after_translation || undefined,
      sentenceGenerationModel: row.sentence_generation_model || undefined,
      audioGenerationService: row.audio_generation_service || undefined,
      audioGenerationModel: row.audio_generation_model || undefined
    };
  }

  private mapRowToWordGenerationJob(row: any): WordGenerationJob {
    return {
      id: row.id,
      wordId: row.word_id,
      language: row.language,
      topic: row.topic ?? undefined,
      desiredSentenceCount: row.desired_sentence_count ?? 3,
      status: row.status as WordGenerationJobStatus,
      attempts: row.attempts ?? 0,
      lastError: row.last_error ?? undefined,
      createdAt: row.created_at ? new Date(row.created_at) : new Date(),
      updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
      startedAt: row.started_at ? new Date(row.started_at) : undefined
    };
  }

  private parseGlossesField(glosses: string): string[] {
    if (!glosses) {
      return [];
    }

    try {
      const parsed = JSON.parse(glosses);
      if (Array.isArray(parsed)) {
        return parsed
          .map(item => String(item).trim())
          .filter(Boolean);
      }
    } catch {
      // Ignore JSON parsing errors and fall back to string parsing
    }

    return glosses
      .split(/[;,]/)
      .map(part => part.trim())
      .filter(Boolean);
  }
}
