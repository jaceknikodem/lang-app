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
import { getAvailableTopics } from '../utils/topic-utils.js';
import { UI_CONFIG } from '../../shared/constants/index.js';

@customElement('topic-selector')
export class TopicSelector extends BaseComponent {
  @state()
  private topic = '';

  @state()
  private isGenerating = false;

  @state()
  private articleUrl = '';

  @state()
  private suggestions: string[] = [];

  @state()
  private allTopicSuggestions: string[] = [];

  @state()
  private themes: string[] = [];

  @state()
  private currentTheme = 'general';

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

      .theme-section {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .theme-label {
        font-size: 12px;
        color: var(--text-secondary);
        margin: 0;
      }

      .theme-pills {
        display: flex;
        gap: var(--spacing-sm);
        flex-wrap: wrap;
      }

      .theme-pill {
        padding: var(--spacing-sm) var(--spacing-md);
        border: 1px solid var(--border-color);
        border-radius: 20px;
        background: var(--background-secondary);
        color: var(--text-secondary);
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s ease;
        text-transform: none;
      }

      .theme-pill:hover {
        border-color: var(--primary-color);
        color: var(--primary-color);
      }

      .theme-pill.active {
        background: var(--primary-color);
        border-color: var(--primary-color);
        color: white;
        font-weight: 500;
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
    await this.loadThemes();
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

  private async loadThemes() {
    try {
      this.themes = await window.electronAPI.topics.getThemes();
      this.currentTheme = await window.electronAPI.topics.getCurrentTheme();
    } catch (error) {
      logger.error({ error }, '[TopicSelector] Error loading themes');
      this.themes = ['general'];
      this.currentTheme = 'general';
    }
  }

  private formatThemeName(theme: string): string {
    const overrides: Record<string, string> = {
      'ai-ml': 'AI/ML',
      mtg: 'MTG',
      general: 'General',
      leadership: 'Leadership',
    };
    return (
      overrides[theme] ??
      theme
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
    );
  }

  private async handleThemeChange(theme: string) {
    if (theme === this.currentTheme) return;
    this.currentTheme = theme;
    try {
      await window.electronAPI.topics.setCurrentTheme(theme);
    } catch (error) {
      logger.error({ error, theme }, '[TopicSelector] Error setting theme');
    }
    await this.loadTopics();
    await this.selectRandomSuggestions();
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

    // Get available topics, excluding frequently used ones
    const topicsToUse = await getAvailableTopics(this.allTopicSuggestions, this.currentLanguage);

    // Select random suggestions based on config
    const suggestionsCount = UI_CONFIG.TOPIC_SUGGESTIONS_COUNT;
    const shuffled = [...topicsToUse].sort(() => Math.random() - 0.5);
    this.suggestions = shuffled.slice(0, suggestionsCount);
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

  private handleArticleUrlChange(e: Event) {
    this.articleUrl = (e.target as HTMLInputElement).value;
    this.error = null;
  }

  private async handleImportFromArticle() {
    if (this.isGenerating) return;
    const url = this.articleUrl.trim();
    if (!url) {
      this.error = 'Enter an article URL to import from.';
      return;
    }

    this.isGenerating = true;
    this.error = null;

    try {
      const language = this.currentLanguage || 'spanish';
      const words = await window.electronAPI.llm.extractArticleWords(url, language);

      if (!words || words.length === 0) {
        throw new Error('No new words found in that article.');
      }

      router.navigateTo('word-selection', {
        topic: undefined,
        generatedWords: words,
        language: this.currentLanguage,
      });
    } catch (error) {
      logger.error({ error, url: this.articleUrl }, 'Failed to import words from article');
      this.error = getErrorMessage(error, 'Failed to import words from that article.');
    } finally {
      this.isGenerating = false;
    }
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

  render() {
    return html`
      <div class="topic-container">
        ${this.themes.length > 1
          ? html`
              <div class="theme-section">
                <p class="theme-label">Theme:</p>
                <div class="theme-pills">
                  ${this.themes.map(
                    (theme) => html`
                      <button
                        class="theme-pill ${theme === this.currentTheme ? 'active' : ''}"
                        @click=${() => this.handleThemeChange(theme)}
                        type="button"
                      >
                        ${this.formatThemeName(theme)}
                      </button>
                    `
                  )}
                </div>
              </div>
            `
          : ''}
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

        <div class="topic-input-section" style="margin-top: 18px;">
          <div class="input-group">
            <label class="input-label" for="article-url-input">Or import from an article</label>
            <div class="input-row">
              <input
                id="article-url-input"
                class="topic-input"
                type="url"
                .value=${this.articleUrl}
                @input=${this.handleArticleUrlChange}
                placeholder="https://… (a page in your target language)"
                ?disabled=${this.isGenerating}
              />
              <button
                class="btn btn-primary generate-btn inline"
                @click=${this.handleImportFromArticle}
                ?disabled=${this.isGenerating}
                title="Extract key words from the article"
              >
                Import
              </button>
            </div>
          </div>
        </div>

        ${this.error ? html` <div class="error-message">${this.error}</div> ` : ''}
      </div>
    `;
  }
}
