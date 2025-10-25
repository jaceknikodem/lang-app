/**
 * Database layer exports
 */

export { DatabaseConnection } from './connection.js';
export { MigrationManager, type Migration } from './migrations.js';
export { SQLiteDatabaseLayer } from './database-layer.js';
export { createDatabase, createTestDatabase } from './factory.js';

// Re-export types for convenience
export type { DatabaseLayer, DatabaseConfig } from '../../shared/types/database.js';