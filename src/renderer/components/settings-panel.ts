/**
 * Settings panel component for application lifecycle management
 */

import { html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import { settingsPanelStyles } from './settings-panel.styles.js';
import { getErrorMessage } from '../../shared/utils/error.js';
import { sessionManager } from '../utils/session-manager.js';
import { BaseComponent } from './base-component.js';
import './status-message.js';
import './confirmation-dialog.js';
import './app-button.js';

// Type is already declared in preload.ts, no need to redeclare

@customElement('settings-panel')
export class SettingsPanel extends BaseComponent {
  static styles = [sharedStyles, settingsPanelStyles];

  @state()
  private backupStatus = '';

  @state()
  private isCreatingBackup = false;

  @state()
  private exportStatus = '';

  @state()
  private isExporting = false;

  @state()
  private flowExportStatus = '';

  @state()
  private isExportingFlow = false;

  @state()
  private restartStatus = '';

  @state()
  private isRestarting = false;

  @state()
  private showConfirmation = false;

  @state()
  private showResetProgressConfirmation = false;

  @state()
  private resetProgressStatus = '';

  @state()
  private isResettingProgress = false;

  @state()
  private showClearSessionConfirmation = false;

  @state()
  private clearSessionStatus = '';

  @state()
  private availableLLMModels: string[] = [];

  @state()
  private currentLLMModel = '';

  @state()
  private isLoadingLLMModels = false;

  @state()
  private currentLLMProvider: 'ollama' | 'gemini' | 'mlx-lm' = 'ollama';

  @state()
  private availableLLMProviders: Array<'ollama' | 'gemini' | 'mlx-lm'> = [];

  @state()
  private geminiApiKey = '';

  @state()
  private mlxLmBaseUrl = '';

  @state()
  private isLoadingProviders = false;

  @state()
  private elevenLabsApiKey = '';

  @state()
  private isElevenLabsEnabled = false;

  @state()
  private llmError = '';

  async connectedCallback() {
    super.connectedCallback();
    await this.loadSettings();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  private async loadSettings() {
    try {
      // Load language settings
      await this.loadLanguageSettings();

      // Speech recognition is only initialized in quiz mode, not here

      // Load LLM settings
      await this.loadLLMSettings();

      // Load ElevenLabs settings
      await this.loadElevenLabsSettings();
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  private async loadLLMSettings() {
    this.isLoadingLLMModels = true;
    this.isLoadingProviders = true;

    try {
      // Get available LLM providers
      this.availableLLMProviders = await window.electronAPI.llm.getAvailableProviders();

      // Get current LLM provider
      this.currentLLMProvider = await window.electronAPI.llm.getCurrentProvider();

      // Get Gemini API key from settings
      const geminiKey = await window.electronAPI.database.getSetting('gemini_api_key');
      this.geminiApiKey = geminiKey || '';

      // Get mlx-lm base URL from settings
      const mlxLmUrl = await window.electronAPI.database.getSetting('mlx_lm_base_url');
      this.mlxLmBaseUrl = mlxLmUrl || '';

      // Get available LLM models for the current provider
      this.availableLLMModels = await window.electronAPI.llm.getModelsForProvider(
        this.currentLLMProvider
      );

      // Get current LLM model
      this.currentLLMModel = await window.electronAPI.llm.getCurrentModel();

      console.log('LLM settings loaded:', {
        providers: this.availableLLMProviders,
        currentProvider: this.currentLLMProvider,
        geminiApiKey: !!this.geminiApiKey,
        models: this.availableLLMModels,
        current: this.currentLLMModel,
      });
    } catch (error) {
      console.error('Failed to load LLM settings:', error);
      this.availableLLMProviders = ['ollama'];
      this.currentLLMProvider = 'ollama';
      this.geminiApiKey = '';
      this.mlxLmBaseUrl = '';
      this.availableLLMModels = [];
      this.currentLLMModel = '';
    } finally {
      this.isLoadingLLMModels = false;
      this.isLoadingProviders = false;
    }
  }

  private async loadLanguageSettings() {
    try {
      // Get current language
      this.currentLanguage = (await window.electronAPI.database.getCurrentLanguage()) || null;

      console.log('Language settings loaded:', {
        current: this.currentLanguage,
      });
    } catch (error) {
      console.error('Failed to load language settings:', error);
      this.currentLanguage = 'spanish'; // Default fallback
    }
  }

  private async loadElevenLabsSettings() {
    try {
      const apiKey = await window.electronAPI.database.getSetting('elevenlabs_api_key');
      this.elevenLabsApiKey = apiKey || '';
      this.isElevenLabsEnabled = !!(this.elevenLabsApiKey && this.elevenLabsApiKey.trim());
    } catch (error) {
      console.error('Failed to load TTS settings:', error);
      this.elevenLabsApiKey = '';
      this.isElevenLabsEnabled = false;
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
      this.backupStatus = `Failed to create backup: ${getErrorMessage(error)}`;
    } finally {
      this.isCreatingBackup = false;
    }
  }

  private async exportToAnki() {
    this.isExporting = true;
    this.exportStatus = '';

    try {
      const language =
        this.currentLanguage || (await window.electronAPI.database.getCurrentLanguage());
      const result = await window.electronAPI.export.toAnki(language);

      if (result.canceled) {
        this.exportStatus = '';
      } else if (result.cardCount === 0) {
        this.exportStatus = `No sentences to export for ${this.capitalizeLanguage(language)}.`;
      } else {
        this.exportStatus = `Exported ${result.cardCount} cards`;
      }
    } catch (error) {
      console.error('Failed to export to Anki:', error);
      this.exportStatus = `Failed to export: ${getErrorMessage(error)}`;
    } finally {
      this.isExporting = false;
    }
  }

  private async exportFlowMp3() {
    this.isExportingFlow = true;
    this.flowExportStatus = '';

    try {
      const language =
        this.currentLanguage || (await window.electronAPI.database.getCurrentLanguage());
      const result = await window.electronAPI.flow.exportFlowMp3(language);

      if (result.canceled) {
        this.flowExportStatus = '';
      } else {
        this.flowExportStatus = 'Saved';
      }
    } catch (error) {
      console.error('Failed to export flow MP3:', error);
      this.flowExportStatus = `Failed to export: ${getErrorMessage(error)}`;
    } finally {
      this.isExportingFlow = false;
    }
  }

  private showRestartConfirmation() {
    this.showConfirmation = true;
  }

  private hideRestartConfirmation() {
    this.showConfirmation = false;
  }

  private handleRestartConfirm() {
    this.confirmRestartAll();
  }

  private handleRestartCancel() {
    this.hideRestartConfirmation();
  }

  private handleResetProgressConfirm() {
    this.confirmResetProgress();
  }

  private handleResetProgressCancel() {
    this.hideResetProgressConfirmation();
  }

  private showResetProgressConfirmationDialog() {
    this.showResetProgressConfirmation = true;
  }

  private hideResetProgressConfirmation() {
    this.showResetProgressConfirmation = false;
  }

  private showClearSessionConfirmationDialog() {
    this.showClearSessionConfirmation = true;
  }

  private hideClearSessionConfirmation() {
    this.showClearSessionConfirmation = false;
  }

  private handleClearSessionConfirm() {
    this.confirmClearSession();
  }

  private handleClearSessionCancel() {
    this.hideClearSessionConfirmation();
  }

  private async confirmClearSession() {
    this.showClearSessionConfirmation = false;
    this.clearSessionStatus = '';

    try {
      sessionManager.clearSession();
      this.clearSessionStatus = 'All session data has been cleared successfully.';
    } catch (error) {
      console.error('Failed to clear session:', error);
      this.clearSessionStatus = `Failed to clear session: ${getErrorMessage(error)}`;
    }
  }

  private async confirmResetProgress() {
    this.showResetProgressConfirmation = false;
    this.isResettingProgress = true;
    this.resetProgressStatus = '';

    try {
      const language =
        this.currentLanguage || (await window.electronAPI.database.getCurrentLanguage());
      await window.electronAPI.database.resetLanguageProgress(language);
      this.resetProgressStatus = `Progress for ${this.capitalizeLanguage(language)} has been reset successfully.`;
    } catch (error) {
      console.error('Failed to reset progress:', error);
      this.resetProgressStatus = `Failed to reset progress: ${getErrorMessage(error)}`;
    } finally {
      this.isResettingProgress = false;
    }
  }

  private async confirmRestartAll() {
    this.showConfirmation = false;
    this.isRestarting = true;
    this.restartStatus = '';

    try {
      const language =
        this.currentLanguage || (await window.electronAPI.database.getCurrentLanguage());
      if (!language) {
        throw new Error('No language selected');
      }

      await window.electronAPI.lifecycle.restartAll(language);
      this.restartStatus = `All data for ${this.capitalizeLanguage(language)} has been cleared successfully.`;

      // Clear any local state/cache if needed
      // The app will automatically reinitialize with empty database

      // Optionally reload the page to reset the UI state
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (error) {
      console.error('Failed to restart language:', error);
      this.restartStatus = `Failed to clear data: ${getErrorMessage(error)}`;
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

  private getModelDisplayName(modelPath: string): string {
    if (!modelPath) return '';

    // Extract just the filename from the full path
    const filename = modelPath.split('/').pop() || modelPath;
    return filename;
  }

  private getModelDescription(modelName: string): string {
    if (!modelName) return '';

    if (modelName.includes('tiny')) {
      return '(Fastest, least accurate ~39MB)';
    } else if (modelName.includes('base')) {
      return '(Good balance ~74MB)';
    } else if (modelName.includes('small')) {
      return '(Better accuracy ~244MB)';
    } else if (modelName.includes('medium')) {
      return '(High accuracy ~769MB)';
    } else if (modelName.includes('large')) {
      return '(Best accuracy ~1550MB)';
    }

    return '';
  }

  private async changeLLMModel(event: Event) {
    const select = event.target as HTMLSelectElement;
    const selectedModel = select.value;

    if (!selectedModel) return;

    try {
      await window.electronAPI.llm.setModel(selectedModel);
      this.currentLLMModel = selectedModel;

      console.log('LLM model changed to:', this.currentLLMModel);
    } catch (error) {
      console.error('Failed to change LLM model:', error);
      // Revert the selection
      select.value = this.currentLLMModel;
    }
  }

  private capitalizeLanguage(language: string): string {
    return language.charAt(0).toUpperCase() + language.slice(1);
  }

  private async updateElevenLabsApiKey(event: Event) {
    const input = event.target as HTMLInputElement;
    const apiKey = input.value.trim();

    try {
      await window.electronAPI.database.setSetting('elevenlabs_api_key', apiKey);
      this.elevenLabsApiKey = apiKey;
      this.isElevenLabsEnabled = !!(apiKey && apiKey.length > 0);

      if (this.isElevenLabsEnabled) {
        await window.electronAPI.audio.switchToElevenLabs(apiKey);
      } else {
        await window.electronAPI.audio.switchToSystemTTS();
      }

      console.log('ElevenLabs API key updated:', { enabled: this.isElevenLabsEnabled });
    } catch (error) {
      console.error('Failed to save ElevenLabs API key:', error);
      // Revert the input value if saving failed
      input.value = this.elevenLabsApiKey;
    }
  }

  private async changeLLMProvider(event: Event) {
    const select = event.target as HTMLSelectElement;
    const selectedProvider = select.value as 'ollama' | 'gemini' | 'mlx-lm';

    if (!selectedProvider) return;

    // Clear any previous error
    this.llmError = '';

    try {
      // Update the UI immediately to show the new provider's models
      this.currentLLMProvider = selectedProvider;
      this.isLoadingLLMModels = true;

      // Get models for the new provider immediately
      this.availableLLMModels = await window.electronAPI.llm.getModelsForProvider(selectedProvider);

      // Switch the actual provider
      await window.electronAPI.llm.switchProvider(
        selectedProvider,
        this.geminiApiKey || undefined,
        selectedProvider === 'mlx-lm' ? this.mlxLmBaseUrl || undefined : undefined
      );

      // Reload all settings to get the current model selections
      await this.loadLLMSettings();

      // Clear any previous errors on success
      this.llmError = '';

      console.log('LLM provider changed to:', this.currentLLMProvider);
    } catch (error) {
      console.error('Failed to change LLM provider:', error);
      // Revert the selection
      select.value = this.currentLLMProvider;
      // Show inline error instead of alert
      this.llmError = `Failed to switch to ${selectedProvider}: ${getErrorMessage(error)}`;
    } finally {
      this.isLoadingLLMModels = false;
    }
  }

  private async updateGeminiApiKey(event: Event) {
    const input = event.target as HTMLInputElement;
    const apiKey = input.value.trim();

    try {
      await window.electronAPI.database.setSetting('gemini_api_key', apiKey);
      this.geminiApiKey = apiKey;

      // If we're currently using Gemini, update the key and refresh
      if (this.currentLLMProvider === 'gemini') {
        await window.electronAPI.llm.setGeminiApiKey(apiKey, false);
        // Reload models to reflect the new API key status
        await this.loadLLMSettings();
      }

      console.log('Gemini API key updated');
    } catch (error) {
      console.error('Failed to save Gemini API key:', error);
      // Revert the input value if saving failed
      input.value = this.geminiApiKey;
    }
  }

  private async updateMlxLmBaseUrl(event: Event) {
    const input = event.target as HTMLInputElement;
    const baseUrl = input.value.trim();
    try {
      await window.electronAPI.database.setSetting('mlx_lm_base_url', baseUrl);
      this.mlxLmBaseUrl = baseUrl;
      if (this.currentLLMProvider === 'mlx-lm') {
        await window.electronAPI.llm.switchProvider('mlx-lm', undefined, baseUrl || undefined);
        await this.loadLLMSettings();
      }
    } catch (error) {
      console.error('Failed to save mlx-lm base URL:', error);
      input.value = this.mlxLmBaseUrl;
    }
  }

  private getProviderDisplayName(provider: 'ollama' | 'gemini' | 'mlx-lm'): string {
    switch (provider) {
      case 'ollama':
        return 'Ollama (Local)';
      case 'gemini':
        return 'Google Gemini (Cloud)';
      case 'mlx-lm':
        return 'mlx-lm (Local)';
      default:
        return provider;
    }
  }

  private getProviderDescription(provider: 'ollama' | 'gemini' | 'mlx-lm'): string {
    switch (provider) {
      case 'ollama':
        return 'Run models locally on your machine. Requires Ollama to be installed and running.';
      case 'gemini':
        return "Use Google's Gemini API for cloud-based generation. Requires API key and internet connection.";
      case 'mlx-lm':
        return 'Run Apple MLX models locally via mlx-lm server. Start with: mlx_lm.server --model <model>';
      default:
        return '';
    }
  }

  private getLLMModelDescription(modelName: string): string {
    if (!modelName) return '';

    // Gemini model descriptions
    if (modelName.includes('gemini')) {
      if (modelName.includes('2.5-pro')) {
        return '(Highest quality, best for complex tasks)';
      } else if (modelName.includes('2.5-flash-lite')) {
        return '(Fastest, most cost-effective)';
      } else if (modelName.includes('2.5-flash')) {
        return '(Fast, good balance of speed and quality)';
      } else if (modelName.includes('2.0-flash-lite')) {
        return '(Fast and cost-effective)';
      } else if (modelName.includes('2.0-flash')) {
        return '(Good performance and speed)';
      }
      return '(Gemini model)';
    }

    // Ollama model descriptions (generic)
    if (modelName.includes('tiny') || modelName.includes('small')) {
      return '(Fast, lightweight)';
    } else if (modelName.includes('large') || modelName.includes('big')) {
      return '(High quality, slower)';
    }

    return '';
  }

  render() {
    return html`
      <div class="settings-container">
        <div class="settings-section">
          <h3>Language Model (LLM)</h3>

          ${this.isLoadingProviders
            ? html`
                <status-message
                  type="info"
                  message="Loading available providers..."
                ></status-message>
              `
            : html`
                <div class="dropdown-row">
                  <div class="dropdown-description">
                    <strong>LLM Provider</strong>
                    <p>${this.getProviderDescription(this.currentLLMProvider)}</p>
                  </div>
                  <select
                    class="model-select"
                    .value=${this.currentLLMProvider}
                    @change=${this.changeLLMProvider}
                    ?disabled=${this.isLoadingProviders}
                  >
                    ${this.availableLLMProviders.map(
                      (provider) => html`
                        <option value=${provider} ?selected=${provider === this.currentLLMProvider}>
                          ${this.getProviderDisplayName(provider)}
                        </option>
                      `
                    )}
                  </select>
                </div>

                ${this.llmError ? html` <div class="error-message">${this.llmError}</div> ` : ''}

                <div class="settings-row">
                  <div class="settings-description">
                    <strong>Gemini API Key</strong>
                    <p>Enter your Google Gemini API key to enable cloud-based generation</p>
                  </div>
                  <input
                    type="password"
                    class="text-input"
                    .value=${this.geminiApiKey}
                    @blur=${this.updateGeminiApiKey}
                    placeholder="Enter Gemini API key..."
                  />
                </div>

                ${this.currentLLMProvider === 'mlx-lm'
                  ? html`
                      <div class="settings-row">
                        <div class="settings-description">
                          <strong>mlx-lm Server URL</strong>
                          <p>Base URL of the running mlx-lm server</p>
                        </div>
                        <input
                          type="text"
                          class="text-input"
                          .value=${this.mlxLmBaseUrl}
                          @blur=${this.updateMlxLmBaseUrl}
                          placeholder="http://localhost:8080"
                        />
                      </div>
                    `
                  : ''}
              `}
          ${this.isLoadingLLMModels
            ? html`
                <status-message type="info" message="Loading available models..."></status-message>
              `
            : this.availableLLMModels.length > 0
              ? html`
                  <div class="model-info">
                    Provider: ${this.getProviderDisplayName(this.currentLLMProvider)}
                    ${this.currentLLMProvider === 'gemini' && !this.geminiApiKey.trim()
                      ? html` <span style="color: #dc3545;"> (⚠️ API key required)</span> `
                      : html` <span style="color: #28a745;"> (✓ Ready)</span> `}<br />
                    ${this.currentLLMProvider === 'mlx-lm'
                      ? html`
                          <span style="font-size: 0.8rem; color: #666;">
                            Server: ${this.mlxLmBaseUrl || 'http://localhost:8080'} </span
                          ><br />
                        `
                      : ''}
                    <p style="margin-top: 0.5rem; font-size: 0.85rem; color: #666;">
                      Word and sentence generation models are configured in config.toml
                    </p>
                  </div>
                `
              : html`
                  <status-message
                    type="error"
                    message="No LLM models available. Please ensure Ollama is running and has models installed."
                  ></status-message>
                `}
        </div>

        <div class="settings-section">
          <h3>🎙️ Text-to-Speech</h3>

          <div class="settings-row">
            <div class="settings-description">
              <strong>ElevenLabs API Key</strong>
              <p>Required when <code>tts_backend = "elevenlabs"</code> is set in config.toml.</p>
            </div>
            <input
              type="password"
              class="text-input"
              .value=${this.elevenLabsApiKey}
              @blur=${this.updateElevenLabsApiKey}
              placeholder="Enter ElevenLabs API key..."
            />
          </div>
          ${this.isElevenLabsEnabled
            ? html`<div class="model-info">
                <span style="color: #28a745;">✓ ElevenLabs API key set</span>
              </div>`
            : ''}
        </div>

        <div class="settings-section">
          <h3>🎓 Learning Preferences</h3>
          <div class="settings-row">
            <div class="settings-description">
              <strong>${this.capitalizeLanguage(this.currentLanguage || 'Language')} Level</strong>
              <p>
                Adjust your proficiency level. This affects the difficulty of generated sentences
                and the strictness of pronunciation feedback.
              </p>
            </div>
            <app-button
              variant="primary"
              @click=${() => window.dispatchEvent(new CustomEvent('show-proficiency-selector'))}
            >
              Change Level
            </app-button>
          </div>
        </div>

        <div class="settings-section">
          <h3>Data Management</h3>
          <div class="backup-actions">
            <div class="backup-action">
              <div class="settings-description">
                <strong>Create Backup</strong>
                <p>Create a backup of your learning data and audio files</p>
              </div>
              <app-button
                variant="primary"
                ?disabled=${this.isCreatingBackup}
                ?loading=${this.isCreatingBackup}
                @click=${this.createBackup}
              >
                ${this.isCreatingBackup ? 'Creating...' : 'Create Backup'}
              </app-button>
              ${this.backupStatus && !this.backupStatus.includes('Restore')
                ? html`
                    <status-message
                      type=${this.backupStatus.includes('Failed') ? 'error' : 'success'}
                      message=${this.backupStatus}
                    ></status-message>
                  `
                : ''}
            </div>
            <div class="backup-action">
              <div class="settings-description">
                <strong>Export to Anki</strong>
                <p>
                  Export ${this.capitalizeLanguage(this.currentLanguage || 'the current language')}
                  sentences and audio as an Anki deck (.apkg) to study on your phone
                </p>
              </div>
              <app-button
                variant="primary"
                ?disabled=${this.isExporting}
                ?loading=${this.isExporting}
                @click=${this.exportToAnki}
              >
                ${this.isExporting ? 'Exporting...' : 'Export to Anki'}
              </app-button>
              ${this.exportStatus
                ? html`
                    <status-message
                      type=${this.exportStatus.includes('Failed') ? 'error' : 'success'}
                      message=${this.exportStatus}
                    ></status-message>
                  `
                : ''}
            </div>
            <div class="backup-action">
              <div class="settings-description">
                <strong>Export Flow MP3</strong>
                <p>
                  Freshly generate and export the bilingual (English +
                  ${this.capitalizeLanguage(this.currentLanguage || 'target language')}) Flow audio
                  as an MP3 file
                </p>
              </div>
              <app-button
                variant="primary"
                ?disabled=${this.isExportingFlow}
                ?loading=${this.isExportingFlow}
                @click=${this.exportFlowMp3}
              >
                ${this.isExportingFlow ? 'Generating...' : 'Export Flow MP3'}
              </app-button>
            </div>
            ${this.flowExportStatus
              ? html`
                  <status-message
                    type=${this.flowExportStatus.includes('Failed') ? 'error' : 'success'}
                    message=${this.flowExportStatus}
                  ></status-message>
                `
              : ''}
            <div class="backup-action">
              <div class="settings-description">
                <strong>Restore Backup</strong>
                <p>Open the backup directory to browse and restore from your backups</p>
              </div>
              <app-button variant="primary" @click=${this.openBackupDirectory}>
                Restore Backup
              </app-button>
            </div>
            <div class="backup-action">
              <div class="settings-description">
                <strong>Clear Session Data</strong>
                <p>Clear all cached session data (learning progress, quiz sessions, etc.)</p>
              </div>
              <app-button variant="primary" @click=${this.showClearSessionConfirmationDialog}>
                Clear Session
              </app-button>
              ${this.clearSessionStatus
                ? html`
                    <status-message
                      type=${this.clearSessionStatus.includes('Failed') ? 'error' : 'success'}
                      message=${this.clearSessionStatus}
                    ></status-message>
                  `
                : ''}
            </div>
          </div>
        </div>

        <div class="settings-section warning-section">
          <h3>⚠️ Danger Zone</h3>
          <div class="settings-row">
            <div class="settings-description">
              <strong
                >Restart ${this.capitalizeLanguage(this.currentLanguage || 'Language')}</strong
              >
              <p>
                Permanently delete all words, sentences, progress, and audio files for
                ${this.capitalizeLanguage(this.currentLanguage || 'the selected language')}. Backups
                will be preserved. This cannot be undone!
              </p>
            </div>
            <app-button
              variant="danger"
              ?disabled=${this.isRestarting}
              ?loading=${this.isRestarting}
              @click=${this.showRestartConfirmation}
            >
              ${this.isRestarting ? 'Clearing...' : 'Restart Language'}
            </app-button>
          </div>
          ${this.restartStatus
            ? html`
                <status-message
                  type=${this.restartStatus.includes('Failed') ? 'error' : 'success'}
                  message=${this.restartStatus}
                ></status-message>
              `
            : ''}
          <div class="settings-row">
            <div class="settings-description">
              <strong>Reset Progress</strong>
              <p>
                Reset all learning progress for
                ${this.capitalizeLanguage(this.currentLanguage || 'the active language')}:
                pronunciation history, FSRS values, sentence counts, and last seen timestamps. Words
                marked as known/ignored will be deleted entirely. This cannot be undone!
              </p>
            </div>
            <app-button
              variant="danger"
              ?disabled=${this.isResettingProgress}
              ?loading=${this.isResettingProgress}
              @click=${this.showResetProgressConfirmationDialog}
            >
              ${this.isResettingProgress ? 'Resetting...' : 'Reset Progress'}
            </app-button>
          </div>
          ${this.resetProgressStatus
            ? html`
                <status-message
                  type=${this.resetProgressStatus.includes('Failed') ? 'error' : 'success'}
                  message=${this.resetProgressStatus}
                ></status-message>
              `
            : ''}
        </div>

        <confirmation-dialog
          .open=${this.showConfirmation}
          title="⚠️ Confirm Restart Language"
          variant="danger"
          confirmText="Yes, Delete Everything"
          cancelText="Cancel"
          .message=${html`
            <p>
              This will permanently delete for
              <strong
                >${this.capitalizeLanguage(this.currentLanguage || 'the selected language')}</strong
              >:
            </p>
            <ul>
              <li>All words and translations</li>
              <li>All sentences and examples</li>
              <li>All progress and statistics</li>
              <li>All audio files</li>
            </ul>
            <p style="color: #28a745; font-size: 0.9rem;">
              <strong>Note:</strong> Backup files will be preserved. Data for other languages will
              not be affected.
            </p>
            <p><strong>This action cannot be undone!</strong></p>
          `}
          @confirm=${this.handleRestartConfirm}
          @cancel=${this.handleRestartCancel}
        ></confirmation-dialog>

        <confirmation-dialog
          .open=${this.showResetProgressConfirmation}
          title="⚠️ Confirm Reset Progress"
          variant="danger"
          confirmText="Yes, Reset Progress"
          cancelText="Cancel"
          .message=${html`
            <p>
              This will reset all learning progress for
              <strong
                >${this.capitalizeLanguage(this.currentLanguage || 'the active language')}</strong
              >:
            </p>
            <ul>
              <li>All historical pronunciation attempts</li>
              <li>All sentence counts</li>
              <li>All FSRS values (difficulty, stability, lapses)</li>
              <li>All words marked as known/ignored (deleted entirely)</li>
              <li>All last seen timestamps</li>
              <li>All sentence play counts</li>
            </ul>
            <p><strong>This action cannot be undone!</strong></p>
          `}
          @confirm=${this.handleResetProgressConfirm}
          @cancel=${this.handleResetProgressCancel}
        ></confirmation-dialog>

        <confirmation-dialog
          .open=${this.showClearSessionConfirmation}
          title="⚠️ Confirm Clear Session"
          variant="warning"
          confirmText="Yes, Clear Session"
          cancelText="Cancel"
          .message=${html`
            <p>This will clear all cached session data:</p>
            <ul>
              <li>Learning session progress</li>
              <li>Quiz session data</li>
              <li>Dialog session data</li>
              <li>Current mode state</li>
            </ul>
            <p>
              <strong>Note:</strong> This will not delete your words, sentences, or progress from
              the database. Only cached session state will be cleared.
            </p>
          `}
          @confirm=${this.handleClearSessionConfirm}
          @cancel=${this.handleClearSessionCancel}
        ></confirmation-dialog>
      </div>
    `;
  }
}
