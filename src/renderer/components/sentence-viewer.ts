/**
 * Sentence viewer component for learning mode
 */

import { LitElement, html, css, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { customElement, state, property } from 'lit/decorators.js';
import { formatDistanceToNow } from 'date-fns';
import { sharedStyles } from '../styles/shared.js';
import { Word, Sentence, DictionaryEntry, PrecomputedToken } from '../../shared/types/core.js';
import { splitSentenceIntoParts } from '../../shared/utils/sentence.js';
import { getErrorMessage } from '../../shared/utils/error.js';
import { useKeyboardBindings } from '../utils/keyboard-manager.js';
import { tokenizeSentenceWithDictionary } from '../utils/sentence-tokenizer.js';
import type { TokenizedWord as WordInSentence } from '../utils/sentence-tokenizer.js';
import { logger } from '../utils/logger.js';
import { sessionManager } from '../utils/session-manager.js';
import { audioPlayer } from '../utils/audio-player-service.js';
import { markdownToHtml } from '../utils/markdown-utils.js';
import { checkProficiencyLevel } from '../utils/app-initializer.js';

@customElement('sentence-viewer')
export class SentenceViewer extends LitElement {
  @property({ type: Object })
  sentence!: Sentence;

  @property({ type: Object })
  targetWord!: Word;

  @property({ type: Object })
  displayLastSeen?: Date;

  @property({ type: Array })
  allWords: Word[] = [];

  @property({ type: Boolean })
  isFirstSentence = false;

  @property({ type: Boolean })
  isLastSentence = false;

  @property({ type: Boolean })
  isProcessing = false;

  @property({ type: String })
  currentPlayingAudio: 'before' | 'main' | null = null;

  @property({ type: Boolean })
  audioOnlyMode = false;

  @property({ type: Boolean })
  autoScrollEnabled = false;

  @property({ type: Number })
  currentSessionId?: number;

  @property({ type: Object })
  audioCache?: Map<string, string>; // audioPath -> blob URL

  @property({ type: Number })
  playbackSpeed?: number; // Playback speed multiplier (defaults to 1.0)

  @state()
  private localPlayingAudio: 'before' | 'main' | 'after' | null = null;

  @state()
  private isRegeneratingAudio = false;

  @state()
  private parsedWords: WordInSentence[] = [];

  @state()
  private autoplayEnabled = false;

  @state()
  private wordPopup: { wordInfo: WordInSentence; position: { x: number; y: number } } | null = null;

  @state()
  private grammarExplanation: { word: string; explanation: string } | null = null;

  @state()
  private isFetchingGrammar = false;

  @state()
  private zipfFrequencies: Record<string, number> = {}; // word -> zipf frequency

  @state()
  private contextMenu: { x: number; y: number; selectedText: string } | null = null;

  // Dictionary cache is not reactive to avoid unnecessary re-renders
  // Dictionary data is precomputed in tokens, so cache updates shouldn't trigger UI updates
  private dictionaryCache: Record<string, DictionaryEntry[] | null> = {};

  private tokenizationRequestId = 0;
  private dictionaryLookupInFlight = new Set<string>();
  private dictionaryLookupPromises: Partial<Record<string, Promise<DictionaryEntry[] | null>>> = {};
  private lastProcessedSentenceId?: number;
  private lastProcessedAllWordsHash?: string;
  private lastAllWordsArrayReference?: Word[]; // Track array reference to avoid re-parsing on same array
  private lastGrammarSentenceId?: number; // Track last sentence ID that had grammar explanation

  private keyboardUnsubscribe?: () => void;

  // Hover tracking for dictionary lookups
  private hoverStartTime = new Map<string, number>(); // Keyed by dictionaryKey
  private hoverTimeout = new Map<string, number>(); // Timeout IDs for hover duration tracking

  private truncate(text: string, max: number): string {
    if (!text) return '';
    const chars = Array.from(text);
    if (chars.length <= max) return text;
    return chars.slice(0, max).join('') + '…';
  }

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      .sentence-container {
        background: var(--background-primary);
        border-radius: var(--border-radius);
        padding: var(--spacing-lg);
        box-shadow: var(--shadow-light);
        border: 1px solid var(--border-color);
        width: 100%;
        max-width: 100%;
        min-width: 0;
        box-sizing: border-box;
        margin: 0;
      }

      .sentence-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--spacing-sm);
        flex-wrap: wrap;
        gap: var(--spacing-sm);
        width: 100%;
        box-sizing: border-box;
      }

      .target-word-info {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        flex: 1;
        min-width: 0;
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
        background: var(--background-primary);
        border: 1px solid var(--border-color);
        border-radius: 999px;
        padding: 4px 8px;
        font-size: 14px;
        color: var(--text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
        width: 32px;
        height: 32px;
        line-height: 1;
        flex-shrink: 0;
      }

      .audio-button:hover:not(:disabled) {
        border-color: var(--primary-color);
        color: var(--primary-color);
        background: rgba(0, 0, 0, 0.03);
      }

      .audio-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .audio-icon {
        width: 16px;
        height: 16px;
      }

      .audio-button.secondary {
        background: var(--background-primary);
        border: 1px solid var(--border-color);
        color: var(--text-secondary);
      }

      .audio-button.secondary:hover:not(:disabled) {
        border-color: var(--primary-color);
        color: var(--primary-color);
        background: rgba(0, 0, 0, 0.03);
      }

      .word-strength {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        font-weight: 600;
        color: var(--text-secondary);
        background: var(--background-secondary);
        border-radius: var(--border-radius-small);
        padding: 2px 6px;
        line-height: 1;
      }

      .last-seen {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        font-weight: 600;
        color: var(--text-secondary);
        background: var(--background-secondary);
        border-radius: var(--border-radius-small);
        padding: 2px 6px;
        line-height: 1;
      }

      .word-strength-value {
        color: var(--primary-color);
      }

      .sentence-content {
        margin-bottom: var(--spacing-md);
        width: 100%;
        box-sizing: border-box;
      }

      .context-section {
        margin-bottom: var(--spacing-sm);
        padding: var(--spacing-md);
        background: var(--background-secondary);
        border-radius: var(--border-radius-small);
        border-left: 2px solid var(--primary-color);
        transition: all 0.3s ease;
        cursor: pointer;
      }

      .context-section.playing {
        background: #e3f2fd;
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

      .context-translation.hidden {
        opacity: 0.1;
        filter: blur(8px);
        pointer-events: none;
        user-select: none;
      }

      .sentence-text {
        font-size: 18px;
        line-height: 1.5;
        margin-bottom: var(--spacing-sm);
        color: var(--text-primary);
        width: 100%;
        word-wrap: break-word;
        overflow-wrap: break-word;
        hyphens: auto;
        padding: var(--spacing-md);
        padding-right: var(--spacing-md);
        background: var(--background-secondary);
        border-radius: var(--border-radius-small);
        border-left: 2px solid var(--primary-color);
        transition: all 0.3s ease;
        box-sizing: border-box;
        cursor: pointer;
      }

      .sentence-text.playing {
        background: #e3f2fd;
      }

      .sentence-pronunciation {
        font-size: 13px;
        color: var(--text-secondary);
        font-style: normal;
        line-height: 1.4;
        margin-top: var(--spacing-xs);
        opacity: 0.8;
      }

      .context-pronunciation {
        font-size: 12px;
        color: var(--text-secondary);
        font-style: normal;
        line-height: 1.4;
        margin-top: var(--spacing-xs);
        opacity: 0.8;
      }

      .sentence-translation {
        font-size: 14px;
        color: var(--text-secondary);
        font-style: italic;
        line-height: 1.4;
        margin-top: var(--spacing-xs);
      }

      .sentence-translation.hidden {
        opacity: 0.1;
        filter: blur(8px);
        pointer-events: none;
        user-select: none;
      }

      .word-in-sentence {
        cursor: pointer;
        padding: 2px 4px;
        border-radius: 3px;
        transition: all 0.2s ease;
        position: relative;
        display: inline-block;
        vertical-align: baseline;
        border: 2px solid transparent;
        box-sizing: border-box;
      }

      .word-in-sentence:hover {
        transform: translateY(-1px);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      /* Word strength and status colors */
      .word-neutral {
        background-color: transparent;
      }

      .word-target {
        background-color: var(--primary-light);
        border: 2px solid transparent;
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

      .word-strength-0 {
        background-color: #ffebee;
      } /* Very weak - light red */
      .word-strength-1 {
        background-color: #fff3e0;
      } /* Weak - light orange */
      .word-strength-2 {
        background-color: #fffde7;
      } /* Learning - light yellow */
      .word-strength-3 {
        background-color: #f3e5f5;
      } /* Good - light purple */
      .word-strength-4 {
        background-color: #e8f5e8;
      } /* Strong - light green */

      .word-actions {
        display: flex;
        justify-content: center;
        gap: var(--spacing-md);
        margin-top: var(--spacing-md);
        flex-wrap: wrap;
      }

      .word-action-btn,
      .nav-action-btn {
        min-width: 100px;
      }

      /* Toned down colors for action buttons */
      .word-action-btn.btn-success {
        background: #e8f5e9;
        color: #2e7d32;
        border: 1px solid #81c784;
      }

      .word-action-btn.btn-success:hover:not(:disabled) {
        background: #c8e6c9;
        border-color: #66bb6a;
      }

      .word-action-btn.btn-danger {
        background: #ffebee;
        color: #c62828;
        border: 1px solid #ef5350;
      }

      .word-action-btn.btn-danger:hover:not(:disabled) {
        background: #ffcdd2;
        border-color: #e57373;
      }

      .word-action-btn.btn-warning {
        background: #fff3e0;
        color: #e65100;
        border: 1px solid #ffb74d;
      }

      .word-action-btn.btn-warning:hover:not(:disabled) {
        background: #ffe0b2;
        border-color: #ffa726;
      }

      .tooltip {
        position: absolute;
        bottom: 100%;
        left: 0;
        transform: none;
        background: var(--text-primary);
        color: white;
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: var(--border-radius-small);
        font-size: 12px;
        white-space: normal;
        max-width: 600px;
        min-width: 150px;
        width: fit-content;
        word-wrap: break-word;
        overflow-wrap: break-word;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease;
        z-index: 10;
        margin-bottom: var(--spacing-xs);
      }

      .tooltip.left {
        left: auto;
        right: 0;
      }

      .word-in-sentence:hover .tooltip {
        opacity: 1;
      }

      .tooltip::after {
        content: '';
        position: absolute;
        top: 100%;
        left: 14px;
        transform: none;
        border: 4px solid transparent;
        border-top-color: var(--text-primary);
      }

      .tooltip.left::after {
        left: auto;
        right: 14px;
      }

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

      .grammar-loading-box {
        margin-top: var(--spacing-md);
        padding: var(--spacing-md);
        border: 1px solid #ccc;
        border-radius: var(--border-radius);
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        color: var(--text-secondary);
      }

      .grammar-explanation-box {
        margin-top: var(--spacing-md);
        padding: var(--spacing-md);
        border: 1px solid #ccc;
        border-radius: var(--border-radius);
      }

      .grammar-explanation-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--spacing-sm);
      }

      .grammar-explanation-header h4 {
        margin: 0;
        font-size: 16px;
        color: var(--text-primary);
      }

      .grammar-close-btn {
        background: transparent;
        border: none;
        font-size: 24px;
        line-height: 1;
        cursor: pointer;
        color: var(--text-secondary);
        padding: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: all 0.2s ease;
      }

      .grammar-close-btn:hover {
        background: var(--background-secondary);
        color: var(--text-primary);
      }

      .grammar-explanation-content {
        font-size: 14px;
        line-height: 1.6;
        color: var(--text-primary);
      }

      .grammar-explanation-content code {
        background: var(--background-primary);
        padding: 2px 4px;
        border-radius: 3px;
        font-family: monospace;
        font-size: 0.9em;
      }

      .grammar-explanation-content strong {
        font-weight: 600;
      }

      .grammar-explanation-content em {
        font-style: italic;
      }

      .grammar-explanation-content ul {
        margin: var(--spacing-xs) 0;
        padding-left: var(--spacing-lg);
      }

      .grammar-explanation-content li {
        margin: var(--spacing-xs) 0;
      }

      .context-menu {
        position: fixed;
        background: var(--background-primary);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius-small);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 10000;
        min-width: 150px;
        padding: var(--spacing-xs) 0;
      }

      .context-menu-item {
        padding: var(--spacing-sm) var(--spacing-md);
        cursor: pointer;
        font-size: 13px;
        color: var(--text-primary);
        transition: background 0.15s ease;
      }

      .context-menu-item:hover {
        background: var(--background-secondary);
      }

      .context-menu-item:active {
        background: var(--primary-light);
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

        .word-action-btn,
        .nav-action-btn {
          width: 100%;
        }
      }
    `,
  ];

  async connectedCallback() {
    super.connectedCallback();

    // If we have precomputed tokens, handle synchronously (no async tokenization)
    if (this.sentence?.tokenizedTokens && this.sentence.tokenizedTokens.length > 0) {
      const newParsedWords = this.convertPrecomputedTokensToWords(this.sentence.tokenizedTokens);
      this.parsedWords = newParsedWords;
      this.lastProcessedSentenceId = this.sentence?.id;
      // Lemmatization is already done during sentence generation, so we just use precomputed tokens
    } else {
      // No precomputed tokens - need async tokenization
      void this.parseSentence();
    }

    await this.loadAutoplaySettings();
    this.setupKeyboardBindings();

    // Trigger autoplay for the initial sentence if autoplay is enabled
    this.checkInitialAutoplay();

    // Close popup on outside click or ESC key
    document.addEventListener('click', this.handleOutsideClick);
    document.addEventListener('keydown', this.handleKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.keyboardUnsubscribe) {
      this.keyboardUnsubscribe();
    }
    document.removeEventListener('click', this.handleOutsideClick);
    document.removeEventListener('keydown', this.handleKeyDown);
    // Clean up audio element
    audioPlayer.stop();
  }

  private handleOutsideClick = (event: MouseEvent) => {
    // Handle context menu close
    if (this.contextMenu) {
      const target = event.target as HTMLElement;
      if (!target.closest('.context-menu') && !target.closest('.grammar-explanation-content')) {
        this.handleCloseContextMenu();
      }
    }

    if (!this.wordPopup) return;

    // Use setTimeout to allow click handlers on words to execute first
    setTimeout(() => {
      if (!this.wordPopup) return;

      const target = event.target as Node;
      if (!this.shadowRoot) {
        this.closeWordPopup();
        return;
      }

      // Check if the click is inside the popup
      const popupElement = this.shadowRoot.querySelector('.word-popup');
      if (popupElement && (popupElement.contains(target) || popupElement === target)) {
        return;
      }

      // Close if click is outside shadow root or outside popup but inside shadow root
      if (!this.shadowRoot.contains(target) || (popupElement && !popupElement.contains(target))) {
        this.closeWordPopup();
      }
    }, 0);
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      if (this.contextMenu) {
        this.handleCloseContextMenu();
      } else if (this.wordPopup) {
        this.closeWordPopup();
      }
    }
  };

  updated(changedProperties: Map<string, any>) {
    // Sync currentPlayingAudio from parent if provided
    // Use parent state if available, otherwise use local state
    if (changedProperties.has('currentPlayingAudio')) {
      // Always sync to parent state when it changes
      // If parent has a value, use it; if parent clears it, clear local too
      this.localPlayingAudio = this.currentPlayingAudio;
    }

    // Only re-parse if sentence actually changed (different ID) or allWords meaningfully changed
    const sentenceChanged = changedProperties.has('sentence');
    const allWordsChanged = changedProperties.has('allWords');

    // Clear grammar explanation when sentence changes
    if (sentenceChanged) {
      const currentSentenceId = this.sentence?.id;
      if (currentSentenceId !== this.lastGrammarSentenceId) {
        // Sentence ID changed - clear grammar state
        this.grammarExplanation = null;
        this.isFetchingGrammar = false;
        this.lastGrammarSentenceId = currentSentenceId;
      }
    }

    // Skip if only non-relevant properties changed (isFirstSentence, isLastSentence, isProcessing, displayLastSeen)
    const relevantPropertyChanged =
      sentenceChanged ||
      allWordsChanged ||
      changedProperties.has('targetWord') ||
      changedProperties.has('displayLastSeen');

    if (!relevantPropertyChanged) {
      return;
    }

    // If we have precomputed tokens, we never need to do async tokenization
    // We can update word statuses synchronously if needed
    const hasPrecomputedTokens =
      this.sentence?.tokenizedTokens && this.sentence.tokenizedTokens.length > 0;

    if (sentenceChanged || allWordsChanged) {
      // Check if allWords array reference is the same (no need to re-parse)
      if (allWordsChanged && this.allWords === this.lastAllWordsArrayReference) {
        // Same array reference, skip re-parsing
        this.lastAllWordsArrayReference = this.allWords;
        return;
      }

      const currentSentenceId = this.sentence?.id;
      const sentenceIdChanged =
        sentenceChanged && currentSentenceId !== this.lastProcessedSentenceId;
      const needsReparse =
        sentenceIdChanged ||
        (allWordsChanged && !hasPrecomputedTokens && this.needsReparseForAllWords());

      if (hasPrecomputedTokens) {
        // With precomputed tokens, only do synchronous conversion
        // Lemmatization is already done during sentence generation, so we just use precomputed tokens
        if (sentenceIdChanged) {
          this.lastProcessedSentenceId = currentSentenceId;
          // Convert precomputed tokens synchronously - no async work
          const newParsedWords = this.convertPrecomputedTokensToWords(
            this.sentence.tokenizedTokens!
          );
          const hasChanged = this.hasParsedWordsChanged(newParsedWords, this.parsedWords);
          if (hasChanged) {
            this.parsedWords = newParsedWords;
            // Fetch zipf frequencies after parsedWords are set
            void this.fetchZipfFrequencies();
          }
        } else if (allWordsChanged) {
          // Only word statuses might have changed - update without re-tokenizing
          this.lastAllWordsArrayReference = this.allWords;
          this.updateWordStatusesFromPrecomputedTokens();
        }
      } else if (needsReparse) {
        // No precomputed tokens - need async tokenization
        if (sentenceChanged) {
          this.lastProcessedSentenceId = currentSentenceId;
        }
        if (allWordsChanged) {
          this.lastAllWordsArrayReference = this.allWords;
        }
        void this.parseSentence();
      } else if (allWordsChanged) {
        // Array changed but content might be same, still update reference
        this.lastAllWordsArrayReference = this.allWords;
      }
    }

    // Auto-play audio when sentence changes (if enabled)
    // This includes both when sentence changes AND when it's first set
    // Reload autoplay setting when sentence changes to respect user toggles
    if (sentenceChanged) {
      // Reload autoplay setting to ensure it's up-to-date
      void this.loadAutoplaySettings().then(() => {
        if (this.autoplayEnabled && this.sentence?.audioPath) {
          console.log('Autoplay triggered - sentence changed or first set');
          // Handle auto-play asynchronously
          this.handleAutoPlay();
        }
      });
    }
  }

  private needsReparseForAllWords(): boolean {
    // Create a simple hash of allWords to detect meaningful changes
    if (!this.allWords || this.allWords.length === 0) {
      return false;
    }

    // Only re-parse if words relevant to current sentence might have changed
    // This prevents unnecessary re-parsing when unrelated words are added/updated
    const hash = this.allWords
      .filter(
        (w) => w.id === this.targetWord?.id || this.parsedWords.some((p) => p.wordData?.id === w.id)
      )
      .map((w) => `${w.id}:${w.strength}:${w.known}:${w.ignored}`)
      .join(',');

    if (hash !== this.lastProcessedAllWordsHash) {
      this.lastProcessedAllWordsHash = hash;
      return true;
    }

    return false;
  }

  private async loadAutoplaySettings() {
    try {
      const autoplaySetting = await window.electronAPI.database.getSetting('autoplay_audio');
      this.autoplayEnabled = autoplaySetting === 'true';
    } catch (error) {
      logger.error({ error }, 'Failed to load autoplay setting');
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
      // Parent component stops audio before navigation, but add a small delay
      // to ensure the stop has fully completed before starting new playback
      await new Promise((resolve) => setTimeout(resolve, 100));
      void this.handlePlayAudio();
    } catch (error) {
      logger.warn({ error }, 'Failed to handle auto-play');
    }
  }

  private async parseSentence(): Promise<void> {
    const requestId = ++this.tokenizationRequestId;

    if (!this.sentence?.sentence) {
      this.parsedWords = [];
      this.lastProcessedSentenceId = undefined;
      return;
    }

    // Check if we have precomputed tokens - use them if available
    if (this.sentence.tokenizedTokens && this.sentence.tokenizedTokens.length > 0) {
      // Convert synchronously to avoid re-render jitter
      // Lemmatization is already done during sentence generation, so we just use precomputed tokens
      const newParsedWords = this.convertPrecomputedTokensToWords(this.sentence.tokenizedTokens);

      // Only update if it actually changed to prevent unnecessary re-renders
      if (requestId === this.tokenizationRequestId) {
        const hasChanged = this.hasParsedWordsChanged(newParsedWords, this.parsedWords);

        if (hasChanged) {
          this.parsedWords = newParsedWords;
        }
      }
      return;
    }

    // Fallback to runtime tokenization for sentences without precomputed tokens
    // Note: Lemmatization only happens during sentence generation, not here
    const parts = this.sentence.sentenceParts ?? splitSentenceIntoParts(this.sentence.sentence);

    const baseWords: WordInSentence[] = parts.map((text, _index) => {
      if (/^\s+$/.test(text)) {
        return { text, isTargetWord: false };
      }

      if (/^[.,!?;:]+$/.test(text)) {
        return { text, isTargetWord: false };
      }

      const dictionaryForm = text.trim().replace(/[.,!?;:]/g, '');
      const cleanText = dictionaryForm.toLowerCase();

      if (!cleanText) {
        return { text, isTargetWord: false };
      }

      // Check if this is the target word (compare by lemma since words are stored by lemma)
      const targetWordLower = this.targetWord.word.toLowerCase();
      const isTargetWord = cleanText === targetWordLower; // Runtime tokenization doesn't have lemma, so compare directly

      // Find word data from allWords (compare directly since runtime tokenization doesn't have lemma)
      const wordData = this.allWords.find((w) => w.word.toLowerCase() === cleanText);

      const dictionaryKey = this.buildDictionaryKey(dictionaryForm);

      if (!wordData && !isTargetWord && dictionaryKey) {
        void this.ensureDictionaryEntry(dictionaryForm, dictionaryKey);
      }

      return {
        text,
        isTargetWord,
        wordData,
        dictionaryForm,
        dictionaryKey,
        // Note: No lemma here - lemmatization only happens during sentence generation
      };
    });

    this.parsedWords = baseWords;
    await this.enhanceSentenceWithDictionary(requestId);
    // Fetch zipf frequencies after parsedWords are set
    void this.fetchZipfFrequencies();
  }

  /**
   * Immediately update wordData in parsedWords for a specific word.
   * This ensures the UI reflects status changes immediately.
   */
  private updateParsedWordsWordData(updatedWord: Word): void {
    const normalizedUpdatedWord = updatedWord.word.toLowerCase().trim();

    // Helper to normalize text for comparison
    const normalizeText = (text: string): string => {
      return text
        .trim()
        .replace(/[.,!?;:]/g, '')
        .toLowerCase();
    };

    let foundMatch = false;
    this.parsedWords = this.parsedWords.map((word) => {
      // Skip whitespace and punctuation
      if (/^\s+$/.test(word.text) || /^[.,!?;:]+$/.test(word.text)) {
        return word;
      }

      // Check if this parsed word matches the updated word by ID
      if (word.wordData?.id === updatedWord.id) {
        foundMatch = true;
        return { ...word, wordData: updatedWord };
      }

      // Compare using lemma if available (words are stored by lemma)
      if (word.lemma) {
        const wordLemma = word.lemma.toLowerCase();
        if (wordLemma === normalizedUpdatedWord) {
          foundMatch = true;
          return { ...word, wordData: updatedWord };
        }
      }

      // Fallback: Check by dictionary form
      if (word.dictionaryForm) {
        const normalizedDictForm = normalizeText(word.dictionaryForm);
        if (normalizedDictForm === normalizedUpdatedWord) {
          foundMatch = true;
          return { ...word, wordData: updatedWord };
        }
      }

      // Fallback: Check by normalized text content (strip punctuation for comparison)
      const normalizedText = normalizeText(word.text);
      if (normalizedText === normalizedUpdatedWord) {
        foundMatch = true;
        return { ...word, wordData: updatedWord };
      }

      // For words without wordData, also check without dictionary form normalization
      if (!word.wordData) {
        // Try matching raw text
        const rawNormalized = word.text.trim().toLowerCase();
        if (rawNormalized === normalizedUpdatedWord) {
          foundMatch = true;
          return { ...word, wordData: updatedWord };
        }
      }

      return word;
    });

    // If we didn't find a match, log for debugging
    if (!foundMatch) {
      logger.warn(
        {
          word: updatedWord.word,
          wordId: updatedWord.id,
          parsedWordsCount: this.parsedWords.length,
          sampleParsedWord: this.parsedWords.find((w) => !w.wordData && w.text.trim()),
        },
        '[SentenceViewer] Could not find matching word in parsedWords'
      );
    }
  }

  /**
   * Update word statuses from precomputed tokens without full re-tokenization.
   * Only updates wordData references when they actually change.
   */
  private updateWordStatusesFromPrecomputedTokens(): void {
    if (!this.sentence?.tokenizedTokens || !this.parsedWords.length) {
      return;
    }

    let hasChanged = false;
    const updatedWords = this.parsedWords.map((word, i) => {
      const token = this.sentence.tokenizedTokens?.[i];
      if (!token) return word;

      // Update wordData reference if it changed
      // Compare using lemma if available (words are stored by lemma)
      let wordData: Word | undefined;
      if (token.wordId) {
        wordData = this.allWords.find((w) => w.id === token.wordId);
      }
      if (!wordData) {
        if (token.lemma) {
          // Use lemma for comparison since words in database are stored by lemma
          const tokenLemma = token.lemma.toLowerCase();
          wordData = this.allWords.find((w) => w.word.toLowerCase() === tokenLemma);
        } else if (token.dictionaryForm) {
          // Fallback to dictionary form if no lemma available
          const cleanText = token.dictionaryForm.toLowerCase();
          wordData = this.allWords.find((w) => w.word.toLowerCase() === cleanText);
        }
      }

      // Check if wordData actually changed (by ID, not by reference)
      const oldWordDataId = word.wordData?.id;
      const newWordDataId = wordData?.id;

      if (
        oldWordDataId !== newWordDataId ||
        word.wordData?.strength !== wordData?.strength ||
        word.wordData?.known !== wordData?.known ||
        word.wordData?.ignored !== wordData?.ignored
      ) {
        hasChanged = true;
        return { ...word, wordData };
      }

      return word;
    });

    if (hasChanged) {
      this.parsedWords = updatedWords;
    }
  }

  /**
   * Deep comparison of parsed words to detect meaningful changes.
   */
  private hasParsedWordsChanged(newWords: WordInSentence[], oldWords: WordInSentence[]): boolean {
    if (newWords.length !== oldWords.length) {
      return true;
    }

    return newWords.some((word, i) => {
      const oldWord = oldWords[i];
      if (!oldWord) return true;

      // Check text and isTargetWord (these should rarely change)
      if (word.text !== oldWord.text || word.isTargetWord !== oldWord.isTargetWord) {
        return true;
      }

      // Check wordData by ID and relevant properties, not by reference
      const oldWordId = oldWord.wordData?.id;
      const newWordId = word.wordData?.id;

      if (oldWordId !== newWordId) {
        return true;
      }

      // If same word ID, check if status changed
      if (oldWordId && oldWordId === newWordId) {
        const oldWordData = oldWord.wordData!;
        const newWordData = word.wordData!;
        return (
          oldWordData.strength !== newWordData.strength ||
          oldWordData.known !== newWordData.known ||
          oldWordData.ignored !== newWordData.ignored
        );
      }

      return false;
    });
  }

  /**
   * Convert precomputed tokens to WordInSentence format, merging with current word status.
   * This applies dynamic word status (strength, known, ignored) from current allWords.
   */
  private convertPrecomputedTokensToWords(precomputedTokens: PrecomputedToken[]): WordInSentence[] {
    return precomputedTokens.map((token) => {
      // Find current word data from allWords (status may have changed since precomputation)
      let wordData: Word | undefined;
      if (token.wordId) {
        wordData = this.allWords.find((w) => w.id === token.wordId);
      }

      // Compare using lemma if available (words are stored by lemma)
      if (!wordData) {
        if (token.lemma) {
          // Use lemma for comparison since words in database are stored by lemma
          const tokenLemma = token.lemma.toLowerCase();
          wordData = this.allWords.find((w) => w.word.toLowerCase() === tokenLemma);
        } else if (token.dictionaryForm) {
          // Fallback to dictionary form if no lemma available
          const cleanText = token.dictionaryForm.toLowerCase();
          wordData = this.allWords.find((w) => w.word.toLowerCase() === cleanText);
        }
      }

      // Update isTargetWord based on current target word (compare using lemma if available)
      const targetWordLower = this.targetWord.word.toLowerCase();
      let isTargetWord = token.isTargetWord;
      if (token.lemma) {
        isTargetWord = token.lemma.toLowerCase() === targetWordLower || isTargetWord;
      } else if (token.dictionaryForm) {
        const cleanText = token.dictionaryForm?.toLowerCase() || '';
        isTargetWord = cleanText === targetWordLower || isTargetWord;
      }

      // Populate dictionary cache from precomputed entries
      if (token.dictionaryKey && token.dictionaryEntries) {
        this.dictionaryCache[token.dictionaryKey] = token.dictionaryEntries;
      }

      return {
        text: token.text,
        isTargetWord,
        wordData,
        dictionaryForm: token.dictionaryForm,
        dictionaryKey: token.dictionaryKey,
        lemma: token.lemma, // Use lemma from precomputed tokens (added during sentence generation)
      };
    });
  }

  private async enhanceSentenceWithDictionary(requestId: number): Promise<void> {
    if (!this.sentence?.sentence || !this.targetWord) {
      return;
    }

    try {
      const cacheMap = new Map<string, DictionaryEntry[] | null>(
        Object.entries(this.dictionaryCache)
      );

      const { words, cache } = await tokenizeSentenceWithDictionary(
        {
          sentence: this.sentence.sentence,
          targetWord: this.targetWord,
          allWords: this.allWords,
          lookupDictionary: async (word, language) => {
            const dictionaryKey = this.buildDictionaryKey(word, language);
            const entries = await this.getDictionaryEntries(word, dictionaryKey, language);
            return entries ?? [];
          },
          language: this.targetWord?.language,
          cache: cacheMap,
        },
        { maxPhraseWords: 3 }
      );

      if (requestId !== this.tokenizationRequestId) {
        return;
      }

      this.dictionaryCache = Object.fromEntries(cache.entries()) as Record<
        string,
        DictionaryEntry[] | null
      >;
      // Only update parsedWords if content actually changed to prevent unnecessary re-renders
      const hasChanged = this.hasParsedWordsChanged(words, this.parsedWords);

      if (hasChanged) {
        this.parsedWords = words;
      }
    } catch (error) {
      if (requestId === this.tokenizationRequestId) {
        logger.error({ error }, 'Failed to apply dictionary-based tokenization');
      }
    }
  }

  private formatTimeAgo(date?: Date): string {
    if (!date) {
      return 'never';
    }
    return formatDistanceToNow(date, { addSuffix: true });
  }

  // Allows async tokenization pipelines to push pre-processed words into the view.
  public applyTokenizedWords(words: WordInSentence[]): void {
    this.tokenizationRequestId += 1;
    this.parsedWords = words;
  }

  private buildDictionaryKey(word: string, languageOverride?: string): string | undefined {
    const trimmed = word.trim();
    if (!trimmed) {
      return undefined;
    }

    const language =
      languageOverride?.toLowerCase() || this.targetWord?.language?.toLowerCase() || 'unknown';
    return `${language}|${trimmed.toLowerCase()}`;
  }

  private async ensureDictionaryEntry(word: string, key: string, lemma?: string): Promise<void> {
    await this.getDictionaryEntries(word, key, undefined, lemma);
  }

  private async getDictionaryEntries(
    word: string,
    key?: string,
    languageOverride?: string,
    lemma?: string
  ): Promise<DictionaryEntry[] | null> {
    const dictionaryKey = key ?? this.buildDictionaryKey(word, languageOverride);

    if (!dictionaryKey) {
      return null;
    }

    if (Object.prototype.hasOwnProperty.call(this.dictionaryCache, dictionaryKey)) {
      return this.dictionaryCache[dictionaryKey] ?? null;
    }

    if (this.dictionaryLookupPromises[dictionaryKey]) {
      return this.dictionaryLookupPromises[dictionaryKey];
    }

    const lookupPromise = (async () => {
      try {
        this.dictionaryLookupInFlight.add(dictionaryKey);

        // Try original word lookup first
        const entries = await Promise.race([
          window.electronAPI.database.lookupDictionary(
            word,
            languageOverride ??
              this.targetWord?.language ??
              (await window.electronAPI.database.getCurrentLanguage())
          ),
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              const error = new Error('Timeout');
              error.name = 'TimeoutError';
              reject(error);
            }, 10000); // 10 second timeout
          }),
        ]);

        let normalizedEntries = Array.isArray(entries) && entries.length > 0 ? entries : null;

        // If original lookup failed and we have a lemma, try lemma lookup
        if (
          !normalizedEntries &&
          lemma &&
          lemma.toLowerCase().trim() !== word.toLowerCase().trim()
        ) {
          try {
            const lemmaEntries = await Promise.race([
              window.electronAPI.database.lookupDictionary(
                lemma,
                languageOverride ?? this.targetWord?.language
              ),
              new Promise<never>((_, reject) => {
                setTimeout(() => {
                  const error = new Error('Timeout');
                  error.name = 'TimeoutError';
                  reject(error);
                }, 10000); // 10 second timeout
              }),
            ]);

            normalizedEntries =
              Array.isArray(lemmaEntries) && lemmaEntries.length > 0 ? lemmaEntries : null;

            if (normalizedEntries) {
              console.log(
                `[Dictionary] Original word "${word}" not found, using lemma "${lemma}" for lookup`
              );
            }
          } catch (lemmaError) {
            logger.warn(
              { error: lemmaError, lemma },
              `[Dictionary] Lemma lookup also failed for "${lemma}"`
            );
            // Continue with null entries
          }
        }

        // Update cache with final result (use original dictionaryKey so tooltip can find it)
        this.dictionaryCache[dictionaryKey] = normalizedEntries;
        return normalizedEntries;
      } catch (error) {
        logger.error({ error, dictionaryKey }, 'Failed to load dictionary entries');
        // Cache null to indicate lookup failed/no results
        this.dictionaryCache[dictionaryKey] = null;
        return null;
      } finally {
        // Always clear the in-flight flag, even on timeout or error
        this.dictionaryLookupInFlight.delete(dictionaryKey);
        delete this.dictionaryLookupPromises[dictionaryKey];
        // Force a re-render to update tooltips after lookup completes (or fails)
        this.requestUpdate();
      }
    })();

    this.dictionaryLookupPromises[dictionaryKey] = lookupPromise;
    return lookupPromise;
  }

  private formatDictionaryTooltip(entries: DictionaryEntry[]): string {
    if (!entries.length) {
      return '';
    }

    const content = entries
      .map((entry) => {
        const glossText = entry.glosses.join(', ');
        if (entry.pos && glossText) {
          return `${entry.pos}: ${glossText}`;
        }
        return glossText || entry.pos || '';
      })
      .filter(Boolean)
      .join(' • ');

    return content ? content : '';
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

  private truncateTooltipText(text: string, maxLength: number = 200): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }

  private async fetchZipfFrequencies() {
    if (!this.sentence || !this.targetWord) {
      return;
    }

    try {
      // Extract unique words from parsed words
      const words = this.parsedWords
        .map((w) => w.dictionaryForm || w.text.trim())
        .filter((w) => w && !/^\s+$/.test(w) && !/^[.,!?;:]+$/.test(w))
        .filter((w, i, arr) => arr.indexOf(w) === i); // Get unique words

      if (words.length === 0) {
        return;
      }

      const frequencies = await window.electronAPI.lemmatization.getWordFrequencies(
        words,
        this.targetWord.language
      );
      this.zipfFrequencies = frequencies;
      this.requestUpdate();
    } catch (error) {
      // Gracefully degrade - don't show zipf, but don't break the UI
      console.warn('[SentenceViewer] Failed to fetch zipf frequencies:', error);
    }
  }

  private getWordTooltip(wordInfo: WordInSentence): string {
    // No tooltip for whitespace or punctuation
    if (/^\s+$/.test(wordInfo.text) || /^[.,!?;:]+$/.test(wordInfo.text)) {
      return '';
    }

    const parts: string[] = [];

    // Show zipf frequency if available
    const wordKey = wordInfo.dictionaryForm || wordInfo.text.trim();
    const zipfFreq = this.zipfFrequencies[wordKey];
    if (zipfFreq && zipfFreq > 0) {
      const roundedZipf = Math.round(zipfFreq);
      // Explain what Zipf frequency means
      let zipfExplanation = '';
      if (roundedZipf >= 6) {
        zipfExplanation = ' (very common, ~1 per 1000 words)';
      } else if (roundedZipf >= 5) {
        zipfExplanation = ' (common, ~1 per 10k words)';
      } else if (roundedZipf >= 4) {
        zipfExplanation = ' (moderate, ~1 per 100k words)';
      } else if (roundedZipf >= 3) {
        zipfExplanation = ' (uncommon, ~1 per million words)';
      } else {
        zipfExplanation = ' (rare)';
      }
      parts.push(`Zipf: ${roundedZipf}${zipfExplanation}`);
    }

    // Show lemma if available and different from the word
    if (wordInfo.lemma) {
      const dictionaryForm = wordInfo.dictionaryForm || wordInfo.text.trim();
      const cleanText = dictionaryForm.toLowerCase();
      if (wordInfo.lemma.toLowerCase() !== cleanText) {
        parts.push(`Lemma: ${wordInfo.lemma}`);
      }
    }

    // Show dictionary definition if available
    if (wordInfo.dictionaryKey) {
      // Trigger lookup if not already in progress or cached
      if (
        !this.dictionaryLookupInFlight.has(wordInfo.dictionaryKey) &&
        this.dictionaryCache[wordInfo.dictionaryKey] === undefined
      ) {
        void this.ensureDictionaryEntry(
          wordInfo.dictionaryForm ?? '',
          wordInfo.dictionaryKey,
          wordInfo.lemma // Pass lemma for fallback lookup
        );
      }

      const cachedEntries = this.dictionaryCache[wordInfo.dictionaryKey];
      if (cachedEntries && cachedEntries.length > 0) {
        const formatted = this.formatDictionaryTooltip(cachedEntries);
        if (parts.length > 0) {
          const result = parts.join(' • ') + ' • ' + formatted;
          return this.truncateTooltipText(result);
        }
        return this.truncateTooltipText(formatted);
      }
    }

    // If we have lemma but no dictionary definition, show just lemma
    if (parts.length > 0) {
      return this.truncateTooltipText(parts.join(' • '));
    }

    return '';
  }

  private async handleWordClick(wordInfo: WordInSentence, event: MouseEvent) {
    // Don't handle clicks on whitespace or punctuation
    if (/^\s+$/.test(wordInfo.text) || /^[.,!?;:]+$/.test(wordInfo.text)) {
      return;
    }

    // Stop event propagation to prevent outside click handler from firing immediately
    event.stopPropagation();

    // Close popup if clicking the same word (check by text content since object reference might differ)
    if (this.wordPopup) {
      const currentWordText = this.wordPopup.wordInfo.text.trim();
      const clickedWordText = wordInfo.text.trim();
      if (
        currentWordText === clickedWordText &&
        this.wordPopup.wordInfo.dictionaryForm === wordInfo.dictionaryForm
      ) {
        this.wordPopup = null;
        this.requestUpdate();
        return;
      }
    }

    // Show popup at click position
    this.wordPopup = {
      wordInfo,
      position: { x: event.clientX, y: event.clientY },
    };

    // Request update to render the popup
    this.requestUpdate();
  }

  private closeWordPopup() {
    this.wordPopup = null;
    this.requestUpdate();
  }

  private handleTooltipPosition(event: MouseEvent) {
    const wordElement = event.currentTarget as HTMLElement;
    const tooltip = wordElement.querySelector('.tooltip') as HTMLElement;
    if (!tooltip) return;

    const wordRect = wordElement.getBoundingClientRect();
    const viewportWidth = window.innerWidth;

    // Calculate optimal width based on content length
    const tooltipText = tooltip.textContent || '';
    const textLength = tooltipText.length;

    // For short text (under 50 chars), use narrower width
    // For medium text (50-150 chars), use medium width
    // For long text (150+ chars), allow it to grow but keep it narrower
    let optimalWidth: number;
    if (textLength < 50) {
      optimalWidth = Math.max(150, textLength * 6); // Roughly 6px per character
    } else if (textLength < 150) {
      optimalWidth = Math.min(400, Math.max(200, textLength * 4));
    } else {
      optimalWidth = 450; // Narrower width for long content
    }

    // Ensure it doesn't exceed viewport
    optimalWidth = Math.min(optimalWidth, viewportWidth - 40);
    tooltip.style.width = `${optimalWidth}px`;

    // Position tooltip to left if word is on the right side of the screen
    // Use 60% threshold to account for tooltip width and ensure it doesn't overflow
    const wordCenter = wordRect.left + wordRect.width / 2;
    if (wordCenter > viewportWidth * 0.6) {
      tooltip.classList.add('left');
    } else {
      tooltip.classList.remove('left');
    }
  }

  private handleWordHoverStart(wordInfo: WordInSentence) {
    // Only track if word has dictionary entries or dictionary key
    if (!wordInfo.dictionaryKey) return;

    const dictionaryKey = wordInfo.dictionaryKey;
    const now = Date.now();

    // Clear any existing timeout for this word
    const existingTimeout = this.hoverTimeout.get(dictionaryKey);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      this.hoverTimeout.delete(dictionaryKey);
    }

    // Record hover start time (logging will happen on hover end)
    this.hoverStartTime.set(dictionaryKey, now);
  }

  private handleWordHoverEnd(wordInfo: WordInSentence) {
    if (!wordInfo.dictionaryKey) return;

    const dictionaryKey = wordInfo.dictionaryKey;
    const startTime = this.hoverStartTime.get(dictionaryKey);

    // Clear any existing timeout (shouldn't be needed anymore, but keep for safety)
    const timeoutId = this.hoverTimeout.get(dictionaryKey);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.hoverTimeout.delete(dictionaryKey);
    }

    // Calculate actual hover duration and log if >= 1000ms
    if (startTime) {
      const duration = Date.now() - startTime;
      if (duration >= 1000) {
        this.recordDictionaryHover(wordInfo, dictionaryKey, duration);
      }
      this.hoverStartTime.delete(dictionaryKey);
    }
  }

  private async recordDictionaryHover(
    wordInfo: WordInSentence,
    dictionaryKey: string,
    duration: number
  ) {
    // Duration is always provided from handleWordHoverEnd and already validated to be >= 1000ms
    // Check if dictionary lookup found entries
    const cachedEntries = this.dictionaryCache[dictionaryKey];
    const foundInDict =
      cachedEntries !== undefined && cachedEntries !== null && cachedEntries.length > 0;

    try {
      // Use lemmatized version if available, otherwise fall back to dictionary form or text
      const wordToRecord = wordInfo.lemma || wordInfo.dictionaryForm || wordInfo.text.trim();

      await window.electronAPI.tracking.recordDictionaryHover({
        word: wordToRecord,
        language: this.targetWord?.language || 'spanish',
        sentenceId: this.sentence?.id,
        sessionId: this.currentSessionId,
        hoverDurationMs: duration,
        dictionaryKey,
        foundInDict,
      });
    } catch (error) {
      logger.warn({ error }, 'Failed to record dictionary hover');
      // Don't block the flow if tracking fails
    }
  }

  private getPopupStyle(): string {
    if (!this.wordPopup) return '';

    // Position popup near the click, but ensure it stays on screen
    const padding = 10;
    const popupWidth = 180;
    const popupHeight = 150; // Approximate height
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = this.wordPopup.position.x;
    let top = this.wordPopup.position.y;

    // Adjust horizontally if popup would go off-screen
    if (left + popupWidth > viewportWidth - padding) {
      left = viewportWidth - popupWidth - padding;
    }
    if (left < padding) {
      left = padding;
    }

    // Adjust vertically if popup would go off-screen (show above click if needed)
    if (top + popupHeight > viewportHeight - padding) {
      top = this.wordPopup.position.y - popupHeight - 5;
    }
    if (top < padding) {
      top = padding;
    }

    return `left: ${left}px; top: ${top}px;`;
  }

  private async handleIgnoreWord() {
    if (!this.wordPopup) return;

    const wordInfo = this.wordPopup.wordInfo;
    let word: Word | null = wordInfo.isTargetWord ? this.targetWord : wordInfo.wordData || null;

    if (!word) {
      // Word doesn't exist yet, need to add it first
      // Don't generate sentences for ignored words
      word = await this.addWordFromSentence(wordInfo, false);
      if (!word) {
        this.closeWordPopup();
        return;
      }
    }

    // Mark word as ignored
    await window.electronAPI.database.markWordIgnored(word.id, true);

    // Update the word with ignored status
    const updatedWord = { ...word, ignored: true };

    // Update local state in allWords
    const wordIndex = this.allWords.findIndex((w) => w.id === word!.id);
    if (wordIndex !== -1) {
      this.allWords = [
        ...this.allWords.slice(0, wordIndex),
        updatedWord,
        ...this.allWords.slice(wordIndex + 1),
      ];
    } else {
      // If word wasn't in allWords (newly added), add it
      this.allWords = [...this.allWords, updatedWord];
    }

    // Immediately update parsedWords to reflect the change
    this.updateParsedWordsWordData(updatedWord);

    // Create a new array reference to ensure Lit detects the change
    this.parsedWords = [...this.parsedWords];

    // Request update to trigger re-render
    this.requestUpdate();

    // Emit event for parent to handle
    this.dispatchEvent(
      new CustomEvent('mark-word-ignored', {
        detail: { word: updatedWord },
        bubbles: true,
        composed: true,
      })
    );

    this.closeWordPopup();
  }

  private async handleMarkWordKnown() {
    if (!this.wordPopup) return;

    const wordInfo = this.wordPopup.wordInfo;
    let word: Word | null = wordInfo.isTargetWord ? this.targetWord : wordInfo.wordData || null;

    if (!word) {
      // Word doesn't exist yet, need to add it first
      // Don't generate sentences for known words
      word = await this.addWordFromSentence(wordInfo, false);
      if (!word) {
        this.closeWordPopup();
        return;
      }
    }

    // Mark word as known
    await window.electronAPI.database.markWordKnown(word.id, true);
    await window.electronAPI.database.updateWordStrength(word.id, 100);

    // Update the word with known status
    const updatedWord = { ...word, known: true, strength: 100 };

    // Update local state in allWords
    const wordIndex = this.allWords.findIndex((w) => w.id === word!.id);
    if (wordIndex !== -1) {
      this.allWords = [
        ...this.allWords.slice(0, wordIndex),
        updatedWord,
        ...this.allWords.slice(wordIndex + 1),
      ];
    } else {
      // If word wasn't in allWords (newly added), add it
      this.allWords = [...this.allWords, updatedWord];
    }

    // Immediately update parsedWords to reflect the change
    this.updateParsedWordsWordData(updatedWord);

    // Create a new array reference to ensure Lit detects the change
    this.parsedWords = [...this.parsedWords];

    // Request update to trigger re-render
    this.requestUpdate();

    // Emit event for parent to handle
    this.dispatchEvent(
      new CustomEvent('mark-word-known', {
        detail: { word: updatedWord },
        bubbles: true,
        composed: true,
      })
    );

    this.closeWordPopup();
  }

  private async handleAddToLearningSet() {
    if (!this.wordPopup) return;

    const wordInfo = this.wordPopup.wordInfo;

    if (!wordInfo.wordData && !wordInfo.isTargetWord) {
      // Word doesn't exist yet, add it to learning set (with sentence generation)
      const newWord = await this.addWordFromSentence(wordInfo, true);
      if (newWord) {
        // Immediately update parsedWords to include the new word
        // This ensures the UI updates before the async parseSentence() completes
        this.updateParsedWordsWordData(newWord);

        // Create a new array reference to ensure Lit detects the change
        this.parsedWords = [...this.parsedWords];

        // Force a re-render to show the updated color
        this.requestUpdate();
      }
    } else {
      const word = wordInfo.isTargetWord ? this.targetWord : wordInfo.wordData!;

      // If word is already in learning set, ensure it's updated in parsedWords
      this.updateParsedWordsWordData(word);

      // Create a new array reference to ensure Lit detects the change
      this.parsedWords = [...this.parsedWords];

      this.requestUpdate();

      // Emit event for parent to handle (existing word clicked)
      this.dispatchEvent(
        new CustomEvent('word-clicked', {
          detail: { word, wordText: wordInfo.text.trim() },
          bubbles: true,
          composed: true,
        })
      );
    }

    this.closeWordPopup();
  }

  private async handleExplainGrammar() {
    if (!this.wordPopup) return;

    const wordInfo = this.wordPopup.wordInfo;
    let word: Word | null = wordInfo.isTargetWord ? this.targetWord : wordInfo.wordData || null;

    // If word doesn't exist in database, add it first (without generating sentences)
    // This ensures we have a wordId for caching the grammar explanation
    if (!word) {
      word = await this.addWordFromSentence(wordInfo, false);
      if (!word) {
        this.closeWordPopup();
        return;
      }
    }

    const wordText = wordInfo.dictionaryForm?.trim() || wordInfo.text.trim();
    const sentenceText = this.sentence.sentence;
    const language = word.language || this.targetWord.language;

    this.isFetchingGrammar = true;
    this.closeWordPopup();

    try {
      // Get proficiency level for the language
      const proficiencyLevel = await checkProficiencyLevel(language);

      const explanation = await window.electronAPI.llm.explainGrammar(
        wordText,
        sentenceText,
        language,
        proficiencyLevel || undefined,
        word.id, // Use the clicked word's ID, not targetWord.id
        this.sentence.id
      );

      // Grammar explanation is now stored and count incremented automatically by the IPC handler

      this.grammarExplanation = {
        word: wordText,
        explanation: explanation,
      };

      // Track that this sentence has grammar explanation
      this.lastGrammarSentenceId = this.sentence?.id;

      this.requestUpdate();
    } catch (error) {
      logger.error({ error }, 'Failed to get explanation');
      window.alert('Failed to get explanation. Please try again.');
    } finally {
      this.isFetchingGrammar = false;
    }
  }

  private handleCloseGrammarExplanation() {
    this.grammarExplanation = null;
    this.requestUpdate();
  }

  private async handleGrammarContextMenu(e: MouseEvent) {
    e.preventDefault();

    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() || '';

    // Only show menu if text is between 5 and 100 characters
    if (selectedText.length < 5 || selectedText.length > 100) {
      this.contextMenu = null;
      return;
    }

    // Show context menu at cursor position (works with any TTS backend)
    this.contextMenu = {
      x: e.clientX,
      y: e.clientY,
      selectedText,
    };

    this.requestUpdate();
  }

  private handleCloseContextMenu() {
    this.contextMenu = null;
    // Clear selection
    window.getSelection()?.removeAllRanges();
  }

  private async handleReadSelectedText() {
    if (!this.contextMenu) return;

    const selectedText = this.contextMenu.selectedText;
    this.handleCloseContextMenu();

    try {
      // Get current language
      const language =
        this.targetWord?.language || (await window.electronAPI.database.getCurrentLanguage());

      // Check cache first
      let audioPath: string;
      const cached = await window.electronAPI.database.getReadAloudCache(selectedText, language);

      if (cached) {
        // Verify the cached audio file still exists
        const audioExists = await window.electronAPI.audio.audioExists(cached.audioPath);
        if (audioExists) {
          audioPath = cached.audioPath;
        } else {
          logger.warn(
            { audioPath: cached.audioPath, selectedText },
            'Cached audio file not found, regenerating'
          );
          // File was deleted, generate new audio
          audioPath = await window.electronAPI.audio.generateAudio(selectedText, language);

          // Update cache with new audio path
          try {
            await window.electronAPI.database.insertReadAloudCache(
              selectedText,
              language,
              audioPath
            );
          } catch (cacheError) {
            logger.warn({ error: cacheError, audioPath, selectedText }, 'Failed to update cache');
          }
        }
      } else {
        // Generate audio using the configured TTS backend (ElevenLabs or system TTS)
        audioPath = await window.electronAPI.audio.generateAudio(selectedText, language);

        // Cache the audio for future use
        try {
          await window.electronAPI.database.insertReadAloudCache(selectedText, language, audioPath);
        } catch (cacheError) {
          // Log but don't fail if caching fails
          logger.warn({ error: cacheError, audioPath, selectedText }, 'Failed to cache audio');
        }
      }

      // Play the audio
      await audioPlayer.play(audioPath, {
        playbackSpeed: this.playbackSpeed || 1.0,
        onError: (error: Error) => {
          logger.error({ error, audioPath, selectedText }, 'Error during audio playback');
        },
      });
    } catch (error) {
      logger.error({ error, selectedText }, 'Failed to read selected text');
      console.error('Error reading selected text:', error);
      // Show error to user
      alert(`Failed to read text: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async addWordFromSentence(
    wordInfo: WordInSentence,
    generateSentences: boolean = true
  ): Promise<Word | null> {
    const rawWord = wordInfo.dictionaryForm?.trim() || wordInfo.text.trim();
    if (!rawWord) {
      return null;
    }

    // Use lemmatized version if available, otherwise normalize the word
    let wordToAdd: string;
    if (wordInfo.lemma) {
      wordToAdd = wordInfo.lemma;
    } else {
      // Skip lemmatization for Japanese
      const isJapanese =
        this.targetWord.language?.toLowerCase() === 'japanese' ||
        this.targetWord.language?.toLowerCase() === 'ja';

      if (isJapanese) {
        // For Japanese, just use the raw word (no lemmatization)
        wordToAdd = rawWord.replace(/\s+/g, ' ');
      } else {
        // Fallback: try to lemmatize the word
        try {
          const lemmas = await window.electronAPI.lemmatization.lemmatizeWords(
            [rawWord.toLowerCase()],
            this.targetWord.language
          );
          const lemma = lemmas[rawWord.toLowerCase()];
          wordToAdd = lemma || rawWord.replace(/\s+/g, ' ');
        } catch (error) {
          logger.warn({ error, rawWord }, 'Failed to lemmatize word (non-critical)');
          wordToAdd = rawWord.replace(/\s+/g, ' ');
        }
      }
    }

    const normalized = wordToAdd.replace(/\s+/g, ' ');

    // Check if word already exists (compare lemmatized versions)
    const alreadyTracked = this.allWords.some((existing) => {
      const existingLower = existing.word.toLowerCase();
      return existingLower === normalized.toLowerCase();
    });

    if (alreadyTracked) {
      const existingWord = this.allWords.find(
        (w) => w.word.toLowerCase() === normalized.toLowerCase()
      );
      this.dispatchEvent(
        new CustomEvent('word-addition-skipped', {
          detail: { word: normalized },
          bubbles: true,
          composed: true,
        })
      );
      return existingWord || null;
    }

    let suggestedTranslation = '';
    try {
      const entries = await this.getDictionaryEntries(normalized, wordInfo.dictionaryKey);
      if (entries && entries.length > 0) {
        const firstEntry = entries[0];
        const gloss = Array.isArray(firstEntry.glosses) ? firstEntry.glosses[0] : '';
        suggestedTranslation = gloss ?? '';
      }
    } catch (error) {
      logger.warn({ error, normalized }, 'Dictionary lookup failed');
    }

    const translation = (suggestedTranslation || normalized).trim();

    try {
      const wordId = await window.electronAPI.database.insertWord({
        word: normalized,
        language: this.targetWord.language,
        translation,
        addedVia: 'context_menu',
      });

      // Only generate sentences if requested (not for known/ignored words)
      if (generateSentences) {
        await window.electronAPI.jobs.enqueueWordGeneration(wordId, {
          language: this.targetWord.language,
          desiredSentenceCount: 3,
        });
      }

      const newWord = await window.electronAPI.database.getWordById(wordId);
      if (newWord) {
        // Update allWords immediately
        this.allWords = [...this.allWords, newWord];
        // Don't call parseSentence here - let the caller handle immediate UI update
        // parseSentence will be called if needed, but we want immediate feedback
      }

      this.dispatchEvent(
        new CustomEvent('word-added-from-sentence', {
          detail: {
            wordId,
            word: normalized,
            translation,
          },
          bubbles: true,
          composed: true,
        })
      );

      // Dispatch event to update word stats in top panel
      window.dispatchEvent(
        new CustomEvent('words-updated', {
          bubbles: true,
          composed: true,
        })
      );

      return newWord || null;
    } catch (error) {
      logger.error({ error }, 'Failed to add word from sentence');
      this.dispatchEvent(
        new CustomEvent('word-addition-error', {
          detail: {
            word: normalized,
            message: getErrorMessage(error, 'Unknown error while adding word.'),
          },
          bubbles: true,
          composed: true,
        })
      );
      return null;
    }
  }

  private async handlePlayAudio() {
    if (!this.sentence.audioPath) {
      return;
    }

    try {
      // Build sequence of audio paths (before, main, after)
      const audioPaths: string[] = [];
      const audioTypes: ('before' | 'main' | 'after')[] = [];

      // Get before sentence audio if it exists
      if (this.sentence.contextBefore && this.sentence.id) {
        try {
          const beforeSentenceAudioPath = await window.electronAPI.dialog.ensureBeforeSentenceAudio(
            this.sentence.id
          );
          if (beforeSentenceAudioPath) {
            audioPaths.push(beforeSentenceAudioPath);
            audioTypes.push('before');
          }
        } catch (error) {
          logger.warn({ error }, 'Failed to get before sentence audio');
          // Continue with main sentence audio even if before sentence audio fails
        }
      }

      // Add main sentence audio
      audioPaths.push(this.sentence.audioPath);
      audioTypes.push('main');

      // Get after sentence audio if it exists
      if (this.sentence.contextAfter && this.sentence.id) {
        try {
          const contextAudio = await window.electronAPI.dialog.ensureContextSentences(
            this.sentence.id
          );
          const afterSentenceAudioPath = contextAudio.afterSentenceAudio;
          if (afterSentenceAudioPath) {
            audioPaths.push(afterSentenceAudioPath);
            audioTypes.push('after');
          }
        } catch (error) {
          logger.warn({ error }, 'Failed to get after sentence audio');
          // Continue even if after sentence audio fails
        }
      }

      // Track which audio is currently playing for UI state
      let currentIndex = 0;
      const playbackSpeed = this.playbackSpeed ?? sessionManager.getPlaybackSpeed() ?? 1.0;

      // Set initial playing state
      if (audioTypes.length > 0) {
        this.localPlayingAudio = audioTypes[0];
        this.requestUpdate();
      }

      // Play sequence
      await audioPlayer.playSequence(audioPaths, {
        playbackSpeed,
        onEnded: () => {
          // Move to next audio in sequence
          currentIndex++;
          if (currentIndex < audioTypes.length) {
            // Update UI to show next audio is playing
            this.localPlayingAudio = audioTypes[currentIndex];
            this.requestUpdate();
          } else {
            // All audio finished
            this.localPlayingAudio = null;
            this.requestUpdate();

            // Dispatch events
            this.dispatchEvent(
              new CustomEvent('sentence-audio-played', {
                detail: {
                  sentenceId: this.sentence.id,
                  wordId: this.targetWord.id,
                },
                bubbles: true,
                composed: true,
              })
            );

            this.dispatchEvent(
              new CustomEvent('sentence-audio-completed', {
                detail: {
                  sentenceId: this.sentence.id,
                  wordId: this.targetWord.id,
                },
                bubbles: true,
                composed: true,
              })
            );
          }
        },
        onError: (error) => {
          logger.error({ error }, 'Failed to play audio sequence');
          this.localPlayingAudio = null;
          this.requestUpdate();
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to play audio');
      this.localPlayingAudio = null;
      this.requestUpdate();
    }
  }

  private handleContextBeforeClick = async (_e: MouseEvent) => {
    // Only play before-sentence audio
    if (!this.sentence.contextBefore || !this.sentence.id) {
      return;
    }

    try {
      const beforeSentenceAudioPath = await window.electronAPI.dialog.ensureBeforeSentenceAudio(
        this.sentence.id
      );
      if (beforeSentenceAudioPath) {
        const playbackSpeed = this.playbackSpeed ?? sessionManager.getPlaybackSpeed() ?? 1.0;
        this.localPlayingAudio = 'before';
        this.requestUpdate();
        await audioPlayer.play(beforeSentenceAudioPath, {
          playbackSpeed,
          onEnded: () => {
            this.localPlayingAudio = null;
            this.requestUpdate();
          },
          onError: () => {
            this.localPlayingAudio = null;
            this.requestUpdate();
          },
        });
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to get before sentence audio');
      this.localPlayingAudio = null;
      this.requestUpdate();
    }
  };

  private handleSentenceTextClick = async (e: MouseEvent) => {
    // Only play main sentence audio if clicking on the sentence text itself (not on a word)
    // Words have their own click handlers, so we check if the target is a word span
    const target = e.target as HTMLElement | Node;

    // If clicking on a word-in-sentence span or any element within it, don't play audio
    // (let word handler do its thing)
    if (target instanceof HTMLElement && target.closest('.word-in-sentence')) {
      return;
    }

    // Also check if the click originated from within a word span by checking the composed path
    const path = e.composedPath();
    if (
      path.some(
        (node) => node instanceof HTMLElement && node.classList?.contains('word-in-sentence')
      )
    ) {
      return;
    }

    // If clicking on whitespace/punctuation or the container itself, play only main sentence audio
    if (!this.sentence.audioPath) {
      return;
    }

    const playbackSpeed = this.playbackSpeed ?? sessionManager.getPlaybackSpeed() ?? 1.0;
    this.localPlayingAudio = 'main';
    this.requestUpdate();
    await audioPlayer.play(this.sentence.audioPath, {
      playbackSpeed,
      onEnded: () => {
        this.localPlayingAudio = null;
        this.requestUpdate();
      },
      onError: () => {
        this.localPlayingAudio = null;
        this.requestUpdate();
      },
    });
  };

  private handleContextAfterClick = async (_e: MouseEvent) => {
    // Only play after-sentence audio
    if (!this.sentence.contextAfter || !this.sentence.id) {
      return;
    }

    try {
      const contextAudio = await window.electronAPI.dialog.ensureContextSentences(this.sentence.id);
      const afterSentenceAudioPath = contextAudio.afterSentenceAudio;
      if (afterSentenceAudioPath) {
        const playbackSpeed = this.playbackSpeed ?? sessionManager.getPlaybackSpeed() ?? 1.0;
        this.localPlayingAudio = 'after';
        this.requestUpdate();
        await audioPlayer.play(afterSentenceAudioPath, {
          playbackSpeed,
          onEnded: () => {
            this.localPlayingAudio = null;
            this.requestUpdate();
          },
          onError: () => {
            this.localPlayingAudio = null;
            this.requestUpdate();
          },
        });
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to get after sentence audio');
      this.localPlayingAudio = null;
      this.requestUpdate();
    }
  };

  private async handleRecreateAudio() {
    if (this.isRegeneratingAudio || !this.sentence?.sentence) {
      return;
    }

    this.isRegeneratingAudio = true;
    try {
      // Ensure no audio is playing
      try {
        audioPlayer.stop();
        await window.electronAPI.audio.stopAudio();
      } catch (e) {
        logger.warn({ error: e }, 'Stop audio before regenerate failed (non-fatal)');
      }

      const oldPath = this.sentence.audioPath;
      const language =
        this.targetWord?.language || (await window.electronAPI.database.getCurrentLanguage());
      const word = this.targetWord?.word;

      let regeneratedPath: string | undefined;

      if (typeof window.electronAPI.audio.regenerateAudio === 'function') {
        const result = await window.electronAPI.audio.regenerateAudio({
          text: this.sentence.sentence,
          language,
          word,
          wordId: this.sentence.wordId || this.targetWord?.id,
          sentenceId: this.sentence.id,
          existingPath: oldPath,
        });
        regeneratedPath = result?.audioPath;
      } else {
        logger.warn('Recreate audio: regenerateAudio not available, using fallback flow');
        const fallbackLanguage =
          language ||
          this.targetWord?.language ||
          (await window.electronAPI.database.getCurrentLanguage());

        // Generate new audio with proper IDs
        regeneratedPath = await window.electronAPI.audio.generateAudio(
          this.sentence.sentence,
          fallbackLanguage,
          word || this.targetWord?.word || undefined,
          this.sentence.wordId || this.targetWord?.id || undefined,
          this.sentence.id || undefined
        );

        if (oldPath && oldPath !== regeneratedPath) {
          await window.electronAPI.database.updateSentenceAudioPath(
            this.sentence.id,
            regeneratedPath
          );

          try {
            await window.electronAPI.audio.deleteRecording(oldPath);
          } catch (deleteError) {
            logger.warn(
              { error: deleteError, oldPath },
              'Recreate audio (fallback): failed to delete previous audio'
            );
          }
        }
      }

      if (!regeneratedPath) {
        throw new Error('Audio regeneration returned an empty path');
      }

      if (
        typeof window.electronAPI.audio.regenerateAudio === 'function' &&
        (!oldPath || regeneratedPath !== oldPath)
      ) {
        await window.electronAPI.database.updateSentenceAudioPath(
          this.sentence.id,
          regeneratedPath
        );
      }

      this.sentence = { ...this.sentence, audioPath: regeneratedPath };

      // Optional event for parent components
      this.dispatchEvent(
        new CustomEvent('sentence-audio-regenerated', {
          detail: { sentenceId: this.sentence.id, audioPath: regeneratedPath },
          bubbles: true,
          composed: true,
        })
      );

      // Play the newly generated audio
      // Use a small delay to ensure the file is ready and to allow the UI to update
      setTimeout(async () => {
        try {
          // Stop any currently playing audio to ensure we play only the new one
          audioPlayer.stop();
          await window.electronAPI.audio.stopAudio();

          // Wait a bit more to ensure stop has completed
          await new Promise((resolve) => setTimeout(resolve, 50));

          // Play only the newly generated audio (not before sentence audio)
          if (regeneratedPath) {
            const playbackSpeed = this.playbackSpeed ?? sessionManager.getPlaybackSpeed() ?? 1.0;
            await audioPlayer.play(regeneratedPath, {
              playbackSpeed,
            });
          }
        } catch (playError) {
          logger.warn({ error: playError }, 'Failed to play newly regenerated audio');
          // Don't show error to user as regeneration succeeded
        }
      }, 100);
    } catch (error) {
      logger.error({ error }, 'Failed to regenerate audio');
      const message = getErrorMessage(error);
      window.alert(`Failed to recreate audio: ${message}`);
    } finally {
      this.isRegeneratingAudio = false;
    }
  }

  private handleMarkKnown() {
    this.dispatchEvent(
      new CustomEvent('mark-word-known', {
        detail: { word: this.targetWord },
        bubbles: true,
      })
    );
  }

  private handleMarkIgnored() {
    this.dispatchEvent(
      new CustomEvent('mark-word-ignored', {
        detail: { word: this.targetWord },
        bubbles: true,
      })
    );
  }

  private handleRemoveSentence() {
    this.dispatchEvent(
      new CustomEvent('remove-sentence', {
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleShowOtherSentence() {
    this.dispatchEvent(
      new CustomEvent('show-other-sentence', {
        bubbles: true,
        composed: true,
      })
    );
  }

  private handlePrevious() {
    this.dispatchEvent(
      new CustomEvent('previous-sentence', {
        bubbles: true,
      })
    );
  }

  private handleNext() {
    this.dispatchEvent(
      new CustomEvent('next-sentence', {
        detail: { isLastSentence: this.isLastSentence },
        bubbles: true,
      })
    );
  }

  private setupKeyboardBindings() {
    // Note: Audio playback and word marking keyboard shortcuts are handled
    // by the parent learning-mode component to avoid conflicts
    // This component focuses on its own internal interactions
    const bindings: any[] = [
      // Add any sentence-viewer specific bindings here if needed
    ];

    this.keyboardUnsubscribe = useKeyboardBindings(bindings);
  }

  render() {
    const wordStrength = Math.round(this.targetWord?.strength ?? 0);

    const lastSeenSource = this.displayLastSeen ?? this.sentence?.lastShown;
    const lastSeenText = this.formatTimeAgo(lastSeenSource);

    return html`
      <div class="sentence-container">
        <div class="sentence-header">
          <div class="target-word-info">
            <span class="target-word">${this.targetWord.word}</span>
            <span class="word-separator">•</span>
            <span class="word-translation" title=${this.targetWord.translation}>
              ${this.truncate(this.targetWord.translation, 40)}
            </span>
            <span class="word-separator">•</span>
            <span class="word-strength" title="Current spaced repetition strength">
              Strength <span class="word-strength-value">${wordStrength}</span>
            </span>
            <span class="word-separator">•</span>
            <span
              class="last-seen"
              title=${this.sentence?.lastShown
                ? this.sentence.lastShown.toLocaleString()
                : 'Never viewed'}
            >
              Last seen ${lastSeenText}
            </span>
          </div>

          <div
            class="flex gap-xs"
            style="display: flex; align-items: center; gap: var(--spacing-xs);"
          >
            ${this.sentence.audioPath
              ? html`
                  <button
                    class="audio-button"
                    @click=${this.handlePlayAudio}
                    ?disabled=${audioPlayer.getState().isPlaying || this.isRegeneratingAudio}
                    title="Play audio (Space)"
                  >
                    <span aria-hidden="true">🔊</span>
                  </button>
                `
              : ''}
            <button
              class="audio-button secondary"
              @click=${this.handleRecreateAudio}
              ?disabled=${audioPlayer.getState().isPlaying || this.isRegeneratingAudio}
              title="Recreate audio"
            >
              <span aria-hidden="true">♻</span>
            </button>
          </div>
        </div>

        <div class="sentence-content">
          ${this.sentence.contextBefore
            ? html`
                <div
                  class="context-section ${this.localPlayingAudio === 'before' ? 'playing' : ''}"
                  @click=${this.handleContextBeforeClick}
                >
                  <div class="context-text">${this.sentence.contextBefore}</div>
                  ${this.sentence.contextBeforePronunciation &&
                  this.sentence.contextBeforePronunciation.trim()
                    ? html`
                        <div class="context-pronunciation">
                          ${this.sentence.contextBeforePronunciation}
                        </div>
                      `
                    : nothing}
                  <div class="context-translation ${this.audioOnlyMode ? 'hidden' : ''}">
                    ${this.sentence.contextBeforeTranslation}
                  </div>
                </div>
              `
            : ''}

          <div
            class="sentence-text ${this.localPlayingAudio === 'main' ? 'playing' : ''}"
            @click=${this.handleSentenceTextClick}
          >
            ${this.parsedWords.map((wordInfo) => {
              // For whitespace and punctuation, render without word styling
              if (/^\s+$/.test(wordInfo.text) || /^[.,!?;:]+$/.test(wordInfo.text)) {
                return html`${wordInfo.text}`;
              }

              // For actual words, render with full styling
              const tooltipText = this.getWordTooltip(wordInfo);
              const isPopupOpen =
                this.wordPopup &&
                this.wordPopup.wordInfo.text.trim() === wordInfo.text.trim() &&
                this.wordPopup.wordInfo.dictionaryForm === wordInfo.dictionaryForm;
              return html`
                <span
                  class="word-in-sentence ${this.getWordClass(wordInfo)}"
                  @click=${(e: MouseEvent) => {
                    this.handleWordHoverEnd(wordInfo); // Clear hover tracking on click
                    this.handleWordClick(wordInfo, e);
                  }}
                  @mouseenter=${(e: MouseEvent) => {
                    this.handleTooltipPosition(e);
                    this.handleWordHoverStart(wordInfo);
                  }}
                  @mouseleave=${() => this.handleWordHoverEnd(wordInfo)}
                  aria-label=${tooltipText || nothing}
                >
                  ${wordInfo.text}
                  ${tooltipText && !isPopupOpen
                    ? html`<div class="tooltip">${tooltipText}</div>`
                    : nothing}
                </span>
              `;
            })}
            ${this.wordPopup
              ? html`
                  <div
                    class="word-popup"
                    style="${this.getPopupStyle()}"
                    @click=${(e: Event) => e.stopPropagation()}
                  >
                    ${(() => {
                      const wordInfo = this.wordPopup!.wordInfo;
                      const word = wordInfo.isTargetWord ? this.targetWord : wordInfo.wordData;
                      const isKnown = word?.known ?? false;
                      const isIgnored = word?.ignored ?? false;
                      const existsInLearning = !!word || wordInfo.isTargetWord;
                      const needsAddToLearningSet = !existsInLearning;

                      const buttons: any[] = [];

                      if (!isKnown) {
                        buttons.push(html`
                          <button
                            class="word-popup-button known"
                            @click=${this.handleMarkWordKnown}
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
                            @click=${this.handleIgnoreWord}
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
                            @click=${this.handleAddToLearningSet}
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
                          @click=${this.handleExplainGrammar}
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
                            ${wordInfo.isTargetWord
                              ? 'Target word'
                              : isKnown
                                ? 'Already known'
                                : 'Already ignored'}
                          </div>
                        `);
                      }

                      return buttons;
                    })()}
                  </div>
                `
              : nothing}
            ${this.sentence.pronunciation && this.sentence.pronunciation.trim()
              ? html` <div class="sentence-pronunciation">${this.sentence.pronunciation}</div> `
              : nothing}
            <div class="sentence-translation ${this.audioOnlyMode ? 'hidden' : ''}">
              ${this.sentence.translation}
            </div>
          </div>

          ${this.sentence.contextAfter
            ? html`
                <div
                  class="context-section ${this.localPlayingAudio === 'after' ? 'playing' : ''}"
                  @click=${this.handleContextAfterClick}
                >
                  <div class="context-text">${this.sentence.contextAfter}</div>
                  ${this.sentence.contextAfterPronunciation &&
                  this.sentence.contextAfterPronunciation.trim()
                    ? html`
                        <div class="context-pronunciation">
                          ${this.sentence.contextAfterPronunciation}
                        </div>
                      `
                    : nothing}
                  <div class="context-translation ${this.audioOnlyMode ? 'hidden' : ''}">
                    ${this.sentence.contextAfterTranslation}
                  </div>
                </div>
              `
            : ''}
        </div>

        <div class="word-actions">
          <button
            class="btn btn-secondary nav-action-btn"
            @click=${this.handlePrevious}
            ?disabled=${this.isFirstSentence || this.isProcessing || this.autoScrollEnabled}
          >
            Previous <span class="keyboard-hint">(←)</span>
          </button>

          <button
            class="btn btn-success word-action-btn"
            @click=${this.handleMarkKnown}
            ?disabled=${this.targetWord.known}
          >
            ${this.targetWord.known ? 'Already Known' : 'Know'}
            ${!this.targetWord.known ? html`<span class="keyboard-hint">(K)</span>` : ''}
          </button>

          <button class="btn btn-danger word-action-btn" @click=${this.handleRemoveSentence}>
            Remove
            <span class="keyboard-hint">(Del)</span>
          </button>

          <button
            class="btn btn-warning word-action-btn"
            @click=${this.handleMarkIgnored}
            ?disabled=${this.targetWord.ignored}
          >
            ${this.targetWord.ignored ? 'Already Ignored' : 'Ignore'}
            ${!this.targetWord.ignored ? html`<span class="keyboard-hint">(I)</span>` : ''}
          </button>

          <button
            class="btn btn-secondary word-action-btn"
            @click=${this.handleShowOtherSentence}
            ?disabled=${this.isProcessing}
          >
            Other <span class="keyboard-hint">(O)</span>
          </button>

          <button
            class="btn btn-primary nav-action-btn"
            @click=${this.handleNext}
            ?disabled=${this.isProcessing || this.autoScrollEnabled}
          >
            ${this.isLastSentence ? 'Finish' : 'Next'} <span class="keyboard-hint">(→)</span>
          </button>
        </div>

        ${this.isFetchingGrammar
          ? html`
              <div class="grammar-loading-box">
                <div class="spinner"></div>
                <span>Loading explanation...</span>
              </div>
            `
          : nothing}
        ${this.grammarExplanation
          ? html`
              <div class="grammar-explanation-box">
                <div class="grammar-explanation-header">
                  <button
                    class="grammar-close-btn"
                    @click=${this.handleCloseGrammarExplanation}
                    title="Close"
                  >
                    ×
                  </button>
                </div>
                <div
                  class="grammar-explanation-content"
                  @contextmenu=${this.handleGrammarContextMenu}
                >
                  ${unsafeHTML(markdownToHtml(this.grammarExplanation.explanation))}
                </div>
                ${this.contextMenu
                  ? html`
                      <div
                        class="context-menu"
                        style="left: ${this.contextMenu.x}px; top: ${this.contextMenu.y}px;"
                        @click=${(e: Event) => e.stopPropagation()}
                      >
                        <div class="context-menu-item" @click=${this.handleReadSelectedText}>
                          Read out loud
                        </div>
                      </div>
                    `
                  : nothing}
              </div>
            `
          : nothing}
      </div>
    `;
  }
}
