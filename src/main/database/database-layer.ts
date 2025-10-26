/**
 * Main database layer implementation
 */

import Database from 'better-sqlite3';
import { DatabaseLayer, DatabaseConfig } from '../../shared/types/database.js';
import { Word, Sentence, StudyStats, CreateWordRequest } from '../../shared/types/core.js';
import { DatabaseConnection } from './connection.js';
import { MigrationManager } from './migrations.js';

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
      const stmt = db.prepare(`
        INSERT INTO words (word, language, translation, audio_path)
        VALUES (?, ?, ?, ?)
      `);
      
      const result = stmt.run(
        wordData.word,
        wordData.language,
        wordData.translation,
        wordData.audioPath || null
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
    
    // Ensure strength is within valid range
    const clampedStrength = Math.max(0, Math.min(100, strength));
    
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
      
      const result = stmt.run(known, wordId);
      
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
      
      const result = stmt.run(ignored, wordId);
      
      if (result.changes === 0) {
        throw new Error(`Word with ID ${wordId} not found`);
      }
    } catch (error) {
      throw new Error(`Failed to mark word as ignored: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get words to study, prioritizing by lowest strength with randomization
   */
  async getWordsToStudy(limit: number, language?: string): Promise<Word[]> {
    const db = this.getDb();
    
    try {
      const currentLanguage = language || await this.getCurrentLanguage();
      
      // Get more words than needed to allow for shuffling within strength tiers
      const expandedLimit = Math.min(limit * 3, 100);
      
      const stmt = db.prepare(`
        SELECT * FROM words 
        WHERE known = FALSE AND ignored = FALSE AND language = ?
        ORDER BY strength ASC, RANDOM()
        LIMIT ?
      `);
      
      const rows = stmt.all(currentLanguage, expandedLimit) as any[];
      const words = rows.map(this.mapRowToWord);
      
      // Shuffle and return the requested limit
      const shuffled = this.shuffleArray(words);
      return shuffled.slice(0, limit);
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

  // Sentence management operations

  /**
   * Insert a new sentence for a word
   */
  async insertSentence(wordId: number, sentence: string, translation: string, audioPath: string): Promise<number> {
    const db = this.getDb();
    
    try {
      const stmt = db.prepare(`
        INSERT INTO sentences (word_id, sentence, translation, audio_path)
        VALUES (?, ?, ?, ?)
      `);
      
      const result = stmt.run(wordId, sentence, translation, audioPath);
      
      return result.lastInsertRowid as number;
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
      const stmt = db.prepare(`
        SELECT * FROM sentences 
        WHERE word_id = ?
        ORDER BY RANDOM()
      `);
      
      const rows = stmt.all(wordId) as any[];
      
      return rows.map(this.mapRowToSentence);
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
   * Get weakest words for quiz generation, prioritizing lowest strength with randomization
   */
  async getWeakestWords(limit: number, language?: string): Promise<Word[]> {
    const db = this.getDb();
    
    try {
      const currentLanguage = language || await this.getCurrentLanguage();
      
      // Get more words than needed to allow for shuffling within strength tiers
      const expandedLimit = Math.min(limit * 2, 50);
      
      const stmt = db.prepare(`
        SELECT * FROM words 
        WHERE known = FALSE AND ignored = FALSE AND language = ?
        ORDER BY strength ASC, RANDOM()
        LIMIT ?
      `);
      
      const rows = stmt.all(currentLanguage, expandedLimit) as any[];
      const words = rows.map(this.mapRowToWord);
      
      // Shuffle and return the requested limit
      const shuffled = this.shuffleArray(words);
      return shuffled.slice(0, limit);
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
      const stmt = db.prepare(`
        SELECT * FROM sentences 
        WHERE word_id = ?
        ORDER BY RANDOM()
        LIMIT 1
      `);
      
      const row = stmt.get(wordId) as any;
      
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

  // Helper methods for mapping database rows to objects and utilities

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
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
      lastStudied: row.last_studied ? new Date(row.last_studied) : undefined
    };
  }

  private mapRowToSentence(row: any): Sentence {
    return {
      id: row.id,
      wordId: row.word_id,
      sentence: row.sentence,
      translation: row.translation,
      audioPath: row.audio_path || '',
      createdAt: new Date(row.created_at),
      lastShown: row.last_shown ? new Date(row.last_shown) : undefined
    };
  }
}