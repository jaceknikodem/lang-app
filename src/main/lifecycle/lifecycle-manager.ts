/**
 * Application lifecycle management
 * Handles startup, shutdown, data backup/restore, and updates
 */

import { app, dialog } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SQLiteDatabaseLayer } from '../database/database-layer.js';

export interface LifecycleConfig {
  databaseLayer: SQLiteDatabaseLayer;
  userDataPath: string;
  backupRetentionDays: number;
}

export class LifecycleManager {
  private config: LifecycleConfig;
  private isShuttingDown = false;

  constructor(config: LifecycleConfig) {
    this.config = config;
  }

  /**
   * Initialize application startup procedures
   */
  async handleStartup(): Promise<void> {
    try {
      console.log('Starting application lifecycle initialization...');
      
      // Migrate audio files from old location to userData directory
      await this.migrateAudioFiles();
      
      // Ensure required directories exist
      await this.ensureDirectories();
      
      // Check for and restore from backup if needed
      await this.checkForRecovery();
      
      // Clean up old backups
      await this.cleanupOldBackups();
      
      console.log('Application startup completed successfully');
    } catch (error) {
      console.error('Error during application startup:', error);
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
      console.log('Starting graceful shutdown...');
      
      // Close database connections
      if (this.config.databaseLayer) {
        await this.config.databaseLayer.close();
      }
      
      console.log('Graceful shutdown completed');
    } catch (error) {
      console.error('Error during shutdown:', error);
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
      } catch (error) {
        // Database might not exist yet, that's okay
        console.log('No database to backup (this is normal for first run)');
      }
      
      // Backup audio files
      const audioDir = path.join(app.getPath('userData'), 'audio');
      const backupAudioDir = path.join(backupPath, 'audio');
      
      try {
        await this.copyDirectory(audioDir, backupAudioDir);
      } catch (error) {
        // Audio directory might not exist yet
        console.log('No audio files to backup');
      }
      
      // Create backup metadata
      const metadata = {
        timestamp: new Date().toISOString(),
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch
      };
      
      await fs.writeFile(
        path.join(backupPath, 'metadata.json'),
        JSON.stringify(metadata, null, 2)
      );
      
      console.log(`Backup created successfully: ${backupPath}`);
      return backupPath;
    } catch (error) {
      console.error('Failed to create backup:', error);
      throw error;
    }
  }

  /**
   * Restore from a backup
   */
  async restoreFromBackup(backupPath: string): Promise<void> {
    try {
      console.log(`Restoring from backup: ${backupPath}`);
      
      // Verify backup exists and is valid
      const metadataPath = path.join(backupPath, 'metadata.json');
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
      
      console.log(`Restoring backup from ${metadata.timestamp}`);
      
      // Restore database
      const backupDbPath = path.join(backupPath, 'language_learning.db');
      const dbPath = path.join(this.config.userDataPath, 'language_learning.db');
      
      try {
        await fs.copyFile(backupDbPath, dbPath);
        console.log('Database restored successfully');
      } catch (error) {
        console.log('No database in backup to restore');
      }
      
      // Restore audio files
      const backupAudioDir = path.join(backupPath, 'audio');
      const audioDir = path.join(app.getPath('userData'), 'audio');
      
      try {
        await fs.rm(audioDir, { recursive: true, force: true });
        await this.copyDirectory(backupAudioDir, audioDir);
        console.log('Audio files restored successfully');
      } catch (error) {
        console.log('No audio files in backup to restore');
      }
      
      console.log('Backup restoration completed successfully');
    } catch (error) {
      console.error('Failed to restore from backup:', error);
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
      } catch (error) {
        console.log('Database not found or inaccessible, checking for backups...');
        await this.offerBackupRecovery();
      }
    } catch (error) {
      console.error('Error during recovery check:', error);
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
            detail: `Found ${validBackups.length} backup(s). Latest: ${validBackups[0].name}`
          });
          
          if (result.response === 0) {
            await this.restoreFromBackup(validBackups[0].path);
          }
        }
      } catch {
        // No backups directory or no backups found - this is normal for first run
        console.log('No backups found (normal for first run)');
      }
    } catch (error) {
      console.error('Error during backup recovery offer:', error);
    }
  }

  /**
   * Clean up old backups based on retention policy
   */
  private async cleanupOldBackups(): Promise<void> {
    try {
      const backupDir = path.join(this.config.userDataPath, 'backups');
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.backupRetentionDays);
      
      try {
        const backups = await fs.readdir(backupDir);
        
        for (const backup of backups) {
          const backupPath = path.join(backupDir, backup);
          const stats = await fs.stat(backupPath);
          
          if (stats.isDirectory() && stats.mtime < cutoffDate) {
            await fs.rm(backupPath, { recursive: true, force: true });
            console.log(`Cleaned up old backup: ${backup}`);
          }
        }
      } catch {
        // Backup directory doesn't exist yet
      }
    } catch (error) {
      console.error('Error during backup cleanup:', error);
    }
  }

  /**
   * Ensure required directories exist
   */
  private async ensureDirectories(): Promise<void> {
    const directories = [
      path.join(this.config.userDataPath, 'backups'),
      path.join(app.getPath('userData'), 'audio'),
      path.join(process.cwd(), 'data')
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
      console.log('Starting complete data reset...');
      
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
        console.log(`Backed up ${Object.keys(settingsBackup).length} settings`);
      } catch (error) {
        console.log('No settings to backup (this is normal for first run)');
      }
      
      // Close database connection first
      if (this.config.databaseLayer) {
        await this.config.databaseLayer.close();
      }
      
      // Remove database file
      const dbPath = path.join(this.config.userDataPath, 'language_learning.db');
      try {
        await fs.unlink(dbPath);
        console.log('Database file removed');
      } catch (error) {
        console.log('No database file to remove (this is normal)');
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
        console.log('Audio files removed');
      } catch (error) {
        console.log('No audio files to remove');
      }
      
      // Reinitialize database
      await this.config.databaseLayer.initialize();
      
      // Restore all settings
      if (Object.keys(settingsBackup).length > 0) {
        for (const [key, value] of Object.entries(settingsBackup)) {
          await this.config.databaseLayer.setSetting(key, value);
        }
        console.log(`Restored ${Object.keys(settingsBackup).length} settings`);
      }
      
      console.log('Complete data reset completed successfully');
    } catch (error) {
      console.error('Failed to restart all:', error);
      throw error;
    }
  }

  /**
   * Open the backup directory in the system file manager
   */
  async openBackupDirectory(): Promise<void> {
    try {
      const { shell } = await import('electron');
      const backupDir = path.join(this.config.userDataPath, 'backups');
      
      // Ensure backup directory exists
      await fs.mkdir(backupDir, { recursive: true });
      
      // Open the directory in the system file manager
      await shell.openPath(backupDir);
      
      console.log(`Opened backup directory: ${backupDir}`);
    } catch (error) {
      console.error('Failed to open backup directory:', error);
      throw error;
    }
  }

  /**
   * Migrate audio files from old location (process.cwd()/audio) to new location (userData/audio)
   */
  private async migrateAudioFiles(): Promise<void> {
    try {
      const oldAudioDir = path.join(process.cwd(), 'audio');
      const newAudioDir = path.join(app.getPath('userData'), 'audio');
      
      // Check if old audio directory exists
      try {
        await fs.access(oldAudioDir);
      } catch {
        // Old directory doesn't exist, nothing to migrate
        console.log('No audio files to migrate from old location');
        return;
      }
      
      // Check if new audio directory already has files
      let newDirExists = false;
      let newDirHasFiles = false;
      try {
        await fs.access(newAudioDir);
        newDirExists = true;
        const entries = await fs.readdir(newAudioDir);
        newDirHasFiles = entries.length > 0;
      } catch {
        // New directory doesn't exist yet
      }
      
      if (newDirHasFiles) {
        console.log('New audio directory already has files, skipping migration');
        return;
      }
      
      console.log(`Migrating audio files from ${oldAudioDir} to ${newAudioDir}...`);
      
      // Copy all files and directories from old location to new location
      await this.copyDirectory(oldAudioDir, newAudioDir);
      
      console.log('Audio files migrated successfully');
    } catch (error) {
      // Don't throw - migration failure shouldn't block app startup
      console.error('Failed to migrate audio files:', error);
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