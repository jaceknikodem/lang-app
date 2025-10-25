/**
 * Word selection component for choosing specific vocabulary to study
 */

import { LitElement, html, css } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import { router } from '../utils/router.js';
import { GeneratedWord } from '../../shared/types/core.js';

interface SelectableWord extends GeneratedWord {
  selected: boolean;
}

@customElement('word-selector')
export class WordSelector extends LitElement {
  @property({ type: Array })
  generatedWords: GeneratedWord[] = [];

  @property({ type: String })
  topic?: string;

  @property({ type: String })
  language = 'Spanish';

  @state()
  private selectableWords: SelectableWord[] = [];

  @state()
  private isProcessing = false;

  @state()
  private error = '';

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        max-width: 800px;
        margin: 0 auto;
      }

      .word-selector-container {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-lg);
      }

      .header-section {
        text-align: center;
      }

      .header-title {
        font-size: 24px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 var(--spacing-sm) 0;
      }

      .header-subtitle {
        font-size: 16px;
        color: var(--text-secondary);
        margin: 0;
      }

      .topic-info {
        background: var(--primary-light);
        padding: var(--spacing-md);
        border-radius: var(--border-radius);
        border: 1px solid var(--primary-color);
        text-align: center;
        margin-bottom: var(--spacing-md);
      }

      .topic-label {
        font-size: 14px;
        color: var(--text-secondary);
        margin: 0 0 var(--spacing-xs) 0;
      }

      .topic-name {
        font-size: 18px;
        font-weight: 600;
        color: var(--primary-color);
        margin: 0;
      }

      .selection-controls {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-md);
        background: var(--background-secondary);
        border-radius: var(--border-radius);
        flex-wrap: wrap;
        gap: var(--spacing-sm);
      }

      .selection-info {
        font-size: 14px;
        color: var(--text-secondary);
      }

      .selection-actions {
        display: flex;
        gap: var(--spacing-sm);
      }

      .word-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: var(--spacing-md);
      }

      .word-item {
        background: var(--background-primary);
        border: 2px solid var(--border-color);
        border-radius: var(--border-radius);
        padding: var(--spacing-md);
        cursor: pointer;
        transition: all 0.2s ease;
        position: relative;
      }

      .word-item:hover {
        border-color: var(--primary-color);
        box-shadow: var(--shadow-light);
      }

      .word-item.selected {
        border-color: var(--primary-color);
        background: var(--primary-light);
      }

      .word-checkbox {
        position: absolute;
        top: var(--spacing-sm);
        right: var(--spacing-sm);
        width: 20px;
        height: 20px;
        cursor: pointer;
      }

      .word-content {
        margin-right: var(--spacing-lg);
      }

      .word-foreign {
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 var(--spacing-xs) 0;
      }

      .word-translation {
        font-size: 14px;
        color: var(--text-secondary);
        margin: 0 0 var(--spacing-xs) 0;
      }

      .word-frequency {
        font-size: 12px;
        padding: 2px 6px;
        border-radius: 12px;
        font-weight: 500;
        text-transform: uppercase;
      }

      .frequency-high {
        background: #e8f5e8;
        color: #2e7d32;
      }

      .frequency-medium {
        background: #fff3e0;
        color: #f57c00;
      }

      .frequency-low {
        background: #ffebee;
        color: #d32f2f;
      }

      .action-section {
        display: flex;
        justify-content: center;
        gap: var(--spacing-md);
        flex-wrap: wrap;
      }

      .start-btn {
        min-width: 160px;
      }

      .back-btn {
        min-width: 120px;
      }

      .error-message {
        color: var(--error-color);
        background: #ffebee;
        padding: var(--spacing-md);
        border-radius: var(--border-radius);
        border: 1px solid #ffcdd2;
        text-align: center;
      }

      .empty-state {
        text-align: center;
        color: var(--text-secondary);
        padding: var(--spacing-xl);
      }

      @media (max-width: 768px) {
        .word-list {
          grid-template-columns: 1fr;
        }

        .selection-controls {
          flex-direction: column;
          align-items: stretch;
        }

        .selection-actions {
          justify-content: center;
        }

        .action-section {
          flex-direction: column;
        }

        .start-btn,
        .back-btn {
          width: 100%;
        }
      }
    `
  ];

  connectedCallback() {
    super.connectedCallback();
    this.initializeWords();
  }

  private initializeWords() {
    // Convert generated words to selectable format
    this.selectableWords = this.generatedWords.map(word => ({
      ...word,
      selected: false
    }));

    // Auto-select first 5 words by default
    this.selectableWords.slice(0, 5).forEach(word => {
      word.selected = true;
    });
  }

  private toggleWordSelection(index: number) {
    const word = this.selectableWords[index];
    if (word) {
      word.selected = !word.selected;
      this.requestUpdate();
    }
  }

  private selectAll() {
    this.selectableWords.forEach(word => {
      word.selected = true;
    });
    this.requestUpdate();
  }

  private selectNone() {
    this.selectableWords.forEach(word => {
      word.selected = false;
    });
    this.requestUpdate();
  }

  private getSelectedWords(): GeneratedWord[] {
    return this.selectableWords
      .filter(word => word.selected)
      .map(({ selected, ...word }) => word);
  }

  private async handleStartLearning() {
    const selectedWords = this.getSelectedWords();
    
    if (selectedWords.length === 0) {
      this.error = 'Please select at least one word to study.';
      return;
    }

    if (selectedWords.length > 20) {
      this.error = 'Please select no more than 20 words for optimal learning.';
      return;
    }

    this.isProcessing = true;
    this.error = '';

    try {
      // Store selected words in database and generate sentences
      const storedWords = [];
      
      for (const word of selectedWords) {
        // Generate audio for the word
        const wordAudioPath = await window.electronAPI.audio.generateAudio(
          word.word,
          this.language
        );

        // Insert word into database
        const wordId = await window.electronAPI.database.insertWord({
          word: word.word,
          language: this.language,
          translation: word.translation,
          audioPath: wordAudioPath
        });

        // Generate sentences for the word
        const sentences = await window.electronAPI.llm.generateSentences(
          word.word,
          this.language
        );

        // Store sentences in database with audio generation
        for (const sentence of sentences) {
          // Generate audio for the sentence
          const audioPath = await window.electronAPI.audio.generateAudio(
            sentence.sentence,
            this.language
          );
          
          await window.electronAPI.database.insertSentence(
            wordId,
            sentence.sentence,
            sentence.translation,
            audioPath
          );
        }

        // Get the complete word data
        const completeWord = await window.electronAPI.database.getWordById(wordId);
        if (completeWord) {
          storedWords.push(completeWord);
        }
      }

      // Navigate to learning mode with selected words
      router.goToLearning(storedWords);

    } catch (error) {
      console.error('Failed to process selected words:', error);
      this.error = error instanceof Error ? error.message : 'Failed to process selected words. Please try again.';
    } finally {
      this.isProcessing = false;
    }
  }

  private handleGoBack() {
    router.goToTopicSelection();
  }

  render() {
    if (this.generatedWords.length === 0) {
      return html`
        <div class="word-selector-container">
          <div class="empty-state">
            <h3>No words generated</h3>
            <p>Please go back and try generating words again.</p>
            <button class="btn btn-primary" @click=${this.handleGoBack}>
              Go Back
            </button>
          </div>
        </div>
      `;
    }

    const selectedCount = this.selectableWords.filter(w => w.selected).length;

    return html`
      <div class="word-selector-container">
        <div class="header-section">
          <h2 class="header-title">Select Words to Study</h2>
          <p class="header-subtitle">
            Choose the vocabulary words you want to focus on in this session.
          </p>
        </div>

        ${this.topic ? html`
          <div class="topic-info">
            <p class="topic-label">Topic</p>
            <p class="topic-name">${this.topic}</p>
          </div>
        ` : ''}

        <div class="selection-controls">
          <div class="selection-info">
            ${selectedCount} of ${this.selectableWords.length} words selected
          </div>
          <div class="selection-actions">
            <button class="btn btn-small btn-secondary" @click=${this.selectAll}>
              Select All
            </button>
            <button class="btn btn-small btn-secondary" @click=${this.selectNone}>
              Select None
            </button>
          </div>
        </div>

        <div class="word-list">
          ${this.selectableWords.map((word, index) => html`
            <div 
              class="word-item ${word.selected ? 'selected' : ''}"
              @click=${() => this.toggleWordSelection(index)}
            >
              <input
                type="checkbox"
                class="word-checkbox"
                .checked=${word.selected}
                @click=${(e: Event) => e.stopPropagation()}
                @change=${() => this.toggleWordSelection(index)}
              />
              <div class="word-content">
                <h4 class="word-foreign">${word.word}</h4>
                <p class="word-translation">${word.translation}</p>
                <span class="word-frequency frequency-${word.frequency}">
                  ${word.frequency}
                </span>
              </div>
            </div>
          `)}
        </div>

        ${this.error ? html`
          <div class="error-message">
            ${this.error}
          </div>
        ` : ''}

        <div class="action-section">
          ${this.isProcessing ? html`
            <div class="loading">
              <div class="spinner"></div>
              Processing selected words...
            </div>
          ` : html`
            <button
              class="btn btn-primary btn-large start-btn"
              @click=${this.handleStartLearning}
              ?disabled=${selectedCount === 0}
            >
              Start Learning (${selectedCount} words)
            </button>
            <button
              class="btn btn-secondary back-btn"
              @click=${this.handleGoBack}
            >
              Go Back
            </button>
          `}
        </div>
      </div>
    `;
  }
}