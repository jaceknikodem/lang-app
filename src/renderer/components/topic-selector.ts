/**
 * Topic selection component for vocabulary generation
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import { router } from '../utils/router.js';
import { sessionManager } from '../utils/session-manager.js';

@customElement('topic-selector')
export class TopicSelector extends LitElement {
  @state()
  private topic = '';

  @state()
  private isGenerating = false;

  @state()
  private error = '';

  @state()
  private availableModels: string[] = [];

  @state()
  private selectedModel = '';

  @state()
  private isLoadingModels = false;

  @state()
  private language = 'Spanish'; // Make language a state property so it can be changed

  @state()
  private availableLanguages = [
    'Polish',
    'Portuguese',
    'Spanish',
    'Italian',
    'Indonesian'
  ];

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        max-width: 600px;
        margin: 0 auto;
      }

      .topic-container {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-lg);
      }

      .intro-section {
        text-align: center;
      }

      .intro-title {
        font-size: 24px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 var(--spacing-md) 0;
      }

      .intro-text {
        font-size: 16px;
        color: var(--text-secondary);
        line-height: 1.5;
        margin: 0;
      }

      .topic-input-section {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
      }

      .input-group {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .input-label {
        font-size: 16px;
        font-weight: 500;
        color: var(--text-primary);
      }

      .topic-input {
        width: 100%;
        padding: var(--spacing-md);
        border: 2px solid var(--border-color);
        border-radius: var(--border-radius);
        font-size: 16px;
        transition: border-color 0.2s ease;
        box-sizing: border-box;
      }

      .topic-input:focus {
        outline: none;
        border-color: var(--primary-color);
      }

      .topic-input::placeholder {
        color: var(--text-tertiary);
      }

      .help-text {
        font-size: 14px;
        color: var(--text-secondary);
        margin: 0;
      }

      .action-section {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
        align-items: center;
      }

      .action-buttons {
        display: flex;
        gap: var(--spacing-md);
        flex-wrap: wrap;
        justify-content: center;
      }

      .generate-btn {
        min-width: 160px;
      }

      .skip-btn {
        min-width: 160px;
      }

      .model-selector {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .model-dropdown {
        width: 100%;
        padding: var(--spacing-md);
        border: 2px solid var(--border-color);
        border-radius: var(--border-radius);
        font-size: 16px;
        background: white;
        transition: border-color 0.2s ease;
        box-sizing: border-box;
      }

      .model-dropdown:focus {
        outline: none;
        border-color: var(--primary-color);
      }

      .model-dropdown:disabled {
        background: #f5f5f5;
        color: var(--text-tertiary);
        cursor: not-allowed;
      }

      .language-dropdown {
        width: 100%;
        padding: var(--spacing-md);
        border: 2px solid var(--border-color);
        border-radius: var(--border-radius);
        font-size: 16px;
        background: white;
        transition: border-color 0.2s ease;
        box-sizing: border-box;
      }

      .language-dropdown:focus {
        outline: none;
        border-color: var(--primary-color);
      }

      .language-dropdown:disabled {
        background: #f5f5f5;
        color: var(--text-tertiary);
        cursor: not-allowed;
      }

      .error-message {
        color: var(--error-color);
        background: #ffebee;
        padding: var(--spacing-md);
        border-radius: var(--border-radius);
        border: 1px solid #ffcdd2;
        text-align: center;
      }

      .loading-state {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-sm);
        color: var(--text-secondary);
        font-style: italic;
      }

      @media (max-width: 768px) {
        .action-buttons {
          flex-direction: column;
          width: 100%;
        }

        .generate-btn,
        .skip-btn {
          width: 100%;
        }
      }
    `
  ];

  async connectedCallback() {
    super.connectedCallback();
    await this.loadAvailableModels();
  }

  private async loadAvailableModels() {
    this.isLoadingModels = true;
    this.error = '';
    
    try {
      console.log('Loading available models...');
      
      const [models, currentModel] = await Promise.all([
        window.electronAPI.llm.getAvailableModels(),
        window.electronAPI.llm.getCurrentModel()
      ]);

      console.log('Models loaded:', models);
      console.log('Current model:', currentModel);

      this.availableModels = models;
      this.selectedModel = currentModel || '';

      if (models.length === 0) {
        this.error = 'No models available. Please ensure Ollama is running and has models installed.';
      } else if (!currentModel) {
        this.error = 'No model selected. Please select a model to continue.';
      }
      
      console.log('Model loading complete. Selected model:', this.selectedModel);
    } catch (error) {
      console.error('Failed to load available models:', error);
      this.error = 'Failed to load available models. Please check that Ollama is running.';
      this.selectedModel = '';
    } finally {
      this.isLoadingModels = false;
      console.log('Model loading finished. isLoadingModels:', this.isLoadingModels, 'selectedModel:', this.selectedModel);
    }
  }

  private handleTopicChange(e: Event) {
    const input = e.target as HTMLInputElement;
    this.topic = input.value;
    this.error = ''; // Clear error when user types
  }

  private async handleModelChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    const newModel = select.value;

    if (newModel && newModel !== this.selectedModel) {
      try {
        await window.electronAPI.llm.setModel(newModel);
        this.selectedModel = newModel;
        this.error = ''; // Clear any previous errors
      } catch (error) {
        console.error('Failed to set model:', error);
        this.error = 'Failed to set model. Please try again.';
        // Revert the selection
        select.value = this.selectedModel;
      }
    }
  }

  private handleLanguageChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    this.language = select.value;
    this.error = ''; // Clear any previous errors
  }

  private async handleGenerateWords() {
    if (this.isGenerating) return;

    // Check if a model is selected
    if (!this.selectedModel) {
      this.error = 'Please select an LLM model before generating words.';
      return;
    }

    console.log('Starting word generation...', { topic: this.topic, language: this.language, selectedModel: this.selectedModel });

    this.isGenerating = true;
    this.error = '';

    try {
      // Generate words based on topic (or general vocabulary if no topic)
      console.log('Calling generateWords API...');
      const words = await window.electronAPI.llm.generateWords(
        this.topic.trim() || undefined,
        this.language
      );

      console.log('Generated words result:', words);

      if (!words || words.length === 0) {
        throw new Error('No words were generated. Please try again.');
      }

      // Update session with topic
      const topicToSave = this.topic.trim() || undefined;
      if (topicToSave) {
        sessionManager.updateSelectedTopic(topicToSave);
      }

      console.log('Navigating to word selection with', words.length, 'words');

      // Navigate to word selection with generated words
      router.navigateTo('word-selection', {
        topic: topicToSave,
        generatedWords: words,
        language: this.language
      });

    } catch (error) {
      console.error('Failed to generate words:', error);
      this.error = error instanceof Error ? error.message : 'Failed to generate vocabulary words. Please check that Ollama is running and try again.';
    } finally {
      this.isGenerating = false;
    }
  }

  private handleSkipTopic() {
    // Generate general vocabulary without topic
    this.topic = '';
    this.handleGenerateWords();
  }

  private handleKeyPress(e: KeyboardEvent) {
    if (e.key === 'Enter' && !this.isGenerating) {
      this.handleGenerateWords();
    }
  }

  render() {
    return html`
      <div class="topic-container">
        <div class="intro-section">
          <h2 class="intro-title">Choose Your Learning Focus</h2>
          <p class="intro-text">
            Enter a topic to generate relevant vocabulary, or skip to practice with general high-frequency words.
          </p>
        </div>

        <div class="topic-input-section">
          <div class="input-group">
            <label class="input-label" for="language-select">
              Language
            </label>
            <select
              id="language-select"
              class="language-dropdown"
              .value=${this.language}
              @change=${this.handleLanguageChange}
              ?disabled=${this.isGenerating}
            >
              ${this.availableLanguages.map(lang => html`
                <option value=${lang} ?selected=${lang === this.language}>
                  ${lang}
                </option>
              `)}
            </select>
            <p class="help-text">
              Select the language you want to learn.
            </p>
          </div>

          <div class="input-group">
            <label class="input-label" for="model-select">
              LLM Model
            </label>
            <select
              id="model-select"
              class="model-dropdown"
              .value=${this.selectedModel}
              @change=${this.handleModelChange}
              ?disabled=${this.isGenerating || this.isLoadingModels || this.availableModels.length === 0}
            >
              ${this.isLoadingModels ? html`
                <option value="">Loading models...</option>
              ` : this.availableModels.length === 0 ? html`
                <option value="">No models available</option>
              ` : this.availableModels.map(model => html`
                <option value=${model} ?selected=${model === this.selectedModel}>
                  ${model}
                </option>
              `)}
            </select>
            <p class="help-text">
              Select the LLM model to use for generating vocabulary words.
            </p>
          </div>

          <div class="input-group">
            <label class="input-label" for="topic-input">
              Topic (Optional)
            </label>
            <input
              id="topic-input"
              class="topic-input"
              type="text"
              .value=${this.topic}
              @input=${this.handleTopicChange}
              @keypress=${this.handleKeyPress}
              placeholder="e.g., travel, food, business, family..."
              ?disabled=${this.isGenerating}
            />
            <p class="help-text">
              Leave blank for general vocabulary, or enter a specific topic like "cooking", "travel", or "business".
            </p>
          </div>
        </div>

        ${this.error ? html`
          <div class="error-message">
            ${this.error}
          </div>
        ` : ''}

        <div class="action-section">
          ${this.isGenerating ? html`
            <div class="loading-state">
              <div class="spinner"></div>
              Generating vocabulary words...
            </div>
          ` : html`
            <div class="action-buttons">
              <button
                class="btn btn-primary btn-large generate-btn"
                @click=${this.handleGenerateWords}
                ?disabled=${this.isGenerating || !this.selectedModel || this.isLoadingModels}
              >
                ${this.topic.trim() ? 'Generate Topic Words' : 'Generate General Words'}
              </button>
              
              ${this.topic.trim() ? html`
                <button
                  class="btn btn-secondary btn-large skip-btn"
                  @click=${this.handleSkipTopic}
                  ?disabled=${this.isGenerating || !this.selectedModel || this.isLoadingModels}
                >
                  Skip Topic
                </button>
              ` : ''}
            </div>
          `}
        </div>
      </div>
    `;
  }
}