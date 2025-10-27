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
      const audioDir = path.join(process.cwd(), 'audio');
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
      const audioDir = path.join(process.cwd(), 'audio');
      
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
      path.join(process.cwd(), 'audio'),
      path.join(process.cwd(), 'data')
    ];
    
    for (const dir of directories) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * Restart all - clear all data and audio files
   */
  async restartAll(): Promise<void> {
    try {
      console.log('Starting complete data reset...');
      
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
      
      // Remove all audio files
      const audioDir = path.join(process.cwd(), 'audio');
      try {
        const audioFiles = await fs.readdir(audioDir);
        for (const file of audioFiles) {
          if (file !== '.gitkeep') { // Keep the .gitkeep file
            await fs.unlink(path.join(audioDir, file));
          }
        }
        console.log('Audio files removed');
      } catch (error) {
        console.log('No audio files to remove');
      }
      
      // Reinitialize database
      await this.config.databaseLayer.initialize();
      
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