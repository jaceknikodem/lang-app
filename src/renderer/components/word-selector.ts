/**
 * Word selection component for choosing specific vocabulary to study
 */

import { LitElement, html } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import { wordSelectorStyles } from './word-selector.styles.js';
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
import { logger } from '../utils/logger.js';
import { APP_CONFIG } from '../../shared/constants/index.js';
import { hiraganaToRomaji } from '../utils/hiragana-romaji.js';

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

  @state()
  private zipfFrequencies: Record<string, number> = {}; // word -> zipf frequency

  @state()
  private wordReadings: Record<string, string> = {}; // word -> hiragana reading (Japanese only)

  private wordAudioData: Map<string, ArrayBuffer> = new Map(); // word text -> raw WAV bytes
  private keyboardUnsubscribe?: () => void;
  private autoNavigateTimeout?: number;

  static styles = [sharedStyles, wordSelectorStyles];

  connectedCallback() {
    super.connectedCallback();
    this.initializeWords();
    this.setupKeyboardBindings();
    // Listen for language changes
    window.addEventListener('language-changed', this.handleExternalLanguageChange);
  }

  updated(changedProperties: Map<string, any>) {
    super.updated?.(changedProperties);
    if (changedProperties.has('topic')) {
      console.log('[WordSelector] Topic property updated:', this.topic);
      console.log('[WordSelector] Topic type:', typeof this.topic);
    }
    if (changedProperties.has('generatedWords')) {
      this.initializeWords();
      this.fetchZipfFrequencies();
      this.fetchWordReadings();
      void this.prefetchWordAudio();
    }
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
    this.wordAudioData.clear();
  }

  private initializeWords() {
    // Convert generated words to selectable format
    this.selectableWords = this.generatedWords.map((word) => ({
      ...word,
      selected: false, // Deselect all words by default
      markedAsKnown: false,
      zipfFrequency: this.zipfFrequencies[word.word] || word.zipfFrequency,
    }));
  }

  private async fetchZipfFrequencies() {
    if (this.generatedWords.length === 0) {
      return;
    }

    try {
      const words = this.generatedWords.map((w) => w.word);
      const frequencies = await window.electronAPI.lemmatization.getWordFrequencies(
        words,
        this.language
      );
      this.zipfFrequencies = frequencies;
      // Update selectableWords with zipf frequencies
      this.selectableWords = this.selectableWords.map((word) => ({
        ...word,
        zipfFrequency: this.zipfFrequencies[word.word] || word.zipfFrequency,
      }));
      this.requestUpdate();
    } catch (error) {
      // Gracefully degrade - don't show zipf, but don't break the UI
      console.warn('[WordSelector] Failed to fetch zipf frequencies:', error);
    }
  }

  private async fetchWordReadings() {
    const lang = this.language.toLowerCase();
    if (lang !== 'japanese' && lang !== 'ja') return;
    if (this.generatedWords.length === 0) return;

    try {
      const words = this.generatedWords.map((w) => w.word);
      const readings = await window.electronAPI.japaneseTokenization.getWordReadings(words);
      this.wordReadings = readings;
    } catch (error) {
      console.warn('[WordSelector] Failed to fetch Japanese word readings:', error);
    }
  }

  private async prefetchWordAudio() {
    if (this.generatedWords.length === 0) return;
    try {
      const items = this.generatedWords.map((w) => ({ text: w.word, language: this.language }));
      const results = await window.electronAPI.audio.generateTextAudioRaw(items);
      for (const result of results) {
        if (result.audioData) {
          this.wordAudioData.set(result.text, result.audioData);
        }
      }
    } catch (error) {
      console.warn('[WordSelector] Failed to prefetch word audio:', error);
    }
  }

  private playWordAudio(word: string) {
    const audioData = this.wordAudioData.get(word);
    if (!audioData) return;

    const blob = new Blob([audioData], { type: 'audio/wav' });
    const blobUrl = URL.createObjectURL(blob);
    const audio = new Audio(blobUrl);
    audio.addEventListener('ended', () => URL.revokeObjectURL(blobUrl));
    audio.play().catch(() => URL.revokeObjectURL(blobUrl));
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
      if (word.selected) {
        this.playWordAudio(word.word);
      }
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
      .map(({ selected: _selected, markedAsKnown: _markedAsKnown, ...word }) => word);
  }

  private getKnownWords(): GeneratedWord[] {
    return this.selectableWords
      .filter((word) => word.markedAsKnown)
      .map(({ selected: _selected, markedAsKnown: _markedAsKnown, ...word }) => word);
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
            logger.warn({ error, wordId }, `Failed to check word ${wordId}`);
          }
        }

        if (readyWords.length > 0) {
          // Start a new learning session with the ready words
          const wordIds = readyWords.map((w) => w.id);
          sessionManager.startNewLearningSession(
            wordIds,
            Math.min(APP_CONFIG.MAX_LEARNING_WORDS, wordIds.length)
          );
          logger.info(
            { readyWordsCount: readyWords.length },
            `Started learning session with ${readyWords.length} ready words`
          );
        }
      } catch (error) {
        logger.error({ error }, 'Failed to start learning session');
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
          logger.warn(
            { wordId: currentWordId },
            `Word ${currentWordId} failed processing, checking next word`
          );
          wordIndex++;
          continue;
        }
      } catch (error) {
        logger.warn({ error }, 'Error checking word status');
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    logger.warn('Timeout waiting for first word to be ready');
    return false;
  }

  private async handleStartLearning() {
    const selectedWords = this.getSelectedWords();
    const knownWords = this.getKnownWords();

    if (selectedWords.length === 0 && knownWords.length === 0) {
      this.error = 'Please select at least one word to study or mark some as known.';
      return;
    }

    if (selectedWords.length > APP_CONFIG.MAX_LEARNING_WORDS) {
      this.error = `Please select no more than ${APP_CONFIG.MAX_LEARNING_WORDS} words for optimal learning.`;
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

      // Get topic from property or route data as fallback
      const routeData = router.getRouteData();
      const topic = this.topic || routeData?.topic;
      console.log('[WordSelector] Topic value (this.topic):', this.topic);
      console.log('[WordSelector] Topic from route data:', routeData?.topic);
      console.log('[WordSelector] Using topic:', topic);
      console.log('[WordSelector] Topic type:', typeof topic);

      // Set up processing session (language and topic)
      await setupWordProcessingSession(this.language, topic);

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
        addedVia: 'manual',
      });

      // Process selected words (insert and enqueue for generation)
      const selectedResult = await processSelectedWords(selectedWords, {
        language: this.language,
        topic: topic, // Use the topic variable instead of this.topic
        desiredSentenceCount: 3,
        addedVia: 'manual',
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
          logger.warn({ error }, 'Failed to record neglected words');
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
      logger.error({ error }, 'Failed to process selected words');
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
          ).map((word, _index) => {
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
                  ${word.zipfFrequency && word.zipfFrequency > 0
                    ? html`
                        <span
                          class="frequency-tier"
                          title="Zipf frequency: ${Math.round(
                            word.zipfFrequency
                          )}. Higher values (1-7) indicate more common words. A value of 6 means the word appears once per thousand words, while 3 means once per million."
                        >
                          ${Math.round(word.zipfFrequency)}
                        </span>
                      `
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
                  <h4 class="word-foreign">
                    ${word.word}
                    ${this.wordReadings[word.word]
                      ? html`<div class="word-reading-tooltip">
                          <span class="tooltip-hiragana">${this.wordReadings[word.word]}</span>
                          <span class="tooltip-romaji"
                            >${hiraganaToRomaji(this.wordReadings[word.word])}</span
                          >
                        </div>`
                      : ''}
                  </h4>
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
