/**
 * Learning mode component for sentence review and word interaction
 */

import { LitElement, html, css } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import { router } from '../utils/router.js';
import { sessionManager } from '../utils/session-manager.js';
import { Word, Sentence } from '../../shared/types/core.js';
import './sentence-viewer.js';
import './session-complete.js';
import type { SessionSummary } from './session-complete.js';

interface WordWithSentences extends Word {
  sentences: Sentence[];
}

@customElement('learning-mode')
export class LearningMode extends LitElement {

  @state()
  private wordsWithSentences: WordWithSentences[] = [];

  @state()
  private selectedWords: Word[] = [];

  @state()
  private currentWordIndex = 0;

  @state()
  private currentSentenceIndex = 0;

  @state()
  private isLoading = true;

  @state()
  private error = '';

  @state()
  private isProcessing = false;

  @state()
  private showCompletion = false;

  @state()
  private sessionSummary: SessionSummary | null = null;

  private sessionStartTime = Date.now();

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        max-width: 900px;
        margin: 0 auto;
      }

      .learning-container {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-lg);
      }

      .learning-header {
        text-align: center;
      }

      .learning-title {
        font-size: 28px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 var(--spacing-sm) 0;
      }

      .learning-subtitle {
        font-size: 16px;
        color: var(--text-secondary);
        margin: 0;
      }

      .progress-section {
        background: var(--background-secondary);
        padding: var(--spacing-md);
        border-radius: var(--border-radius);
        border: 1px solid var(--border-color);
      }

      .progress-info {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--spacing-sm);
        flex-wrap: wrap;
        gap: var(--spacing-sm);
      }

      .progress-text {
        font-size: 14px;
        color: var(--text-secondary);
      }

      .word-counter {
        font-weight: 600;
        color: var(--primary-color);
      }

      .sentence-counter {
        font-size: 12px;
        color: var(--text-tertiary);
      }

      .progress-bar {
        width: 100%;
        height: 8px;
        background: var(--border-color);
        border-radius: 4px;
        overflow: hidden;
      }

      .progress-fill {
        height: 100%;
        background: var(--primary-color);
        transition: width 0.3s ease;
      }

      .navigation-section {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--spacing-md);
        flex-wrap: wrap;
      }

      .nav-button {
        min-width: 100px;
      }

      .nav-info {
        display: flex;
        gap: var(--spacing-md);
        align-items: center;
      }

      .error-message {
        color: var(--error-color);
        background: #ffebee;
        padding: var(--spacing-md);
        border-radius: var(--border-radius);
        border: 1px solid #ffcdd2;
        text-align: center;
      }

      .loading-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-md);
        padding: var(--spacing-xl);
      }

      .empty-state {
        text-align: center;
        padding: var(--spacing-xl);
        color: var(--text-secondary);
      }

      .empty-state h3 {
        color: var(--text-primary);
        margin-bottom: var(--spacing-md);
      }

      .completion-state {
        text-align: center;
        padding: var(--spacing-xl);
        background: var(--success-color);
        color: white;
        border-radius: var(--border-radius);
      }

      .completion-state h3 {
        margin: 0 0 var(--spacing-md) 0;
        font-size: 24px;
      }

      .completion-actions {
        display: flex;
        justify-content: center;
        gap: var(--spacing-md);
        margin-top: var(--spacing-lg);
        flex-wrap: wrap;
      }

      @media (max-width: 768px) {
        .progress-info {
          flex-direction: column;
          align-items: stretch;
          text-align: center;
        }

        .navigation-section {
          flex-direction: column;
        }

        .nav-info {
          justify-content: center;
        }

        .completion-actions {
          flex-direction: column;
        }
      }
    `
  ];

  async connectedCallback() {
    super.connectedCallback();
    
    // Load words from database first
    await this.loadSelectedWords();
    
    // Load words and sentences before restoring session progress
    await this.loadWordsAndSentences();
    
    // Try to restore learning session from session manager (after words are loaded)
    this.restoreSessionProgress();
  }

  private async loadSelectedWords() {
    try {
      // Check if specific words were passed via router
      const routeData = router.getRouteData();
      if (routeData?.specificWords) {
        this.selectedWords = routeData.specificWords;
        console.log('Using specific words from router:', this.selectedWords.length);
        return;
      }

      // Get only words that have sentences available for learning
      this.selectedWords = await window.electronAPI.database.getWordsWithSentences(true, false);
      console.log('Loaded words with sentences for learning:', this.selectedWords.length);
    } catch (error) {
      console.error('Failed to load words:', error);
      this.error = 'Failed to load words from database.';
    }
  }

  private async loadWordsAndSentences() {
    if (!this.selectedWords.length) {
      this.error = 'No words available for learning. Please start a new learning session.';
      this.isLoading = false;
      return;
    }

    this.isLoading = true;
    this.error = '';

    try {
      const wordsWithSentences: WordWithSentences[] = [];

      for (const word of this.selectedWords) {
        // Get sentences for this word
        const sentences = await window.electronAPI.database.getSentencesByWord(word.id);

        if (sentences.length === 0) {
          console.warn(`No sentences found for word: ${word.word}`);
        }

        // Shuffle sentences for each word to avoid predictable order
        const shuffledSentences = this.shuffleArray(sentences);

        wordsWithSentences.push({
          ...word,
          sentences: shuffledSentences
        });
      }

      // Filter out words with no sentences and shuffle for varied learning experience
      const wordsWithValidSentences = wordsWithSentences.filter(w => w.sentences.length > 0);
      console.log(`Words with sentences: ${wordsWithValidSentences.length} out of ${wordsWithSentences.length} total words`);
      
      this.wordsWithSentences = this.shuffleArray(wordsWithValidSentences);

      if (this.wordsWithSentences.length === 0) {
        console.warn('No words have sentences available for learning');
        this.error = 'No sentences available for the selected words. Please generate new words or check if sentence generation completed successfully.';
      } else {
        console.log(`Ready to learn with ${this.wordsWithSentences.length} words`);
      }

    } catch (error) {
      console.error('Failed to load words and sentences:', error);
      this.error = 'Failed to load learning content. Please try again.';
    } finally {
      this.isLoading = false;
    }
  }

  private restoreSessionProgress() {
    // Restore learning progress from session if available
    const session = sessionManager.getCurrentSession();
    if (session.learningProgress) {
      this.currentWordIndex = Math.min(
        session.learningProgress.currentWordIndex,
        this.wordsWithSentences.length - 1
      );

      const currentWord = this.getCurrentWord();
      if (currentWord) {
        this.currentSentenceIndex = Math.min(
          session.learningProgress.currentSentenceIndex,
          currentWord.sentences.length - 1
        );
      }

      console.log('Restored learning progress:', this.currentWordIndex, this.currentSentenceIndex);
    }
  }

  private getCurrentWord(): WordWithSentences | null {
    return this.wordsWithSentences[this.currentWordIndex] || null;
  }

  private getCurrentSentence(): Sentence | null {
    const currentWord = this.getCurrentWord();
    return currentWord?.sentences[this.currentSentenceIndex] || null;
  }

  private getTotalSentences(): number {
    return this.wordsWithSentences.reduce((total, word) => total + word.sentences.length, 0);
  }

  private getCurrentSentenceGlobalIndex(): number {
    let index = 0;
    for (let i = 0; i < this.currentWordIndex; i++) {
      index += this.wordsWithSentences[i].sentences.length;
    }
    return index + this.currentSentenceIndex + 1;
  }

  private async handleWordStatusChange(word: Word, known: boolean) {
    this.isProcessing = true;

    try {
      if (known) {
        await window.electronAPI.database.markWordKnown(word.id, true);
        // Also update strength to maximum
        await window.electronAPI.database.updateWordStrength(word.id, 100);
      } else {
        await window.electronAPI.database.markWordIgnored(word.id, true);
      }

      // Update last studied timestamp
      await window.electronAPI.database.updateLastStudied(word.id);

      // Update local state
      const wordIndex = this.wordsWithSentences.findIndex(w => w.id === word.id);
      if (wordIndex !== -1) {
        this.wordsWithSentences[wordIndex] = {
          ...this.wordsWithSentences[wordIndex],
          known,
          ignored: !known,
          strength: known ? 100 : this.wordsWithSentences[wordIndex].strength
        };
        this.requestUpdate();
      }

    } catch (error) {
      console.error('Failed to update word status:', error);
      this.error = 'Failed to update word status. Please try again.';
    } finally {
      this.isProcessing = false;
    }
  }

  private handleWordClicked(event: CustomEvent) {
    const { word } = event.detail;
    console.log('Word clicked in sentence:', word);
    // Could show word details or allow status change
  }

  private handleMarkWordKnown(event: CustomEvent) {
    const { word } = event.detail;
    this.handleWordStatusChange(word, true);
  }

  private handleMarkWordIgnored(event: CustomEvent) {
    const { word } = event.detail;
    this.handleWordStatusChange(word, false);
  }

  private goToPreviousSentence() {
    if (this.currentSentenceIndex > 0) {
      this.currentSentenceIndex--;
    } else if (this.currentWordIndex > 0) {
      this.currentWordIndex--;
      const currentWord = this.getCurrentWord();
      this.currentSentenceIndex = currentWord ? currentWord.sentences.length - 1 : 0;
    }

    // Save progress to session
    this.saveProgressToSession();
  }

  private goToNextSentence() {
    const currentWord = this.getCurrentWord();
    if (!currentWord) return;

    if (this.currentSentenceIndex < currentWord.sentences.length - 1) {
      this.currentSentenceIndex++;
    } else if (this.currentWordIndex < this.wordsWithSentences.length - 1) {
      this.currentWordIndex++;
      this.currentSentenceIndex = 0;
    }

    // Save progress to session
    this.saveProgressToSession();
  }

  private saveProgressToSession() {
    sessionManager.updateLearningProgress(this.currentWordIndex, this.currentSentenceIndex);
  }

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  private isFirstSentence(): boolean {
    return this.currentWordIndex === 0 && this.currentSentenceIndex === 0;
  }

  private isLastSentence(): boolean {
    const currentWord = this.getCurrentWord();
    if (!currentWord) return true;

    return this.currentWordIndex === this.wordsWithSentences.length - 1 &&
      this.currentSentenceIndex === currentWord.sentences.length - 1;
  }

  private async handleFinishLearning() {
    console.log('handleFinishLearning called');

    // Record the learning session
    await this.recordLearningSession();

    // Show completion screen
    this.showSessionCompletion();

    console.log('showCompletion set to:', this.showCompletion);
  }

  private async recordLearningSession() {
    try {
      // Record study session in database
      await window.electronAPI.database.recordStudySession(this.selectedWords.length);

      // Clear session progress since we're completing
      sessionManager.clearSession();

    } catch (error) {
      console.error('Failed to record learning session:', error);
    }
  }

  private showSessionCompletion() {
    const timeSpent = Math.round((Date.now() - this.sessionStartTime) / (1000 * 60)); // minutes

    // Determine next recommendation based on word strengths
    let nextRecommendation: SessionSummary['nextRecommendation'] = 'take-quiz';

    const averageStrength = this.wordsWithSentences.reduce((sum, w) => sum + w.strength, 0) / this.wordsWithSentences.length;

    if (averageStrength < 50) {
      nextRecommendation = 'continue-learning';
    } else if (averageStrength >= 70) {
      nextRecommendation = 'new-topic';
    }

    this.sessionSummary = {
      type: 'learning',
      wordsStudied: this.selectedWords.length,
      timeSpent,
      completedWords: this.selectedWords,
      nextRecommendation
    };

    this.showCompletion = true;
  }

  private handleBackToSelection() {
    router.goToTopicSelection();
  }

  render() {
    if (this.isLoading) {
      return html`
        <div class="learning-container">
          <div class="loading-container">
            <div class="loading">
              <div class="spinner"></div>
              Loading learning content...
            </div>
          </div>
        </div>
      `;
    }

    if (this.error) {
      return html`
        <div class="learning-container">
          <div class="error-message">
            ${this.error}
          </div>
          <div style="text-align: center; margin-top: var(--spacing-lg);">
            <button class="btn btn-primary" @click=${this.handleBackToSelection}>
              Back to Selection
            </button>
          </div>
        </div>
      `;
    }

    if (this.wordsWithSentences.length === 0) {
      return html`
        <div class="learning-container">
          <div class="empty-state">
            <h3>No Learning Content Available</h3>
            <p>No sentences were found for the selected words.</p>
            <button class="btn btn-primary" @click=${this.handleBackToSelection}>
              Back to Selection
            </button>
          </div>
        </div>
      `;
    }

    // Check for completion first, regardless of current word/sentence state
    if (this.showCompletion && this.sessionSummary) {
      return html`
        <div class="learning-container">
          <session-complete .sessionSummary=${this.sessionSummary}></session-complete>
        </div>
      `;
    }

    const currentWord = this.getCurrentWord();
    const currentSentence = this.getCurrentSentence();
    const totalSentences = this.getTotalSentences();
    const currentSentenceNumber = this.getCurrentSentenceGlobalIndex();
    const progressPercent = (currentSentenceNumber / totalSentences) * 100;

    if (!currentWord || !currentSentence) {

      return html`
        <div class="learning-container">
          <div class="completion-state">
            <h3>🎉 Learning Session Complete!</h3>
            <p>You've reviewed all sentences for the selected words.</p>
            <div class="completion-actions">
              <button class="btn btn-primary btn-large" @click=${this.handleFinishLearning}>
                Finish Session
              </button>
              <button class="btn btn-secondary" @click=${this.handleBackToSelection}>
                Select New Words
              </button>
            </div>
          </div>
        </div>
      `;
    }

    return html`
      <div class="learning-container">
        <div class="learning-header">
          <h2 class="learning-title">Learning Mode</h2>
          <p class="learning-subtitle">
            Review sentences and mark words as known or ignored
          </p>
        </div>

        <div class="progress-section">
          <div class="progress-info">
            <div class="progress-text">
              <span class="word-counter">Word ${this.currentWordIndex + 1} of ${this.wordsWithSentences.length}</span>
              <span class="sentence-counter">
                (Sentence ${this.currentSentenceIndex + 1} of ${currentWord.sentences.length})
              </span>
            </div>
            <div class="progress-text">
              Overall: ${currentSentenceNumber} of ${totalSentences} sentences
            </div>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${progressPercent}%"></div>
          </div>
        </div>

        <sentence-viewer
          .sentence=${currentSentence}
          .targetWord=${currentWord}
          .allWords=${this.wordsWithSentences}
          @word-clicked=${this.handleWordClicked}
          @mark-word-known=${this.handleMarkWordKnown}
          @mark-word-ignored=${this.handleMarkWordIgnored}
        ></sentence-viewer>

        <div class="navigation-section">
          <button
            class="btn btn-secondary nav-button"
            @click=${this.goToPreviousSentence}
            ?disabled=${this.isFirstSentence() || this.isProcessing}
          >
            ← Previous
          </button>

          <div class="nav-info">
            <button class="btn btn-secondary" @click=${this.handleBackToSelection}>
              Back to Selection
            </button>
          </div>

          <button
            class="btn btn-primary nav-button"
            @click=${this.isLastSentence() ? this.handleFinishLearning : this.goToNextSentence}
            ?disabled=${this.isProcessing}
          >
            ${this.isLastSentence() ? 'Finish' : 'Next →'}
          </button>
        </div>
      </div>
    `;
  }
}