/**
 * Word selection component for choosing specific vocabulary to study
 */

import { LitElement, html, css } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import { router } from '../utils/router.js';
import { sessionManager } from '../utils/session-manager.js';
import { useKeyboardBindings, CommonKeys } from '../utils/keyboard-manager.js';
import { GeneratedWord } from '../../shared/types/core.js';

interface SelectableWord extends GeneratedWord {
  selected: boolean;
  markedAsKnown: boolean;
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

  @state()
  private statusMessage = '';

  private keyboardUnsubscribe?: () => void;

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
        gap: var(--spacing-md);
      }

      .header-section {
        text-align: center;
      }

      .header-title {
        font-size: 20px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 var(--spacing-sm) 0;
      }

      .header-subtitle {
        font-size: 14px;
        color: var(--text-secondary);
        margin: 0;
      }

      .topic-info {
        background: var(--primary-light);
        padding: var(--spacing-md);
        border-radius: var(--border-radius);
        border: 1px solid var(--primary-color);
        text-align: center;
        margin-bottom: var(--spacing-sm);
      }

      .topic-label {
        font-size: 12px;
        color: var(--text-secondary);
        margin: 0 0 var(--spacing-xs) 0;
      }

      .topic-name {
        font-size: 16px;
        font-weight: 600;
        color: var(--primary-color);
        margin: 0;
      }

      .selection-controls {
        display: flex;
        justify-content: center;
        align-items: center;
        padding: var(--spacing-md);
        background: var(--background-secondary);
        border-radius: var(--border-radius);
        flex-wrap: wrap;
        gap: var(--spacing-sm);
        text-align: center;
      }

      .selection-info {
        font-size: 14px;
        color: var(--text-secondary);
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

      .word-item.known {
        border-color: #4caf50;
        background: #e8f5e8;
        opacity: 0.7;
      }

      .word-item.known .word-content {
        text-decoration: line-through;
      }



      .word-actions {
        position: absolute;
        top: var(--spacing-sm);
        right: var(--spacing-sm);
        display: flex;
        flex-direction: row;
        gap: var(--spacing-xs);
        align-items: center;
      }

      .known-btn {
        background: #4caf50;
        color: white;
        border: none;
        border-radius: 4px;
        padding: 4px 10px;
        font-size: 12px;
        cursor: pointer;
        transition: background-color 0.2s ease;
        white-space: nowrap;
        min-width: 110px;
      }

      .known-btn:hover {
        background: #45a049;
      }

      .known-btn.active {
        background: #2e7d32;
      }

      .undo-btn {
        background: #ff9800;
        color: white;
        border: none;
        border-radius: 4px;
        padding: 3px 6px;
        font-size: 11px;
        cursor: pointer;
        transition: background-color 0.2s ease;
        white-space: nowrap;
        min-width: 50px;
      }

      .undo-btn:hover {
        background: #f57c00;
      }

      .word-content {
        margin-right: calc(var(--spacing-lg) + 70px);
        display: flex;
        align-items: baseline;
        gap: var(--spacing-sm);
        flex-wrap: wrap;
      }

      .word-foreign {
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
      }

      .word-translation {
        font-size: 14px;
        color: var(--text-secondary);
        margin: 0;
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

      .frequency-tier {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 10px;
        background: #f5f5f5;
        color: #666;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        white-space: nowrap;
      }

      .action-section {
        display: flex;
        justify-content: center;
      }

      .primary-actions {
        display: flex;
        gap: var(--spacing-sm);
        flex-wrap: wrap;
        justify-content: center;
      }

      .start-btn {
        min-width: 180px;
      }

      .error-message {
        color: var(--error-color);
        background: #ffebee;
        padding: var(--spacing-md);
        border-radius: var(--border-radius);
        border: 1px solid #ffcdd2;
        text-align: center;
      }

      .success-message {
        color: var(--success-color);
        background: #e8f5e9;
        padding: var(--spacing-md);
        border-radius: var(--border-radius);
        border: 1px solid #c8e6c9;
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

        .primary-actions {
          width: 100%;
        }

        .start-btn {
          width: 100%;
        }
      }
    `
  ];

  connectedCallback() {
    super.connectedCallback();
    this.initializeWords();
    this.setupKeyboardBindings();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.keyboardUnsubscribe) {
      this.keyboardUnsubscribe();
    }
  }

  private initializeWords() {
    // Convert generated words to selectable format and auto-select all words
    this.selectableWords = this.generatedWords.map(word => ({
      ...word,
      selected: true,  // Auto-select all generated words by default
      markedAsKnown: false
    }));
  }

  private toggleWordSelection(index: number) {
    const word = this.selectableWords[index];
    if (word && !word.markedAsKnown) {
      word.selected = !word.selected;
      this.requestUpdate();
    }
  }

  private markWordAsKnown(index: number, event: Event) {
    event.stopPropagation();
    const word = this.selectableWords[index];
    if (word) {
      word.markedAsKnown = !word.markedAsKnown;
      if (word.markedAsKnown) {
        word.selected = false; // Unselect when marked as known
      }
      this.requestUpdate();
    }
  }

  private selectAll() {
    this.selectableWords.forEach(word => {
      if (!word.markedAsKnown) {
        word.selected = true;
      }
    });
    this.requestUpdate();
  }

  private selectNone() {
    this.selectableWords.forEach(word => {
      word.selected = false;
    });
    this.requestUpdate();
  }

  private setupKeyboardBindings() {
    const bindings = [
      {
        key: CommonKeys.ENTER,
        action: () => {
          if (this.isProcessing) {
            return;
          }

          const hasSelection = this.getSelectedWords().length > 0 || this.getKnownWords().length > 0;
          if (!hasSelection) {
            return;
          }

          return this.handleStartLearning();
        },
        context: 'word-selection',
        description: 'Start learning with selected words'
      }
    ];

    this.keyboardUnsubscribe = useKeyboardBindings(bindings);
  }

  private getSelectedWords(): GeneratedWord[] {
    return this.selectableWords
      .filter(word => word.selected && !word.markedAsKnown)
      .map(({ selected, markedAsKnown, ...word }) => word);
  }

  private getKnownWords(): GeneratedWord[] {
    return this.selectableWords
      .filter(word => word.markedAsKnown)
      .map(({ selected, markedAsKnown, ...word }) => word);
  }

  private async handleStartLearning() {
    const selectedWords = this.getSelectedWords();
    const knownWords = this.getKnownWords();

    if (selectedWords.length === 0 && knownWords.length === 0) {
      this.error = 'Please select at least one word to study or mark some as known.';
      return;
    }

    if (selectedWords.length > 20) {
      this.error = 'Please select no more than 20 words for optimal learning.';
      return;
    }

    this.isProcessing = true;
    this.error = '';
    this.statusMessage = '';

    try {
      console.log('Processing', selectedWords.length, 'selected words and', knownWords.length, 'known words...');

      // Set the current language in database to match the words being inserted
      await window.electronAPI.database.setCurrentLanguage(this.language);
      console.log('Set current language to:', this.language);

      // Process known words first (simpler - no sentences needed)
      let processedKnown = 0;
      const failedWords: string[] = [];

      for (let i = 0; i < knownWords.length; i++) {
        const word = knownWords[i];
        console.log(`Processing known word ${i + 1}/${knownWords.length}: ${word.word}`);

        try {
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

          // Mark as known immediately
          await window.electronAPI.database.markWordKnown(wordId, true);
          console.log('Known word processed:', word.word);
          processedKnown++;
        } catch (wordError) {
          console.error(`Failed to process known word ${word.word}:`, wordError);
          failedWords.push(word.word);
        }
      }

      // Store selected words in database and enqueue jobs for asynchronous processing
      let queuedCount = 0;

      for (let i = 0; i < selectedWords.length; i++) {
        const word = selectedWords[i];
        console.log(`Processing word ${i + 1}/${selectedWords.length}: ${word.word}`);

        try {
          // Generate audio for the word
          console.log('Generating audio for word:', word.word);
          const wordAudioPath = await window.electronAPI.audio.generateAudio(
            word.word,
            this.language
          );
          console.log('Word audio generated:', wordAudioPath);

          // Insert word into database
          console.log('Inserting word into database:', word.word);
          const wordId = await window.electronAPI.database.insertWord({
            word: word.word,
            language: this.language,
            translation: word.translation,
            audioPath: wordAudioPath
          });
          console.log('Word inserted with ID:', wordId);
          await window.electronAPI.jobs.enqueueWordGeneration(wordId, {
            language: this.language,
            topic: this.topic,
            desiredSentenceCount: 3
          });
          queuedCount++;
          console.log('Enqueued word for asynchronous processing:', word.word);
        } catch (wordError) {
          console.error(`Failed to process word ${word.word}:`, wordError);
          failedWords.push(word.word);
        }
      }

      // Update session with topic
      if (this.topic) {
        sessionManager.updateSelectedTopic(this.topic);
      }

      if (queuedCount === 0 && processedKnown === 0) {
        throw new Error(failedWords.length ? `Failed to process: ${failedWords.join(', ')}` : 'No words were processed. Please try again.');
      }

      const messageParts: string[] = [];
      if (queuedCount > 0) {
        messageParts.push(`${queuedCount} ${queuedCount === 1 ? 'word' : 'words'} queued for review`);
      }
      if (processedKnown > 0) {
        messageParts.push(`${processedKnown} ${processedKnown === 1 ? 'word' : 'words'} saved as known`);
      }
      this.statusMessage = `${messageParts.join(' • ')}${queuedCount > 0 ? '. Sentences will appear in Review soon.' : '.'}`;

      if (failedWords.length > 0) {
        this.error = `Unable to process: ${failedWords.join(', ')}`;
      }

      if (queuedCount > 0) {
        // Small delay to ensure database operations are fully committed
        await new Promise(resolve => setTimeout(resolve, 100));
        router.goToLearning();
      } else {
        router.goToTopicSelection();
      }
    } catch (error) {
      console.error('Failed to process selected words:', error);
      this.error = error instanceof Error ? error.message : 'Failed to process selected words. Please try again.';
    } finally {
      this.isProcessing = false;
    }
  }

  render() {
    if (this.generatedWords.length === 0) {
      return html`
        <div class="word-selector-container">
          <div class="empty-state">
            <h3>No words generated</h3>
            <p>Please generate words again from the topics view.</p>
          </div>
        </div>
      `;
    }

    const selectedCount = this.selectableWords.filter(w => w.selected && !w.markedAsKnown).length;
    const knownCount = this.selectableWords.filter(w => w.markedAsKnown).length;
    const learnButtonLabel = selectedCount > 0
      ? `Learn (${selectedCount} ${selectedCount === 1 ? 'word' : 'words'})`
      : knownCount > 0
        ? `Save (${knownCount} known)`
        : 'Start Learning';

    return html`
      <div class="word-selector-container">
        <div class="header-section">
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
            ${selectedCount} selected • ${knownCount} marked as known • ${this.selectableWords.length - selectedCount - knownCount} unselected
          </div>
        </div>

        <div class="action-section">
          ${this.isProcessing ? html`
            <div class="loading">
              <div class="spinner"></div>
              Processing selected words...
            </div>
          ` : html`
            <div class="primary-actions">
              <button
                class="btn btn-primary start-btn"
                @click=${this.handleStartLearning}
                ?disabled=${selectedCount === 0 && knownCount === 0}
              >
                ${learnButtonLabel}
              </button>
              <button class="btn btn-small btn-secondary" @click=${this.selectAll}>
                Select All
              </button>
              <button class="btn btn-small btn-secondary" @click=${this.selectNone}>
                Select None
              </button>
            </div>
          `}
        </div>

        <div class="word-list">
          ${this.selectableWords.map((word, index) => html`
            <div 
              class="word-item ${word.selected ? 'selected' : ''} ${word.markedAsKnown ? 'known' : ''}"
              @click=${() => this.toggleWordSelection(index)}
            >
              <div class="word-actions">
                ${word.frequencyTier ? html`
                  <span class="frequency-tier">${word.frequencyTier}</span>
                ` : ''}
                ${word.markedAsKnown ? html`
                  <button
                    class="undo-btn"
                    @click=${(e: Event) => this.markWordAsKnown(index, e)}
                    title="Undo mark as known"
                  >
                    Undo
                  </button>
                ` : html`

                  <button
                    class="known-btn"
                    @click=${(e: Event) => this.markWordAsKnown(index, e)}
                    title="Mark as known"
                  >
                    Mark as known
                  </button>
                `}
              </div>
              <div class="word-content">
                <h4 class="word-foreign">${word.word}</h4>
                •
                <p class="word-translation">${word.translation}</p>
              </div>
            </div>
          `)}
        </div>

        ${this.error ? html`
          <div class="error-message">
            ${this.error}
          </div>
        ` : ''}

        ${this.statusMessage ? html`
          <div class="success-message">
            ${this.statusMessage}
          </div>
        ` : ''}
      </div>
    `;
  }
}
