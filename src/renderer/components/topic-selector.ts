/**
 * Topic selection component for vocabulary generation
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import { router } from '../utils/router.js';
import { sessionManager } from '../utils/session-manager.js';
import { keyboardManager, useKeyboardBindings, GlobalShortcuts, CommonKeys } from '../utils/keyboard-manager.js';

@customElement('topic-selector')
export class TopicSelector extends LitElement {
  @state()
  private topic = '';

  @state()
  private isGenerating = false;

  @state()
  private error = '';



  @state()
  private currentLanguage = '';

  @state()
  private suggestions: string[] = [];

  private keyboardUnsubscribe?: () => void;

  private readonly ALL_TOPIC_SUGGESTIONS = [
    'ordering perfect latte',
    'playing Lego with your toddler',
    'choosing ice cream flavors',
    'bargaining at a flea market',
    'finding a hidden speakeasy',
    'learning to tango',
    'ordering at a local eatery',
    'chasing a runaway balloon',
    'exploring a spice market',
    'making the perfect aperitif',
    'catching the last train',
    'decoding street art',
    'finding the best pastry',
    'navigating a food truck festival',
    'learning secret handshakes',
    'discovering underground jazz',
    'hunting for vintage vinyl',
    'ordering at a cozy restaurant',
    'making friends at a town square',
    'finding lost treasures'
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
    `
  ];

  async connectedCallback() {
    super.connectedCallback();
    await this.loadCurrentLanguage();
    this.selectRandomSuggestions();
    this.setupKeyboardBindings();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.keyboardUnsubscribe) {
      this.keyboardUnsubscribe();
    }
  }

  private async loadCurrentLanguage() {
    try {
      this.currentLanguage = await window.electronAPI.database.getCurrentLanguage();
    } catch (error) {
      console.error('Failed to load current language:', error);
      this.currentLanguage = 'spanish'; // Default fallback
    }
  }

  private capitalizeLanguage(language: string): string {
    return language.charAt(0).toUpperCase() + language.slice(1);
  }

  private selectRandomSuggestions() {
    const shuffled = [...this.ALL_TOPIC_SUGGESTIONS].sort(() => Math.random() - 0.5);
    this.suggestions = shuffled.slice(0, 3);
  }

  private handleSuggestionClick(suggestion: string) {
    this.topic = suggestion;
    this.error = ''; // Clear any errors
    // Focus the input field to show the suggestion was applied
    const input = this.shadowRoot?.querySelector('#topic-input') as HTMLInputElement;
    if (input) {
      input.focus();
    }
  }



  private handleTopicChange(e: Event) {
    const input = e.target as HTMLInputElement;
    this.topic = input.value;
    this.error = ''; // Clear error when user types
  }





  private async handleGenerateWords() {
    if (this.isGenerating) return;

    console.log('Starting word generation...', { topic: this.topic, language: this.currentLanguage });

    this.isGenerating = true;
    this.error = '';

    try {
      // Generate words based on topic (or general vocabulary if no topic)
      console.log('Calling generateWords API...');
      const words = await window.electronAPI.llm.generateWords(
        this.topic.trim() || undefined,
        this.currentLanguage
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
        language: this.currentLanguage
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

  private setupKeyboardBindings() {
    const bindings = [
      {
        key: CommonKeys.ENTER,
        action: () => this.handleGenerateWords(),
        context: 'topic-selection',
        description: 'Generate words for topic'
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
            <label class="input-label" for="topic-input">
              Topic/prompt (Optional)
            </label>
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
              ${this.isGenerating ? html`
                <div class="loading-state">
                  <div class="spinner"></div>
                  Generating...
                </div>
              ` : html`
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
          ${this.suggestions.length > 0 && !this.isGenerating ? html`
            <div class="suggestions-section">
              <p class="suggestions-label">Suggestions:</p>
              <div class="suggestions-container">
                ${this.suggestions.map(suggestion => html`
                  <button
                    class="suggestion-btn"
                    @click=${() => this.handleSuggestionClick(suggestion)}
                    ?disabled=${this.isGenerating}
                    type="button"
                  >
                    ${suggestion}
                  </button>
                `)}
              </div>
            </div>
          ` : ''}
        </div>

        ${this.error ? html`
          <div class="error-message">
            ${this.error}
          </div>
        ` : ''}


      </div>
    `;
  }
}