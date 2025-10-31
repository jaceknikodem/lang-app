/**
 * Database factory for creating configured database instances
 */

import path from 'path';
import { app } from 'electron';
import { SQLiteDatabaseLayer } from './database-layer.js';
import { DatabaseConfig } from '../../shared/types/database.js';

/**
 * Create a database instance with default configuration
 */
export function createDatabase(customConfig?: Partial<DatabaseConfig>): SQLiteDatabaseLayer {
  // Default database path in user data directory
  const defaultPath = path.join(app.getPath('userData'), 'language_learning.db');
  
  const config: DatabaseConfig = {
    databasePath: defaultPath,
    enableWAL: true,
    timeout: 5000,
    ...customConfig
  };

  return new SQLiteDatabaseLayer(config);
}

/**
 * Create a test database instance (in-memory)
 */
export function createTestDatabase(): SQLiteDatabaseLayer {
  const config: DatabaseConfig = {
    databasePath: ':memory:',
    enableWAL: false,
    timeout: 1000
  };

  return new SQLiteDatabaseLayer(config);
}