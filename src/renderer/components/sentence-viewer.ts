/**
 * Sentence viewer component for learning mode
 */

import { LitElement, html, css } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import { Word, Sentence } from '../../shared/types/core.js';
import { keyboardManager, useKeyboardBindings, GlobalShortcuts, CommonKeys } from '../utils/keyboard-manager.js';

interface WordInSentence {
  text: string;
  isTargetWord: boolean;
  wordData?: Word;
}

@customElement('sentence-viewer')
export class SentenceViewer extends LitElement {
  @property({ type: Object })
  sentence!: Sentence;

  @property({ type: Object })
  targetWord!: Word;

  @property({ type: Array })
  allWords: Word[] = [];

  @state()
  private isPlayingAudio = false;

  @state()
  private parsedWords: WordInSentence[] = [];

  @state()
  private autoplayEnabled = false;

  private keyboardUnsubscribe?: () => void;

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
      }

      .sentence-container {
        background: var(--background-primary);
        border-radius: var(--border-radius);
        padding: var(--spacing-lg);
        box-shadow: var(--shadow-light);
        border: 1px solid var(--border-color);
      }

      .sentence-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--spacing-sm);
        flex-wrap: wrap;
        gap: var(--spacing-sm);
      }

      .target-word-info {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .target-word {
        font-size: 16px;
        font-weight: 700;
        color: var(--primary-color);
      }

      .word-separator {
        font-size: 16px;
        font-weight: 700;
        color: var(--text-primary);
        margin: 0 var(--spacing-sm);
      }

      .word-translation {
        font-size: 16px;
        color: var(--text-primary);
        font-weight: 400;
      }

      .audio-button {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--primary-color);
        color: white;
        border: none;
        border-radius: var(--border-radius-small);
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s ease;
      }

      .audio-button:hover:not(:disabled) {
        background: var(--primary-hover);
      }

      .audio-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .audio-icon {
        width: 16px;
        height: 16px;
      }

      .sentence-content {
        margin-bottom: var(--spacing-md);
      }

      .context-section {
        margin-bottom: var(--spacing-sm);
        padding: var(--spacing-md);
        background: var(--background-secondary);
        border-radius: var(--border-radius-small);
        border-left: 2px solid var(--primary-color);
      }

      .context-label {
        font-size: 10px;
        font-weight: 600;
        color: var(--primary-color);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: var(--spacing-xs);
      }

      .context-text {
        font-size: 14px;
        line-height: 1.4;
        color: var(--text-primary);
        margin-bottom: var(--spacing-xs);
      }

      .context-translation {
        font-size: 12px;
        color: var(--text-secondary);
        font-style: italic;
      }

      .sentence-text {
        font-size: 18px;
        line-height: 1.5;
        margin-bottom: var(--spacing-sm);
        color: var(--text-primary);
      }

      .sentence-translation {
        font-size: 14px;
        color: var(--text-secondary);
        font-style: italic;
        line-height: 1.4;
      }

      .word-in-sentence {
        cursor: pointer;
        padding: 2px 4px;
        border-radius: 3px;
        transition: all 0.2s ease;
        position: relative;
      }

      .word-in-sentence:hover {
        transform: translateY(-1px);
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }

      /* Word strength and status colors */
      .word-neutral {
        background-color: transparent;
      }

      .word-target {
        background-color: var(--primary-light);
        border: 2px solid var(--primary-color);
        font-weight: 600;
      }

      .word-known {
        background-color: #c8e6c9;
        color: #2e7d32;
      }

      .word-ignored {
        background-color: #f5f5f5;
        color: #999;
        text-decoration: line-through;
      }

      .word-strength-0 { background-color: #ffebee; } /* Very weak - light red */
      .word-strength-1 { background-color: #fff3e0; } /* Weak - light orange */
      .word-strength-2 { background-color: #fffde7; } /* Learning - light yellow */
      .word-strength-3 { background-color: #f3e5f5; } /* Good - light purple */
      .word-strength-4 { background-color: #e8f5e8; } /* Strong - light green */

      .word-actions {
        display: flex;
        justify-content: center;
        gap: var(--spacing-md);
        margin-top: var(--spacing-md);
        flex-wrap: wrap;
      }

      .word-action-btn {
        min-width: 100px;
      }

      .tooltip {
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        background: var(--text-primary);
        color: white;
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: var(--border-radius-small);
        font-size: 12px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease;
        z-index: 10;
      }

      .word-in-sentence:hover .tooltip {
        opacity: 1;
      }

      .tooltip::after {
        content: '';
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 4px solid transparent;
        border-top-color: var(--text-primary);
      }

      @media (max-width: 768px) {
        .sentence-header {
          flex-direction: column;
          align-items: stretch;
        }

        .target-word-info {
          justify-content: center;
        }

        .sentence-text {
          font-size: 16px;
        }

        .word-actions {
          flex-direction: column;
        }

        .word-action-btn {
          width: 100%;
        }
      }
    `
  ];

  async connectedCallback() {
    super.connectedCallback();
    this.parseSentence();
    await this.loadAutoplaySettings();
    this.setupKeyboardBindings();
    
    // Trigger autoplay for the initial sentence if autoplay is enabled
    this.checkInitialAutoplay();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.keyboardUnsubscribe) {
      this.keyboardUnsubscribe();
    }
  }

  updated(changedProperties: Map<string, any>) {
    if (changedProperties.has('sentence') || changedProperties.has('allWords')) {
      this.parseSentence();
    }
    
    // Auto-play audio when sentence changes (if enabled)
    // This includes both when sentence changes AND when it's first set
    if (changedProperties.has('sentence') && this.autoplayEnabled && this.sentence?.audioPath) {
      console.log('Autoplay triggered - sentence changed or first set');
      // Handle auto-play asynchronously
      this.handleAutoPlay();
    }
  }

  private async loadAutoplaySettings() {
    try {
      const autoplaySetting = await window.electronAPI.database.getSetting('autoplay_audio');
      this.autoplayEnabled = autoplaySetting === 'true';
    } catch (error) {
      console.error('Failed to load autoplay setting:', error);
      this.autoplayEnabled = false;
    }
  }

  private checkInitialAutoplay() {
    // Trigger autoplay for the initial sentence if autoplay is enabled
    if (this.autoplayEnabled && this.sentence?.audioPath) {
      console.log('Initial autoplay triggered for first sentence');
      this.handleAutoPlay();
    }
  }

  private async handleAutoPlay() {
    try {
      console.log('Auto-play: Stopping previous audio...');
      // Stop any currently playing audio first
      await window.electronAPI.audio.stopAudio();
      console.log('Auto-play: Previous audio stopped, starting new audio...');
      
      // Small delay to ensure audio is stopped before starting new one
      setTimeout(() => {
        this.handlePlayAudio();
      }, 100);
    } catch (error) {
      console.warn('Failed to handle auto-play:', error);
    }
  }

  private parseSentence() {
    if (!this.sentence?.sentence) {
      this.parsedWords = [];
      return;
    }

    // Better word parsing - split by spaces and punctuation but handle them properly
    const parts = this.sentence.sentence.split(/(\s+|[.,!?;:])/);
    
    this.parsedWords = parts.map(text => {
      // If it's just whitespace, keep it as is for proper spacing
      if (/^\s+$/.test(text)) {
        return { text, isTargetWord: false };
      }
      
      // If it's punctuation, keep it as is
      if (/^[.,!?;:]+$/.test(text)) {
        return { text, isTargetWord: false };
      }
      
      // For actual words, clean them for comparison but keep original text for display
      const cleanText = text.trim().toLowerCase().replace(/[.,!?;:]/g, '');
      
      if (!cleanText) {
        return { text, isTargetWord: false };
      }

      // Check if this is the target word
      const isTargetWord = cleanText === this.targetWord.word.toLowerCase();
      
      // Find matching word in allWords
      const wordData = this.allWords.find(w => 
        w.word.toLowerCase() === cleanText
      );

      return {
        text,
        isTargetWord,
        wordData
      };
    });
  }

  private getWordClass(wordInfo: WordInSentence): string {
    // Don't style whitespace or punctuation
    if (/^\s+$/.test(wordInfo.text) || /^[.,!?;:]+$/.test(wordInfo.text)) {
      return '';
    }
    
    if (!wordInfo.wordData && !wordInfo.isTargetWord) {
      return 'word-neutral';
    }

    if (wordInfo.isTargetWord) {
      return 'word-target';
    }

    const word = wordInfo.wordData!;
    
    if (word.ignored) {
      return 'word-ignored';
    }
    
    if (word.known) {
      return 'word-known';
    }

    // Color based on strength (0-100 scale, map to 0-4 levels)
    const strengthLevel = Math.min(4, Math.floor(word.strength / 20));
    return `word-strength-${strengthLevel}`;
  }

  private getWordTooltip(wordInfo: WordInSentence): string {
    // No tooltip for whitespace or punctuation
    if (/^\s+$/.test(wordInfo.text) || /^[.,!?;:]+$/.test(wordInfo.text)) {
      return '';
    }
    
    if (wordInfo.isTargetWord) {
      return `Target word`;
    }

    const word = wordInfo.wordData;
    
    if (!word) {
      return '';
    }
    
    if (word.ignored) {
      return `Ignored: ${word.translation}`;
    }
    
    if (word.known) {
      return `Known: ${word.translation}`;
    }

    return `Learning (${word.strength}%): ${word.translation}`;
  }

  private async handleWordClick(wordInfo: WordInSentence) {
    // Don't handle clicks on whitespace or punctuation
    if (/^\s+$/.test(wordInfo.text) || /^[.,!?;:]+$/.test(wordInfo.text)) {
      return;
    }
    
    if (!wordInfo.wordData && !wordInfo.isTargetWord) {
      // This is a new word - we could add it to the database
      console.log('Clicked on unknown word:', wordInfo.text);
      return;
    }

    const word = wordInfo.isTargetWord ? this.targetWord : wordInfo.wordData!;
    
    // Emit event for parent to handle word status change
    this.dispatchEvent(new CustomEvent('word-clicked', {
      detail: { word, wordText: wordInfo.text.trim() },
      bubbles: true
    }));
  }

  private async handlePlayAudio() {
    if (this.isPlayingAudio || !this.sentence.audioPath) {
      return;
    }

    this.isPlayingAudio = true;

    try {
      // Stop any currently playing audio first
      await window.electronAPI.audio.stopAudio();
      
      // Play the new audio
      await window.electronAPI.audio.playAudio(this.sentence.audioPath);
    } catch (error) {
      console.error('Failed to play audio:', error);
    } finally {
      // Reset after a delay to prevent rapid clicking
      setTimeout(() => {
        this.isPlayingAudio = false;
      }, 500);
    }
  }

  private handleMarkKnown() {
    this.dispatchEvent(new CustomEvent('mark-word-known', {
      detail: { word: this.targetWord },
      bubbles: true
    }));
  }

  private handleMarkIgnored() {
    this.dispatchEvent(new CustomEvent('mark-word-ignored', {
      detail: { word: this.targetWord },
      bubbles: true
    }));
  }

  private setupKeyboardBindings() {
    const bindings = [
      // These bindings are context-specific to sentence viewer
      // They will only work when this component is active
      {
        ...GlobalShortcuts.PLAY_AUDIO,
        action: () => this.handlePlayAudio(),
        context: 'sentence-viewer',
        description: 'Play sentence audio'
      },
      {
        ...GlobalShortcuts.REPLAY_AUDIO,
        action: () => this.handlePlayAudio(),
        context: 'sentence-viewer',
        description: 'Replay sentence audio'
      },
      {
        ...GlobalShortcuts.MARK_KNOWN,
        action: () => this.handleMarkKnown(),
        context: 'sentence-viewer',
        description: 'Mark target word as known'
      },
      {
        ...GlobalShortcuts.MARK_IGNORED,
        action: () => this.handleMarkIgnored(),
        context: 'sentence-viewer',
        description: 'Mark target word as ignored'
      }
    ];

    this.keyboardUnsubscribe = useKeyboardBindings(bindings);
  }

  render() {
    return html`
      <div class="sentence-container">
        <div class="sentence-header">
          <div class="target-word-info">
            <span class="target-word">${this.targetWord.word}</span>
            <span class="word-separator">•</span>
            <span class="word-translation">${this.targetWord.translation}</span>
          </div>
          
          ${this.sentence.audioPath ? html`
            <button
              class="audio-button"
              @click=${this.handlePlayAudio}
              ?disabled=${this.isPlayingAudio}
              title="Play audio (Space)"
            >
              <svg class="audio-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
              </svg>
            </button>
          ` : ''}
        </div>

        <div class="sentence-content">
          ${this.sentence.contextBefore ? html`
            <div class="context-section">
              <div class="context-label">Context Before</div>
              <div class="context-text">${this.sentence.contextBefore}</div>
              <div class="context-translation">${this.sentence.contextBeforeTranslation}</div>
            </div>
          ` : ''}
          
          <div class="sentence-text">
            ${this.parsedWords.map(wordInfo => {
              // For whitespace and punctuation, render without word styling
              if (/^\s+$/.test(wordInfo.text) || /^[.,!?;:]+$/.test(wordInfo.text)) {
                return html`${wordInfo.text}`;
              }
              
              // For actual words, render with full styling
              return html`
                <span
                  class="word-in-sentence ${this.getWordClass(wordInfo)}"
                  @click=${() => this.handleWordClick(wordInfo)}
                  title=${this.getWordTooltip(wordInfo)}
                >
                  ${wordInfo.text}
                  ${this.getWordTooltip(wordInfo) ? html`<div class="tooltip">${this.getWordTooltip(wordInfo)}</div>` : ''}
                </span>
              `;
            })}
          </div>
          
          <div class="sentence-translation">
            ${this.sentence.translation}
          </div>
          
          ${this.sentence.contextAfter ? html`
            <div class="context-section">
              <div class="context-label">Context After</div>
              <div class="context-text">${this.sentence.contextAfter}</div>
              <div class="context-translation">${this.sentence.contextAfterTranslation}</div>
            </div>
          ` : ''}
        </div>

        <div class="word-actions">
          <button
            class="btn btn-success word-action-btn"
            @click=${this.handleMarkKnown}
            ?disabled=${this.targetWord.known}
          >
            ${this.targetWord.known ? 'Already Known' : 'Mark as Known'} 
            ${!this.targetWord.known ? html`<span class="keyboard-hint">(K)</span>` : ''}
          </button>
          
          <button
            class="btn btn-warning word-action-btn"
            @click=${this.handleMarkIgnored}
            ?disabled=${this.targetWord.ignored}
          >
            ${this.targetWord.ignored ? 'Already Ignored' : 'Mark as Ignored'}
            ${!this.targetWord.ignored ? html`<span class="keyboard-hint">(I)</span>` : ''}
          </button>
        </div>
      </div>
    `;
  }
}