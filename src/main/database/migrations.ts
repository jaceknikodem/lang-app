/**
 * Database migration system for schema versioning
 */

import Database from 'better-sqlite3';

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

    // Run migrations in transaction
    const transaction = this.db.transaction(() => {
      for (const migration of this.migrations) {
        if (migration.version > currentVersion) {
          console.log(`Applying migration ${migration.version}: ${migration.name}`);
          
          // Execute all migration statements
          for (const statement of migration.up) {
            this.db.exec(statement);
          }
          
          // Record migration as applied
          this.db.prepare(`
            INSERT INTO migrations (version, name) 
            VALUES (?, ?)
          `).run(migration.version, migration.name);
        }
      }
    });

    try {
      transaction();
      console.log(`Database migration completed successfully`);
    } catch (error) {
      throw new Error(`Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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
}