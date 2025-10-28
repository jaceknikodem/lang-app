/**
 * Sentence viewer component for learning mode
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import { Word, Sentence, DictionaryEntry } from '../../shared/types/core.js';
import { useKeyboardBindings } from '../utils/keyboard-manager.js';
import type { TokenizedWord as WordInSentence } from '../utils/sentence-tokenizer.js';

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

  @state()
  private isPlayingAudio = false;

  @state()
  private isRegeneratingAudio = false;

  @state()
  private parsedWords: WordInSentence[] = [];

  @state()
  private autoplayEnabled = false;

  @state()
  private dictionaryCache: Record<string, DictionaryEntry[] | null> = {};

  private dictionaryLookupInFlight = new Set<string>();
  private dictionaryLookupPromises: Partial<Record<string, Promise<DictionaryEntry[] | null>>> = {};

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

      .audio-button.secondary {
        background: var(--background-secondary);
        color: var(--text-primary);
        border: 1px solid var(--border-color);
      }

      .audio-button.secondary:hover:not(:disabled) {
        background: #e9e9e9;
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
        left: 0;
        transform: none;
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
        left: 14px;
        transform: none;
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

  private parseSentence(): void {
    if (!this.sentence?.sentence) {
      this.parsedWords = [];
      return;
    }

    const parts = this.sentence.sentence.split(/(\s+|[.,!?;:])/);

    this.parsedWords = parts.map(text => {
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

      const isTargetWord = cleanText === this.targetWord.word.toLowerCase();

      const wordData = this.allWords.find(w =>
        w.word.toLowerCase() === cleanText
      );

      const dictionaryKey = this.buildDictionaryKey(dictionaryForm);

      if (!wordData && !isTargetWord && dictionaryKey) {
        void this.ensureDictionaryEntry(dictionaryForm, dictionaryKey);
      }

      return {
        text,
        isTargetWord,
        wordData,
        dictionaryForm,
        dictionaryKey
      };
    });
  }

  private formatTimeAgo(date?: Date): string {
    if (!date) {
      return 'never';
    }
    const now = Date.now();
    const diffMs = now - date.getTime();
    const sec = Math.floor(diffMs / 1000);
    if (sec < 10) return 'just now';
    if (sec < 60) return `${sec} second${sec === 1 ? '' : 's'} ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
    const week = Math.floor(day / 7);
    if (week < 5) return `${week} week${week === 1 ? '' : 's'} ago`;
    const month = Math.floor(day / 30);
    if (month < 12) return `${month} month${month === 1 ? '' : 's'} ago`;
    const year = Math.floor(day / 365);
    return `${year} year${year === 1 ? '' : 's'} ago`;
  }

  // Allows async tokenization pipelines to push pre-processed words into the view.
  public applyTokenizedWords(words: WordInSentence[]): void {
    this.parsedWords = words;
  }

  private buildDictionaryKey(word: string): string | undefined {
    const trimmed = word.trim();
    if (!trimmed) {
      return undefined;
    }

    const language = this.targetWord?.language?.toLowerCase() || 'unknown';
    return `${language}|${trimmed.toLowerCase()}`;
  }

  private async ensureDictionaryEntry(word: string, key: string): Promise<void> {
    await this.getDictionaryEntries(word, key);
  }

  private async getDictionaryEntries(word: string, key?: string): Promise<DictionaryEntry[] | null> {
    const dictionaryKey = key ?? this.buildDictionaryKey(word);

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
        const entries = await window.electronAPI.database.lookupDictionary(word, this.targetWord?.language);
        const normalizedEntries = Array.isArray(entries) && entries.length > 0 ? entries : null;
        this.dictionaryCache = {
          ...this.dictionaryCache,
          [dictionaryKey]: normalizedEntries
        };
        return normalizedEntries;
      } catch (error) {
        console.error('Failed to load dictionary entries:', error);
        this.dictionaryCache = {
          ...this.dictionaryCache,
          [dictionaryKey]: null
        };
        return null;
      } finally {
        this.dictionaryLookupInFlight.delete(dictionaryKey);
        delete this.dictionaryLookupPromises[dictionaryKey];
      }
    })();

    this.dictionaryLookupPromises[dictionaryKey] = lookupPromise;
    return lookupPromise;
  }

  private formatDictionaryTooltip(entries: DictionaryEntry[]): string {
    if (!entries.length) {
      return '';
    }

    const language = entries[0]?.lang || this.targetWord?.language || '';
    const content = entries
      .map(entry => {
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

  private getWordTooltip(wordInfo: WordInSentence): string {
    // No tooltip for whitespace or punctuation
    if (/^\s+$/.test(wordInfo.text) || /^[.,!?;:]+$/.test(wordInfo.text)) {
      return '';
    }
    
    if (wordInfo.isTargetWord) {
      return 'Target word';
    }

    const word = wordInfo.wordData;
    
    if (!word) {
      if (!wordInfo.dictionaryKey) {
        return '';
      }

      if (this.dictionaryLookupInFlight.has(wordInfo.dictionaryKey)) {
        return 'Looking up dictionary…';
      }

      const cachedEntries = this.dictionaryCache[wordInfo.dictionaryKey];

      if (cachedEntries === undefined) {
        // Trigger lookup if somehow missing (should already be queued)
        void this.ensureDictionaryEntry(wordInfo.dictionaryForm ?? '', wordInfo.dictionaryKey);
        return 'Looking up dictionary…';
      }

      if (!cachedEntries || cachedEntries.length === 0) {
        return '';
      }

      return this.formatDictionaryTooltip(cachedEntries);
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
      await this.addWordFromSentence(wordInfo);
      return;
    }

    const word = wordInfo.isTargetWord ? this.targetWord : wordInfo.wordData!;
    
    // Emit event for parent to handle word status change
    this.dispatchEvent(new CustomEvent('word-clicked', {
      detail: { word, wordText: wordInfo.text.trim() },
      bubbles: true,
      composed: true
    }));
  }

  private async addWordFromSentence(wordInfo: WordInSentence): Promise<void> {
    const rawWord = wordInfo.dictionaryForm?.trim() || wordInfo.text.trim();
    if (!rawWord) {
      return;
    }

    const normalized = rawWord.replace(/\s+/g, ' ');
    const alreadyTracked = this.allWords.some(existing =>
      existing.word.toLowerCase() === normalized.toLowerCase()
    );

    if (alreadyTracked) {
      this.dispatchEvent(new CustomEvent('word-addition-skipped', {
        detail: { word: normalized },
        bubbles: true,
        composed: true
      }));
      return;
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
      console.warn('Dictionary lookup failed for', normalized, error);
    }

    const translation = (suggestedTranslation || normalized).trim();

    try {
      const audioPath = await window.electronAPI.audio.generateAudio(
        normalized,
        this.targetWord.language
      );

      const wordId = await window.electronAPI.database.insertWord({
        word: normalized,
        language: this.targetWord.language,
        translation,
        audioPath
      });

      await window.electronAPI.jobs.enqueueWordGeneration(wordId, {
        language: this.targetWord.language,
        desiredSentenceCount: 3
      });

      const newWord = await window.electronAPI.database.getWordById(wordId);
      if (newWord) {
        this.allWords = [...this.allWords, newWord];
        this.parseSentence();
      }

      this.dispatchEvent(new CustomEvent('word-added-from-sentence', {
        detail: {
          wordId,
          word: normalized,
          translation
        },
        bubbles: true,
        composed: true
      }));
    } catch (error) {
      console.error('Failed to add word from sentence:', error);
      this.dispatchEvent(new CustomEvent('word-addition-error', {
        detail: {
          word: normalized,
          message: error instanceof Error ? error.message : 'Unknown error while adding word.'
        },
        bubbles: true,
        composed: true
      }));
    }
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

      this.dispatchEvent(new CustomEvent('sentence-audio-played', {
        detail: {
          sentenceId: this.sentence.id,
          wordId: this.targetWord.id
        },
        bubbles: true,
        composed: true
      }));
    } catch (error) {
      console.error('Failed to play audio:', error);
    } finally {
      // Reset after a delay to prevent rapid clicking
      setTimeout(() => {
        this.isPlayingAudio = false;
      }, 500);
    }
  }

  private async handleRecreateAudio() {
    if (this.isRegeneratingAudio || !this.sentence?.sentence) {
      return;
    }

    this.isRegeneratingAudio = true;
    console.info('Recreate audio: start');
    try {
      // Ensure no audio is playing
      try {
        await window.electronAPI.audio.stopAudio();
        this.isPlayingAudio = false;
      } catch (e) {
        console.warn('Stop audio before regenerate failed (non-fatal):', e);
      }

      const oldPath = this.sentence.audioPath;
      const language = this.targetWord?.language;
      const word = this.targetWord?.word;

      console.info('Recreate audio: invoking regenerateAudio', { oldPath });

      let regeneratedPath: string | undefined;

      if (typeof window.electronAPI.audio.regenerateAudio === 'function') {
        const result = await window.electronAPI.audio.regenerateAudio({
          text: this.sentence.sentence,
          language,
          word,
          existingPath: oldPath
        });
        regeneratedPath = result?.audioPath;
      } else {
        console.warn('Recreate audio: regenerateAudio not available, using fallback flow');
        const fallbackLanguage = language || this.targetWord?.language;
        if (!fallbackLanguage) {
          throw new Error('Unable to determine language for audio generation');
        }

        const fallbackWord = `${word || this.targetWord?.word || 'sentence'}-regen-${Date.now()}`;

        // Generate new audio under a temporary scoped word to avoid clashes
        regeneratedPath = await window.electronAPI.audio.generateAudio(
          this.sentence.sentence,
          fallbackLanguage,
          fallbackWord
        );

        if (oldPath && oldPath !== regeneratedPath) {
          await window.electronAPI.database.updateSentenceAudioPath(this.sentence.id, regeneratedPath);
          console.info('Recreate audio (fallback): DB audio_path updated for sentence', this.sentence.id);

          try {
            await window.electronAPI.audio.deleteRecording(oldPath);
          } catch (deleteError) {
            console.warn('Recreate audio (fallback): failed to delete previous audio', deleteError);
          }
        }
      }

      if (!regeneratedPath) {
        throw new Error('Audio regeneration returned an empty path');
      }

      if (typeof window.electronAPI.audio.regenerateAudio === 'function' && (!oldPath || regeneratedPath !== oldPath)) {
        await window.electronAPI.database.updateSentenceAudioPath(this.sentence.id, regeneratedPath);
        console.info('Recreate audio: DB audio_path updated for sentence', this.sentence.id);
      }

      console.info('Recreate audio: regeneration completed with path', regeneratedPath);

      this.sentence = { ...this.sentence, audioPath: regeneratedPath };

      // Optional event for parent components
      this.dispatchEvent(new CustomEvent('sentence-audio-regenerated', {
        detail: { sentenceId: this.sentence.id, audioPath: regeneratedPath },
        bubbles: true,
        composed: true
      }));
    } catch (error) {
      console.error('Failed to regenerate audio:', error);
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`Failed to recreate audio: ${message}`);
    } finally {
      this.isRegeneratingAudio = false;
      console.info('Recreate audio: end');
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

  private handleRemoveSentence() {
    this.dispatchEvent(new CustomEvent('remove-sentence', {
      bubbles: true,
      composed: true
    }));
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
            <span class="word-translation">${this.targetWord.translation}</span>
            <span class="word-separator">•</span>
            <span class="word-strength" title="Current spaced repetition strength">
              Strength <span class="word-strength-value">${wordStrength}</span>
            </span>
            <span class="word-separator">•</span>
            <span class="last-seen" title=${this.sentence?.lastShown ? this.sentence.lastShown.toLocaleString() : 'Never viewed'}>
              Last seen ${lastSeenText}
            </span>
          </div>
          
          ${this.sentence.audioPath ? html`
            <div class="flex gap-sm">
              <button
                class="audio-button"
                @click=${this.handlePlayAudio}
                ?disabled=${this.isPlayingAudio || this.isRegeneratingAudio}
                title="Play audio (Space)"
              >
                <svg class="audio-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                </svg>
              </button>
              <button
                class="audio-button secondary"
                @click=${this.handleRecreateAudio}
                ?disabled=${this.isPlayingAudio || this.isRegeneratingAudio}
                title="Recreate audio"
              >
                ♻
              </button>
            </div>
          ` : ''}
        </div>

        <div class="sentence-content">
          ${this.sentence.contextBefore ? html`
            <div class="context-section">
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
              const tooltipText = this.getWordTooltip(wordInfo);
              return html`
                <span
                  class="word-in-sentence ${this.getWordClass(wordInfo)}"
                  @click=${() => this.handleWordClick(wordInfo)}
                  aria-label=${tooltipText || nothing}
                >
                  ${wordInfo.text}
                  ${tooltipText ? html`<div class="tooltip">${tooltipText}</div>` : nothing}
                </span>
              `;
            })}
          </div>
          
          <div class="sentence-translation">
            ${this.sentence.translation}
          </div>
          
          ${this.sentence.contextAfter ? html`
            <div class="context-section">
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
            class="btn btn-danger word-action-btn"
            @click=${this.handleRemoveSentence}
          >
            Remove Sentence
            <span class="keyboard-hint">(Del)</span>
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
