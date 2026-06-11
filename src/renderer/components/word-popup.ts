import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import type { Word } from '../../shared/types/core.js';
import type { TokenizedWord as WordInSentence } from '../utils/sentence-tokenizer.js';

/**
 * Floating action popup for a word in a sentence. Purely presentational:
 * it decides which buttons to show from the word's state and reports the user's
 * choice via events. All business logic (DB writes, sentence regeneration) stays
 * in the host, which owns `wordInfo`/visibility.
 *
 * Events (all bubbling + composed):
 * - `mark-known`      — "Mark as known"
 * - `ignore`          — "Ignore"
 * - `add-to-set`      — "Add to learning set"
 * - `explain-grammar` — "Explain grammar"
 */
@customElement('word-popup')
export class WordPopup extends LitElement {
  /** The word the popup is anchored to; `null` renders nothing. */
  @property({ attribute: false }) wordInfo: WordInSentence | null = null;

  /** Click position (viewport coords); the popup nudges itself on-screen. */
  @property({ attribute: false }) position: { x: number; y: number } | null = null;

  /** Current target word — used to resolve known/ignored state for the target. */
  @property({ attribute: false }) targetWord: Word | null = null;

  /** Disables action buttons while the host is mutating word state. */
  @property({ type: Boolean }) isProcessing = false;

  /** Reflects an in-flight grammar request (relabels the grammar button). */
  @property({ type: Boolean }) isFetchingGrammar = false;

  static styles = [
    sharedStyles,
    css`
      .word-popup {
        position: fixed;
        background: var(--background-primary);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        padding: var(--spacing-xs);
        z-index: 1000;
        min-width: 180px;
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .word-popup-button {
        padding: var(--spacing-sm) var(--spacing-md);
        border: none;
        border-radius: var(--border-radius-small);
        cursor: pointer;
        font-size: 14px;
        text-align: left;
        transition: all 0.2s ease;
        background: transparent;
        color: var(--text-primary);
      }

      .word-popup-button:hover:not(:disabled) {
        background: var(--background-secondary);
      }

      .word-popup-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .word-popup-button.ignore {
        color: #c62828;
      }

      .word-popup-button.ignore:hover:not(:disabled) {
        background: #ffebee;
      }

      .word-popup-button.known {
        color: #2e7d32;
      }

      .word-popup-button.known:hover:not(:disabled) {
        background: #e8f5e9;
      }

      .word-popup-button.add {
        color: var(--primary-color);
      }

      .word-popup-button.add:hover:not(:disabled) {
        background: var(--primary-light);
      }

      .word-popup-button.grammar {
        color: var(--primary-color);
      }

      .word-popup-button.grammar:hover:not(:disabled) {
        background: var(--primary-light);
      }

      .word-popup-divider {
        height: 1px;
        background: var(--border-color);
        margin: var(--spacing-xs) 0;
      }
    `,
  ];

  private emit(type: string): void {
    this.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true }));
  }

  /** Keep clicks inside the popup from bubbling out to the host's outside-click logic. */
  private stop(e: Event): void {
    e.stopPropagation();
  }

  /** Position the popup near the click, clamped to stay within the viewport. */
  private getPopupStyle(): string {
    if (!this.position) return '';

    // Position popup near the click, but ensure it stays on screen
    const padding = 10;
    const popupWidth = 180;
    const popupHeight = 150; // Approximate height
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = this.position.x;
    let top = this.position.y;

    // Adjust horizontal position if popup would overflow
    if (left + popupWidth + padding > viewportWidth) {
      left = viewportWidth - popupWidth - padding;
    }
    if (left < padding) {
      left = padding;
    }

    // Adjust vertical position if popup would overflow
    if (top + popupHeight + padding > viewportHeight) {
      top = this.position.y - popupHeight - 5;
    }
    if (top < padding) {
      top = padding;
    }

    return `left: ${left}px; top: ${top}px;`;
  }

  private renderButtons(wordInfo: WordInSentence): TemplateResult[] {
    const word = wordInfo.isTargetWord ? this.targetWord : wordInfo.wordData;
    const isKnown = word?.known ?? false;
    const isIgnored = word?.ignored ?? false;
    const existsInLearning = !!word || wordInfo.isTargetWord;
    const needsAddToLearningSet = !existsInLearning;

    const buttons: TemplateResult[] = [];

    if (!isKnown) {
      buttons.push(html`
        <button
          class="word-popup-button known"
          @click=${() => this.emit('mark-known')}
          ?disabled=${this.isProcessing}
        >
          Mark as known
        </button>
      `);
    }

    if (!isIgnored) {
      buttons.push(html`
        <button
          class="word-popup-button ignore"
          @click=${() => this.emit('ignore')}
          ?disabled=${this.isProcessing}
        >
          Ignore
        </button>
      `);
    }

    if (needsAddToLearningSet) {
      if (buttons.length > 0) {
        buttons.push(html`<div class="word-popup-divider"></div>`);
      }
      buttons.push(html`
        <button
          class="word-popup-button add"
          @click=${() => this.emit('add-to-set')}
          ?disabled=${this.isProcessing}
        >
          Add to learning set
        </button>
      `);
    }

    // Add "Explain grammar" button (always available)
    if (buttons.length > 0) {
      buttons.push(html`<div class="word-popup-divider"></div>`);
    }
    buttons.push(html`
      <button
        class="word-popup-button grammar"
        @click=${() => this.emit('explain-grammar')}
        ?disabled=${this.isProcessing || this.isFetchingGrammar}
      >
        ${this.isFetchingGrammar ? 'Loading...' : 'Explain grammar'}
      </button>
    `);

    // If no buttons to show (word is already known/ignored and in learning set)
    if (buttons.length === 0) {
      buttons.push(html`
        <div
          class="word-popup-button"
          style="opacity: 0.6; cursor: default; padding: var(--spacing-sm);"
        >
          ${wordInfo.isTargetWord ? 'Target word' : isKnown ? 'Already known' : 'Already ignored'}
        </div>
      `);
    }

    return buttons;
  }

  render(): TemplateResult {
    if (!this.wordInfo || !this.position) {
      return html``;
    }
    return html`
      <div class="word-popup" style="${this.getPopupStyle()}" @click=${this.stop}>
        ${this.renderButtons(this.wordInfo)}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'word-popup': WordPopup;
  }
}
