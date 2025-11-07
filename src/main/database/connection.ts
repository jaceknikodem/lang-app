/**
 * SQLite database connection and configuration
 */

import Database from 'better-sqlite3';
import { DatabaseConfig } from '../../shared/types/database.js';
import path from 'path';
import fs from 'fs';
import { getLogger } from '../utils/logger.js';
import { env } from '../../shared/config/index.js';
import { Logger } from '../../shared/utils/logger.js';

export class DatabaseConnection {
  private db: Database.Database | null = null;
  private config: DatabaseConfig;
  private readonly logger: Logger;

  constructor(config: DatabaseConfig) {
    this.logger = getLogger();
    this.config = config;
  }

  /**
   * Initialize database connection with proper configuration
   */
  async connect(): Promise<Database.Database> {
    if (this.db) {
      return this.db;
    }

    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.config.databasePath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Create database connection
      this.db = new Database(this.config.databasePath, {
        timeout: this.config.timeout || 5000,
        verbose:
          env === 'development'
            ? (message?: unknown, ...additionalArgs: unknown[]) => {
                const sql = typeof message === 'string' ? message : String(message);
                this.logger.debug({ sql, additionalArgs }, 'SQL query');
              }
            : undefined,
      });

      // Configure database settings
      if (this.config.enableWAL !== false) {
        this.db.pragma('journal_mode = WAL');
      }

      // Enable foreign key constraints
      this.db.pragma('foreign_keys = ON');

      // Set synchronous mode for better performance with WAL
      this.db.pragma('synchronous = NORMAL');

      return this.db;
    } catch (error) {
      throw new Error(
        `Failed to connect to database: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get the current database instance
   */
  getDatabase(): Database.Database {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.db;
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      try {
        this.db.close();
        this.db = null;
      } catch (error) {
        throw new Error(
          `Failed to close database: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }
  }

  /**
   * Check if database is connected
   */
  isConnected(): boolean {
    return this.db !== null;
  }
}
