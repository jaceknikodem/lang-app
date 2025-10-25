/**
 * Settings panel component for application lifecycle management
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import { APP_CONFIG } from '../../shared/constants/index.js';

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
  private backupStatus = '';

  @state()
  private isCreatingBackup = false;

  @state()
  private currentLanguage = 'spanish';

  @state()
  private languageStatus = '';

  @state()
  private availableLanguages: string[] = [];

  @state()
  private languageStats: Array<{ language: string, totalWords: number, studiedWords: number }> = [];

  async connectedCallback() {
    super.connectedCallback();
    await this.loadCurrentLanguage();
    await this.loadAvailableLanguages();
    await this.loadLanguageStats();
  }

  private async loadCurrentLanguage() {
    try {
      this.currentLanguage = await window.electronAPI.database.getCurrentLanguage();
    } catch (error) {
      console.error('Failed to get current language:', error);
      this.currentLanguage = APP_CONFIG.DEFAULT_LANGUAGE;
    }
  }

  private async loadAvailableLanguages() {
    try {
      this.availableLanguages = await window.electronAPI.database.getAvailableLanguages();
    } catch (error) {
      console.error('Failed to get available languages:', error);
      this.availableLanguages = [];
    }
  }

  private async loadLanguageStats() {
    try {
      this.languageStats = await window.electronAPI.database.getLanguageStats();
    } catch (error) {
      console.error('Failed to get language stats:', error);
      this.languageStats = [];
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



  private async changeLanguage(event: Event) {
    const select = event.target as HTMLSelectElement;
    const newLanguage = select.value;

    this.languageStatus = '';

    try {
      await window.electronAPI.database.setCurrentLanguage(newLanguage);
      this.currentLanguage = newLanguage;
      this.languageStatus = `Language changed to ${this.getLanguageDisplayName(newLanguage)}`;

      // Refresh language stats after changing language
      await this.loadLanguageStats();
    } catch (error) {
      console.error('Failed to change language:', error);
      this.languageStatus = `Failed to change language: ${error instanceof Error ? error.message : 'Unknown error'}`;
      // Reset select to current language
      select.value = this.currentLanguage;
    }
  }

  private getLanguageDisplayName(language: string): string {
    const languageNames: Record<string, string> = {
      'spanish': 'Spanish',
      'italian': 'Italian',
      'portuguese': 'Portuguese',
      'polish': 'Polish',
      'indonesian': 'Indonesian'
    };

    return languageNames[language] || language.charAt(0).toUpperCase() + language.slice(1);
  }

  private renderLanguageOptions() {
    // Show all supported languages, with available ones first
    const supportedLanguages = [...APP_CONFIG.SUPPORTED_LANGUAGES];
    const availableSet = new Set(this.availableLanguages);

    // Sort: available languages first, then others
    const sortedLanguages = supportedLanguages.sort((a: string, b: string) => {
      const aAvailable = availableSet.has(a);
      const bAvailable = availableSet.has(b);

      if (aAvailable && !bAvailable) return -1;
      if (!aAvailable && bAvailable) return 1;
      return a.localeCompare(b);
    });

    return sortedLanguages.map((language: string) => {
      const isAvailable = availableSet.has(language);
      const displayName = this.getLanguageDisplayName(language);
      const wordCount = this.languageStats.find(stat => stat.language === language)?.totalWords || 0;

      return html`
        <option value=${language} ?disabled=${!isAvailable && language !== this.currentLanguage}>
          ${displayName}${isAvailable ? ` (${wordCount} words)` : ' (no words)'}
        </option>
      `;
    });
  }

  render() {
    return html`
      <div class="settings-container">
        <h2>Settings</h2>

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
              ${this.renderLanguageOptions()}
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
      </div>
    `;
  }
}