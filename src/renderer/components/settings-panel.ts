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
        padding: var(--spacing-lg);
      }

      .settings-section {
        margin-bottom: var(--spacing-lg);
        padding: var(--spacing-lg);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius);
        background: var(--background-secondary);
      }

      .settings-section h3 {
        margin-top: 0;
        color: var(--text-primary);
        font-size: 16px;
        font-weight: 600;
      }

      .settings-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--spacing-md);
      }

      .settings-row:last-child {
        margin-bottom: 0;
      }

      .settings-description {
        flex: 1;
        margin-right: var(--spacing-md);
      }

      .settings-description p {
        margin: 0;
        color: var(--text-secondary);
        font-size: 12px;
      }

      .action-button {
        padding: var(--spacing-md) var(--spacing-lg);
        background: var(--primary-color);
        color: white;
        border: none;
        border-radius: var(--border-radius-small);
        cursor: pointer;
        font-size: 12px;
        min-width: 100px;
        transition: all 0.2s ease;
      }

      .action-button:hover {
        background: var(--primary-hover);
      }

      .action-button:disabled {
        background: var(--text-tertiary);
        cursor: not-allowed;
      }

      .action-button.danger {
        background: var(--error-color);
        color: white;
      }

      .action-button.danger:hover:not(:disabled) {
        background: var(--error-dark);
      }

      .status-message {
        margin-top: var(--spacing-sm);
        padding: var(--spacing-sm);
        border-radius: var(--border-radius-small);
        font-size: 12px;
      }

      .status-success {
        background: var(--success-light);
        color: var(--success-dark);
        border: 1px solid var(--success-color);
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

      .dropdown-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
      }

      .dropdown-row:last-child {
        margin-bottom: 0;
      }

      .dropdown-description {
        flex: 1;
        margin-right: 1rem;
      }

      .dropdown-description p {
        margin: 0;
        color: #666;
        font-size: 0.9rem;
      }

      .model-select {
        padding: 0.5rem;
        border: 1px solid #ccc;
        border-radius: 4px;
        background: white;
        font-size: 0.9rem;
        min-width: 200px;
        cursor: pointer;
      }

      .model-select:focus {
        outline: none;
        border-color: #007acc;
        box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.2);
      }

      .model-select:disabled {
        background: #f5f5f5;
        color: #999;
        cursor: not-allowed;
      }

      .model-info {
        margin-top: 0.5rem;
        font-size: 0.8rem;
        color: #666;
        font-style: italic;
      }

      .text-input {
        padding: 0.5rem;
        border: 1px solid #ccc;
        border-radius: 4px;
        background: white;
        font-size: 0.9rem;
        min-width: 300px;
        font-family: monospace;
      }

      .text-input:focus {
        outline: none;
        border-color: #007acc;
        box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.2);
      }

      .text-input:disabled {
        background: #f5f5f5;
        color: #999;
        cursor: not-allowed;
      }

      .text-input[type="password"] {
        letter-spacing: 0.1em;
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

  @state()
  private autoplayAudioEnabled = false;

  @state()
  private availableSpeechModels: string[] = [];

  @state()
  private currentSpeechModel = '';

  @state()
  private speechRecognitionReady = false;

  @state()
  private availableLLMModels: string[] = [];

  @state()
  private currentLLMModel = '';

  @state()
  private currentWordGenerationModel = '';

  @state()
  private currentSentenceGenerationModel = '';

  @state()
  private isLoadingLLMModels = false;

  @state()
  private currentLLMProvider: 'ollama' | 'gemini' = 'ollama';

  @state()
  private availableLLMProviders: Array<'ollama' | 'gemini'> = [];

  @state()
  private geminiApiKey = '';

  @state()
  private isLoadingProviders = false;

  @state()
  private srsAlgorithm: 'classic' | 'fsrs' = 'classic';



  @state()
  private currentLanguage = '';

  @state()
  private elevenLabsApiKey = '';

  @state()
  private isElevenLabsEnabled = false;

  @state()
  private elevenLabsModel = 'eleven_flash_v2_5';

  @state()
  private minimaxApiKey = '';

  @state()
  private isMinimaxEnabled = false;

  @state()
  private minimaxModel = 'speech-2.6-hd';







  async connectedCallback() {
    super.connectedCallback();
    await this.loadSettings();
    
    // Listen for language changes from the navigation dropdown
    document.addEventListener('language-changed', this.handleExternalLanguageChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('language-changed', this.handleExternalLanguageChange);
  }

  private async loadSettings() {
    try {
      const contextSetting = await window.electronAPI.database.getSetting('context_sentences');
      this.contextSentencesEnabled = contextSetting === 'true';

      const autoplaySetting = await window.electronAPI.database.getSetting('autoplay_audio');
      this.autoplayAudioEnabled = autoplaySetting === 'true';

      await this.loadSrsSettings();

      // Load language settings
      await this.loadLanguageSettings();

      // Load speech recognition settings
      await this.loadSpeechRecognitionSettings();

      // Load LLM settings
      await this.loadLLMSettings();

      // Load ElevenLabs settings
      await this.loadElevenLabsSettings();

      // Load Minimax settings
      await this.loadMinimaxSettings();
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  private async loadSrsSettings() {
    try {
      const algorithm = await window.electronAPI.database.getSetting('srs_algorithm');
      this.srsAlgorithm = algorithm === 'fsrs' ? 'fsrs' : 'classic';
    } catch (error) {
      console.error('Failed to load SRS settings:', error);
      this.srsAlgorithm = 'classic';
    }
  }

  private async loadSpeechRecognitionSettings() {
    try {
      // Check if speech recognition is available
      this.speechRecognitionReady = await window.electronAPI.audio.isSpeechRecognitionReady();

      if (this.speechRecognitionReady) {
        // Get available models
        this.availableSpeechModels = await window.electronAPI.audio.getAvailableSpeechModels();

        // Get current model
        this.currentSpeechModel = await window.electronAPI.audio.getCurrentSpeechModel();

        console.log('Speech recognition settings loaded:', {
          ready: this.speechRecognitionReady,
          models: this.availableSpeechModels,
          current: this.currentSpeechModel
        });
      }
    } catch (error) {
      console.error('Failed to load speech recognition settings:', error);
      this.speechRecognitionReady = false;
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

      // Get available LLM models for the current provider
      this.availableLLMModels = await window.electronAPI.llm.getModelsForProvider(this.currentLLMProvider);

      // Get current LLM models
      this.currentLLMModel = await window.electronAPI.llm.getCurrentModel();
      this.currentWordGenerationModel = await window.electronAPI.llm.getWordGenerationModel();
      this.currentSentenceGenerationModel = await window.electronAPI.llm.getSentenceGenerationModel();

      console.log('LLM settings loaded:', {
        providers: this.availableLLMProviders,
        currentProvider: this.currentLLMProvider,
        geminiApiKey: !!this.geminiApiKey,
        models: this.availableLLMModels,
        current: this.currentLLMModel,
        wordGeneration: this.currentWordGenerationModel,
        sentenceGeneration: this.currentSentenceGenerationModel
      });
    } catch (error) {
      console.error('Failed to load LLM settings:', error);
      this.availableLLMProviders = ['ollama'];
      this.currentLLMProvider = 'ollama';
      this.geminiApiKey = '';
      this.availableLLMModels = [];
      this.currentLLMModel = '';
      this.currentWordGenerationModel = '';
      this.currentSentenceGenerationModel = '';
    } finally {
      this.isLoadingLLMModels = false;
      this.isLoadingProviders = false;
    }
  }

  private async loadLanguageSettings() {
    try {
      // Get current language
      this.currentLanguage = await window.electronAPI.database.getCurrentLanguage();

      console.log('Language settings loaded:', {
        current: this.currentLanguage
      });
    } catch (error) {
      console.error('Failed to load language settings:', error);
      this.currentLanguage = 'spanish'; // Default fallback
    }
  }

  private async loadElevenLabsSettings() {
    try {
      // Get ElevenLabs API key
      const apiKey = await window.electronAPI.database.getSetting('elevenlabs_api_key');
      this.elevenLabsApiKey = apiKey || '';

      // Get ElevenLabs model
      const model = await window.electronAPI.database.getSetting('elevenlabs_model');
      this.elevenLabsModel = model || 'eleven_flash_v2_5';

      // Check if ElevenLabs is enabled (has API key and model is not disabled)
      this.isElevenLabsEnabled = !!(this.elevenLabsApiKey && this.elevenLabsApiKey.trim() && this.elevenLabsModel !== 'disabled');

      console.log('ElevenLabs settings loaded:', {
        hasApiKey: !!this.elevenLabsApiKey,
        model: this.elevenLabsModel,
        enabled: this.isElevenLabsEnabled
      });
    } catch (error) {
      console.error('Failed to load ElevenLabs settings:', error);
      this.elevenLabsApiKey = '';
      this.elevenLabsModel = 'eleven_flash_v2_5';
      this.isElevenLabsEnabled = false;
    }
  }

  private async loadMinimaxSettings() {
    try {
      // Get Minimax API key
      const apiKey = await window.electronAPI.database.getSetting('minimax_api_key');
      this.minimaxApiKey = apiKey || '';

      // Get Minimax model
      const model = await window.electronAPI.database.getSetting('minimax_model');
      this.minimaxModel = model || 'speech-2.6-hd';

      // Check if Minimax is enabled (has API key and model is not disabled)
      this.isMinimaxEnabled = !!(this.minimaxApiKey && this.minimaxApiKey.trim() && this.minimaxModel && this.minimaxModel !== 'disabled');

      console.log('Minimax settings loaded:', {
        hasApiKey: !!this.minimaxApiKey,
        model: this.minimaxModel,
        enabled: this.isMinimaxEnabled
      });
    } catch (error) {
      console.error('Failed to load Minimax settings:', error);
      this.minimaxApiKey = '';
      this.minimaxModel = 'speech-2.6-hd';
      this.isMinimaxEnabled = false;
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

  private async toggleAutoplayAudio(event: Event) {
    const checkbox = event.target as HTMLInputElement;
    this.autoplayAudioEnabled = checkbox.checked;

    try {
      await window.electronAPI.database.setSetting('autoplay_audio', checkbox.checked ? 'true' : 'false');
    } catch (error) {
      console.error('Failed to save autoplay audio setting:', error);
      // Revert the checkbox state if saving failed
      this.autoplayAudioEnabled = !checkbox.checked;
      checkbox.checked = !checkbox.checked;
    }
  }

  private async changeSrsAlgorithm(event: Event) {
    const select = event.target as HTMLSelectElement;
    const selected = select.value === 'fsrs' ? 'fsrs' : 'classic';
    const previous = this.srsAlgorithm;
    this.srsAlgorithm = selected;

    try {
      await window.electronAPI.database.setSetting('srs_algorithm', selected);
    } catch (error) {
      console.error('Failed to save SRS algorithm setting:', error);
      this.srsAlgorithm = previous;
      select.value = previous;
    }
  }

  private async changeSpeechModel(event: Event) {
    const select = event.target as HTMLSelectElement;
    const selectedModel = select.value;

    if (!selectedModel) return;

    try {
      // The model path should be the full path, so we need to construct it
      const projectDir = process.cwd ? process.cwd() : '';
      const modelPath = selectedModel.includes('/') ? selectedModel : `models/${selectedModel}`;

      await window.electronAPI.audio.setSpeechModel(modelPath);
      this.currentSpeechModel = await window.electronAPI.audio.getCurrentSpeechModel();

      console.log('Speech model changed to:', this.currentSpeechModel);
    } catch (error) {
      console.error('Failed to change speech model:', error);
      // Revert the selection
      select.value = this.currentSpeechModel;
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

  private getSrsEngineDescription(engine: 'classic' | 'fsrs'): string {
    if (engine === 'fsrs') {
      return 'FSRS baseline: estimates memory stability to schedule reviews for consistent retention.';
    }
    return "Classic scheduler: traditional ease-factor intervals similar to Anki's algorithm.";
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

  private async changeWordGenerationModel(event: Event) {
    const select = event.target as HTMLSelectElement;
    const selectedModel = select.value;

    if (!selectedModel) return;

    try {
      await window.electronAPI.llm.setWordGenerationModel(selectedModel);
      this.currentWordGenerationModel = selectedModel;

      console.log('Word generation model changed to:', this.currentWordGenerationModel);
    } catch (error) {
      console.error('Failed to change word generation model:', error);
      // Revert the selection
      select.value = this.currentWordGenerationModel;
    }
  }

  private async changeSentenceGenerationModel(event: Event) {
    const select = event.target as HTMLSelectElement;
    const selectedModel = select.value;

    if (!selectedModel) return;

    try {
      await window.electronAPI.llm.setSentenceGenerationModel(selectedModel);
      this.currentSentenceGenerationModel = selectedModel;

      console.log('Sentence generation model changed to:', this.currentSentenceGenerationModel);
    } catch (error) {
      console.error('Failed to change sentence generation model:', error);
      // Revert the selection
      select.value = this.currentSentenceGenerationModel;
    }
  }



  private capitalizeLanguage(language: string): string {
    return language.charAt(0).toUpperCase() + language.slice(1);
  }



  private handleExternalLanguageChange = async (event: Event) => {
    const customEvent = event as CustomEvent;
    console.log('Settings panel received language change:', customEvent.detail);
    
    // Update current language
    this.currentLanguage = customEvent.detail.language;
  };

  private async updateElevenLabsApiKey(event: Event) {
    const input = event.target as HTMLInputElement;
    const apiKey = input.value.trim();

    try {
      await window.electronAPI.database.setSetting('elevenlabs_api_key', apiKey);
      this.elevenLabsApiKey = apiKey;
      this.isElevenLabsEnabled = !!(apiKey && apiKey.length > 0 && this.elevenLabsModel !== 'disabled');

      // Switch TTS based on current settings
      await this.switchTTSBasedOnSettings();

      console.log('ElevenLabs API key updated:', { enabled: this.isElevenLabsEnabled });
    } catch (error) {
      console.error('Failed to save ElevenLabs API key:', error);
      // Revert the input value if saving failed
      input.value = this.elevenLabsApiKey;
    }
  }

  private async updateElevenLabsModel(event: Event) {
    const select = event.target as HTMLSelectElement;
    const model = select.value;

    try {
      // If selecting a Minimax model, update Minimax settings and disable ElevenLabs
      if (model === 'speech-2.6-hd' || model === 'speech-2.6-turbo') {
        await window.electronAPI.database.setSetting('minimax_model', model);
        await window.electronAPI.database.setSetting('elevenlabs_model', 'disabled');
        this.minimaxModel = model;
        this.elevenLabsModel = 'disabled';
        // Model is guaranteed to be a valid Minimax model at this point (not 'disabled')
        this.isMinimaxEnabled = !!(this.minimaxApiKey && this.minimaxApiKey.trim());
        this.isElevenLabsEnabled = false;
      } else {
        // Otherwise, update ElevenLabs settings and disable Minimax
        await window.electronAPI.database.setSetting('elevenlabs_model', model);
        await window.electronAPI.database.setSetting('minimax_model', 'disabled');
        this.elevenLabsModel = model;
        this.minimaxModel = 'disabled';
        this.isElevenLabsEnabled = !!(this.elevenLabsApiKey && this.elevenLabsApiKey.trim() && model !== 'disabled');
        this.isMinimaxEnabled = false;
      }

      // Switch TTS based on current settings
      await this.switchTTSBasedOnSettings();

      console.log('TTS model updated:', model);
    } catch (error) {
      console.error('Failed to save TTS model:', error);
      // Revert the selection
      select.value = this.getCurrentTTSModel();
    }
  }

  private getCurrentTTSModel(): string {
    // Return the currently active TTS model for the dropdown
    if (this.isMinimaxEnabled && this.minimaxModel && this.minimaxModel !== 'disabled') {
      return this.minimaxModel;
    } else if (this.isElevenLabsEnabled && this.elevenLabsModel && this.elevenLabsModel !== 'disabled') {
      return this.elevenLabsModel;
    }
    return 'disabled';
  }

  private async updateMinimaxApiKey(event: Event) {
    const input = event.target as HTMLInputElement;
    const apiKey = input.value.trim();

    try {
      await window.electronAPI.database.setSetting('minimax_api_key', apiKey);
      this.minimaxApiKey = apiKey;
      this.isMinimaxEnabled = !!(apiKey && apiKey.length > 0 && this.minimaxModel && this.minimaxModel !== 'disabled');

      // Switch TTS based on current settings
      await this.switchTTSBasedOnSettings();

      console.log('Minimax API key updated:', { enabled: this.isMinimaxEnabled });
    } catch (error) {
      console.error('Failed to save Minimax API key:', error);
      // Revert the input value if saving failed
      input.value = this.minimaxApiKey;
    }
  }

  private async switchTTSBasedOnSettings() {
    // Check Minimax first (higher priority), then ElevenLabs, then system TTS
    if (this.isMinimaxEnabled) {
      // Switch to Minimax TTS
      await window.electronAPI.audio.switchToMinimax(this.minimaxApiKey);
    } else if (this.isElevenLabsEnabled) {
      // Switch to ElevenLabs TTS
      await window.electronAPI.audio.switchToElevenLabs(this.elevenLabsApiKey);
    } else {
      // Switch back to system TTS
      await window.electronAPI.audio.switchToSystemTTS();
    }
  }

  private async changeLLMProvider(event: Event) {
    const select = event.target as HTMLSelectElement;
    const selectedProvider = select.value as 'ollama' | 'gemini';

    if (!selectedProvider) return;

    try {
      // Update the UI immediately to show the new provider's models
      this.currentLLMProvider = selectedProvider;
      this.isLoadingLLMModels = true;
      
      // Get models for the new provider immediately
      this.availableLLMModels = await window.electronAPI.llm.getModelsForProvider(selectedProvider);
      
      // Switch the actual provider
      await window.electronAPI.llm.switchProvider(selectedProvider, this.geminiApiKey || undefined);

      // Reload all settings to get the current model selections
      await this.loadLLMSettings();

      console.log('LLM provider changed to:', this.currentLLMProvider);
    } catch (error) {
      console.error('Failed to change LLM provider:', error);
      // Revert the selection
      select.value = this.currentLLMProvider;
      alert(`Failed to switch to ${selectedProvider}: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

  private getProviderDisplayName(provider: 'ollama' | 'gemini'): string {
    switch (provider) {
      case 'ollama':
        return 'Ollama (Local)';
      case 'gemini':
        return 'Google Gemini (Cloud)';
      default:
        return provider;
    }
  }

  private getProviderDescription(provider: 'ollama' | 'gemini'): string {
    switch (provider) {
      case 'ollama':
        return 'Run models locally on your machine. Requires Ollama to be installed and running.';
      case 'gemini':
        return 'Use Google\'s Gemini API for cloud-based generation. Requires API key and internet connection.';
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
          <h3>Spaced Repetition</h3>
          <div class="dropdown-row">
            <div class="dropdown-description">
              <strong>Scheduling Engine</strong>
              <p>Choose how review intervals are calculated for your study sessions</p>
            </div>
            <select
              class="model-select"
              .value=${this.srsAlgorithm}
              @change=${this.changeSrsAlgorithm}
            >
              <option value="classic">Classic (Anki-style)</option>
              <option value="fsrs">FSRS Baseline</option>
            </select>
          </div>
          <div class="model-info">
            ${this.getSrsEngineDescription(this.srsAlgorithm)}
          </div>
        </div>

        <div class="settings-section">
          <h3>Language Model (LLM)</h3>
          
          ${this.isLoadingProviders ? html`
            <div class="status-message status-info">
              Loading available providers...
            </div>
          ` : html`
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
                ${this.availableLLMProviders.map(provider => html`
                  <option value=${provider} ?selected=${provider === this.currentLLMProvider}>
                    ${this.getProviderDisplayName(provider)}
                  </option>
                `)}
              </select>
            </div>

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
          `}
          
          ${this.isLoadingLLMModels ? html`
            <div class="status-message status-info">
              Loading available models...
            </div>
          ` : this.availableLLMModels.length > 0 ? html`
            <div class="dropdown-row">
              <div class="dropdown-description">
                <strong>Word Generation Model (Small)</strong>
                <p>Choose a small, fast model for generating vocabulary words and translations</p>
              </div>
              <select 
                class="model-select"
                .value=${this.currentWordGenerationModel}
                @change=${this.changeWordGenerationModel}
                ?disabled=${this.isLoadingLLMModels}
              >
                ${this.availableLLMModels.map(model => html`
                  <option value=${model} ?selected=${model === this.currentWordGenerationModel}>
                    ${model}
                  </option>
                `)}
              </select>
            </div>
            
            <div class="dropdown-row">
              <div class="dropdown-description">
                <strong>Sentence Generation Model (Big)</strong>
                <p>Choose a larger, more capable model for generating complex sentences and context</p>
              </div>
              <select 
                class="model-select"
                .value=${this.currentSentenceGenerationModel}
                @change=${this.changeSentenceGenerationModel}
                ?disabled=${this.isLoadingLLMModels}
              >
                ${this.availableLLMModels.map(model => html`
                  <option value=${model} ?selected=${model === this.currentSentenceGenerationModel}>
                    ${model}
                  </option>
                `)}
              </select>
            </div>
            
            <div class="model-info">
              Provider: ${this.getProviderDisplayName(this.currentLLMProvider)}
              ${this.currentLLMProvider === 'gemini' && !this.geminiApiKey.trim() ? html`
                <span style="color: #dc3545;"> (⚠️ API key required)</span>
              ` : html`
                <span style="color: #28a745;"> (✓ Ready)</span>
              `}<br>
              Word generation: ${this.currentWordGenerationModel || 'None selected'} ${this.getLLMModelDescription(this.currentWordGenerationModel)}<br>
              Sentence generation: ${this.currentSentenceGenerationModel || 'None selected'} ${this.getLLMModelDescription(this.currentSentenceGenerationModel)}
            </div>
          ` : html`
            <div class="status-message status-error">
              No LLM models available. Please ensure Ollama is running and has models installed.
            </div>
          `}
        </div>

        <div class="settings-section">
          <h3>Speech Recognition</h3>
          ${this.speechRecognitionReady ? html`
            <div class="dropdown-row">
              <div class="dropdown-description">
                <strong>Whisper Model</strong>
                <p>Choose the speech recognition model for pronunciation practice</p>
              </div>
              <select 
                class="model-select"
                .value=${this.getModelDisplayName(this.currentSpeechModel)}
                @change=${this.changeSpeechModel}
              >
                ${this.availableSpeechModels.map(model => html`
                  <option value=${model} ?selected=${this.getModelDisplayName(this.currentSpeechModel) === model}>
                    ${this.getModelDisplayName(model)}
                  </option>
                `)}
              </select>
            </div>
            <div class="model-info">
              Current model: ${this.getModelDisplayName(this.currentSpeechModel)}
              ${this.getModelDescription(this.getModelDisplayName(this.currentSpeechModel))}
            </div>
          ` : html`
            <div class="status-message status-info">
              Speech recognition is not available. Make sure Whisper models are installed in the models/ folder.
            </div>
          `}
        </div>

        <div class="settings-section">
          <h3>🎙️ Text-to-Speech</h3>
          
          <div class="dropdown-row">
            <div class="dropdown-description">
              <strong>TTS Engine</strong>
              <p>Choose the text-to-speech engine and model</p>
            </div>
            <select 
              class="model-select"
              .value=${this.getCurrentTTSModel()}
              @change=${this.updateElevenLabsModel}
            >
              <option value="disabled">System TTS (macOS say command)</option>
              <optgroup label="ElevenLabs">
                <option value="eleven_flash_v2_5">ElevenLabs Flash v2.5 (Fastest, most cost-effective)</option>
                <option value="eleven_multilingual_v2">ElevenLabs Multilingual v2 (High quality, slower)</option>
              </optgroup>
              <optgroup label="Minimax">
                <option value="speech-2.6-hd">Minimax Speech 2.6 HD (Ultra-low latency, enhanced naturalness)</option>
                <option value="speech-2.6-turbo">Minimax Speech 2.6 Turbo (Faster, more cost-effective)</option>
              </optgroup>
            </select>
          </div>

          ${this.elevenLabsModel !== 'disabled' ? html`
            <div class="settings-row">
              <div class="settings-description">
                <strong>ElevenLabs API Key</strong>
                <p>Enter your ElevenLabs API key to use AI voices</p>
              </div>
              <input 
                type="password" 
                class="text-input"
                .value=${this.elevenLabsApiKey}
                @blur=${this.updateElevenLabsApiKey}
                placeholder="Enter ElevenLabs API key..."
              />
            </div>
          ` : ''}

          ${this.minimaxModel !== 'disabled' ? html`
            <div class="settings-row">
              <div class="settings-description">
                <strong>Minimax API Key</strong>
                <p>Enter your Minimax API key to use AI voices</p>
              </div>
              <input 
                type="password" 
                class="text-input"
                .value=${this.minimaxApiKey}
                @blur=${this.updateMinimaxApiKey}
                placeholder="Enter Minimax API key..."
              />
            </div>
          ` : ''}
          
          <div class="model-info">
            Status: ${this.isMinimaxEnabled ? 
              html`<span style="color: #28a745;">✓ Minimax TTS Active (${this.minimaxModel})</span>` : 
              this.isElevenLabsEnabled ? 
                html`<span style="color: #28a745;">✓ ElevenLabs TTS Active (${this.elevenLabsModel})</span>` : 
                html`<span style="color: #6c757d;">System TTS Active</span>`
            }
            ${this.minimaxModel !== 'disabled' && !this.minimaxApiKey ? html`
              <br><span style="color: #dc3545;">⚠️ API key required for Minimax TTS</span>
            ` : ''}
            ${this.elevenLabsModel !== 'disabled' && !this.elevenLabsApiKey ? html`
              <br><span style="color: #dc3545;">⚠️ API key required for ElevenLabs TTS</span>
            ` : ''}
          </div>
        </div>

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
          
          <div class="checkbox-row">
            <input 
              type="checkbox" 
              id="autoplay-audio"
              .checked=${this.autoplayAudioEnabled}
              @change=${this.toggleAutoplayAudio}
            />
            <label for="autoplay-audio">
              <strong>Autoplay Audio</strong>
              <div class="checkbox-description">
                Automatically play sentence audio when reviewing sentences in learning mode
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
