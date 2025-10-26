/**
 * Settings panel component for application lifecycle management
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';

// Type is already declared in preload.ts, no need to redeclare

@customElement('settings-panel')
export class SettingsPanel extends LitElement {
  static styles = [
    sharedStyles,
    css`
      .settings-container {
        max-width: 600px;
        margin: 0 auto;
        padding: 2rem;
      }

      .settings-section {
        margin-bottom: 2rem;
        padding: 1.5rem;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        background: #fafafa;
      }

      .settings-section h3 {
        margin-top: 0;
        color: #333;
        font-size: 1.2rem;
      }

      .settings-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
      }

      .settings-row:last-child {
        margin-bottom: 0;
      }

      .settings-description {
        flex: 1;
        margin-right: 1rem;
      }

      .settings-description p {
        margin: 0;
        color: #666;
        font-size: 0.9rem;
      }

      .action-button {
        padding: 0.5rem 1rem;
        background: #007acc;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.9rem;
        min-width: 120px;
      }

      .action-button:hover {
        background: #005a9e;
      }

      .action-button:disabled {
        background: #ccc;
        cursor: not-allowed;
      }

      .action-button.danger {
        background: #dc3545;
        color: white;
      }

      .action-button.danger:hover:not(:disabled) {
        background: #c82333;
      }

      .status-message {
        margin-top: 0.5rem;
        padding: 0.5rem;
        border-radius: 4px;
        font-size: 0.9rem;
      }

      .status-success {
        background: #d4edda;
        color: #155724;
        border: 1px solid #c3e6cb;
      }

      .status-error {
        background: #f8d7da;
        color: #721c24;
        border: 1px solid #f5c6cb;
      }

      .status-info {
        background: #d1ecf1;
        color: #0c5460;
        border: 1px solid #bee5eb;
      }

      .warning-section {
        border-color: #ffc107;
        background: #fff3cd;
      }

      .warning-section h3 {
        color: #856404;
      }

      .confirmation-dialog {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }

      .confirmation-content {
        background: white;
        padding: 2rem;
        border-radius: 8px;
        max-width: 400px;
        text-align: center;
      }

      .confirmation-content h3 {
        color: #dc3545;
        margin-top: 0;
      }

      .confirmation-actions {
        display: flex;
        gap: 1rem;
        justify-content: center;
        margin-top: 1.5rem;
      }

      .checkbox-row {
        display: flex;
        align-items: center;
        margin-bottom: 1rem;
      }

      .checkbox-row:last-child {
        margin-bottom: 0;
      }

      .checkbox-row input[type="checkbox"] {
        margin-right: 0.5rem;
        transform: scale(1.2);
      }

      .checkbox-row label {
        cursor: pointer;
        flex: 1;
      }

      .checkbox-description {
        margin-top: 0.25rem;
        color: #666;
        font-size: 0.9rem;
      }

    `
  ];

  @state()
  private backupStatus = '';

  @state()
  private isCreatingBackup = false;

  @state()
  private restartStatus = '';

  @state()
  private isRestarting = false;

  @state()
  private showConfirmation = false;

  @state()
  private contextSentencesEnabled = false;





  async connectedCallback() {
    super.connectedCallback();
    await this.loadSettings();
  }

  private async loadSettings() {
    try {
      const contextSetting = await window.electronAPI.database.getSetting('context_sentences');
      this.contextSentencesEnabled = contextSetting === 'true';
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }



  private async createBackup() {
    this.isCreatingBackup = true;
    this.backupStatus = '';

    try {
      const backupPath = await window.electronAPI.lifecycle.createBackup();
      this.backupStatus = `Backup created successfully at: ${backupPath}`;
    } catch (error) {
      console.error('Failed to create backup:', error);
      this.backupStatus = `Failed to create backup: ${error instanceof Error ? error.message : 'Unknown error'}`;
    } finally {
      this.isCreatingBackup = false;
    }
  }

  private showRestartConfirmation() {
    this.showConfirmation = true;
  }

  private hideRestartConfirmation() {
    this.showConfirmation = false;
  }

  private async confirmRestartAll() {
    this.showConfirmation = false;
    this.isRestarting = true;
    this.restartStatus = '';

    try {
      await window.electronAPI.lifecycle.restartAll();
      this.restartStatus = 'All data has been cleared successfully. The application will restart with a fresh database.';
      
      // Clear any local state/cache if needed
      // The app will automatically reinitialize with empty database
      
      // Optionally reload the page to reset the UI state
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (error) {
      console.error('Failed to restart all:', error);
      this.restartStatus = `Failed to clear all data: ${error instanceof Error ? error.message : 'Unknown error'}`;
    } finally {
      this.isRestarting = false;
    }
  }



  private async openBackupDirectory() {
    try {
      await window.electronAPI.lifecycle.openBackupDirectory();
    } catch (error) {
      console.error('Failed to open backup directory:', error);
      // Could add a status message here if needed, but for this simple action
      // it's probably better to just log the error
    }
  }

  private async toggleContextSentences(event: Event) {
    const checkbox = event.target as HTMLInputElement;
    this.contextSentencesEnabled = checkbox.checked;
    
    try {
      await window.electronAPI.database.setSetting('context_sentences', checkbox.checked ? 'true' : 'false');
    } catch (error) {
      console.error('Failed to save context sentences setting:', error);
      // Revert the checkbox state if saving failed
      this.contextSentencesEnabled = !checkbox.checked;
      checkbox.checked = !checkbox.checked;
    }
  }





  render() {
    return html`
      <div class="settings-container">
        <h2>Settings</h2>



        <div class="settings-section">
          <h3>Learning Preferences</h3>
          <div class="checkbox-row">
            <input 
              type="checkbox" 
              id="context-sentences"
              .checked=${this.contextSentencesEnabled}
              @change=${this.toggleContextSentences}
            />
            <label for="context-sentences">
              <strong>Context Sentences</strong>
              <div class="checkbox-description">
                When generating sentences, include additional sentences before and after for better context understanding
              </div>
            </label>
          </div>
        </div>

        <div class="settings-section">
          <h3>Data Management</h3>
          <div class="settings-row">
            <div class="settings-description">
              <strong>Create Backup</strong>
              <p>Create a backup of your learning data and audio files</p>
            </div>
            <button 
              class="action-button" 
              @click=${this.createBackup}
              ?disabled=${this.isCreatingBackup}
            >
              ${this.isCreatingBackup ? 'Creating...' : 'Create Backup'}
            </button>
          </div>
          ${this.backupStatus ? html`
            <div class="status-message ${this.backupStatus.includes('Failed') ? 'status-error' : 'status-success'}">
              ${this.backupStatus}
            </div>
          ` : ''}
          
          <div class="settings-row">
            <div class="settings-description">
              <strong>Restore Backup</strong>
              <p>Open the backup directory to browse and restore from your backups</p>
            </div>
            <button 
              class="action-button" 
              @click=${this.openBackupDirectory}
            >
              Restore Backup
            </button>
          </div>
        </div>

        <div class="settings-section warning-section">
          <h3>⚠️ Danger Zone</h3>
          <div class="settings-row">
            <div class="settings-description">
              <strong>Restart All</strong>
              <p>Permanently delete all words, sentences, progress, and audio files. Backups will be preserved. This cannot be undone!</p>
            </div>
            <button 
              class="action-button danger" 
              @click=${this.showRestartConfirmation}
              ?disabled=${this.isRestarting}
            >
              ${this.isRestarting ? 'Clearing...' : 'Restart All'}
            </button>
          </div>
          ${this.restartStatus ? html`
            <div class="status-message ${this.restartStatus.includes('Failed') ? 'status-error' : 'status-success'}">
              ${this.restartStatus}
            </div>
          ` : ''}
        </div>

        ${this.showConfirmation ? html`
          <div class="confirmation-dialog">
            <div class="confirmation-content">
              <h3>⚠️ Confirm Restart All</h3>
              <p>This will permanently delete:</p>
              <ul style="text-align: left; margin: 1rem 0;">
                <li>All words and translations</li>
                <li>All sentences and examples</li>
                <li>All progress and statistics</li>
                <li>All audio files</li>
              </ul>
              <p style="color: #28a745; font-size: 0.9rem;"><strong>Note:</strong> Backup files will be preserved.</p>
              <p><strong>This action cannot be undone!</strong></p>
              <div class="confirmation-actions">
                <button 
                  class="action-button danger" 
                  @click=${this.confirmRestartAll}
                >
                  Yes, Delete Everything
                </button>
                <button 
                  class="action-button" 
                  @click=${this.hideRestartConfirmation}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }
}