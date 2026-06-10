/**
 * Application lifecycle management
 * Handles startup, shutdown, data backup/restore, and updates
 */

import { app, dialog } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { subDays } from 'date-fns';
import { SQLiteDatabaseLayer } from '../database/database-layer.js';
import { getLogger } from '../utils/logger.js';
import { Logger } from '../../shared/utils/logger.js';

export interface LifecycleConfig {
  databaseLayer: SQLiteDatabaseLayer;
  userDataPath: string;
  backupRetentionDays: number;
}

export class LifecycleManager {
  private config: LifecycleConfig;
  private isShuttingDown = false;
  private readonly logger: Logger;

  constructor(config: LifecycleConfig) {
    this.logger = getLogger();
    this.config = config;
  }

  /**
   * Initialize application startup procedures
   */
  async handleStartup(): Promise<void> {
    try {
      this.logger.info('Starting application lifecycle initialization...');

      // Migrate audio files from old location to userData directory
      await this.migrateAudioFiles();

      // Ensure required directories exist
      await this.ensureDirectories();

      // Check for and restore from backup if needed
      await this.checkForRecovery();

      // Clean up old backups
      await this.cleanupOldBackups();

      this.logger.info('Application startup completed successfully');
    } catch (error) {
      this.logger.error({ error }, 'Error during application startup');
      throw error;
    }
  }

  /**
   * Handle graceful application shutdown
   */
  async handleShutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;

    try {
      this.logger.info('Starting graceful shutdown...');

      // Close database connections
      if (this.config.databaseLayer) {
        await this.config.databaseLayer.close();
      }

      this.logger.info('Graceful shutdown completed');
    } catch (error) {
      this.logger.error({ error }, 'Error during shutdown');
      // Don't throw - we still want to quit
    }
  }

  /**
   * Create a backup of user data
   */
  async createBackup(): Promise<string> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = path.join(this.config.userDataPath, 'backups');
      const backupPath = path.join(backupDir, `backup-${timestamp}`);

      // Ensure backup directory exists
      await fs.mkdir(backupDir, { recursive: true });
      await fs.mkdir(backupPath, { recursive: true });

      // Backup database
      const dbPath = path.join(this.config.userDataPath, 'language_learning.db');
      const backupDbPath = path.join(backupPath, 'language_learning.db');

      try {
        await fs.copyFile(dbPath, backupDbPath);
      } catch {
        // Database might not exist yet, that's okay
        this.logger.debug('No database to backup (this is normal for first run)');
      }

      // Backup audio files
      const audioDir = path.join(app.getPath('userData'), 'audio');
      const backupAudioDir = path.join(backupPath, 'audio');

      try {
        await this.copyDirectory(audioDir, backupAudioDir);
      } catch {
        // Audio directory might not exist yet
        this.logger.debug('No audio files to backup');
      }

      // Create backup metadata
      const metadata = {
        timestamp: new Date().toISOString(),
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
      };

      await fs.writeFile(path.join(backupPath, 'metadata.json'), JSON.stringify(metadata, null, 2));

      this.logger.info({ backupPath }, 'Backup created successfully');
      return backupPath;
    } catch (error) {
      this.logger.error({ error }, 'Failed to create backup');
      throw error;
    }
  }

  /**
   * Restore from a backup
   */
  async restoreFromBackup(backupPath: string): Promise<void> {
    try {
      this.logger.info({ backupPath }, 'Restoring from backup');

      // Verify backup exists and is valid
      const metadataPath = path.join(backupPath, 'metadata.json');
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));

      this.logger.info({ timestamp: metadata.timestamp }, 'Restoring backup');

      // Restore database
      const backupDbPath = path.join(backupPath, 'language_learning.db');
      const dbPath = path.join(this.config.userDataPath, 'language_learning.db');

      try {
        await fs.copyFile(backupDbPath, dbPath);
        this.logger.info('Database restored successfully');
      } catch {
        this.logger.debug('No database in backup to restore');
      }

      // Restore audio files
      const backupAudioDir = path.join(backupPath, 'audio');
      const audioDir = path.join(app.getPath('userData'), 'audio');

      try {
        await fs.rm(audioDir, { recursive: true, force: true });
        await this.copyDirectory(backupAudioDir, audioDir);
        this.logger.info('Audio files restored successfully');
      } catch {
        this.logger.debug('No audio files in backup to restore');
      }

      this.logger.info('Backup restoration completed successfully');
    } catch (error) {
      this.logger.error({ error, backupPath }, 'Failed to restore from backup');
      throw error;
    }
  }

  /**
   * Check for recovery scenarios on startup
   */
  private async checkForRecovery(): Promise<void> {
    try {
      const dbPath = path.join(this.config.userDataPath, 'language_learning.db');

      // Check if database exists and is accessible
      try {
        await fs.access(dbPath);
        // Try to open database to verify it's not corrupted
        // This will be handled by the database layer initialization
      } catch {
        this.logger.info('Database not found or inaccessible, checking for backups...');
        await this.offerBackupRecovery();
      }
    } catch (error) {
      this.logger.error({ error }, 'Error during recovery check');
    }
  }

  /**
   * Offer user the option to recover from backup
   */
  private async offerBackupRecovery(): Promise<void> {
    try {
      const backupDir = path.join(this.config.userDataPath, 'backups');

      try {
        const backups = await fs.readdir(backupDir);
        const validBackups = [];

        for (const backup of backups) {
          const backupPath = path.join(backupDir, backup);
          const metadataPath = path.join(backupPath, 'metadata.json');

          try {
            await fs.access(metadataPath);
            validBackups.push({ name: backup, path: backupPath });
          } catch {
            // Skip invalid backups
          }
        }

        if (validBackups.length > 0) {
          // Sort by name (which includes timestamp) to get most recent first
          validBackups.sort((a, b) => b.name.localeCompare(a.name));

          const result = await dialog.showMessageBox({
            type: 'question',
            buttons: ['Restore Latest Backup', 'Start Fresh', 'Cancel'],
            defaultId: 0,
            title: 'Data Recovery',
            message: 'No database found. Would you like to restore from a backup?',
            detail: `Found ${validBackups.length} backup(s). Latest: ${validBackups[0].name}`,
          });

          if (result.response === 0) {
            await this.restoreFromBackup(validBackups[0].path);
          }
        }
      } catch {
        // No backups directory or no backups found - this is normal for first run
        this.logger.debug('No backups found (normal for first run)');
      }
    } catch (error) {
      this.logger.error({ error }, 'Error during backup recovery offer');
    }
  }

  /**
   * Clean up old backups based on retention policy
   */
  private async cleanupOldBackups(): Promise<void> {
    try {
      const backupDir = path.join(this.config.userDataPath, 'backups');
      const cutoffDate = subDays(new Date(), this.config.backupRetentionDays);

      try {
        const backups = await fs.readdir(backupDir);

        for (const backup of backups) {
          const backupPath = path.join(backupDir, backup);
          const stats = await fs.stat(backupPath);

          if (stats.isDirectory() && stats.mtime < cutoffDate) {
            await fs.rm(backupPath, { recursive: true, force: true });
            this.logger.debug({ backup }, 'Cleaned up old backup');
          }
        }
      } catch {
        // Backup directory doesn't exist yet
      }
    } catch (error) {
      this.logger.error({ error }, 'Error during backup cleanup');
    }
  }

  /**
   * Ensure required directories exist
   */
  private async ensureDirectories(): Promise<void> {
    const directories = [
      path.join(this.config.userDataPath, 'backups'),
      path.join(app.getPath('userData'), 'audio'),
      path.join(process.cwd(), 'data'),
    ];

    for (const dir of directories) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * Restart all - clear all data and audio files (but preserve settings)
   */
  async restartAll(): Promise<void> {
    try {
      this.logger.info('Starting complete data reset...');

      // Backup all settings before deleting database
      const settingsBackup: Record<string, string> = {};
      try {
        // Access the database connection through the database layer
        // We use a type assertion to access the private getDb method
        // This is safe here since we're in the lifecycle manager which is tightly coupled
        const db = (this.config.databaseLayer as any).getDb();
        const stmt = db.prepare('SELECT key, value FROM settings');
        const rows = stmt.all() as Array<{ key: string; value: string }>;
        for (const row of rows) {
          settingsBackup[row.key] = row.value;
        }
        this.logger.info(
          { settingCount: Object.keys(settingsBackup).length },
          'Backed up settings'
        );
      } catch {
        this.logger.debug('No settings to backup (this is normal for first run)');
      }

      // Close database connection first
      if (this.config.databaseLayer) {
        await this.config.databaseLayer.close();
      }

      // Remove database file
      const dbPath = path.join(this.config.userDataPath, 'language_learning.db');
      try {
        await fs.unlink(dbPath);
        this.logger.info('Database file removed');
      } catch {
        this.logger.debug('No database file to remove (this is normal)');
      }

      // Remove all audio files recursively (including subdirectories)
      const audioDir = path.join(app.getPath('userData'), 'audio');
      try {
        const entries = await fs.readdir(audioDir, { withFileTypes: true });
        for (const entry of entries) {
          const entryPath = path.join(audioDir, entry.name);
          if (entry.name === '.gitkeep') {
            // Keep the .gitkeep file
            continue;
          }
          if (entry.isDirectory()) {
            // Recursively remove directory
            await fs.rm(entryPath, { recursive: true, force: true });
          } else {
            // Remove file
            await fs.unlink(entryPath);
          }
        }
        this.logger.info('Audio files removed');
      } catch {
        this.logger.debug('No audio files to remove');
      }

      // Reinitialize database
      await this.config.databaseLayer.initialize();

      // Restore all settings
      if (Object.keys(settingsBackup).length > 0) {
        for (const [key, value] of Object.entries(settingsBackup)) {
          await this.config.databaseLayer.setSetting(key, value);
        }
        this.logger.info({ settingCount: Object.keys(settingsBackup).length }, 'Restored settings');
      }

      this.logger.info('Complete data reset completed successfully');
    } catch (error) {
      this.logger.error({ error }, 'Failed to restart all');
      throw error;
    }
  }

  /**
   * Restart language - clear all data and audio files for a specific language (but preserve settings)
   */
  async restartLanguage(language: string): Promise<void> {
    try {
      this.logger.info({ language }, 'Starting language-specific data reset...');

      // Access the database connection through the database layer
      const db = (this.config.databaseLayer as any).getDb();

      // Delete all words for this language (this will cascade delete sentences and related data)
      const deleteWordsStmt = db.prepare('DELETE FROM words WHERE language = ?');
      const wordsResult = deleteWordsStmt.run(language);
      this.logger.info(
        { language, deletedWords: wordsResult.changes },
        'Deleted words for language'
      );

      // Delete language-specific entries from other tables.
      // Tables that reference learning_sessions without CASCADE must be deleted before
      // learning_sessions itself, otherwise the FK constraint fires.
      const deleteQueueStmt = db.prepare('DELETE FROM word_generation_queue WHERE language = ?');
      deleteQueueStmt.run(language);

      const deleteAudioEventsStmt = db.prepare(
        'DELETE FROM audio_playback_events WHERE language = ?'
      );
      deleteAudioEventsStmt.run(language);

      const deleteSrsAdjustmentsStmt = db.prepare('DELETE FROM srs_adjustments WHERE language = ?');
      deleteSrsAdjustmentsStmt.run(language);

      // dialog_corrections will be deleted via CASCADE when sentences are deleted,
      // but we'll also delete any orphaned entries just in case
      const deleteDialogCorrectionsStmt = db.prepare(
        'DELETE FROM dialog_corrections WHERE language = ?'
      );
      deleteDialogCorrectionsStmt.run(language);

      const deleteNeglectedWordsStmt = db.prepare('DELETE FROM neglected_words WHERE language = ?');
      deleteNeglectedWordsStmt.run(language);

      const deleteDictionaryHoverStmt = db.prepare(
        'DELETE FROM dictionary_hover_events WHERE language = ?'
      );
      deleteDictionaryHoverStmt.run(language);

      const deleteReadAloudCacheStmt = db.prepare(
        'DELETE FROM read_aloud_cache WHERE language = ?'
      );
      deleteReadAloudCacheStmt.run(language);

      // Delete sessions last — audio_playback_events, srs_adjustments, dialog_corrections,
      // neglected_words, and dictionary_hover_events all have non-cascading FKs to this table.
      const deleteSessionsStmt = db.prepare('DELETE FROM learning_sessions WHERE language = ?');
      deleteSessionsStmt.run(language);

      this.logger.info({ language }, 'Deleted language-specific database entries');

      // Remove audio files for this language
      // Audio files are stored in lowercase language directories
      const audioDir = path.join(app.getPath('userData'), 'audio');
      const languageAudioDir = path.join(audioDir, language.toLowerCase());
      try {
        await fs.rm(languageAudioDir, { recursive: true, force: true });
        this.logger.info(
          { language, audioDir: languageAudioDir },
          'Removed audio files for language'
        );
      } catch (error) {
        // Directory might not exist, which is fine
        this.logger.debug(
          { language, error },
          'No audio files to remove for language (this is normal)'
        );
      }

      this.logger.info({ language }, 'Language-specific data reset completed successfully');
    } catch (error) {
      this.logger.error({ error, language }, 'Failed to restart language');
      throw error;
    }
  }

  /**
   * Open the backup directory in the system file manager
   */
  async openBackupDirectory(): Promise<void> {
    const backupDir = path.join(this.config.userDataPath, 'backups');
    try {
      const { shell } = await import('electron');

      // Ensure backup directory exists
      await fs.mkdir(backupDir, { recursive: true });

      // Open the directory in the system file manager
      await shell.openPath(backupDir);

      this.logger.info({ backupDir }, 'Opened backup directory');
    } catch (error) {
      this.logger.error({ error, backupDir }, 'Failed to open backup directory');
      throw error;
    }
  }

  /**
   * Migrate audio files from old location (process.cwd()/audio) to new location (userData/audio)
   */
  private async migrateAudioFiles(): Promise<void> {
    const oldAudioDir = path.join(process.cwd(), 'audio');
    const newAudioDir = path.join(app.getPath('userData'), 'audio');
    try {
      // Check if old audio directory exists
      try {
        await fs.access(oldAudioDir);
      } catch {
        // Old directory doesn't exist, nothing to migrate
        this.logger.debug('No audio files to migrate from old location');
        return;
      }

      // Check if new audio directory already has files
      let newDirHasFiles = false;
      try {
        await fs.access(newAudioDir);
        const entries = await fs.readdir(newAudioDir);
        newDirHasFiles = entries.length > 0;
      } catch {
        // New directory doesn't exist yet
      }

      if (newDirHasFiles) {
        this.logger.debug(
          { newAudioDir },
          'New audio directory already has files, skipping migration'
        );
        return;
      }

      this.logger.info(
        { oldAudioDir, newAudioDir },
        'Migrating audio files from old location to new location'
      );

      // Copy all files and directories from old location to new location
      await this.copyDirectory(oldAudioDir, newAudioDir);

      this.logger.info('Audio files migrated successfully');
    } catch (error) {
      // Don't throw - migration failure shouldn't block app startup
      this.logger.error({ error, oldAudioDir, newAudioDir }, 'Failed to migrate audio files');
    }
  }

  /**
   * Copy directory recursively
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}
