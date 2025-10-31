/**
 * Database migration system for schema versioning
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, renameSync, readdirSync, statSync } from 'fs';
import { join, dirname, basename, extname } from 'path';

export interface Migration {
  version: number;
  name: string;
  up: string[];
  down?: string[];
}

export class MigrationManager {
  private db: Database.Database;
  private migrations: Migration[] = [];

  constructor(db: Database.Database) {
    this.db = db;
    this.initializeMigrationsTable();
    this.registerMigrations();
  }

  /**
   * Create migrations tracking table if it doesn't exist
   */
  private initializeMigrationsTable(): void {
    const createMigrationsTable = `
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    this.db.exec(createMigrationsTable);
  }

  /**
   * Register all available migrations
   */
  private registerMigrations(): void {
    this.migrations = [
      {
        version: 1,
        name: 'initial_schema',
        up: [
          `CREATE TABLE IF NOT EXISTS words (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word TEXT NOT NULL,
            language TEXT NOT NULL DEFAULT 'spanish',
            translation TEXT NOT NULL,
            audio_path TEXT,
            strength INTEGER DEFAULT 0 CHECK (strength >= 0 AND strength <= 100),
            known BOOLEAN DEFAULT FALSE,
            ignored BOOLEAN DEFAULT FALSE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_studied DATETIME
          )`,
          
          `CREATE TABLE IF NOT EXISTS sentences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
            sentence TEXT NOT NULL,
            translation TEXT NOT NULL,
            audio_path TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_shown DATETIME
          )`,
          
          `CREATE TABLE IF NOT EXISTS progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            words_studied INTEGER DEFAULT 0,
            when_studied DATETIME DEFAULT CURRENT_TIMESTAMP
          )`,
          
          // Create indexes for better query performance
          `CREATE INDEX IF NOT EXISTS idx_words_strength ON words(strength)`,
          `CREATE INDEX IF NOT EXISTS idx_words_last_studied ON words(last_studied)`,
          `CREATE INDEX IF NOT EXISTS idx_words_known_ignored ON words(known, ignored)`,
          `CREATE INDEX IF NOT EXISTS idx_sentences_word_id ON sentences(word_id)`,
          `CREATE INDEX IF NOT EXISTS idx_progress_when_studied ON progress(when_studied)`
        ]
      },
      {
        version: 2,
        name: 'add_settings_table',
        up: [
          `CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )`,
          
          // Insert default language setting
          `INSERT OR IGNORE INTO settings (key, value) VALUES ('current_language', 'spanish')`
        ],
        down: [
          `DROP TABLE IF EXISTS settings`
        ]
      },
      {
        version: 3,
        name: 'restructure_audio_paths',
        up: [
          // This migration will be handled by a special method that includes file system operations
          // The actual SQL updates will be done programmatically after moving files
        ],
        down: [
          // Rollback is not supported for this migration due to file system complexity
        ]
      },
      {
        version: 4,
        name: 'add_context_sentences',
        up: [
          `ALTER TABLE sentences ADD COLUMN context_before TEXT`,
          `ALTER TABLE sentences ADD COLUMN context_after TEXT`,
          `ALTER TABLE sentences ADD COLUMN context_before_translation TEXT`,
          `ALTER TABLE sentences ADD COLUMN context_after_translation TEXT`
        ],
        down: [
          // SQLite doesn't support DROP COLUMN, so we'd need to recreate the table
          // For now, we'll leave the columns as they won't hurt anything
        ]
      },
      {
        version: 5,
        name: 'add_srs_fields',
        up: [
          `ALTER TABLE words ADD COLUMN interval_days INTEGER DEFAULT 1`,
          `ALTER TABLE words ADD COLUMN ease_factor REAL DEFAULT 2.5`,
          `ALTER TABLE words ADD COLUMN last_review DATETIME`,
          `ALTER TABLE words ADD COLUMN next_due DATETIME`,
          
          // Update existing words with default next_due value
          `UPDATE words SET next_due = datetime('now', '+1 day') WHERE next_due IS NULL`,
          
          // Create index for efficient SRS queries
          `CREATE INDEX IF NOT EXISTS idx_words_next_due ON words(next_due)`,
          `CREATE INDEX IF NOT EXISTS idx_words_srs_review ON words(next_due, strength)`
        ],
        down: [
          // SQLite doesn't support DROP COLUMN, so we'd need to recreate the table
          // For now, we'll leave the columns as they won't hurt anything
        ]
      },
      {
        version: 6,
        name: 'add_dictionary_table',
        up: [
          `CREATE TABLE IF NOT EXISTS dict (
            word TEXT,
            pos TEXT,
            glosses TEXT,
            lang TEXT
          )`,
          `CREATE INDEX IF NOT EXISTS idx_word_lang ON dict(word, lang)`
        ],
        down: [
          `DROP INDEX IF EXISTS idx_word_lang`,
          `DROP TABLE IF EXISTS dict`
        ]
      },
      {
        version: 7,
        name: 'add_fsrs_fields',
        up: [
          `ALTER TABLE words ADD COLUMN fsrs_difficulty REAL DEFAULT 5.0`,
          `ALTER TABLE words ADD COLUMN fsrs_stability REAL DEFAULT 1.0`,
          `ALTER TABLE words ADD COLUMN fsrs_lapses INTEGER DEFAULT 0`,
          `ALTER TABLE words ADD COLUMN fsrs_last_rating INTEGER`,
          `ALTER TABLE words ADD COLUMN fsrs_version TEXT DEFAULT 'fsrs-baseline'`,
          `UPDATE words SET fsrs_difficulty = 5.0 WHERE fsrs_difficulty IS NULL`,
          `UPDATE words SET fsrs_stability = 1.0 WHERE fsrs_stability IS NULL`,
          `UPDATE words SET fsrs_lapses = 0 WHERE fsrs_lapses IS NULL`,
          `UPDATE words SET fsrs_version = 'fsrs-baseline' WHERE fsrs_version IS NULL`,
          `CREATE INDEX IF NOT EXISTS idx_words_fsrs_state ON words(fsrs_stability, fsrs_difficulty)`
        ],
        down: [
          // SQLite does not support dropping columns; leave them in place on rollback.
        ]
      },
      {
        version: 8,
        name: 'add_word_generation_queue',
        up: [
          `ALTER TABLE words ADD COLUMN processing_status TEXT DEFAULT 'ready'`,
          `ALTER TABLE words ADD COLUMN sentence_count INTEGER DEFAULT 0`,
          `UPDATE words SET processing_status = 'ready' WHERE processing_status IS NULL`,
          `UPDATE words SET sentence_count = (
            SELECT COUNT(*) FROM sentences WHERE sentences.word_id = words.id
          )`,
          `CREATE TABLE IF NOT EXISTS word_generation_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word_id INTEGER NOT NULL UNIQUE REFERENCES words(id) ON DELETE CASCADE,
            language TEXT NOT NULL,
            topic TEXT,
            desired_sentence_count INTEGER NOT NULL DEFAULT 3,
            status TEXT NOT NULL DEFAULT 'queued',
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            started_at DATETIME
          )`,
          `CREATE INDEX IF NOT EXISTS idx_word_generation_queue_status ON word_generation_queue(status, updated_at)`
        ],
        down: [
          `DROP INDEX IF EXISTS idx_word_generation_queue_status`,
          `DROP TABLE IF EXISTS word_generation_queue`
          // processing_status and sentence_count columns remain in words table on rollback
        ]
      },
      {
        version: 9,
        name: 'add_sentence_parts_column',
        up: [
          `ALTER TABLE sentences ADD COLUMN sentence_parts TEXT`
        ],
        down: [
          // SQLite cannot drop columns; leaving sentence_parts in place on rollback.
        ]
      },
      {
        version: 10,
        name: 'add_generation_metadata_columns',
        up: [
          `ALTER TABLE sentences ADD COLUMN sentence_generation_model TEXT`,
          `ALTER TABLE sentences ADD COLUMN audio_generation_service TEXT`,
          `ALTER TABLE sentences ADD COLUMN audio_generation_model TEXT`
        ],
        down: [
          // SQLite cannot drop columns; leaving generation metadata columns in place on rollback.
        ]
      },
      {
        version: 11,
        name: 'add_sentence_words_junction_table',
        up: [
          `CREATE TABLE IF NOT EXISTS sentence_words (
            sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
            word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
            PRIMARY KEY (sentence_id, word_id)
          )`,
          `CREATE INDEX IF NOT EXISTS idx_sentence_words_sentence_id ON sentence_words(sentence_id)`,
          `CREATE INDEX IF NOT EXISTS idx_sentence_words_word_id ON sentence_words(word_id)`,
          // Populate junction table from existing sentences.word_id data
          `INSERT OR IGNORE INTO sentence_words (sentence_id, word_id)
           SELECT id, word_id FROM sentences WHERE word_id IS NOT NULL`
        ],
        down: [
          `DROP INDEX IF EXISTS idx_sentence_words_word_id`,
          `DROP INDEX IF EXISTS idx_sentence_words_sentence_id`,
          `DROP TABLE IF EXISTS sentence_words`
        ]
      },
      {
        version: 12,
        name: 'add_sentence_tokens_column',
        up: [
          `ALTER TABLE sentences ADD COLUMN sentence_tokens TEXT`
        ],
        down: [
          // SQLite cannot drop columns; leaving sentence_tokens in place on rollback.
        ]
      }
    ];
  }

  /**
   * Get current database schema version
   */
  getCurrentVersion(): number {
    try {
      const result = this.db.prepare('SELECT MAX(version) as version FROM migrations').get() as { version: number | null };
      return result.version || 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get latest available migration version
   */
  getLatestVersion(): number {
    return Math.max(...this.migrations.map(m => m.version), 0);
  }

  /**
   * Run all pending migrations
   */
  async migrate(): Promise<void> {
    const currentVersion = this.getCurrentVersion();
    const latestVersion = this.getLatestVersion();

    if (currentVersion >= latestVersion) {
      console.log(`Database is up to date (version ${currentVersion})`);
      return;
    }

    console.log(`Migrating database from version ${currentVersion} to ${latestVersion}`);

    // Handle migrations one by one to allow for special handling
    for (const migration of this.migrations) {
      if (migration.version > currentVersion) {
        console.log(`Applying migration ${migration.version}: ${migration.name}`);
        
        // Special handling for audio path restructuring migration
        if (migration.version === 3 && migration.name === 'restructure_audio_paths') {
          await this.migrateAudioPaths();
        } else {
          // Regular SQL migration
          const transaction = this.db.transaction(() => {
            for (const statement of migration.up) {
              if (statement.trim()) { // Skip empty statements
                this.db.exec(statement);
              }
            }
          });
          
          try {
            transaction();
          } catch (error) {
            throw new Error(`Migration ${migration.version} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
        
        // Record migration as applied
        this.db.prepare(`
          INSERT INTO migrations (version, name) 
          VALUES (?, ?)
        `).run(migration.version, migration.name);
      }
    }

    console.log(`Database migration completed successfully`);
  }

  /**
   * Special migration to restructure audio file paths
   * Moves files from flat structure to /audio/<lang>/<word>/<sentence>.<ext>
   */
  private async migrateAudioPaths(): Promise<void> {
    console.log('Starting audio path restructuring migration...');
    
    const audioDir = join(process.cwd(), 'audio');
    
    if (!existsSync(audioDir)) {
      console.log('No audio directory found, skipping audio migration');
      return;
    }

    // Get all words and sentences from database
    const words = this.db.prepare('SELECT * FROM words WHERE audio_path IS NOT NULL').all() as any[];
    const sentences = this.db.prepare('SELECT * FROM sentences WHERE audio_path IS NOT NULL').all() as any[];
    
    console.log(`Found ${words.length} words and ${sentences.length} sentences with audio paths`);

    // Migrate word audio files
    for (const word of words) {
      try {
        const oldPath = join(process.cwd(), word.audio_path);
        if (existsSync(oldPath)) {
          const newPath = join(audioDir, word.language, `${this.sanitizeFilename(word.word)}.aiff`);
          
          // Ensure directory exists
          const newDir = dirname(newPath);
          if (!existsSync(newDir)) {
            mkdirSync(newDir, { recursive: true });
          }
          
          // Move file if it doesn't already exist at new location
          if (!existsSync(newPath)) {
            renameSync(oldPath, newPath);
          }
          
          // Update database with new path
          const relativePath = join('audio', word.language, `${this.sanitizeFilename(word.word)}.aiff`);
          this.db.prepare('UPDATE words SET audio_path = ? WHERE id = ?').run(relativePath, word.id);
          
          console.log(`Migrated word audio: ${word.word} -> ${relativePath}`);
        }
      } catch (error) {
        console.warn(`Failed to migrate word audio for "${word.word}":`, error);
      }
    }

    // Migrate sentence audio files
    for (const sentence of sentences) {
      try {
        // Get the word for this sentence
        const word = this.db.prepare('SELECT * FROM words WHERE id = ?').get(sentence.word_id) as any;
        if (!word) continue;

        const oldPath = join(process.cwd(), sentence.audio_path);
        if (existsSync(oldPath)) {
          const wordDir = this.sanitizeFilename(word.word);
          const sentenceFile = `${this.sanitizeFilename(sentence.sentence)}.aiff`;
          const newPath = join(audioDir, word.language, wordDir, sentenceFile);
          
          // Ensure directory exists
          const newDir = dirname(newPath);
          if (!existsSync(newDir)) {
            mkdirSync(newDir, { recursive: true });
          }
          
          // Move file if it doesn't already exist at new location
          if (!existsSync(newPath)) {
            renameSync(oldPath, newPath);
          }
          
          // Update database with new path
          const relativePath = join('audio', word.language, wordDir, sentenceFile);
          this.db.prepare('UPDATE sentences SET audio_path = ? WHERE id = ?').run(relativePath, sentence.id);
          
          console.log(`Migrated sentence audio: ${sentence.sentence} -> ${relativePath}`);
        }
      } catch (error) {
        console.warn(`Failed to migrate sentence audio for sentence ID ${sentence.id}:`, error);
      }
    }

    console.log('Audio path restructuring migration completed');
  }

  /**
   * Rollback to a specific version (if down migrations are available)
   */
  async rollback(targetVersion: number): Promise<void> {
    const currentVersion = this.getCurrentVersion();
    
    if (targetVersion >= currentVersion) {
      throw new Error(`Target version ${targetVersion} is not lower than current version ${currentVersion}`);
    }

    console.log(`Rolling back database from version ${currentVersion} to ${targetVersion}`);

    const transaction = this.db.transaction(() => {
      // Find migrations to rollback (in reverse order)
      const migrationsToRollback = this.migrations
        .filter(m => m.version > targetVersion && m.version <= currentVersion)
        .sort((a, b) => b.version - a.version);

      for (const migration of migrationsToRollback) {
        if (!migration.down) {
          throw new Error(`Migration ${migration.version} (${migration.name}) does not support rollback`);
        }

        console.log(`Rolling back migration ${migration.version}: ${migration.name}`);
        
        // Execute rollback statements
        for (const statement of migration.down) {
          this.db.exec(statement);
        }
        
        // Remove migration record
        this.db.prepare('DELETE FROM migrations WHERE version = ?').run(migration.version);
      }
    });

    try {
      transaction();
      console.log(`Database rollback completed successfully`);
    } catch (error) {
      throw new Error(`Rollback failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Legacy filename sanitizer (matches existing audio assets on disk)
  private sanitizeFilename(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 100);
  }
}
