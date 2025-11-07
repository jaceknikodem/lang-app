/**
 * Word selection component for choosing specific vocabulary to study
 */

import { LitElement, html, css } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import { router } from '../utils/router.js';
import { sessionManager } from '../utils/session-manager.js';
import { useKeyboardBindings, CommonKeys } from '../utils/keyboard-manager.js';
import {
  processSelectedWords,
  processKnownWords,
  setupWordProcessingSession,
} from '../utils/word-processor.js';
import { getErrorMessage } from '../../shared/utils/error.js';
import { GeneratedWord, Word } from '../../shared/types/core.js';

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

  @state()
  private wordsProcessed = false; // Track if words have been processed

  @state()
  private queuedWordIds: number[] = []; // Track wordIds of queued words

  private keyboardUnsubscribe?: () => void;
  private autoNavigateTimeout?: number;

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        max-width: 1000px;
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
        grid-template-columns: repeat(auto-fill, minmax(450px, 1fr));
        gap: var(--spacing-md);
      }

      .word-list.processed {
        grid-template-columns: repeat(2, 1fr);
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

      .word-item.disabled {
        cursor: default;
        pointer-events: none;
        opacity: 0.8;
      }

      .word-item.disabled:hover {
        border-color: var(--border-color);
        box-shadow: none;
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
        margin-right: calc(var(--spacing-lg) + 120px);
        display: flex;
        align-items: baseline;
        gap: var(--spacing-sm);
        flex-wrap: wrap;
      }

      .word-item.disabled .word-content {
        margin-right: var(--spacing-sm);
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
        color: var(--text-primary);
        background: var(--background-secondary);
        padding: var(--spacing-md);
        border-radius: var(--border-radius);
        border: 1px solid var(--border-color);
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
    `,
  ];

  connectedCallback() {
    super.connectedCallback();
    this.initializeWords();
    this.setupKeyboardBindings();
    // Listen for language changes
    window.addEventListener('language-changed', this.handleExternalLanguageChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.keyboardUnsubscribe) {
      this.keyboardUnsubscribe();
    }
    if (this.autoNavigateTimeout !== undefined) {
      clearTimeout(this.autoNavigateTimeout);
    }
    window.removeEventListener('language-changed', this.handleExternalLanguageChange);
  }

  private initializeWords() {
    // Convert generated words to selectable format
    this.selectableWords = this.generatedWords.map((word) => ({
      ...word,
      selected: false, // Deselect all words by default
      markedAsKnown: false,
    }));
  }

  private handleExternalLanguageChange = async (event: Event) => {
    const detail = (event as CustomEvent<{ language?: string }>).detail;
    const newLanguage = detail?.language;

    if (!newLanguage || newLanguage === this.language) {
      return;
    }

    // Update session manager with new language to ensure it uses correct language's session
    sessionManager.setActiveLanguage(newLanguage);

    // When language changes in word-selection mode, navigate back to topic-selection
    // since the generated words are for the old language
    router.goToTopicSelection();
  };

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

  private toggleSelectAllNone() {
    const selectedCount = this.selectableWords.filter((w) => w.selected && !w.markedAsKnown).length;
    const availableCount = this.selectableWords.filter((w) => !w.markedAsKnown).length;
    const allSelected = availableCount > 0 && selectedCount === availableCount;

    if (allSelected) {
      // Deselect all
      this.selectableWords.forEach((word) => {
        word.selected = false;
      });
    } else {
      // Select all
      this.selectableWords.forEach((word) => {
        if (!word.markedAsKnown) {
          word.selected = true;
        }
      });
    }
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

          // If words are already processed, go to review
          if (this.wordsProcessed) {
            return this.handleGoToReview();
          }

          const hasSelection =
            this.getSelectedWords().length > 0 || this.getKnownWords().length > 0;
          if (!hasSelection) {
            return;
          }

          return this.handleStartLearning();
        },
        context: 'word-selection',
        description: 'Start learning with selected words / Go to review',
      },
    ];

    this.keyboardUnsubscribe = useKeyboardBindings(bindings);
  }

  private getSelectedWords(): GeneratedWord[] {
    return this.selectableWords
      .filter((word) => word.selected && !word.markedAsKnown)
      .map(({ selected, markedAsKnown, ...word }) => word);
  }

  private getKnownWords(): GeneratedWord[] {
    return this.selectableWords
      .filter((word) => word.markedAsKnown)
      .map(({ selected, markedAsKnown, ...word }) => word);
  }

  private async handleGoToReview() {
    // Clear auto-navigate timeout if it exists
    if (this.autoNavigateTimeout !== undefined) {
      clearTimeout(this.autoNavigateTimeout);
      this.autoNavigateTimeout = undefined;
    }

    // Start a learning session with the queued words that are ready
    // This ensures learning-mode can find the words
    if (this.queuedWordIds.length > 0) {
      try {
        // Load word objects for words that are ready (have sentences)
        const readyWords: Word[] = [];
        for (const wordId of this.queuedWordIds) {
          try {
            const word = await window.electronAPI.database.getWordById(wordId);
            if (word) {
              const sentences = await window.electronAPI.database.getSentencesByWord(wordId);
              if (sentences && sentences.length > 0) {
                readyWords.push(word);
              }
            }
          } catch (error) {
            console.warn(`Failed to check word ${wordId}:`, error);
          }
        }

        if (readyWords.length > 0) {
          // Start a new learning session with the ready words
          const wordIds = readyWords.map((w) => w.id);
          sessionManager.startNewLearningSession(wordIds, Math.min(20, wordIds.length));
          console.log(`Started learning session with ${readyWords.length} ready words`);
        }
      } catch (error) {
        console.error('Failed to start learning session:', error);
      }
    }

    router.goToLearning();
    window.dispatchEvent(new CustomEvent('autopilot-check-trigger'));
  }

  /**
   * Poll until the first word in the queue has sentences ready
   * Returns true if first word is ready, false if timeout is reached
   */
  private async waitForFirstWordReady(
    wordIds: number[],
    timeoutMs: number = 60000
  ): Promise<boolean> {
    if (wordIds.length === 0) {
      return false;
    }

    const startTime = Date.now();
    const pollIntervalMs = 1000; // Poll every 1 second
    let wordIndex = 0; // Track which word we're checking

    while (Date.now() - startTime < timeoutMs) {
      // Check the current word
      if (wordIndex >= wordIds.length) {
        return false; // All words checked and none ready
      }

      const currentWordId = wordIds[wordIndex];

      try {
        // Get word processing status
        const processingInfo = await window.electronAPI.jobs.getWordStatus(currentWordId);

        if (processingInfo && processingInfo.processingStatus === 'ready') {
          // Word is ready, check if it has sentences
          const sentences = await window.electronAPI.database.getSentencesByWord(currentWordId);
          if (sentences && sentences.length > 0) {
            console.log(
              `First word (ID: ${currentWordId}) is ready with ${sentences.length} sentences`
            );
            return true;
          }
        } else if (processingInfo && processingInfo.processingStatus === 'failed') {
          // Word failed, check next word
          console.warn(`Word ${currentWordId} failed processing, checking next word`);
          wordIndex++;
          continue;
        }
      } catch (error) {
        console.warn('Error checking word status:', error);
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    console.warn('Timeout waiting for first word to be ready');
    return false;
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
      console.log(
        'Processing',
        selectedWords.length,
        'selected words and',
        knownWords.length,
        'known words...'
      );

      // Set up processing session (language and topic)
      await setupWordProcessingSession(this.language, this.topic);

      // Dispatch language changed event for UI updates
      this.dispatchEvent(
        new CustomEvent('language-changed', {
          detail: { language: this.language },
          bubbles: true,
          composed: true,
        })
      );

      // Process known words first (simpler - no sentences needed)
      const knownResult = await processKnownWords(knownWords, {
        language: this.language,
      });

      // Process selected words (insert and enqueue for generation)
      const selectedResult = await processSelectedWords(selectedWords, {
        language: this.language,
        topic: this.topic,
        desiredSentenceCount: 3,
      });

      const queuedCount = selectedResult.queuedCount;
      const processedKnown = knownResult.processedKnown;
      const failedWords = [...selectedResult.failedWords, ...knownResult.failedWords];
      this.queuedWordIds = selectedResult.queuedWordIds;

      // Track ignored words (words shown but not selected or marked as known)
      const selectedWordTexts = new Set(selectedWords.map((w) => w.word.toLowerCase()));
      const knownWordTexts = new Set(knownWords.map((w) => w.word.toLowerCase()));
      const ignoredWords = this.generatedWords.filter(
        (word) =>
          !selectedWordTexts.has(word.word.toLowerCase()) &&
          !knownWordTexts.has(word.word.toLowerCase())
      );

      // Record ignored words (batch insert)
      if (ignoredWords.length > 0) {
        try {
          // Get current session ID if available (optional)
          let sessionId: number | undefined;
          // Note: session tracking would need to be implemented separately if needed

          const ignoredWordData = ignoredWords.map((word) => ({
            word: word.word,
            language: this.language,
            topic: this.topic,
            translation: word.translation,
            sessionId,
            frequencyPosition: word.frequencyPosition,
          }));

          await window.electronAPI.tracking.recordNeglectedWords(ignoredWordData);
        } catch (error) {
          console.warn('Failed to record neglected words:', error);
          // Don't block the flow if tracking fails
        }
      }

      if (queuedCount === 0 && processedKnown === 0) {
        throw new Error(
          failedWords.length
            ? `Failed to process: ${failedWords.join(', ')}`
            : 'No words were processed. Please try again.'
        );
      }

      const messageParts: string[] = [];
      if (queuedCount > 0) {
        messageParts.push(
          `${queuedCount} ${queuedCount === 1 ? 'word' : 'words'} queued for review`
        );
      }
      if (processedKnown > 0) {
        messageParts.push(
          `${processedKnown} ${processedKnown === 1 ? 'word' : 'words'} saved as known`
        );
      }
      this.statusMessage = `${messageParts.join(' • ')}${queuedCount > 0 ? '. Sentences will appear in Review soon.' : '.'}`;

      if (failedWords.length > 0) {
        this.error = `Unable to process: ${failedWords.join(', ')}`;
      }

      // Mark words as processed and show success state
      if (queuedCount > 0 || processedKnown > 0) {
        this.wordsProcessed = true;
        window.dispatchEvent(new CustomEvent('autopilot-check-trigger'));

        // Dispatch event to update word stats in top panel
        window.dispatchEvent(
          new CustomEvent('words-updated', {
            bubbles: true,
            composed: true,
          })
        );

        // Auto-navigate to Review once first word is ready
        if (queuedCount > 0 && this.queuedWordIds.length > 0) {
          // Wait for first word to be ready (non-blocking)
          void this.waitForFirstWordReady([...this.queuedWordIds]).then((ready) => {
            if (ready) {
              this.handleGoToReview();
            }
          });
        }
      }

      if (queuedCount === 0 && processedKnown > 0) {
        // Only known words, no words queued - go back to topic selection
        router.goToTopicSelection();
      }
      // If words are queued, don't auto-navigate - user will click button
    } catch (error) {
      console.error('Failed to process selected words:', error);
      this.error = getErrorMessage(error, 'Failed to process selected words. Please try again.');
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

    const selectedCount = this.selectableWords.filter((w) => w.selected && !w.markedAsKnown).length;
    const knownCount = this.selectableWords.filter((w) => w.markedAsKnown).length;
    const learnButtonLabel =
      selectedCount > 0
        ? `Learn (${selectedCount} ${selectedCount === 1 ? 'word' : 'words'})`
        : knownCount > 0
          ? `Save (${knownCount} known)`
          : 'Start Learning';

    return html`
      <div class="word-selector-container">
        ${!this.wordsProcessed
          ? html`
              ${this.topic
                ? html`
                    <div class="topic-info">
                      <p class="topic-label">Topic</p>
                      <p class="topic-name">${this.topic}</p>
                    </div>
                  `
                : ''}

              <div class="selection-controls">
                <div class="selection-info">
                  ${selectedCount} selected • ${knownCount} marked as known •
                  ${this.selectableWords.length - selectedCount - knownCount} unselected
                </div>
              </div>

              <div class="action-section">
                ${this.isProcessing
                  ? html`
                      <div class="loading">
                        <div class="spinner"></div>
                        Processing selected words...
                      </div>
                    `
                  : html`
                      <div class="primary-actions">
                        <button
                          class="btn btn-primary start-btn"
                          @click=${this.handleStartLearning}
                          ?disabled=${selectedCount === 0 && knownCount === 0}
                        >
                          ${learnButtonLabel}
                        </button>
                        <button
                          class="btn btn-small btn-secondary"
                          @click=${this.toggleSelectAllNone}
                        >
                          ${(() => {
                            const availableCount = this.selectableWords.filter(
                              (w) => !w.markedAsKnown
                            ).length;
                            const allSelected =
                              availableCount > 0 && selectedCount === availableCount;
                            return allSelected ? 'Select None' : 'Select All';
                          })()}
                        </button>
                      </div>
                    `}
              </div>
            `
          : ''}

        <div class="word-list ${this.wordsProcessed ? 'processed' : ''}">
          ${(this.wordsProcessed
            ? this.selectableWords.filter((w) => w.selected || w.markedAsKnown)
            : this.selectableWords
          ).map((word, index) => {
            // Find the original index in selectableWords array
            const originalIndex = this.selectableWords.findIndex(
              (w) => w.word === word.word && w.translation === word.translation
            );
            return html`
              <div
                class="word-item ${word.selected ? 'selected' : ''} ${word.markedAsKnown
                  ? 'known'
                  : ''} ${this.wordsProcessed ? 'disabled' : ''}"
                @click=${() => !this.wordsProcessed && this.toggleWordSelection(originalIndex)}
              >
                <div class="word-actions">
                  ${word.frequencyTier
                    ? html` <span class="frequency-tier">${word.frequencyTier}</span> `
                    : ''}
                  ${!this.wordsProcessed
                    ? html`
                        ${word.markedAsKnown
                          ? html`
                              <button
                                class="undo-btn"
                                @click=${(e: Event) => this.markWordAsKnown(originalIndex, e)}
                                title="Undo mark as known"
                              >
                                Undo
                              </button>
                            `
                          : html`
                              <button
                                class="known-btn"
                                @click=${(e: Event) => this.markWordAsKnown(originalIndex, e)}
                                title="Mark as known"
                              >
                                Mark as known
                              </button>
                            `}
                      `
                    : ''}
                </div>
                <div class="word-content">
                  <h4 class="word-foreign">${word.word}</h4>
                  ${!this.wordsProcessed ? html`•` : ''}
                  ${!this.wordsProcessed
                    ? html`<p class="word-translation">${word.translation}</p>`
                    : ''}
                </div>
              </div>
            `;
          })}
        </div>

        ${this.error ? html` <div class="error-message">${this.error}</div> ` : ''}
        ${this.statusMessage
          ? html`
              <div class="success-message">
                ${this.statusMessage}
                ${this.wordsProcessed && this.statusMessage.includes('queued for review')
                  ? html`
                      <div style="margin-top: var(--spacing-md);">
                        <p style="margin: 0; color: var(--text-secondary);">
                          You will be redirected when words are ready.
                        </p>
                      </div>
                    `
                  : ''}
              </div>
            `
          : ''}
      </div>
    `;
  }
}
