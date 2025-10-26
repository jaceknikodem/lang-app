/**
 * Sentence viewer component for learning mode
 */

import { LitElement, html, css } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import { Word, Sentence } from '../../shared/types/core.js';

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
        margin-bottom: var(--spacing-md);
        flex-wrap: wrap;
        gap: var(--spacing-sm);
      }

      .target-word-info {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .target-word {
        font-size: 18px;
        font-weight: 600;
        color: var(--primary-color);
      }

      .word-translation {
        font-size: 14px;
        color: var(--text-secondary);
        font-style: italic;
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
        font-size: 14px;
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
        margin-bottom: var(--spacing-lg);
      }

      .sentence-text {
        font-size: 20px;
        line-height: 1.6;
        margin-bottom: var(--spacing-md);
        color: var(--text-primary);
      }

      .sentence-translation {
        font-size: 16px;
        color: var(--text-secondary);
        font-style: italic;
        line-height: 1.5;
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
        margin-top: var(--spacing-lg);
        flex-wrap: wrap;
      }

      .word-action-btn {
        min-width: 120px;
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
          font-size: 18px;
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

  connectedCallback() {
    super.connectedCallback();
    this.parseSentence();
  }

  updated(changedProperties: Map<string, any>) {
    if (changedProperties.has('sentence') || changedProperties.has('allWords')) {
      this.parseSentence();
    }
  }

  private parseSentence() {
    if (!this.sentence?.sentence) {
      this.parsedWords = [];
      return;
    }

    // Simple word parsing - split by spaces and punctuation
    const words = this.sentence.sentence.split(/(\s+|[.,!?;:])/);
    
    this.parsedWords = words.map(text => {
      const cleanText = text.trim().toLowerCase().replace(/[.,!?;:]/g, '');
      
      if (!cleanText || /^\s+$/.test(text)) {
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
    if (wordInfo.isTargetWord) {
      return `Target word: ${this.targetWord.translation}`;
    }

    const word = wordInfo.wordData;
    
    if (!word) {
      return 'Click to mark as known/ignored';
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

  render() {
    return html`
      <div class="sentence-container">
        <div class="sentence-header">
          <div class="target-word-info">
            <span class="target-word">${this.targetWord.word}</span>
            <span class="word-translation">${this.targetWord.translation}</span>
          </div>
          
          ${this.sentence.audioPath ? html`
            <button
              class="audio-button"
              @click=${this.handlePlayAudio}
              ?disabled=${this.isPlayingAudio}
            >
              <svg class="audio-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
              </svg>
              ${this.isPlayingAudio ? 'Playing...' : 'Play Audio'}
            </button>
          ` : ''}
        </div>

        <div class="sentence-content">
          <div class="sentence-text">
            ${this.parsedWords.map(wordInfo => html`
              <span
                class="word-in-sentence ${this.getWordClass(wordInfo)}"
                @click=${() => this.handleWordClick(wordInfo)}
                title=${this.getWordTooltip(wordInfo)}
              >
                ${wordInfo.text}
                <div class="tooltip">${this.getWordTooltip(wordInfo)}</div>
              </span>
            `)}
          </div>
          
          <div class="sentence-translation">
            ${this.sentence.translation}
          </div>
        </div>

        <div class="word-actions">
          <button
            class="btn btn-success word-action-btn"
            @click=${this.handleMarkKnown}
            ?disabled=${this.targetWord.known}
          >
            ${this.targetWord.known ? 'Already Known' : 'Mark as Known'}
          </button>
          
          <button
            class="btn btn-warning word-action-btn"
            @click=${this.handleMarkIgnored}
            ?disabled=${this.targetWord.ignored}
          >
            ${this.targetWord.ignored ? 'Already Ignored' : 'Mark as Ignored'}
          </button>
        </div>
      </div>
    `;
  }
}