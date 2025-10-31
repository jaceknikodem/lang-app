/**
 * SQLite database connection and configuration using Drizzle ORM
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { DatabaseConfig } from '../../shared/types/database.js';
import path from 'path';
import fs from 'fs';
import * as schema from './schema.js';

export class DatabaseConnection {
  private db: Database.Database | null = null;
  private drizzleDb: ReturnType<typeof drizzle> | null = null;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  /**
   * Initialize database connection with proper configuration
   */
  async connect(): Promise<ReturnType<typeof drizzle>> {
    if (this.drizzleDb) {
      return this.drizzleDb;
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
        verbose: process.env.NODE_ENV === 'development' ? console.log : undefined
      });

      // Configure database settings
      if (this.config.enableWAL !== false) {
        this.db.pragma('journal_mode = WAL');
      }
      
      // Enable foreign key constraints
      this.db.pragma('foreign_keys = ON');
      
      // Set synchronous mode for better performance with WAL
      this.db.pragma('synchronous = NORMAL');

      // Create Drizzle instance
      this.drizzleDb = drizzle(this.db, { schema });

      return this.drizzleDb;
    } catch (error) {
      throw new Error(`Failed to connect to database: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get the current Drizzle database instance
   */
  getDatabase(): ReturnType<typeof drizzle> {
    if (!this.drizzleDb) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.drizzleDb;
  }

  /**
   * Get the raw better-sqlite3 database instance (for migrations and direct SQL)
   */
  getRawDatabase(): Database.Database {
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
        this.drizzleDb = null;
      } catch (error) {
        throw new Error(`Failed to close database: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  /**
   * Check if database is connected
   */
  isConnected(): boolean {
    return this.db !== null && this.drizzleDb !== null;
  }
}