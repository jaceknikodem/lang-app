/**
 * Topic selection component for vocabulary generation
 */

import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import { router } from '../utils/router.js';
import { sessionManager } from '../utils/session-manager.js';
import { useKeyboardBindings, CommonKeys } from '../utils/keyboard-manager.js';
import { loadCurrentLanguage, loadLemmatizationModel } from '../utils/language-manager.js';
import { getErrorMessage } from '../../shared/utils/error.js';
import { logger } from '../utils/logger.js';
import { BaseComponent } from './base-component.js';

@customElement('topic-selector')
export class TopicSelector extends BaseComponent {
  @state()
  private topic = '';

  @state()
  private isGenerating = false;

  @state()
  private suggestions: string[] = [];

  @state()
  private allTopicSuggestions: string[] = [];

  private keyboardUnsubscribe?: () => void;

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
        gap: var(--spacing-md);
      }

      .intro-section {
        text-align: center;
      }

      .intro-title {
        font-size: 20px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 var(--spacing-sm) 0;
      }

      .intro-text {
        font-size: 14px;
        color: var(--text-secondary);
        line-height: 1.4;
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

      .input-row {
        display: flex;
        gap: var(--spacing-md);
        align-items: flex-end;
      }

      .input-label {
        font-size: 14px;
        font-weight: 500;
        color: var(--text-primary);
      }

      .topic-input {
        flex: 3;
        min-width: 300px;
        padding: var(--spacing-md);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius);
        font-size: 14px;
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
        font-size: 12px;
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
        min-width: 120px;
        white-space: nowrap;
      }

      .generate-btn.inline {
        flex: 0 0 auto;
        min-width: 80px;
        padding: var(--spacing-md) var(--spacing-lg);
      }

      .skip-btn {
        min-width: 160px;
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

      .suggestions-section {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .suggestions-label {
        font-size: 12px;
        color: var(--text-secondary);
        margin: 0;
      }

      .suggestions-container {
        display: flex;
        gap: var(--spacing-sm);
        flex-wrap: wrap;
      }

      .suggestion-btn {
        padding: var(--spacing-sm) var(--spacing-md);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius);
        background: var(--background-secondary);
        color: var(--text-primary);
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s ease;
        white-space: nowrap;
      }

      .suggestion-btn:hover {
        background: var(--primary-color);
        color: white;
        border-color: var(--primary-color);
        transform: translateY(-1px);
      }

      .suggestion-btn:active {
        transform: translateY(0);
      }

      .suggestion-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      @media (max-width: 768px) {
        .input-row {
          flex-direction: column;
          gap: var(--spacing-sm);
        }

        .topic-input {
          width: 100%;
          min-width: unset;
        }

        .generate-btn.inline {
          width: 100%;
          min-width: unset;
        }

        .action-buttons {
          flex-direction: column;
          width: 100%;
        }

        .skip-btn {
          width: 100%;
        }
      }
    `,
  ];

  async connectedCallback() {
    super.connectedCallback();
    await this.loadCurrentLanguage();
    await this.loadTopics();
    await this.selectRandomSuggestions();
    this.setupKeyboardBindings();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.keyboardUnsubscribe) {
      this.keyboardUnsubscribe();
    }
  }

  private async loadCurrentLanguage() {
    this.currentLanguage = (await loadCurrentLanguage('spanish')) || null;
  }

  protected override handleExternalLanguageChange = async (event: Event): Promise<void> => {
    // Call base class handler first
    await super.handleExternalLanguageChange(event);

    const detail = (event as CustomEvent<{ language?: string }>).detail;
    const newLanguage = detail?.language;

    if (!newLanguage || newLanguage === this.currentLanguage) {
      return;
    }

    // Reload lemmatization model for the new language (async, non-blocking)
    void loadLemmatizationModel(newLanguage);

    // Reset state for the new language
    this.topic = '';
    this.error = null;
    await this.loadTopics();
    await this.selectRandomSuggestions();

    // Request update to reflect changes
    this.requestUpdate();
  };

  private async loadTopics() {
    try {
      this.allTopicSuggestions = await window.electronAPI.topics.getTopics();
    } catch (error) {
      logger.error({ error }, '[TopicSelector] Error loading topics');
      this.allTopicSuggestions = [];
    }
  }

  private async selectRandomSuggestions() {
    if (this.allTopicSuggestions.length === 0) {
      return;
    }

    // Get word counts by topic for the current language
    let frequentlyUsedTopics: Set<string> = new Set();
    if (this.currentLanguage) {
      try {
        const topicCounts = await window.electronAPI.database.getTopicWordCounts(
          this.currentLanguage
        );
        // Get the top ~10 most used topics (or fewer if there aren't that many)
        const topUsedTopics = topicCounts.slice(0, 10).map((tc) => tc.topic);
        frequentlyUsedTopics = new Set(topUsedTopics);
      } catch (error) {
        logger.error({ error }, '[TopicSelector] Error getting topic word counts');
        // Continue without filtering if there's an error
      }
    }

    // Filter out frequently used topics
    const availableTopics = this.allTopicSuggestions.filter(
      (topic) => !frequentlyUsedTopics.has(topic)
    );

    // If we filtered out too many, fall back to all topics
    const topicsToUse = availableTopics.length >= 3 ? availableTopics : this.allTopicSuggestions;

    // Select 3 random suggestions
    const shuffled = [...topicsToUse].sort(() => Math.random() - 0.5);
    this.suggestions = shuffled.slice(0, 3);
  }

  private handleSuggestionClick(suggestion: string) {
    this.topic = suggestion;
    this.error = null; // Clear any errors
    // Focus the input field to show the suggestion was applied
    const input = this.shadowRoot?.querySelector('#topic-input') as HTMLInputElement;
    if (input) {
      input.focus();
    }
  }

  private handleTopicChange(e: Event) {
    const input = e.target as HTMLInputElement;
    this.topic = input.value;
    this.error = null; // Clear error when user types
  }

  private async handleGenerateWords() {
    if (this.isGenerating) return;

    console.log('Starting word generation...', {
      topic: this.topic,
      language: this.currentLanguage,
    });

    this.isGenerating = true;
    this.error = null;

    try {
      // Generate words based on topic (or general vocabulary if no topic)
      console.log('Calling generateWords API...');
      const language = this.currentLanguage || 'spanish'; // Default fallback
      const words = await window.electronAPI.llm.generateWords(
        this.topic.trim() || undefined,
        language
      );

      console.log('Generated words result:', words);

      if (!words || words.length === 0) {
        throw new Error('No words were generated. Please try again.');
      }

      // Update session with topic
      const topicToSave = this.topic.trim() || undefined;
      console.log('[TopicSelector] Original topic:', this.topic);
      console.log('[TopicSelector] Topic trimmed:', this.topic.trim());
      console.log('[TopicSelector] Topic to save:', topicToSave);
      if (topicToSave) {
        sessionManager.updateSelectedTopic(topicToSave);
      }

      console.log('Navigating to word selection with', words.length, 'words');

      // Navigate to word selection with generated words
      router.navigateTo('word-selection', {
        topic: topicToSave,
        generatedWords: words,
        language: this.currentLanguage,
      });
      console.log('[TopicSelector] Navigated with topic:', topicToSave);
    } catch (error) {
      logger.error(
        { error, topic: this.topic, language: this.currentLanguage },
        'Failed to generate words'
      );
      this.error = getErrorMessage(
        error,
        'Failed to generate vocabulary words. Please check that Ollama is running and try again.'
      );
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

  private setupKeyboardBindings() {
    const bindings = [
      {
        key: CommonKeys.ENTER,
        action: () => this.handleGenerateWords(),
        context: 'topic-selection',
        description: 'Generate words for topic',
      },
    ];

    this.keyboardUnsubscribe = useKeyboardBindings(bindings);
  }

  private clearTopic() {
    this.topic = '';
    const input = this.shadowRoot?.querySelector('#topic-input') as HTMLInputElement;
    if (input) {
      input.focus();
    }
  }

  render() {
    return html`
      <div class="topic-container">
        <div class="topic-input-section">
          <div class="input-group">
            <label class="input-label" for="topic-input"> Topic/prompt (Optional) </label>
            <div class="input-row">
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
              ${this.isGenerating
                ? html`
                    <div class="loading-state">
                      <div class="spinner"></div>
                      Generating...
                    </div>
                  `
                : html`
                    <button
                      class="btn btn-primary generate-btn inline"
                      @click=${this.handleGenerateWords}
                      ?disabled=${this.isGenerating}
                      title="Generate words (Enter)"
                    >
                      Generate <span class="keyboard-hint">(Enter)</span>
                    </button>
                  `}
            </div>
          </div>
          ${this.suggestions.length > 0 && !this.isGenerating
            ? html`
                <div class="suggestions-section">
                  <p class="suggestions-label">Suggestions:</p>
                  <div class="suggestions-container">
                    ${this.suggestions.map(
                      (suggestion) => html`
                        <button
                          class="suggestion-btn"
                          @click=${() => this.handleSuggestionClick(suggestion)}
                          ?disabled=${this.isGenerating}
                          type="button"
                        >
                          ${suggestion}
                        </button>
                      `
                    )}
                  </div>
                </div>
              `
            : ''}
        </div>

        ${this.error ? html` <div class="error-message">${this.error}</div> ` : ''}
      </div>
    `;
  }
}
