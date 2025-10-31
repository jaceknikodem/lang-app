/**
 * Main database layer implementation using Drizzle ORM
 */

import path from 'path';
import { promises as fsPromises } from 'fs';
import { eq, and, or, desc, asc, sql, lt, lte, gte, count, avg, max, inArray, SQL } from 'drizzle-orm';
import { DatabaseLayer, DatabaseConfig, JobWordInfo, WordGenerationJob, WordGenerationJobStatus, WordProcessingStatus } from '../../shared/types/database.js';
import { Word, Sentence, StudyStats, CreateWordRequest, DictionaryEntry } from '../../shared/types/core.js';
import { DatabaseConnection } from './connection.js';
import { MigrationManager } from './migrations.js';
import { splitSentenceIntoParts, serializeSentenceParts, parseSentenceParts } from '../../shared/utils/sentence.js';
import * as schema from './schema.js';

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
      const rawDb = this.connection.getRawDatabase();
      
      // Initialize and run migrations (still uses raw database)
      this.migrationManager = new MigrationManager(rawDb);
      await this.migrationManager.migrate();

      // Ensure sentence parts are populated for existing records
      await this.backfillSentenceParts();

      // Populate dictionary data from bundled files
      try {
        await this.populateDictionaryFromFiles();
      } catch (dictError) {
        console.warn('Dictionary population skipped due to error:', dictError);
      }
      
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
   * Get Drizzle database instance for operations
   */
  private getDb() {
    return this.connection.getDatabase();
  }
  
  /**
   * Get raw database instance for migrations and direct SQL
   */
  private getRawDb() {
    return this.connection.getRawDatabase();
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
      
      const result = await db.insert(schema.words).values({
        word: wordData.word,
        language: wordData.language,
        translation: wordData.translation,
        audioPath: wordData.audioPath || null,
        strength: 20,
        intervalDays: 1,
        easeFactor: 2.5,
        nextDue: tomorrow.toISOString(),
      }).returning({ id: schema.words.id });
      
      return result[0].id;
    } catch (error) {
      throw new Error(`Failed to insert word: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update word strength based on user performance
   */
  async updateWordStrength(wordId: number, strength: number): Promise<void> {
    const db = this.getDb();
    
    // Ensure strength is within valid range
    const clampedStrength = Math.max(0, Math.min(100, strength));
    
    try {
      const result = await db.update(schema.words)
        .set({ 
          strength: clampedStrength,
          lastStudied: sql`CURRENT_TIMESTAMP`
        })
        .where(eq(schema.words.id, wordId))
        .returning({ id: schema.words.id });
      
      if (result.length === 0) {
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
      const result = await db.update(schema.words)
        .set({ 
          known,
          lastStudied: sql`CURRENT_TIMESTAMP`
        })
        .where(eq(schema.words.id, wordId))
        .returning({ id: schema.words.id });
      
      if (result.length === 0) {
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
      const result = await db.update(schema.words)
        .set({ 
          ignored,
          lastStudied: sql`CURRENT_TIMESTAMP`
        })
        .where(eq(schema.words.id, wordId))
        .returning({ id: schema.words.id });
      
      if (result.length === 0) {
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
      
      // If we need more words, get additional words by strength
      const remainingLimit = limit - dueWords.length;
      const now = new Date().toISOString();
      
      const result = await db.select().from(schema.words)
        .where(and(
          eq(schema.words.known, false),
          eq(schema.words.ignored, false),
          eq(schema.words.language, currentLanguage),
          sql`${schema.words.nextDue} > ${now}`
        ))
        .orderBy(asc(schema.words.strength), sql`RANDOM()`)
        .limit(remainingLimit);
      
      const additionalWords = result.map(this.mapRowToWord);
      
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
      
      const conditions = and(
        eq(schema.words.known, false),
        eq(schema.words.ignored, false),
        gte(schema.words.strength, minStrength),
        lte(schema.words.strength, maxStrength),
        eq(schema.words.language, currentLanguage)
      );
      
      const baseQuery = db.select().from(schema.words)
        .where(conditions)
        .orderBy(sql`${schema.words.lastStudied} ASC NULLS FIRST`);
      
      const result = limit ? await baseQuery.limit(limit) : await baseQuery;
      return result.map(this.mapRowToWord);
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
      
      const conditions = [eq(schema.words.language, currentLanguage)];
      if (!includeKnown) {
        conditions.push(eq(schema.words.known, false));
      }
      if (!includeIgnored) {
        conditions.push(eq(schema.words.ignored, false));
      }
      
      const result = await db.selectDistinct({ 
        id: schema.words.id,
        word: schema.words.word,
        language: schema.words.language,
        translation: schema.words.translation,
        audioPath: schema.words.audioPath,
        strength: schema.words.strength,
        known: schema.words.known,
        ignored: schema.words.ignored,
        createdAt: schema.words.createdAt,
        lastStudied: schema.words.lastStudied,
        intervalDays: schema.words.intervalDays,
        easeFactor: schema.words.easeFactor,
        lastReview: schema.words.lastReview,
        nextDue: schema.words.nextDue,
        fsrsDifficulty: schema.words.fsrsDifficulty,
        fsrsStability: schema.words.fsrsStability,
        fsrsLapses: schema.words.fsrsLapses,
        fsrsLastRating: schema.words.fsrsLastRating,
        fsrsVersion: schema.words.fsrsVersion,
        processingStatus: schema.words.processingStatus,
        sentenceCount: schema.words.sentenceCount,
      })
        .from(schema.words)
        .innerJoin(schema.sentences, eq(schema.words.id, schema.sentences.wordId))
        .where(and(...conditions))
        .orderBy(asc(schema.words.strength), sql`RANDOM()`);
      
      const words = result.map(this.mapRowToWord);
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
      
      const conditions = [eq(schema.words.language, currentLanguage)];
      if (!includeKnown) {
        conditions.push(eq(schema.words.known, false));
      }
      if (!includeIgnored) {
        conditions.push(eq(schema.words.ignored, false));
      }
      
      const result = await db.selectDistinct({ 
        id: schema.words.id,
        word: schema.words.word,
        language: schema.words.language,
        translation: schema.words.translation,
        audioPath: schema.words.audioPath,
        strength: schema.words.strength,
        known: schema.words.known,
        ignored: schema.words.ignored,
        createdAt: schema.words.createdAt,
        lastStudied: schema.words.lastStudied,
        intervalDays: schema.words.intervalDays,
        easeFactor: schema.words.easeFactor,
        lastReview: schema.words.lastReview,
        nextDue: schema.words.nextDue,
        fsrsDifficulty: schema.words.fsrsDifficulty,
        fsrsStability: schema.words.fsrsStability,
        fsrsLapses: schema.words.fsrsLapses,
        fsrsLastRating: schema.words.fsrsLastRating,
        fsrsVersion: schema.words.fsrsVersion,
        processingStatus: schema.words.processingStatus,
        sentenceCount: schema.words.sentenceCount,
      })
        .from(schema.words)
        .innerJoin(schema.sentences, eq(schema.words.id, schema.sentences.wordId))
        .where(and(...conditions))
        .orderBy(asc(schema.words.strength), sql`${schema.words.lastStudied} ASC NULLS FIRST`);
      
      return result.map(this.mapRowToWord);
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
      
      const conditions = [eq(schema.words.language, currentLanguage)];
      if (!includeKnown) {
        conditions.push(eq(schema.words.known, false));
      }
      if (!includeIgnored) {
        conditions.push(eq(schema.words.ignored, false));
      }
      
      // If we're getting words for learning (not including known/ignored), shuffle them
      const shouldShuffle = !includeKnown && !includeIgnored;
      
      const baseQuery = db.select().from(schema.words)
        .where(and(...conditions));
      
      const result = shouldShuffle 
        ? await baseQuery.orderBy(asc(schema.words.strength), sql`RANDOM()`)
        : await baseQuery.orderBy(desc(schema.words.createdAt));
      const words = result.map(this.mapRowToWord);
      
      // Additional shuffling for learning words to ensure variety
      if (shouldShuffle) {
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
      const result = await db.select().from(schema.words)
        .where(eq(schema.words.id, wordId))
        .limit(1);
      
      return result.length > 0 ? this.mapRowToWord(result[0]) : null;
    } catch (error) {
      throw new Error(`Failed to get word by ID: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Sentence management operations

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
    sentenceParts?: string[]
  ): Promise<number> {
    const db = this.getDb();
    
    try {
      const parts = sentenceParts ?? splitSentenceIntoParts(sentence);
      const serializedParts = serializeSentenceParts(parts);

      const result = await db.insert(schema.sentences).values({
        wordId,
        sentence,
        translation,
        audioPath,
        contextBefore: contextBefore || null,
        contextAfter: contextAfter || null,
        contextBeforeTranslation: contextBeforeTranslation || null,
        contextAfterTranslation: contextAfterTranslation || null,
        sentenceParts: serializedParts,
      }).returning({ id: schema.sentences.id });

      await db.update(schema.words)
        .set({ sentenceCount: sql`${schema.words.sentenceCount} + 1` })
        .where(eq(schema.words.id, wordId));
      
      return result[0].id;
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
      const result = await db.select().from(schema.sentences)
        .where(eq(schema.sentences.wordId, wordId))
        .orderBy(sql`RANDOM()`);
      
      return result.map(this.mapRowToSentence);
    } catch (error) {
      throw new Error(`Failed to get sentences by word: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update sentence last shown timestamp
   */
  async updateSentenceLastShown(sentenceId: number): Promise<void> {
    const db = this.getDb();
    
    try {
      const result = await db.update(schema.sentences)
        .set({ lastShown: sql`CURRENT_TIMESTAMP` })
        .where(eq(schema.sentences.id, sentenceId))
        .returning({ id: schema.sentences.id });
      
      if (result.length === 0) {
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
      const result = await db.update(schema.sentences)
        .set({ audioPath })
        .where(eq(schema.sentences.id, sentenceId))
        .returning({ id: schema.sentences.id });
      
      if (result.length === 0) {
        throw new Error(`Sentence with ID ${sentenceId} not found`);
      }
    } catch (error) {
      throw new Error(`Failed to update sentence audio path: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get sentence by ID
   */
  async getSentenceById(sentenceId: number): Promise<Sentence | null> {
    const db = this.getDb();
    
    try {
      const result = await db.select().from(schema.sentences)
        .where(eq(schema.sentences.id, sentenceId))
        .limit(1);
      
      return result.length > 0 ? this.mapRowToSentence(result[0]) : null;
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
      const sentence = await db.select({ wordId: schema.sentences.wordId })
        .from(schema.sentences)
        .where(eq(schema.sentences.id, sentenceId))
        .limit(1);
      
      const result = await db.delete(schema.sentences)
        .where(eq(schema.sentences.id, sentenceId))
        .returning({ id: schema.sentences.id });
      
      if (result.length === 0) {
        throw new Error(`Sentence with ID ${sentenceId} not found`);
      }

      if (sentence.length > 0 && sentence[0].wordId) {
        await db.update(schema.words)
          .set({ sentenceCount: sql`CASE WHEN ${schema.words.sentenceCount} > 0 THEN ${schema.words.sentenceCount} - 1 ELSE 0 END` })
          .where(eq(schema.words.id, sentence[0].wordId));
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
      const result = await db.update(schema.words)
        .set({ lastStudied: sql`CURRENT_TIMESTAMP` })
        .where(eq(schema.words.id, wordId))
        .returning({ id: schema.words.id });
      
      if (result.length === 0) {
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
      
      const result = await db.select({
        totalWords: count(),
        wordsStudied: sql<number>`COUNT(CASE WHEN ${schema.words.lastStudied} IS NOT NULL THEN 1 END)`,
        averageStrength: sql<number>`AVG(CASE WHEN ${schema.words.lastStudied} IS NOT NULL THEN ${schema.words.strength} ELSE NULL END)`,
        lastStudyDate: max(schema.words.lastStudied),
      })
        .from(schema.words)
        .where(and(
          eq(schema.words.ignored, false),
          eq(schema.words.language, currentLanguage)
        ));
      
      const stats = result[0];
      
      return {
        totalWords: Number(stats.totalWords) || 0,
        wordsStudied: Number(stats.wordsStudied) || 0,
        averageStrength: Number(stats.averageStrength) || 0,
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
      await db.insert(schema.progress).values({
        wordsStudied,
        whenStudied: sql`CURRENT_TIMESTAMP`,
      });
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
      const result = await db.select({
        id: schema.progress.id,
        wordsStudied: schema.progress.wordsStudied,
        whenStudied: schema.progress.whenStudied,
      })
        .from(schema.progress)
        .orderBy(desc(schema.progress.whenStudied))
        .limit(limit);
      
      return result.map(row => ({
        id: row.id,
        wordsStudied: row.wordsStudied ?? 0,
        whenStudied: new Date(row.whenStudied)
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
      
      // Get additional weak words if needed
      const remainingLimit = limit - dueWords.length;
      const now = new Date().toISOString();
      
      const result = await db.select().from(schema.words)
        .where(and(
          eq(schema.words.known, false),
          eq(schema.words.ignored, false),
          eq(schema.words.language, currentLanguage),
          sql`${schema.words.nextDue} > ${now}`
        ))
        .orderBy(asc(schema.words.strength), sql`RANDOM()`)
        .limit(remainingLimit);
      
      const additionalWords = result.map(this.mapRowToWord);
      
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
      const result = await db.select().from(schema.sentences)
        .where(eq(schema.sentences.wordId, wordId))
        .orderBy(sql`RANDOM()`)
        .limit(1);
      
      return result.length > 0 ? this.mapRowToSentence(result[0]) : null;
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
      const result = await db.select({ value: schema.settings.value })
        .from(schema.settings)
        .where(eq(schema.settings.key, key))
        .limit(1);
      
      return result.length > 0 ? result[0].value : null;
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
      await db.insert(schema.settings).values({
        key,
        value,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      }).onConflictDoUpdate({
        target: schema.settings.key,
        set: {
          value,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      });
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
      const result = await db.selectDistinct({ language: schema.words.language })
        .from(schema.words)
        .orderBy(asc(schema.words.language));
      
      return result.map(row => row.language);
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
      const result = await db.select({
        language: schema.words.language,
        totalWords: count(),
        studiedWords: sql<number>`COUNT(CASE WHEN ${schema.words.lastStudied} IS NOT NULL THEN 1 END)`,
      })
        .from(schema.words)
        .where(eq(schema.words.ignored, false))
        .groupBy(schema.words.language)
        .orderBy(asc(schema.words.language));
      
      return result.map(row => ({
        language: row.language,
        totalWords: Number(row.totalWords) || 0,
        studiedWords: Number(row.studiedWords) || 0
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

      const result = await db.select({
        word: schema.dict.word,
        pos: schema.dict.pos,
        glosses: schema.dict.glosses,
        lang: schema.dict.lang,
      })
        .from(schema.dict)
        .where(and(
          sql`LOWER(${schema.dict.word}) = LOWER(${word})`,
          eq(schema.dict.lang, currentLanguage)
        ))
        .orderBy(asc(schema.dict.pos), asc(schema.dict.word));

      return result.map(row => ({
        word: row.word || '',
        pos: row.pos || '',
        glosses: this.parseGlossesField(row.glosses || ''),
        lang: row.lang || ''
      }));
    } catch (error) {
      throw new Error(`Failed to lookup dictionary entry: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async updateWordProcessingStatus(wordId: number, status: WordProcessingStatus): Promise<void> {
    const db = this.getDb();

    try {
      await db.update(schema.words)
        .set({ processingStatus: status })
        .where(eq(schema.words.id, wordId));
    } catch (error) {
      throw new Error(`Failed to update word processing status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getWordProcessingInfo(wordId: number): Promise<{ processingStatus: WordProcessingStatus; sentenceCount: number } | null> {
    const db = this.getDb();

    try {
      const result = await db.select({
        processingStatus: schema.words.processingStatus,
        sentenceCount: schema.words.sentenceCount,
      })
        .from(schema.words)
        .where(eq(schema.words.id, wordId))
        .limit(1);

      return result.length > 0
        ? { 
            processingStatus: result[0].processingStatus ?? 'ready', 
            sentenceCount: result[0].sentenceCount ?? 0 
          }
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
      const conditions = language 
        ? [eq(schema.wordGenerationQueue.language, language)]
        : [];

      const statusRows = await db.select({
        status: schema.wordGenerationQueue.status,
        total: count(),
      })
        .from(schema.wordGenerationQueue)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(schema.wordGenerationQueue.status);

      const summary = statusRows.reduce(
        (acc, row) => {
          if (row.status === 'queued') acc.queued += Number(row.total);
          if (row.status === 'processing') acc.processing += Number(row.total);
          if (row.status === 'failed') acc.failed += Number(row.total);
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

      const jobWordConditions = [
        inArray(schema.wordGenerationQueue.status, ['queued', 'processing']),
        sql`${schema.words.processingStatus} != 'failed'`,
      ];

      if (language) {
        jobWordConditions.push(eq(schema.wordGenerationQueue.language, language));
      }

      const jobWordRows = await db.select({
        wordId: schema.wordGenerationQueue.wordId,
        status: schema.wordGenerationQueue.status,
        language: schema.wordGenerationQueue.language,
        topic: schema.wordGenerationQueue.topic,
        word: schema.words.word,
      })
        .from(schema.wordGenerationQueue)
        .innerJoin(schema.words, eq(schema.wordGenerationQueue.wordId, schema.words.id))
        .where(and(...jobWordConditions))
        .orderBy(
          sql`CASE ${schema.wordGenerationQueue.status} WHEN 'processing' THEN 0 ELSE 1 END`,
          asc(schema.wordGenerationQueue.updatedAt)
        );

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
      await db.insert(schema.wordGenerationQueue).values({
        wordId,
        language,
        topic: topic || null,
        desiredSentenceCount,
        status: 'queued',
        attempts: 0,
        lastError: null,
        createdAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
        startedAt: null,
      }).onConflictDoUpdate({
        target: schema.wordGenerationQueue.wordId,
        set: {
          language,
          topic: topic || null,
          desiredSentenceCount,
          status: 'queued',
          attempts: 0,
          lastError: null,
          updatedAt: sql`CURRENT_TIMESTAMP`,
          startedAt: null,
        },
      });

      await this.updateWordProcessingStatus(wordId, 'queued');
    } catch (error) {
      throw new Error(`Failed to enqueue word generation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getNextWordGenerationJob(): Promise<WordGenerationJob | null> {
    const db = this.getDb();

    try {
      const result = await db.select().from(schema.wordGenerationQueue)
        .where(eq(schema.wordGenerationQueue.status, 'queued'))
        .orderBy(asc(schema.wordGenerationQueue.updatedAt), asc(schema.wordGenerationQueue.createdAt))
        .limit(1);

      return result.length > 0 ? this.mapRowToWordGenerationJob(result[0]) : null;
    } catch (error) {
      throw new Error(`Failed to get next word generation job: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async markWordGenerationJobProcessing(jobId: number): Promise<void> {
    const db = this.getDb();

    try {
      await db.update(schema.wordGenerationQueue)
        .set({
          status: 'processing',
          attempts: sql`${schema.wordGenerationQueue.attempts} + 1`,
          startedAt: sql`CURRENT_TIMESTAMP`,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.wordGenerationQueue.id, jobId));
    } catch (error) {
      throw new Error(`Failed to mark job processing: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async rescheduleWordGenerationJob(jobId: number, delayMs: number, lastError?: string): Promise<void> {
    const db = this.getDb();
    const nextAttempt = new Date(Date.now() + delayMs).toISOString();

    try {
      const updateData: any = {
        status: 'queued',
        updatedAt: nextAttempt,
        startedAt: null,
      };
      
      if (lastError !== undefined) {
        updateData.lastError = lastError;
      }
      
      await db.update(schema.wordGenerationQueue)
        .set(updateData)
        .where(eq(schema.wordGenerationQueue.id, jobId));
    } catch (error) {
      throw new Error(`Failed to reschedule job: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async completeWordGenerationJob(jobId: number): Promise<void> {
    const db = this.getDb();

    try {
      await db.update(schema.wordGenerationQueue)
        .set({
          status: 'completed',
          updatedAt: sql`CURRENT_TIMESTAMP`,
          startedAt: null,
        })
        .where(eq(schema.wordGenerationQueue.id, jobId));
    } catch (error) {
      throw new Error(`Failed to complete job: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async failWordGenerationJob(jobId: number, errorMessage: string): Promise<void> {
    const db = this.getDb();

    try {
      await db.update(schema.wordGenerationQueue)
        .set({
          status: 'failed',
          lastError: errorMessage,
          updatedAt: sql`CURRENT_TIMESTAMP`,
          startedAt: null,
        })
        .where(eq(schema.wordGenerationQueue.id, jobId));
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
      const updateData: any = {
        strength: Math.max(0, Math.min(100, strength)),
        intervalDays,
        easeFactor,
        lastReview: nowIso,
        nextDue: nextDue.toISOString(),
        lastStudied: nowIso,
      };
      
      if (options) {
        if (options.fsrsDifficulty !== undefined) {
          updateData.fsrsDifficulty = options.fsrsDifficulty;
        }
        if (options.fsrsStability !== undefined) {
          updateData.fsrsStability = options.fsrsStability;
        }
        if (options.fsrsLapses !== undefined) {
          updateData.fsrsLapses = options.fsrsLapses;
        }
        if (options.fsrsLastRating !== undefined) {
          updateData.fsrsLastRating = options.fsrsLastRating;
        }
        if (options.fsrsVersion !== undefined) {
          updateData.fsrsVersion = options.fsrsVersion;
        }
      }

      const result = await db.update(schema.words)
        .set(updateData)
        .where(eq(schema.words.id, wordId))
        .returning({ id: schema.words.id });
      
      if (result.length === 0) {
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
      
      const baseQuery = db.select().from(schema.words)
        .where(and(
          eq(schema.words.known, false),
          eq(schema.words.ignored, false),
          eq(schema.words.language, currentLanguage),
          sql`${schema.words.nextDue} <= ${now}`
        ))
        .orderBy(asc(schema.words.nextDue), asc(schema.words.strength));
      
      const result = limit ? await baseQuery.limit(limit) : await baseQuery;
      
      return result.map(this.mapRowToWord);
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
      
      const result = await db.select({
        count: count(),
      })
        .from(schema.words)
        .where(and(
          eq(schema.words.known, false),
          eq(schema.words.ignored, false),
          eq(schema.words.language, currentLanguage),
          sql`${schema.words.nextDue} <= ${now}`
        ));
      
      return Number(result[0].count);
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
      
      // Get all due words first
      const result = await db.select().from(schema.words)
        .where(and(
          eq(schema.words.known, false),
          eq(schema.words.ignored, false),
          eq(schema.words.language, currentLanguage),
          sql`${schema.words.nextDue} <= ${now}`
        ));
      
      const words = result.map(this.mapRowToWord);
      
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
      
      const result = await db.select({
        totalWords: count(),
        dueToday: sql<number>`COUNT(CASE WHEN ${schema.words.nextDue} <= ${todayStr} THEN 1 END)`,
        overdue: sql<number>`COUNT(CASE WHEN ${schema.words.nextDue} < ${now} THEN 1 END)`,
        averageInterval: avg(schema.words.intervalDays),
        averageEaseFactor: avg(schema.words.easeFactor),
      })
        .from(schema.words)
        .where(and(
          eq(schema.words.ignored, false),
          eq(schema.words.known, false),
          eq(schema.words.language, currentLanguage)
        ));
      
      const stats = result[0];
      
      return {
        totalWords: Number(stats.totalWords) || 0,
        dueToday: Number(stats.dueToday) || 0,
        overdue: Number(stats.overdue) || 0,
        averageInterval: Number(stats.averageInterval) || 1,
        averageEaseFactor: Number(stats.averageEaseFactor) || 2.5
      };
    } catch (error) {
      throw new Error(`Failed to get SRS stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Load dictionary entries from JSONL files in the dicts directory
   */
  private async populateDictionaryFromFiles(): Promise<void> {
    const dictDir = path.join(process.cwd(), 'dicts');
    let files: string[];

    try {
      files = await fsPromises.readdir(dictDir);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code !== 'ENOENT') {
        console.warn('Failed to access dictionary directory:', error);
      } else {
        console.warn('Dictionary directory not found, skipping dictionary population');
      }
      return;
    }

    const jsonlFiles = files.filter(file => file.endsWith('_dict.jsonl'));
    if (jsonlFiles.length === 0) {
      return;
    }

    const db = this.getDb();
    const rawDb = this.getRawDb();
    const deleteStmt = rawDb.prepare('DELETE FROM dict WHERE lang = ?');
    const insertStmt = rawDb.prepare('INSERT INTO dict (word, pos, glosses, lang) VALUES (?, ?, ?, ?)');
    const hasEntriesStmt = rawDb.prepare('SELECT 1 FROM dict WHERE lang = ? LIMIT 1');

    for (const file of jsonlFiles) {
      const language = file.replace('_dict.jsonl', '');
      const filePath = path.join(dictDir, file);

      const existingEntry = hasEntriesStmt.get(language);
      const markerKey = `dictionary_populated_${language}`;
      const alreadyMarked = await this.getSetting(markerKey);

      if (alreadyMarked === 'true' && existingEntry) {
        console.log(`Dictionary already populated for ${language}, skipping`);
        continue;
      }

      if (existingEntry && alreadyMarked !== 'true') {
        await this.setSetting(markerKey, 'true');
        console.log(`Dictionary entries already present for ${language}, skipping re-import`);
        continue;
      }

      try {
        const entries = await this.parseDictionaryFile(filePath, language);

        const transaction = rawDb.transaction((dictionaryEntries: Array<{ word: string; pos: string; glosses: string; lang: string }>) => {
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

  private async backfillSentenceParts(): Promise<void> {
    const db = this.getDb();

    try {
      const rows = await db.select({
        id: schema.sentences.id,
        sentence: schema.sentences.sentence,
      })
        .from(schema.sentences)
        .where(or(
          sql`${schema.sentences.sentenceParts} IS NULL`,
          sql`${schema.sentences.sentenceParts} = ''`
        ));

      if (!rows.length) {
        return;
      }

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

      for (const item of updates) {
        await db.update(schema.sentences)
          .set({ sentenceParts: item.serialized })
          .where(eq(schema.sentences.id, item.id));
      }
    } catch (error) {
      console.warn('Failed to backfill sentence parts:', error);
    }
  }

  private mapRowToWord(row: any): Word {
    return {
      id: row.id,
      word: row.word,
      language: row.language,
      translation: row.translation,
      audioPath: row.audioPath || '',
      strength: row.strength,
      known: Boolean(row.known),
      ignored: Boolean(row.ignored),
      createdAt: new Date(row.createdAt),
      lastStudied: row.lastStudied ? new Date(row.lastStudied) : undefined,
      // SRS fields
      intervalDays: row.intervalDays || 1,
      easeFactor: row.easeFactor || 2.5,
      lastReview: row.lastReview ? new Date(row.lastReview) : undefined,
      nextDue: row.nextDue ? new Date(row.nextDue) : new Date(),
      fsrsDifficulty: row.fsrsDifficulty ?? undefined,
      fsrsStability: row.fsrsStability ?? undefined,
      fsrsLapses: row.fsrsLapses ?? undefined,
      fsrsLastRating: row.fsrsLastRating ?? undefined,
      fsrsVersion: row.fsrsVersion ?? undefined,
      processingStatus: row.processingStatus ?? 'ready',
      sentenceCount: row.sentenceCount ?? 0
    };
  }

  private mapRowToSentence(row: any): Sentence {
    return {
      id: row.id,
      wordId: row.wordId,
      sentence: row.sentence,
      sentenceParts: parseSentenceParts(row.sentenceParts),
      translation: row.translation,
      audioPath: row.audioPath || '',
      createdAt: new Date(row.createdAt),
      lastShown: row.lastShown ? new Date(row.lastShown) : undefined,
      contextBefore: row.contextBefore || undefined,
      contextAfter: row.contextAfter || undefined,
      contextBeforeTranslation: row.contextBeforeTranslation || undefined,
      contextAfterTranslation: row.contextAfterTranslation || undefined
    };
  }

  private mapRowToWordGenerationJob(row: any): WordGenerationJob {
    return {
      id: row.id,
      wordId: row.wordId,
      language: row.language,
      topic: row.topic ?? undefined,
      desiredSentenceCount: row.desiredSentenceCount ?? 3,
      status: row.status as WordGenerationJobStatus,
      attempts: row.attempts ?? 0,
      lastError: row.lastError ?? undefined,
      createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
      updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
      startedAt: row.startedAt ? new Date(row.startedAt) : undefined
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
