/**
 * Database layer exports
 */

export { SQLiteDatabaseLayer } from './database-layer.js';
export { createDatabase } from './factory.js';

// Re-export types for convenience
export type { DatabaseLayer, DatabaseConfig } from '../../shared/types/database.js';