/**
 * Shared plumbing for the database repositories.
 *
 * Repositories are thin, table-focused groupings of queries. They hold no state
 * of their own beyond the connection and logger handed to them.
 */

import Database from 'better-sqlite3';
import { DatabaseConnection } from './connection.js';
import { Logger } from '../../shared/utils/logger.js';
import { wrapError } from '../../shared/utils/error.js';

export abstract class BaseRepository {
  constructor(
    protected readonly connection: DatabaseConnection,
    protected readonly logger: Logger
  ) {}

  protected getDb(): Database.Database {
    return this.connection.getDatabase();
  }

  protected requireChange(result: { changes: number }, entity: string, id: number): void {
    if (result.changes === 0) {
      throw new Error(`${entity} with ID ${id} not found`);
    }
  }

  /**
   * Run `work` against the database, tagging any failure with `description`.
   *
   * Resolving the connection stays outside the try block so that a
   * "database not connected" fault surfaces as itself rather than being
   * reported as a failure of whichever query happened to run first.
   */
  protected query<T>(description: string, work: (db: Database.Database) => T): T {
    const db = this.getDb();
    try {
      return work(db);
    } catch (error) {
      throw wrapError(error, description);
    }
  }

  /** Async counterpart to {@link query}; awaits inside the try so rejections are wrapped too. */
  protected async queryAsync<T>(
    description: string,
    work: (db: Database.Database) => Promise<T>
  ): Promise<T> {
    const db = this.getDb();
    try {
      return await work(db);
    } catch (error) {
      throw wrapError(error, description);
    }
  }
}
