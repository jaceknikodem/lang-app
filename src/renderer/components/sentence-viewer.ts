import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import { sentenceViewerStyles } from './sentence-viewer.styles.js';
import './grammar-explanation.js';
import './word-popup.js';
import { truncate, formatTimeAgo, getWordClass } from './sentence-viewer-helpers.js';
import { SentenceTokenizationController } from './sentence-tokenization-controller.js';
import { SentenceAudioController } from './sentence-audio-controller.js';
import type { Word, Sentence } from '../../shared/types/core.js';
import { getErrorMessage } from '../../shared/utils/error.js';
import { useKeyboardBindings } from '../utils/keyboard-manager.js';
import type { TokenizedWord as WordInSentence } from '../utils/sentence-tokenizer.js';
import { logger } from '../utils/logger.js';
import { audioPlayer } from '../utils/audio-player-service.js';
import { checkProficiencyLevel } from '../utils/app-initializer.js';
import { hiraganaToRomaji } from '../utils/hiragana-romaji.js';

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

  @property({ type: Number })
  playbackSpeed?: number; // Playback speed multiplier (defaults to 1.0)

  @state()
  private autoplayEnabled = false;

  @state()
  private wordPopup: { wordInfo: WordInSentence; position: { x: number; y: number } } | null = null;

  @state()
  private grammarExplanation: { word: string; explanation: string } | null = null;

  @state()
  private isFetchingGrammar = false;

  @state()
  private wordReading = ''; // hiragana reading of targetWord (Japanese only)

  private lastGrammarSentenceId?: number;
  private keyboardUnsubscribe?: () => void;

  // Controllers own their respective state and call host.requestUpdate() when it changes.
  // The host reads controller state in render() via tokenizationCtrl.parsedWords etc.
  readonly tokenizationCtrl = new SentenceTokenizationController(this);
  readonly audioCtrl = new SentenceAudioController(this);

  static styles = [sharedStyles, sentenceViewerStyles];

  /** Called by SentenceAudioController when audio regeneration produces a new sentence object. */
  updateSentence(sentence: Sentence): void {
    this.sentence = sentence;
  }

  async connectedCallback() {
    super.connectedCallback();
    // tokenizationCtrl.hostConnected() runs inside super.connectedCallback() above
    await this.loadAutoplaySettings();
    this.setupKeyboardBindings();
    this.checkInitialAutoplay();
    document.addEventListener('click', this.handleOutsideClick);
    document.addEventListener('keydown', this.handleKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.keyboardUnsubscribe) this.keyboardUnsubscribe();
    document.removeEventListener('click', this.handleOutsideClick);
    document.removeEventListener('keydown', this.handleKeyDown);
    audioPlayer.stop();
  }

  private handleOutsideClick = () => {
    // Word clicks (which open the popup) and clicks inside <word-popup> both call
    // stopPropagation, so any click that reaches this document-level listener is
    // genuinely outside the popup and should dismiss it.
    if (this.wordPopup) this.closeWordPopup();
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.wordPopup) this.closeWordPopup();
  };

  private handleGrammarStateOnSentenceChange(currentSentenceId?: number): void {
    if (currentSentenceId !== this.lastGrammarSentenceId) {
      this.grammarExplanation = null;
      this.isFetchingGrammar = false;
      this.lastGrammarSentenceId = currentSentenceId;
    }
  }

  updated(changedProperties: Map<string, any>) {
    if (changedProperties.has('currentPlayingAudio')) {
      this.audioCtrl.localPlayingAudio = this.currentPlayingAudio;
      this.requestUpdate();
    }

    const sentenceChanged = changedProperties.has('sentence');
    const allWordsChanged = changedProperties.has('allWords');

    if (sentenceChanged) {
      this.handleGrammarStateOnSentenceChange(this.sentence?.id);
    }

    const relevantPropertyChanged =
      sentenceChanged ||
      allWordsChanged ||
      changedProperties.has('targetWord') ||
      changedProperties.has('displayLastSeen');

    if (!relevantPropertyChanged) return;

    if (sentenceChanged || allWordsChanged) {
      this.tokenizationCtrl.handleSentenceChange(sentenceChanged, allWordsChanged);
    }

    if (sentenceChanged) this.handleAutoplayOnSentenceChange();

    if (changedProperties.has('targetWord') && this.targetWord) {
      void this.fetchWordReading();
    }
  }

  private async fetchWordReading(): Promise<void> {
    const lang = this.targetWord?.language?.toLowerCase();
    if (lang !== 'japanese' && lang !== 'ja') {
      this.wordReading = '';
      return;
    }
    try {
      const readings = await window.electronAPI.japaneseTokenization.getWordReadings([
        this.targetWord.word,
      ]);
      this.wordReading = readings[this.targetWord.word] ?? '';
    } catch {
      this.wordReading = '';
    }
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
    if (this.autoplayEnabled && this.sentence?.audioPath) {
      console.log('Initial autoplay triggered for first sentence');
      this.handleAutoPlay();
    }
  }

  private handleAutoplayOnSentenceChange(): void {
    void this.loadAutoplaySettings().then(() => {
      if (this.autoplayEnabled && this.sentence?.audioPath) {
        console.log('Autoplay triggered - sentence changed or first set');
        this.handleAutoPlay();
      }
    });
  }

  private async handleAutoPlay() {
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      void this.audioCtrl.handlePlayAudio();
    } catch (error) {
      logger.warn({ error }, 'Failed to handle auto-play');
    }
  }

  /** Allows async tokenization pipelines to push pre-processed words into the view. */
  public applyTokenizedWords(words: WordInSentence[]): void {
    this.tokenizationCtrl.applyTokenizedWords(words);
  }

  private async handleWordClick(wordInfo: WordInSentence, event: MouseEvent) {
    if (/^\s+$/.test(wordInfo.text) || /^[.,!?;:]+$/.test(wordInfo.text)) return;

    // Prevent outside-click handler from firing immediately after this opens the popup
    event.stopPropagation();

    if (this.wordPopup) {
      const sameWord =
        this.wordPopup.wordInfo.text.trim() === wordInfo.text.trim() &&
        this.wordPopup.wordInfo.dictionaryForm === wordInfo.dictionaryForm;
      if (sameWord) {
        this.wordPopup = null;
        this.requestUpdate();
        return;
      }
    }

    this.wordPopup = { wordInfo, position: { x: event.clientX, y: event.clientY } };
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
    const textLength = (tooltip.textContent || '').length;

    let optimalWidth: number;
    if (textLength < 50) {
      optimalWidth = Math.max(150, textLength * 6);
    } else if (textLength < 150) {
      optimalWidth = Math.min(400, Math.max(200, textLength * 4));
    } else {
      optimalWidth = 450;
    }
    tooltip.style.width = `${Math.min(optimalWidth, viewportWidth - 40)}px`;

    const wordCenter = wordRect.left + wordRect.width / 2;
    if (wordCenter > viewportWidth * 0.6) {
      tooltip.classList.add('left');
    } else {
      tooltip.classList.remove('left');
    }
  }

  private async handleIgnoreWord() {
    if (!this.wordPopup) return;

    const wordInfo = this.wordPopup.wordInfo;
    let word: Word | null = wordInfo.isTargetWord ? this.targetWord : wordInfo.wordData || null;

    if (!word) {
      word = await this.addWordFromSentence(wordInfo, false);
      if (!word) {
        this.closeWordPopup();
        return;
      }
    }

    await window.electronAPI.database.markWordIgnored(word.id, true);
    const updatedWord = { ...word, ignored: true };

    const wordIndex = this.allWords.findIndex((w) => w.id === word!.id);
    if (wordIndex !== -1) {
      this.allWords = [
        ...this.allWords.slice(0, wordIndex),
        updatedWord,
        ...this.allWords.slice(wordIndex + 1),
      ];
    } else {
      this.allWords = [...this.allWords, updatedWord];
    }

    this.tokenizationCtrl.updateParsedWordsWordData(updatedWord);

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
      word = await this.addWordFromSentence(wordInfo, false);
      if (!word) {
        this.closeWordPopup();
        return;
      }
    }

    await window.electronAPI.database.markWordKnown(word.id, true);
    await window.electronAPI.database.updateWordStrength(word.id, 100);
    const updatedWord = { ...word, known: true, strength: 100 };

    const wordIndex = this.allWords.findIndex((w) => w.id === word!.id);
    if (wordIndex !== -1) {
      this.allWords = [
        ...this.allWords.slice(0, wordIndex),
        updatedWord,
        ...this.allWords.slice(wordIndex + 1),
      ];
    } else {
      this.allWords = [...this.allWords, updatedWord];
    }

    this.tokenizationCtrl.updateParsedWordsWordData(updatedWord);

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
      const newWord = await this.addWordFromSentence(wordInfo, true);
      if (newWord) this.tokenizationCtrl.updateParsedWordsWordData(newWord);
    } else {
      const word = wordInfo.isTargetWord ? this.targetWord : wordInfo.wordData!;
      this.tokenizationCtrl.updateParsedWordsWordData(word);
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
      const proficiencyLevel = await checkProficiencyLevel(language);
      const explanation = await window.electronAPI.llm.explainGrammar(
        wordText,
        sentenceText,
        language,
        proficiencyLevel || undefined,
        word.id,
        this.sentence.id
      );

      this.grammarExplanation = { word: wordText, explanation };
      this.lastGrammarSentenceId = this.sentence?.id;
    } catch (error) {
      logger.error({ error }, 'Failed to get explanation');
      window.alert('Failed to get explanation. Please try again.');
    } finally {
      this.isFetchingGrammar = false;
    }
  }

  private handleCloseGrammarExplanation() {
    this.grammarExplanation = null;
  }

  private async handleReadAloud(selectedText: string) {
    if (!selectedText) return;

    try {
      const language =
        this.targetWord?.language || (await window.electronAPI.database.getCurrentLanguage());

      let audioPath: string;
      const cached = await window.electronAPI.database.getReadAloudCache(selectedText, language);

      if (cached) {
        const audioExists = await window.electronAPI.audio.audioExists(cached.audioPath);
        if (audioExists) {
          audioPath = cached.audioPath;
        } else {
          logger.warn(
            { audioPath: cached.audioPath, selectedText },
            'Cached audio file not found, regenerating'
          );
          audioPath = await window.electronAPI.audio.generateAudio(selectedText, language);
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
        audioPath = await window.electronAPI.audio.generateAudio(selectedText, language);
        try {
          await window.electronAPI.database.insertReadAloudCache(selectedText, language, audioPath);
        } catch (cacheError) {
          logger.warn({ error: cacheError, audioPath, selectedText }, 'Failed to cache audio');
        }
      }

      await audioPlayer.play(audioPath, {
        playbackSpeed: this.playbackSpeed || 1.0,
        onError: (error: Error) => {
          logger.error({ error, audioPath, selectedText }, 'Error during audio playback');
        },
      });
    } catch (error) {
      logger.error({ error, selectedText }, 'Failed to read selected text');
      alert(`Failed to read text: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async addWordFromSentence(
    wordInfo: WordInSentence,
    generateSentences: boolean = true
  ): Promise<Word | null> {
    const rawWord = wordInfo.dictionaryForm?.trim() || wordInfo.text.trim();
    if (!rawWord) return null;

    let wordToAdd: string;
    if (wordInfo.lemma) {
      wordToAdd = wordInfo.lemma;
    } else {
      const isJapanese =
        this.targetWord.language?.toLowerCase() === 'japanese' ||
        this.targetWord.language?.toLowerCase() === 'ja';

      if (isJapanese) {
        wordToAdd = rawWord.replace(/\s+/g, ' ');
      } else {
        try {
          const lemmas = await window.electronAPI.lemmatization.lemmatizeWords(
            [rawWord.toLowerCase()],
            this.targetWord.language
          );
          const lemma: string | undefined = lemmas[rawWord.toLowerCase()];
          wordToAdd = lemma || rawWord.replace(/\s+/g, ' ');
        } catch (error) {
          logger.warn({ error, rawWord }, 'Failed to lemmatize word (non-critical)');
          wordToAdd = rawWord.replace(/\s+/g, ' ');
        }
      }
    }

    const normalized = wordToAdd.replace(/\s+/g, ' ');

    const alreadyTracked = this.allWords.some(
      (existing) => existing.word.toLowerCase() === normalized.toLowerCase()
    );

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
      const entries = await this.tokenizationCtrl.getDictionaryEntries(
        normalized,
        wordInfo.dictionaryKey
      );
      if (entries && entries.length > 0) {
        const gloss = Array.isArray(entries[0].glosses) ? entries[0].glosses[0] : '';
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

      if (generateSentences) {
        await window.electronAPI.jobs.enqueueWordGeneration(wordId, {
          language: this.targetWord.language,
          desiredSentenceCount: 3,
        });
      }

      const newWord = await window.electronAPI.database.getWordById(wordId);
      if (newWord) {
        this.allWords = [...this.allWords, newWord];
      }

      this.dispatchEvent(
        new CustomEvent('word-added-from-sentence', {
          detail: { wordId, word: normalized, translation },
          bubbles: true,
          composed: true,
        })
      );

      window.dispatchEvent(new CustomEvent('words-updated', { bubbles: true, composed: true }));

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

  private handleMarkKnown() {
    this.dispatchEvent(
      new CustomEvent('mark-word-known', { detail: { word: this.targetWord }, bubbles: true })
    );
  }

  private handleMarkIgnored() {
    this.dispatchEvent(
      new CustomEvent('mark-word-ignored', { detail: { word: this.targetWord }, bubbles: true })
    );
  }

  private handleRemoveSentence() {
    this.dispatchEvent(new CustomEvent('remove-sentence', { bubbles: true, composed: true }));
  }

  private handleShowOtherSentence() {
    this.dispatchEvent(new CustomEvent('show-other-sentence', { bubbles: true, composed: true }));
  }

  private handlePrevious() {
    this.dispatchEvent(new CustomEvent('previous-sentence', { bubbles: true }));
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
    const bindings: any[] = [];
    this.keyboardUnsubscribe = useKeyboardBindings(bindings);
  }

  private renderHeader(): TemplateResult {
    const wordStrength = Math.round(this.targetWord?.strength ?? 0);
    const lastSeenSource = this.displayLastSeen ?? this.sentence?.lastShown;
    const lastSeenText = formatTimeAgo(lastSeenSource);

    return html`
      <div class="sentence-header">
        <div class="target-word-info">
          <span class="target-word">
            ${this.targetWord.word}
            ${this.wordReading
              ? html`<div class="word-reading-tooltip">
                  <span class="tooltip-hiragana">${this.wordReading}</span>
                  <span class="tooltip-romaji">${hiraganaToRomaji(this.wordReading)}</span>
                </div>`
              : nothing}
          </span>
          <span class="word-separator">•</span>
          <span class="word-translation" title=${this.targetWord.translation}>
            ${truncate(this.targetWord.translation, 40)}
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
                  @click=${() => this.audioCtrl.handlePlayAudio()}
                  ?disabled=${audioPlayer.getState().isPlaying ||
                  this.audioCtrl.isRegeneratingAudio}
                  title="Play audio (Space)"
                >
                  <span aria-hidden="true">🔊</span>
                </button>
              `
            : ''}
          <button
            class="audio-button secondary"
            @click=${() => this.audioCtrl.handleRecreateAudio()}
            ?disabled=${audioPlayer.getState().isPlaying || this.audioCtrl.isRegeneratingAudio}
            title="Recreate audio"
          >
            <span aria-hidden="true">♻</span>
          </button>
        </div>
      </div>
    `;
  }

  private renderContextSection(
    text: string | undefined,
    pronunciation: string | undefined,
    translation: string | undefined,
    audioType: 'before' | 'after',
    onClick: (e: MouseEvent) => void
  ): TemplateResult {
    if (!text) return html``;

    const isPlaying = this.audioCtrl.localPlayingAudio === audioType;

    return html`
      <div class="context-section ${isPlaying ? 'playing' : ''}" @click=${onClick}>
        <div class="context-text">${text}</div>
        ${pronunciation && pronunciation.trim()
          ? html`
              <div class="context-pronunciation">
                ${pronunciation}
                <div class="word-reading-tooltip">
                  <span class="tooltip-romaji">${hiraganaToRomaji(pronunciation)}</span>
                </div>
              </div>
            `
          : nothing}
        <div class="context-translation ${this.audioOnlyMode ? 'hidden' : ''}">${translation}</div>
      </div>
    `;
  }

  private renderWord(wordInfo: WordInSentence): TemplateResult {
    if (/^\s+$/.test(wordInfo.text) || /^[.,!?;:]+$/.test(wordInfo.text)) {
      return html`${wordInfo.text}`;
    }

    const tooltipText = this.tokenizationCtrl.getWordTooltip(wordInfo);
    const isPopupOpen =
      this.wordPopup &&
      this.wordPopup.wordInfo.text.trim() === wordInfo.text.trim() &&
      this.wordPopup.wordInfo.dictionaryForm === wordInfo.dictionaryForm;

    return html`
      <span
        class="word-in-sentence ${getWordClass(wordInfo)}"
        @click=${(e: MouseEvent) => {
          this.tokenizationCtrl.handleWordHoverEnd(wordInfo);
          this.handleWordClick(wordInfo, e);
        }}
        @mouseenter=${(e: MouseEvent) => {
          this.handleTooltipPosition(e);
          this.tokenizationCtrl.handleWordHoverStart(wordInfo);
        }}
        @mouseleave=${() => this.tokenizationCtrl.handleWordHoverEnd(wordInfo)}
        aria-label=${tooltipText || nothing}
      >
        ${wordInfo.text}
        ${tooltipText && !isPopupOpen ? html`<div class="tooltip">${tooltipText}</div>` : nothing}
      </span>
    `;
  }

  private renderSentenceText(): TemplateResult {
    const lang = this.targetWord?.language?.toLowerCase();
    const isJapanese = lang === 'japanese' || lang === 'ja';

    return html`
      <div
        class="sentence-text ${this.audioCtrl.localPlayingAudio === 'main' ? 'playing' : ''}"
        @click=${this.audioCtrl.handleSentenceTextClick}
      >
        <div class="${isJapanese ? 'japanese-words' : ''}">
          ${this.tokenizationCtrl.parsedWords.map((wordInfo) => this.renderWord(wordInfo))}
        </div>
        <word-popup
          .wordInfo=${this.wordPopup?.wordInfo ?? null}
          .position=${this.wordPopup?.position ?? null}
          .targetWord=${this.targetWord ?? null}
          ?isProcessing=${this.isProcessing}
          ?isFetchingGrammar=${this.isFetchingGrammar}
          @mark-known=${this.handleMarkWordKnown}
          @ignore=${this.handleIgnoreWord}
          @add-to-set=${this.handleAddToLearningSet}
          @explain-grammar=${this.handleExplainGrammar}
        ></word-popup>
        ${this.sentence.pronunciation && this.sentence.pronunciation.trim()
          ? html`
              <div class="sentence-pronunciation">
                ${this.sentence.pronunciation}
                <div class="word-reading-tooltip">
                  <span class="tooltip-romaji"
                    >${hiraganaToRomaji(this.sentence.pronunciation)}</span
                  >
                </div>
              </div>
            `
          : nothing}
        <div class="sentence-translation ${this.audioOnlyMode ? 'hidden' : ''}">
          ${this.sentence.translation}
        </div>
      </div>
    `;
  }

  private renderActionButtons(): TemplateResult {
    return html`
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
    `;
  }

  private renderGrammarExplanation(): TemplateResult {
    return html`
      <grammar-explanation
        .explanation=${this.grammarExplanation?.explanation ?? null}
        ?loading=${this.isFetchingGrammar}
        @close=${this.handleCloseGrammarExplanation}
        @read-aloud=${(e: CustomEvent<{ text: string }>) => this.handleReadAloud(e.detail.text)}
      ></grammar-explanation>
    `;
  }

  render() {
    return html`
      <div class="sentence-container">
        ${this.renderHeader()}

        <div class="sentence-content">
          ${this.renderContextSection(
            this.sentence.contextBefore,
            this.sentence.contextBeforePronunciation,
            this.sentence.contextBeforeTranslation,
            'before',
            this.audioCtrl.handleContextBeforeClick
          )}
          ${this.renderSentenceText()}
          ${this.renderContextSection(
            this.sentence.contextAfter,
            this.sentence.contextAfterPronunciation,
            this.sentence.contextAfterTranslation,
            'after',
            this.audioCtrl.handleContextAfterClick
          )}
        </div>

        ${this.renderActionButtons()} ${this.renderGrammarExplanation()}
      </div>
    `;
  }
}
