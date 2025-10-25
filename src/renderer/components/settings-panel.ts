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

      .version-info {
        font-family: monospace;
        font-size: 0.9rem;
        color: #666;
      }

      .language-select {
        padding: 0.5rem;
        border: 1px solid #ccc;
        border-radius: 4px;
        font-size: 0.9rem;
        min-width: 200px;
      }

      .language-select:focus {
        outline: none;
        border-color: #007acc;
      }
    `
  ];

  @state()
  private appVersion = '';

  @state()
  private backupStatus = '';

  @state()
  private updateStatus = '';

  @state()
  private isCreatingBackup = false;

  @state()
  private isCheckingUpdates = false;

  @state()
  private currentLanguage = 'spanish';

  @state()
  private languageStatus = '';

  async connectedCallback() {
    super.connectedCallback();
    await this.loadAppVersion();
    await this.loadCurrentLanguage();
  }

  private async loadCurrentLanguage() {
    try {
      this.currentLanguage = await window.electronAPI.database.getCurrentLanguage();
    } catch (error) {
      console.error('Failed to get current language:', error);
      this.currentLanguage = 'spanish';
    }
  }

  private async loadAppVersion() {
    try {
      this.appVersion = await window.electronAPI.lifecycle.getAppVersion();
    } catch (error) {
      console.error('Failed to get app version:', error);
      this.appVersion = 'Unknown';
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

  private async checkForUpdates() {
    this.isCheckingUpdates = true;
    this.updateStatus = '';

    try {
      const hasUpdates = await window.electronAPI.lifecycle.checkForUpdates();
      if (hasUpdates) {
        this.updateStatus = 'Updates are available! Check the notification for details.';
      } else {
        this.updateStatus = 'You are running the latest version.';
      }
    } catch (error) {
      console.error('Failed to check for updates:', error);
      this.updateStatus = `Failed to check for updates: ${error instanceof Error ? error.message : 'Unknown error'}`;
    } finally {
      this.isCheckingUpdates = false;
    }
  }

  private async changeLanguage(event: Event) {
    const select = event.target as HTMLSelectElement;
    const newLanguage = select.value;
    
    this.languageStatus = '';

    try {
      await window.electronAPI.database.setCurrentLanguage(newLanguage);
      this.currentLanguage = newLanguage;
      this.languageStatus = `Language changed to ${this.getLanguageDisplayName(newLanguage)}`;
    } catch (error) {
      console.error('Failed to change language:', error);
      this.languageStatus = `Failed to change language: ${error instanceof Error ? error.message : 'Unknown error'}`;
      // Reset select to current language
      select.value = this.currentLanguage;
    }
  }

  private getLanguageDisplayName(language: string): string {
    const languageNames: Record<string, string> = {
      'spanish': 'Spanish (Monica)',
      'portuguese': 'Portuguese (Luciana)',
      'italian': 'Italian (Alice)',
      'indonesian': 'Indonesian (Damayanti)',
      'polish': 'Polish (Zosia)',
    };
    
    return languageNames[language] || language;
  }

  render() {
    return html`
      <div class="settings-container">
        <h2>Application Settings</h2>

        <div class="settings-section">
          <h3>Application Information</h3>
          <div class="settings-row">
            <div class="settings-description">
              <strong>Version</strong>
              <p>Current application version</p>
            </div>
            <div class="version-info">v${this.appVersion}</div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Language Settings</h3>
          <div class="settings-row">
            <div class="settings-description">
              <strong>Current Language</strong>
              <p>Select the language for TTS voice and learning content</p>
            </div>
            <select 
              class="language-select" 
              .value=${this.currentLanguage}
              @change=${this.changeLanguage}
            >
              <option value="spanish">Spanish (Monica)</option>
              <option value="portuguese">Portuguese (Luciana)</option>
              <option value="italian">Italian (Alice)</option>
              <option value="indonesian">Indonesian (Damayanti)</option>
              <option value="polish">Polish (Zosia)</option>
            </select>
          </div>
          ${this.languageStatus ? html`
            <div class="status-message ${this.languageStatus.includes('Failed') ? 'status-error' : 'status-success'}">
              ${this.languageStatus}
            </div>
          ` : ''}
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
        </div>

        <div class="settings-section">
          <h3>Updates</h3>
          <div class="settings-row">
            <div class="settings-description">
              <strong>Check for Updates</strong>
              <p>Check if a newer version of the application is available</p>
            </div>
            <button 
              class="action-button" 
              @click=${this.checkForUpdates}
              ?disabled=${this.isCheckingUpdates}
            >
              ${this.isCheckingUpdates ? 'Checking...' : 'Check Updates'}
            </button>
          </div>
          ${this.updateStatus ? html`
            <div class="status-message status-info">
              ${this.updateStatus}
            </div>
          ` : ''}
        </div>

        <div class="settings-section">
          <h3>Privacy & Security</h3>
          <div class="settings-row">
            <div class="settings-description">
              <strong>Local-first Design</strong>
              <p>All your data stays on your device. No external tracking or data collection.</p>
            </div>
            <div class="version-info">✓ Enabled</div>
          </div>
          <div class="settings-row">
            <div class="settings-description">
              <strong>Automatic Backups</strong>
              <p>Backups are created automatically on app shutdown and retained for 30 days.</p>
            </div>
            <div class="version-info">✓ Enabled</div>
          </div>
        </div>
      </div>
    `;
  }
}