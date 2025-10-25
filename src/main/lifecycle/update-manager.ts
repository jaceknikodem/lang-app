/**
 * Application update management
 * Handles checking for and installing updates
 */

import { app, dialog, shell } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface UpdateInfo {
  version: string;
  releaseDate: string;
  downloadUrl: string;
  releaseNotes: string;
  critical: boolean;
}

export interface UpdateConfig {
  checkOnStartup: boolean;
  checkIntervalHours: number;
  updateServerUrl?: string;
  autoDownload: boolean;
}

export class UpdateManager {
  private config: UpdateConfig;
  private checkTimer?: NodeJS.Timeout;

  constructor(config: UpdateConfig) {
    this.config = config;
  }

  /**
   * Initialize update checking
   */
  async initialize(): Promise<void> {
    try {
      console.log('Initializing update manager...');
      
      if (this.config.checkOnStartup) {
        // Check for updates on startup (with delay to not block app initialization)
        setTimeout(() => {
          this.checkForUpdates(false);
        }, 30000); // 30 second delay
      }
      
      // Set up periodic update checks
      if (this.config.checkIntervalHours > 0) {
        this.checkTimer = setInterval(() => {
          this.checkForUpdates(false);
        }, this.config.checkIntervalHours * 60 * 60 * 1000);
      }
      
      console.log('Update manager initialized');
    } catch (error) {
      console.error('Failed to initialize update manager:', error);
    }
  }

  /**
   * Check for available updates
   */
  async checkForUpdates(showNoUpdateDialog = true): Promise<UpdateInfo | null> {
    try {
      console.log('Checking for updates...');
      
      // In a real implementation, this would check a remote server
      // For now, we'll simulate the update check process
      const currentVersion = app.getVersion();
      const updateInfo = await this.fetchUpdateInfo();
      
      if (updateInfo && this.isNewerVersion(updateInfo.version, currentVersion)) {
        console.log(`Update available: ${updateInfo.version}`);
        await this.handleUpdateAvailable(updateInfo);
        return updateInfo;
      } else {
        console.log('No updates available');
        if (showNoUpdateDialog) {
          await dialog.showMessageBox({
            type: 'info',
            title: 'No Updates',
            message: 'You are running the latest version.',
            detail: `Current version: ${currentVersion}`
          });
        }
        return null;
      }
    } catch (error) {
      console.error('Error checking for updates:', error);
      
      if (showNoUpdateDialog) {
        await dialog.showMessageBox({
          type: 'error',
          title: 'Update Check Failed',
          message: 'Unable to check for updates.',
          detail: 'Please check your internet connection and try again later.'
        });
      }
      
      return null;
    }
  }

  /**
   * Handle when an update is available
   */
  private async handleUpdateAvailable(updateInfo: UpdateInfo): Promise<void> {
    const result = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Download Update', 'View Release Notes', 'Remind Me Later'],
      defaultId: 0,
      title: 'Update Available',
      message: `Version ${updateInfo.version} is available`,
      detail: updateInfo.critical 
        ? 'This is a critical update and is recommended for all users.'
        : 'A new version of the application is available.'
    });

    switch (result.response) {
      case 0: // Download Update
        await this.downloadUpdate(updateInfo);
        break;
      case 1: // View Release Notes
        await this.showReleaseNotes(updateInfo);
        break;
      case 2: // Remind Me Later
        // Schedule reminder for next startup
        await this.scheduleUpdateReminder(updateInfo);
        break;
    }
  }

  /**
   * Download and install update
   */
  private async downloadUpdate(updateInfo: UpdateInfo): Promise<void> {
    try {
      // In a real implementation, this would download the update
      // For now, we'll open the download URL in the default browser
      await shell.openExternal(updateInfo.downloadUrl);
      
      const result = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Quit and Install', 'Install Later'],
        defaultId: 0,
        title: 'Update Downloaded',
        message: 'The update has been downloaded.',
        detail: 'Would you like to quit the application and install the update now?'
      });

      if (result.response === 0) {
        // Quit application for update installation
        app.quit();
      }
    } catch (error) {
      console.error('Error downloading update:', error);
      await dialog.showMessageBox({
        type: 'error',
        title: 'Download Failed',
        message: 'Failed to download the update.',
        detail: 'Please try again later or download manually from the website.'
      });
    }
  }

  /**
   * Show release notes for the update
   */
  private async showReleaseNotes(updateInfo: UpdateInfo): Promise<void> {
    await dialog.showMessageBox({
      type: 'info',
      title: `Release Notes - Version ${updateInfo.version}`,
      message: `What's new in version ${updateInfo.version}`,
      detail: updateInfo.releaseNotes
    });

    // Ask if they want to download after viewing notes
    const result = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Download Now', 'Maybe Later'],
      defaultId: 0,
      title: 'Download Update?',
      message: 'Would you like to download this update?'
    });

    if (result.response === 0) {
      await this.downloadUpdate(updateInfo);
    }
  }

  /**
   * Schedule update reminder for next startup
   */
  private async scheduleUpdateReminder(updateInfo: UpdateInfo): Promise<void> {
    try {
      const reminderPath = path.join(app.getPath('userData'), 'update-reminder.json');
      const reminder = {
        version: updateInfo.version,
        scheduledAt: new Date().toISOString(),
        updateInfo
      };
      
      await fs.writeFile(reminderPath, JSON.stringify(reminder, null, 2));
      console.log('Update reminder scheduled');
    } catch (error) {
      console.error('Failed to schedule update reminder:', error);
    }
  }

  /**
   * Check for scheduled update reminders
   */
  async checkUpdateReminders(): Promise<void> {
    try {
      const reminderPath = path.join(app.getPath('userData'), 'update-reminder.json');
      
      try {
        const reminderData = await fs.readFile(reminderPath, 'utf-8');
        const reminder = JSON.parse(reminderData);
        
        // Show reminder if it's for a version newer than current
        if (this.isNewerVersion(reminder.version, app.getVersion())) {
          await this.handleUpdateAvailable(reminder.updateInfo);
        }
        
        // Clean up the reminder file
        await fs.unlink(reminderPath);
      } catch {
        // No reminder file exists
      }
    } catch (error) {
      console.error('Error checking update reminders:', error);
    }
  }

  /**
   * Fetch update information from server
   */
  private async fetchUpdateInfo(): Promise<UpdateInfo | null> {
    // In a real implementation, this would make an HTTP request to check for updates
    // For demonstration purposes, we'll return null (no updates available)
    // 
    // Example implementation:
    // const response = await fetch(`${this.config.updateServerUrl}/check-update`);
    // const updateData = await response.json();
    // return updateData;
    
    return null;
  }

  /**
   * Compare version strings to determine if one is newer
   */
  private isNewerVersion(newVersion: string, currentVersion: string): boolean {
    const parseVersion = (version: string) => {
      return version.split('.').map(num => parseInt(num, 10));
    };
    
    const newParts = parseVersion(newVersion);
    const currentParts = parseVersion(currentVersion);
    
    for (let i = 0; i < Math.max(newParts.length, currentParts.length); i++) {
      const newPart = newParts[i] || 0;
      const currentPart = currentParts[i] || 0;
      
      if (newPart > currentPart) return true;
      if (newPart < currentPart) return false;
    }
    
    return false;
  }

  /**
   * Clean up update manager resources
   */
  cleanup(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }
  }
}