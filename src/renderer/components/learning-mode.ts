/**
 * Learning mode component for sentence review and word interaction
 */

import { LitElement, html, css } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import { router } from '../utils/router.js';
import { sessionManager } from '../utils/session-manager.js';
import { Word, Sentence } from '../../shared/types/core.js';
import { keyboardManager, useKeyboardBindings, GlobalShortcuts, CommonKeys } from '../utils/keyboard-manager.js';
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
  private allWords: Word[] = [];

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

  @state()
  private queueSummary: {
    queued: number;
    processing: number;
    failed: number;
    queuedWords: Array<{ wordId: number; word: string; status: 'queued' | 'processing' | 'completed' | 'failed'; language: string; topic?: string }>;
    processingWords: Array<{ wordId: number; word: string; status: 'queued' | 'processing' | 'completed' | 'failed'; language: string; topic?: string }>;
  } = { queued: 0, processing: 0, failed: 0, queuedWords: [], processingWords: [] };

  @state()
  private currentLanguage: string | null = null;

  @state()
  private infoMessage = '';

  @state()
  private infoMessageType: 'info' | 'success' | 'error' = 'info';

  @state()
  private failureMessageExpiresAt: number | null = null;

  @state()
  private autoScrollEnabled = false;

  @state()
  private playbackSpeed: number = 1.0; // 0.9x, 1x, 1.1x, 1.2x

  private sessionStartTime = Date.now();
  private keyboardUnsubscribe?: () => void;
  private lastRecordedSentenceId: number | null = null;
  private queueIntervalId: number | undefined;
  private jobListenerCleanup?: () => void;
  private infoTimeoutId: number | undefined;
  private isReloadingFromQueue = false;
  private currentSentenceDisplayLastSeen?: Date;
  private lastSeenClearFrame: number | null = null;
  private autoScrollTimer: number | null = null;
  
  // Audio cache: Map of audioPath -> blob URL
  // Using Blob URLs instead of data URLs for better performance (no base64 encoding/decoding)
  private audioCache: Map<string, string> = new Map(); // audioPath -> blob URL
  private blobUrlCache: Map<string, string> = new Map(); // audioPath -> blob URL (for cleanup)
  // HTML5 Audio instances for playing cached audio
  private currentAudioElement: HTMLAudioElement | null = null;
  private handleExternalLanguageChange = async (event: Event) => {
    const detail = (event as CustomEvent<{ language?: string }>).detail;
    const newLanguage = detail?.language;

    if (!newLanguage || newLanguage === this.currentLanguage) {
      return;
    }

    this.currentLanguage = newLanguage;
    
    // Update session manager with new language to ensure it uses correct language's session
    sessionManager.setActiveLanguage(newLanguage);
    
    // Reload all data for the new language
    try {
      // Load all words for highlighting purposes
      await this.loadAllWords();
      
      // Load words from database first
      await this.loadSelectedWords();

      const initialRouteData = router.getRouteData<{ specificWords?: Word[] }>();
      if (!initialRouteData?.specificWords?.length) {
        const appended = await this.maybeAppendNewWordsToSession();
        if (appended) {
          await this.loadSelectedWords();
        }
      }
      
      // Load words and sentences before restoring session progress
      await this.loadWordsAndSentences();
      
      // Try to restore learning session from session manager (after words are loaded)
      this.restoreSessionProgress();
      
      // Refresh queue summary
      await this.refreshQueueSummary();
    } catch (error) {
      console.error('Failed to reload data after language change:', error);
    }
  };

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        width: 100%;
        box-sizing: border-box;
      }

      .learning-container {
        width: 100%;
        max-width: 100%;
        min-width: 0;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
        margin: 0;
        padding: 0;
      }

      .queue-status {
        background: var(--background-secondary);
        padding: var(--spacing-sm);
        border-radius: var(--border-radius);
        font-size: 12px;
        color: var(--text-secondary);
        width: 100%;
        max-width: 100%;
        min-width: 0;
        box-sizing: border-box;
        margin: 0;
      }

      .queue-status .queue-warning {
        color: var(--error-color);
        font-weight: 600;
        margin-left: var(--spacing-sm);
      }

      .info-banner {
        padding: var(--spacing-sm);
        border-radius: var(--border-radius);
        font-size: 13px;
        margin-bottom: var(--spacing-sm);
        width: 100%;
        max-width: 100%;
        min-width: 0;
        box-sizing: border-box;
        margin-left: 0;
        margin-right: 0;
      }

      .info-banner.info {
        background: #e3f2fd;
        color: #0d47a1;
      }

      .info-banner.success {
        background: #e8f5e9;
        color: #2e7d32;
      }

      .info-banner.error {
        background: #ffebee;
        color: #c62828;
      }

      .learning-header {
        text-align: center;
      }

      .learning-title {
        font-size: 20px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 var(--spacing-xs) 0;
      }

      .learning-subtitle {
        font-size: 14px;
        color: var(--text-secondary);
        margin: 0;
      }

      .progress-section {
        background: var(--background-secondary);
        padding: var(--spacing-md);
        border-radius: var(--border-radius);
        border: 1px solid var(--border-color);
        width: 100%;
        max-width: 100%;
        min-width: 0;
        box-sizing: border-box;
        margin: 0;
      }

      .progress-info {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--spacing-xs);
        flex-wrap: wrap;
        gap: var(--spacing-sm);
      }

      .progress-text {
        font-size: 12px;
        color: var(--text-secondary);
      }

      .word-counter {
        font-weight: 600;
        color: var(--primary-color);
      }

      .sentence-counter {
        font-size: 10px;
        color: var(--text-tertiary);
      }

      .progress-bar {
        width: 100%;
        height: 4px;
        background: var(--border-color);
        border-radius: 2px;
        overflow: hidden;
      }

      .progress-fill {
        height: 100%;
        background: var(--primary-color);
        transition: width 0.3s ease;
      }


      .nav-info {
        display: flex;
        gap: var(--spacing-md);
        align-items: center;
      }

      .error-message {
        color: var(--error-color);
      }

      .keyboard-hint {
        font-size: 0.8em;
        opacity: 0.7;
        font-weight: normal;
      }
        background: #ffebee;
        padding: var(--spacing-md);
        border-radius: var(--border-radius);
        border: 1px solid #ffcdd2;
        text-align: center;
        font-size: 14px;
      }

      .loading-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-md);
        padding: var(--spacing-lg);
      }

      .empty-state {
        text-align: center;
        padding: var(--spacing-lg);
        color: var(--text-secondary);
      }

      .empty-state h3 {
        color: var(--text-primary);
        margin-bottom: var(--spacing-md);
        font-size: 18px;
      }

      .completion-state {
        text-align: center;
        padding: var(--spacing-lg);
        background: var(--success-color);
        color: white;
        border-radius: var(--border-radius);
      }

      .completion-state h3 {
        margin: 0 0 var(--spacing-sm) 0;
        font-size: 18px;
      }

      .completion-actions {
        display: flex;
        justify-content: center;
        gap: var(--spacing-md);
        margin-top: var(--spacing-md);
        flex-wrap: wrap;
      }

      .auto-scroll-toggle {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        font-size: 14px;
        color: var(--text-secondary);
      }

      .auto-scroll-switch {
        position: relative;
        width: 50px;
        height: 24px;
        background: var(--border-color);
        border-radius: 12px;
        cursor: pointer;
        transition: background-color 0.3s ease;
      }

      .auto-scroll-switch.active {
        background: var(--primary-color);
      }

      .auto-scroll-slider {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 20px;
        height: 20px;
        background: white;
        border-radius: 50%;
        transition: transform 0.3s ease;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      }

      .auto-scroll-switch.active .auto-scroll-slider {
        transform: translateX(22px);
      }

      .auto-scroll-label {
        font-weight: 500;
        user-select: none;
      }

      .playback-speed-control {
        display: flex;
        align-items: center;
        gap: calc(var(--spacing-xs) + 4px);
        font-size: 12px;
        color: var(--text-secondary);
      }

      .playback-speed-label {
        font-weight: 500;
        user-select: none;
      }

      .playback-speed-buttons {
        display: flex;
        gap: 2px;
        background: var(--background-secondary);
        border-radius: var(--border-radius-small);
        padding: 2px;
        border: 1px solid var(--border-color);
      }

      .playback-speed-button {
        padding: 2px 8px;
        border: none;
        background: transparent;
        color: var(--text-secondary);
        border-radius: var(--border-radius-small);
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        min-width: 32px;
      }

      .playback-speed-button:hover {
        background: var(--background-primary);
        color: var(--text-primary);
      }

      .playback-speed-button.active {
        background: var(--primary-color);
        color: white;
      }

      @media (max-width: 768px) {
        .progress-info {
          flex-direction: column;
          align-items: stretch;
          text-align: center;
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
    document.addEventListener('language-changed', this.handleExternalLanguageChange);
    
    await this.loadCurrentLanguage();
    
    // Setup keyboard bindings
    this.setupKeyboardBindings();
    
    // Load all words for highlighting purposes
    await this.loadAllWords();
    
    // Load words from database first
    await this.loadSelectedWords();

    const initialRouteData = router.getRouteData<{ specificWords?: Word[] }>();
    if (!initialRouteData?.specificWords?.length) {
      const appended = await this.maybeAppendNewWordsToSession();
      if (appended) {
        await this.loadSelectedWords();
      }
    }
    
    // Load words and sentences before restoring session progress
    await this.loadWordsAndSentences();
    
    // Try to restore learning session from session manager (after words are loaded)
    this.restoreSessionProgress();

    this.startJobMonitoring();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    
    // Clean up keyboard bindings
    if (this.keyboardUnsubscribe) {
      this.keyboardUnsubscribe();
    }

    // Clean up audio cache and playing audio
    this.stopCachedAudio();
    // Revoke all blob URLs to free memory
    this.blobUrlCache.forEach(blobUrl => URL.revokeObjectURL(blobUrl));
    this.audioCache.clear();
    this.blobUrlCache.clear();

    this.stopJobMonitoring();
    this.clearInfoTimeout();
    this.clearAutoScrollTimer();
    if (this.lastSeenClearFrame !== null) {
      cancelAnimationFrame(this.lastSeenClearFrame);
      this.lastSeenClearFrame = null;
    }
    document.removeEventListener('language-changed', this.handleExternalLanguageChange);
  }

  private async loadCurrentLanguage(): Promise<void> {
    try {
      this.currentLanguage = await window.electronAPI.database.getCurrentLanguage();
    } catch (error) {
      console.error('Failed to load current language for learning mode:', error);
      if (!this.currentLanguage) {
        this.currentLanguage = 'spanish';
      }
    }
  }

  private async loadAllWords() {
    try {
      // Load all words (including known ones) for highlighting purposes
      // Filter by current language to avoid loading words from other languages
      this.allWords = await window.electronAPI.database.getAllWords(true, false, this.currentLanguage ?? undefined);
      console.log('Loaded all words for highlighting:', this.allWords.length);
    } catch (error) {
      console.error('Failed to load all words:', error);
      // Don't set error state here as this is not critical for basic functionality
    }
  }

  private async loadSelectedWords() {
    try {
      // Ensure we have current language loaded
      if (!this.currentLanguage) {
        await this.loadCurrentLanguage();
      }

      // Check if specific words were passed via router (from word selection)
      const routeData = router.getRouteData<{ specificWords?: Word[] }>();
      if (routeData?.specificWords && routeData.specificWords.length > 0) {
        const limitedWords: Word[] = [];
        const seenIds = new Set<number>();

        for (const word of routeData.specificWords) {
          // Filter by current language to prevent loading words from wrong language
          if (this.currentLanguage && word.language !== this.currentLanguage) {
            continue;
          }

          if (seenIds.has(word.id)) {
            continue;
          }

          const sentences = await window.electronAPI.database.getSentencesByWord(word.id);
          if (!sentences.length) {
            continue;
          }

          limitedWords.push(word);
          seenIds.add(word.id);

          if (limitedWords.length >= 20) {
            break;
          }
        }

        this.selectedWords = limitedWords;
        if (limitedWords.length > 0) {
          sessionManager.startNewLearningSession(
            limitedWords.map(word => word.id),
            Math.min(20, limitedWords.length)
          );
        }
        console.log('Using specific words from current session:', this.selectedWords.length);
        return;
      }

      const activeSession = sessionManager.getLearningSession();
      if (activeSession?.wordIds?.length) {
        const orderedWordIds = activeSession.wordIds;
        const loadedWords: Word[] = [];

        for (const wordId of orderedWordIds) {
          const word = await window.electronAPI.database.getWordById(wordId);
          // Filter by current language to prevent loading words from wrong language
          if (word && (!this.currentLanguage || word.language === this.currentLanguage)) {
            loadedWords.push(word);
          }
        }

        if (loadedWords.length > 0) {
          this.selectedWords = loadedWords;
          console.log('Loaded words from persisted learning session:', this.selectedWords.length);
          return;
        }
      }

      // Fallback: Get words that have sentences available for learning, ordered by strength (weakest first)
      // This handles cases like "Continue Learning" or "Practice Weak Words"
      const wordsOrdered = await window.electronAPI.database.getWordsWithSentencesOrderedByStrength(true, false, this.currentLanguage ?? undefined);
      const sessionWordIds: number[] = [];
      const selectableWords: Word[] = [];

      for (const word of wordsOrdered) {
        const sentences = await window.electronAPI.database.getSentencesByWord(word.id);
        if (!sentences.length) {
          continue;
        }

        selectableWords.push(word);
        sessionWordIds.push(word.id);

        if (sessionWordIds.length >= 20) {
          break;
        }
      }

      this.selectedWords = selectableWords;
      if (sessionWordIds.length) {
        sessionManager.startNewLearningSession(sessionWordIds, Math.min(20, sessionWordIds.length));
      }
      console.log('Loaded words with sentences for learning session:', this.selectedWords.length);
    } catch (error) {
      console.error('Failed to load words:', error);
      this.error = 'Failed to load words from database.';
    }
  }

  private prepareSentencesForWord(word: Word, sentences: Sentence[]): Sentence[] {
    if (!sentences.length) {
      return [];
    }

    let orderedSentences = sentences;
    if ((word.strength ?? 0) < 50) {
      orderedSentences = [...sentences].sort((a, b) => {
        const at = a.lastShown ? a.lastShown.getTime() : 0;
        const bt = b.lastShown ? b.lastShown.getTime() : 0;
        return at - bt;
      });
    }

    return orderedSentences.slice(0, 1);
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
      // Check if we have cached IDs in session for fast batch loading
      const activeSession = sessionManager.getLearningSession();
      const hasCachedIds = activeSession?.wordIds?.length && activeSession?.sentenceIds?.length && activeSession?.audioPaths?.length;

      let wordsWithValidSentences: WordWithSentences[];

      if (hasCachedIds && activeSession.wordIds.length === this.selectedWords.length && activeSession.sentenceIds && activeSession.audioPaths) {
        // Fast path: Use cached IDs for batch loading
        console.log('Using cached IDs for fast batch loading');
        
        const wordIds = activeSession.wordIds;
        const sentenceIds = activeSession.sentenceIds;
        const audioPaths = activeSession.audioPaths;

        // Start audio loading in parallel with DB queries (non-blocking)
        const audioLoadPromises = audioPaths.length > 0
          ? audioPaths
              .filter(path => path && !this.audioCache.has(path))
              .map(path => 
                this.loadAudioIntoCache(path).catch(err => {
                  console.warn(`Failed to preload audio ${path}:`, err);
                })
              )
          : [];

        // Start DB queries (await these, audio loads in parallel)
        const [loadedWords, loadedSentences] = await Promise.all([
          window.electronAPI.database.getWordsByIds(wordIds),
          window.electronAPI.database.getSentencesByIds(sentenceIds)
        ]);

        // Note: Audio loading is happening in parallel, we don't await it

        // Build wordId -> sentenceId map from loaded sentences
        const sentenceMapByWordId = new Map<number, Sentence[]>();
        for (const sentence of loadedSentences) {
          if (!sentenceMapByWordId.has(sentence.wordId)) {
            sentenceMapByWordId.set(sentence.wordId, []);
          }
          sentenceMapByWordId.get(sentence.wordId)!.push(sentence);
        }

        // Reconstruct wordsWithSentences array matching wordId -> sentenceIds
        // Filter by current language to prevent loading words from wrong language
        wordsWithValidSentences = loadedWords
          .filter((word: Word) => !this.currentLanguage || word.language === this.currentLanguage)
          .map((word: Word) => {
            const sentences = sentenceMapByWordId.get(word.id) || [];
            // Apply filtering logic (prepareSentencesForWord)
            const limitedSentences = this.prepareSentencesForWord(word, sentences);
            return {
              ...word,
              sentences: limitedSentences
            };
          })
          .filter((w: WordWithSentences) => w.sentences.length > 0);

        // Track audio loading completion (non-blocking)
        void Promise.all(audioLoadPromises).then(() => {
          console.log(`Preloaded ${audioPaths.length} audio files in parallel with DB queries`);
        });

        this.wordsWithSentences = wordsWithValidSentences;
      } else {
        // Fallback: Sequential loading (for new sessions or when cache is missing)
        console.log('Using sequential loading (cache miss or new session)');
        
        const wordsWithSentences: WordWithSentences[] = [];

        for (const word of this.selectedWords) {
          // Filter by current language to prevent loading words from wrong language
          if (this.currentLanguage && word.language !== this.currentLanguage) {
            continue;
          }

          // Get sentences for this word
          const sentences = await window.electronAPI.database.getSentencesByWord(word.id);

          if (!sentences.length) {
            console.warn(`No sentences found for word: ${word.word}`);
          }

          // Keep sentences in their original order for consistent review
          const limitedSentences = this.prepareSentencesForWord(word, sentences);
          wordsWithSentences.push({
            ...word,
            sentences: limitedSentences
          });
        }

        // Filter out words with no sentences but maintain strength-based order
        wordsWithValidSentences = wordsWithSentences.filter(w => w.sentences.length > 0);
        
        // Extract IDs and audio paths for caching
        const wordIds = wordsWithValidSentences.map(w => w.id);
        const sentenceIds: number[] = [];
        const audioPaths: string[] = [];
        
        for (const wordWithSentences of wordsWithValidSentences) {
          for (const sentence of wordWithSentences.sentences) {
            sentenceIds.push(sentence.id);
            if (sentence.audioPath) {
              audioPaths.push(sentence.audioPath);
            }
          }
        }

        // Store IDs and audio paths in session for future fast loading
        if (wordIds.length > 0) {
          sessionManager.startNewLearningSession(
            wordIds,
            Math.min(20, wordIds.length),
            sentenceIds,
            audioPaths
          );
        }

        this.wordsWithSentences = wordsWithValidSentences;
        
        // Pre-load all audio files into cache (background)
        void this.preloadReviewAudio(wordsWithValidSentences);
      }

      console.log(`Words with sentences: ${wordsWithValidSentences.length} out of ${this.selectedWords.length} total words`);

      if (this.wordsWithSentences.length === 0) {
        console.warn('No words have sentences available for learning');
        this.error = 'No sentences available for the selected words. Please generate new words or check if sentence generation completed successfully.';
      } else {
        console.log(`Ready to learn with ${this.wordsWithSentences.length} words`);
        
        // Prioritize: Load current sentence's audio first
        await this.ensureCurrentSentenceAudioLoaded();
        
        // Load next sentence's audio right after current one is ready
        this.preloadNextSentenceAudio();
      }

    } catch (error) {
      console.error('Failed to load words and sentences:', error);
      this.error = 'Failed to load learning content. Please try again.';
    } finally {
      this.isLoading = false;
    }
  }

  private async maybeAppendNewWordsToSession(): Promise<boolean> {
    const activeSession = sessionManager.getLearningSession();
    if (!activeSession) {
      return false;
    }

    try {
      const sessionCreatedAt = new Date(activeSession.createdAt);
      const wordsOrdered = await window.electronAPI.database.getWordsWithSentencesOrderedByStrength(
        true,
        false,
        this.currentLanguage ?? undefined
      );

      const existingWordIds = new Set(activeSession.wordIds);
      const wordsToAppend: number[] = [];

      for (const word of wordsOrdered) {
        if (existingWordIds.has(word.id)) {
          continue;
        }

        if (word.createdAt <= sessionCreatedAt) {
          continue;
        }

        const sentences = await window.electronAPI.database.getSentencesByWord(word.id);
        if (!sentences.length) {
          continue;
        }

        wordsToAppend.push(word.id);

        if (wordsToAppend.length >= 10) {
          break;
        }
      }

      if (wordsToAppend.length) {
        sessionManager.appendWordsToLearningSession(wordsToAppend);
        return true;
      }
    } catch (error) {
      console.error('Failed to append new words to learning session:', error);
    }

    return false;
  }

  private startJobMonitoring(): void {
    if (!window.electronAPI?.jobs) {
      return;
    }

    void this.refreshQueueSummary();

    this.queueIntervalId = window.setInterval(() => {
      void this.refreshQueueSummary();
    }, 5000);

    this.jobListenerCleanup = window.electronAPI.jobs.onWordUpdated(update => {
      void this.handleJobStatusUpdate(update);
    });
  }

  private stopJobMonitoring(): void {
    if (this.queueIntervalId !== undefined) {
      window.clearInterval(this.queueIntervalId);
      this.queueIntervalId = undefined;
    }

    if (this.jobListenerCleanup) {
      this.jobListenerCleanup();
      this.jobListenerCleanup = undefined;
    }
  }

  private async refreshQueueSummary(): Promise<void> {
    if (!window.electronAPI?.jobs) {
      return;
    }

    try {
      if (!this.currentLanguage) {
        await this.loadCurrentLanguage();
      }

      const summary = await window.electronAPI.jobs.getQueueSummary(this.currentLanguage ?? undefined);
      this.queueSummary = summary;

      if (summary.failed > 0) {
        if (this.failureMessageExpiresAt === null || Date.now() > this.failureMessageExpiresAt) {
          this.failureMessageExpiresAt = Date.now() + 10000;
        }
      } else {
        this.failureMessageExpiresAt = null;
      }
    } catch (error) {
      console.warn('Failed to refresh queue summary:', error);
    }
  }

  private async handleJobStatusUpdate(update: { wordId: number; processingStatus: 'queued' | 'processing' | 'ready' | 'failed'; sentenceCount: number }): Promise<void> {
    await this.refreshQueueSummary();

    if (update.processingStatus === 'ready') {
      try {
        // Ensure currentLanguage is loaded before checking
        if (!this.currentLanguage) {
          await this.loadCurrentLanguage();
        }

        const word = await window.electronAPI.database.getWordById(update.wordId);
        if (word) {
          // Check if the word's language matches the currently active language
          if (this.currentLanguage && word.language !== this.currentLanguage) {
            console.log(`[LearningMode] Skipping UI update for word ${word.word} (${word.language}) - active language is ${this.currentLanguage}`);
            // Still update allWords for consistency, but don't modify the review mode UI
            this.allWords = [...this.allWords.filter(existing => existing.id !== word.id), word];
            return;
          }

          this.allWords = [...this.allWords.filter(existing => existing.id !== word.id), word];

          const sentences = await window.electronAPI.database.getSentencesByWord(word.id);
          const preparedSentences = this.prepareSentencesForWord(word, sentences);

          if (!preparedSentences.length) {
            console.warn(`Word ${word.word} has no sentences ready after job completion.`);
            return;
          }

          const existingWordIndex = this.wordsWithSentences.findIndex(w => w.id === word.id);

          if (existingWordIndex !== -1) {
            this.wordsWithSentences = this.wordsWithSentences.map((existing, index) =>
              index === existingWordIndex
                ? { ...word, sentences: preparedSentences }
                : existing
            );
            this.selectedWords = this.selectedWords.map(existing =>
              existing.id === word.id ? word : existing
            );
          } else {
            sessionManager.appendWordsToLearningSession([word.id]);
            this.selectedWords = [...this.selectedWords, word];
            this.wordsWithSentences = [
              ...this.wordsWithSentences,
              { ...word, sentences: preparedSentences }
            ];
          }
        } else {
          await this.loadAllWords();
        }
      } catch (error) {
        console.error('Unable to fetch word after job completion:', error);
      }

    } else if (update.processingStatus === 'failed') {
      this.failureMessageExpiresAt = Date.now() + 10000;
      this.showInfo('Sentence generation failed for a word. Please retry from the queue.', 'error');
    }
  }

  private showInfo(message: string, type: 'info' | 'success' | 'error' = 'info', duration = 4000): void {
    this.infoMessage = message;
    this.infoMessageType = type;
    this.clearInfoTimeout();
    this.infoTimeoutId = window.setTimeout(() => {
      this.infoMessage = '';
      this.infoTimeoutId = undefined;
    }, duration);
  }

  private clearInfoTimeout(): void {
    if (this.infoTimeoutId !== undefined) {
      window.clearTimeout(this.infoTimeoutId);
      this.infoTimeoutId = undefined;
    }
  }

  private clearAutoScrollTimer(): void {
    if (this.autoScrollTimer !== null) {
      window.clearTimeout(this.autoScrollTimer);
      this.autoScrollTimer = null;
    }
  }

  private toggleAutoScroll(): void {
    this.autoScrollEnabled = !this.autoScrollEnabled;
    // Clear any existing timer when toggling off
    if (!this.autoScrollEnabled) {
      this.clearAutoScrollTimer();
    }
  }

  private setPlaybackSpeed(speed: number): void {
    this.playbackSpeed = speed;
    
    // Update currently playing audio if any
    if (this.currentAudioElement) {
      this.currentAudioElement.playbackRate = speed;
    }
  }

  protected updated(changed: Map<string, unknown>) {
    // When the visible sentence changes, record last viewed time
    if (
      changed.has('currentWordIndex') ||
      changed.has('currentSentenceIndex') ||
      changed.has('wordsWithSentences')
    ) {
      const currentSentence = this.getCurrentSentence();
      if (currentSentence && currentSentence.id !== this.lastRecordedSentenceId) {
        this.lastRecordedSentenceId = currentSentence.id;
        // Optimistically update local state so UI shows "just now"
      const wIndex = this.currentWordIndex;
      const sIndex = this.currentSentenceIndex;
      if (this.wordsWithSentences[wIndex]?.sentences[sIndex]) {
        const previousLastShown = this.wordsWithSentences[wIndex].sentences[sIndex].lastShown;
        this.currentSentenceDisplayLastSeen = previousLastShown ? new Date(previousLastShown) : undefined;
        // Only update wordsWithSentences if the sentence object reference actually changed
        // This prevents unnecessary re-renders that cause layout shifts
        const currentSentence = this.wordsWithSentences[wIndex]?.sentences[sIndex];
        if (currentSentence && currentSentence.lastShown?.getTime() !== new Date().getTime()) {
          const updatedWords = this.wordsWithSentences.map((w, wi) => {
            if (wi !== wIndex) return w;
            const updatedSentences = w.sentences.map((s, si) =>
              si === sIndex ? { ...s, lastShown: new Date() } : s
            );
            return { ...w, sentences: updatedSentences };
          });
          this.wordsWithSentences = updatedWords;
        }

        if (this.lastSeenClearFrame !== null) {
          cancelAnimationFrame(this.lastSeenClearFrame);
        }
        this.lastSeenClearFrame = requestAnimationFrame(() => {
          this.currentSentenceDisplayLastSeen = undefined;
          this.lastSeenClearFrame = null;
          // Don't call requestUpdate() - only update if something actually changed
        });
      }
      // Fire and forget; no need to block UI
      window.electronAPI.database
        .updateSentenceLastShown(currentSentence.id)
        .catch(err => console.warn('Failed to update sentence last_shown:', err));
      }

      // Disable auto-scroll when we reach the last sentence
      if (this.isLastSentence() && this.autoScrollEnabled) {
        this.autoScrollEnabled = false;
        this.clearAutoScrollTimer();
      }
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

      // Update local state in wordsWithSentences
      const wordIndex = this.wordsWithSentences.findIndex(w => w.id === word.id);
      if (wordIndex !== -1) {
        this.wordsWithSentences[wordIndex] = {
          ...this.wordsWithSentences[wordIndex],
          known,
          ignored: !known,
          strength: known ? 100 : this.wordsWithSentences[wordIndex].strength
        };
      }

      // Also update the allWords array for highlighting
      const allWordsIndex = this.allWords.findIndex(w => w.id === word.id);
      if (allWordsIndex !== -1) {
        this.allWords[allWordsIndex] = {
          ...this.allWords[allWordsIndex],
          known,
          ignored: !known,
          strength: known ? 100 : this.allWords[allWordsIndex].strength
        };
      }

      // Save progress immediately after updating word status
      this.saveProgressToSession();

      this.requestUpdate();

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

  private handlePreviousSentence() {
    if (this.isLoading || this.error || this.showCompletion || this.isProcessing) return;
    this.goToPreviousSentence();
  }

  private handleNextSentence(event?: CustomEvent) {
    if (this.isLoading || this.error || this.showCompletion || this.isProcessing) return;
    const isLastSentence = event?.detail?.isLastSentence ?? this.isLastSentence();
    if (isLastSentence) {
      this.handleFinishLearning();
    } else {
      void this.goToNextSentence();
    }
  }

  private async handleShowOtherSentence() {
    if (this.isLoading || this.error || this.showCompletion || this.isProcessing) return;

    const currentWord = this.getCurrentWord();
    const currentSentence = this.getCurrentSentence();

    if (!currentWord || !currentSentence) return;

    const currentSentenceId = currentSentence.id;
    const oldAudioPath = currentSentence.audioPath;

    this.isProcessing = true;

    try {
      // Fetch another sentence for the same word
      // Try to get a different sentence by attempting multiple times if needed
      let newSentence = await window.electronAPI.quiz.getRandomSentenceForWord(currentWord.id);
      let attempts = 0;
      const maxAttempts = 5;
      
      // Try to get a different sentence (not guaranteed, but attempt to avoid same sentence)
      while (newSentence && newSentence.id === currentSentenceId && attempts < maxAttempts) {
        newSentence = await window.electronAPI.quiz.getRandomSentenceForWord(currentWord.id);
        attempts++;
      }

      if (!newSentence) {
        console.warn('No other sentence found for word:', currentWord.word);
        this.isProcessing = false;
        return;
      }

      // Remove old audio from cache if it exists and is different from new one
      if (oldAudioPath && oldAudioPath !== newSentence.audioPath && this.audioCache.has(oldAudioPath)) {
        const oldBlobUrl = this.blobUrlCache.get(oldAudioPath);
        if (oldBlobUrl) {
          URL.revokeObjectURL(oldBlobUrl);
        }
        this.audioCache.delete(oldAudioPath);
        this.blobUrlCache.delete(oldAudioPath);
      }

      // Replace the sentence in wordsWithSentences
      const updatedWords = this.wordsWithSentences.map(word => {
        if (word.id !== currentWord.id) {
          return word;
        }

        const updatedSentences = word.sentences.map((sentence, index) =>
          index === this.currentSentenceIndex ? newSentence : sentence
        );

        return {
          ...word,
          sentences: updatedSentences
        };
      });

      this.wordsWithSentences = updatedWords;

      // Update session manager with new sentence ID
      const activeSession = sessionManager.getLearningSession();
      if (activeSession?.sentenceIds) {
        const currentGlobalIndex = this.getCurrentSentenceGlobalIndex() - 1;
        if (currentGlobalIndex >= 0 && currentGlobalIndex < activeSession.sentenceIds.length) {
          const updatedSentenceIds = [...activeSession.sentenceIds];
          updatedSentenceIds[currentGlobalIndex] = newSentence.id;
          
          // Update audio paths if available
          let updatedAudioPaths = activeSession.audioPaths || [];
          if (newSentence.audioPath && currentGlobalIndex < updatedAudioPaths.length) {
            updatedAudioPaths = [...updatedAudioPaths];
            updatedAudioPaths[currentGlobalIndex] = newSentence.audioPath;
          }

          // Update the session
          sessionManager.startNewLearningSession(
            activeSession.wordIds,
            activeSession.maxSentences,
            updatedSentenceIds,
            updatedAudioPaths
          );
        }
      }

      // Load new audio if available
      if (newSentence.audioPath) {
        await this.ensureCurrentSentenceAudioLoaded();
      }

      // Save progress
      this.saveProgressToSession();

      // Force re-render
      this.requestUpdate();
    } catch (error) {
      console.error('Failed to load other sentence:', error);
      window.alert('Failed to load another sentence. Please try again.');
    } finally {
      this.isProcessing = false;
    }
  }

  private async handleRemoveCurrentSentence() {
    if (this.isLoading || this.error || this.showCompletion || this.isProcessing) return;

    const currentWord = this.getCurrentWord();
    const currentSentence = this.getCurrentSentence();

    if (!currentWord || !currentSentence) return;

    const confirmed = window.confirm('Remove this sentence from the current review session?');
    if (!confirmed) return;

    this.isProcessing = true;

    try {
      await window.electronAPI.database.deleteSentence(currentSentence.id);

      const updatedWords = this.wordsWithSentences
        .map(word => {
          if (word.id !== currentWord.id) {
            return word;
          }

          const remainingSentences = word.sentences.filter(sentence => sentence.id !== currentSentence.id);
          return {
            ...word,
            sentences: remainingSentences
          };
        })
        .filter(word => word.sentences.length > 0);

      this.wordsWithSentences = updatedWords;

      if (updatedWords.length === 0) {
        this.currentWordIndex = 0;
        this.currentSentenceIndex = 0;

        if (!this.showCompletion) {
          await this.handleFinishLearning();
        }
        return;
      }

      let newWordIndex = Math.min(this.currentWordIndex, updatedWords.length - 1);
      let newSentenceIndex = this.currentSentenceIndex;

      const currentWordStillExists = updatedWords[newWordIndex]?.id === currentWord.id;

      if (currentWordStillExists) {
        const sentenceCount = updatedWords[newWordIndex].sentences.length;
        if (newSentenceIndex >= sentenceCount) {
          newSentenceIndex = Math.max(sentenceCount - 1, 0);
        }
      } else {
        newSentenceIndex = 0;
      }

      this.currentWordIndex = newWordIndex;
      this.currentSentenceIndex = newSentenceIndex;
      this.saveProgressToSession();
    } catch (error) {
      console.error('Failed to delete sentence:', error);
      window.alert('Failed to remove sentence. Please try again.');
    } finally {
      this.isProcessing = false;
    }
  }

  private goToPreviousSentence() {
    // Clear auto-scroll timer when manually navigating
    this.clearAutoScrollTimer();
    
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

  private async goToNextSentence() {
    // Clear auto-scroll timer when manually navigating
    this.clearAutoScrollTimer();
    
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

    // Load current sentence's audio into cache in background (non-blocking)
    void this.ensureCurrentSentenceAudioLoaded().catch(err => {
      console.warn('Failed to load audio into cache:', err);
    });
    
    // Immediately load next sentence's audio in background
    this.preloadNextSentenceAudio();

    // Note: Audio autoplay is handled by sentence-viewer component when sentence changes
    // It will start playing immediately without waiting for loading
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

      // Mark the learning session as complete but keep history until a new session starts
      sessionManager.markLearningSessionComplete();

    } catch (error) {
      console.error('Failed to record learning session:', error);
    }
  }

  private showSessionCompletion() {
    const timeSpent = Math.round((Date.now() - this.sessionStartTime) / (1000 * 60)); // minutes

    // Determine next recommendation based on word strengths
    let nextRecommendation: SessionSummary['nextRecommendation'] = 'take-quiz';

    const totalStrength = this.wordsWithSentences.reduce((sum, w) => sum + w.strength, 0);
    const averageStrength = this.wordsWithSentences.length
      ? totalStrength / this.wordsWithSentences.length
      : 0;

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

  private setupKeyboardBindings() {
    const bindings = [
      // Navigation
      {
        ...GlobalShortcuts.NEXT,
        action: () => this.handleNextAction(),
        context: 'learning',
        description: 'Next sentence / Finish learning'
      },
      {
        ...GlobalShortcuts.PREVIOUS,
        action: () => this.goToPreviousSentence(),
        context: 'learning',
        description: 'Previous sentence'
      },
      {
        key: CommonKeys.ENTER,
        action: () => this.handleNextAction(),
        context: 'learning',
        description: 'Next sentence / Finish learning'
      },
      // Word actions
      {
        ...GlobalShortcuts.MARK_KNOWN,
        action: () => this.handleMarkCurrentWordKnown(),
        context: 'learning',
        description: 'Mark current word as known'
      },
      {
        ...GlobalShortcuts.MARK_IGNORED,
        action: () => this.handleMarkCurrentWordIgnored(),
        context: 'learning',
        description: 'Mark current word as ignored'
      },
      {
        ...GlobalShortcuts.REMOVE_SENTENCE,
        action: () => this.handleRemoveCurrentSentence(),
        context: 'learning',
        description: 'Remove current sentence'
      },
      {
        ...GlobalShortcuts.REMOVE_SENTENCE_BACKSPACE,
        action: () => this.handleRemoveCurrentSentence(),
        context: 'learning',
        description: 'Remove current sentence'
      },
      {
        key: 'o',
        action: () => this.handleShowOtherSentence(),
        context: 'learning',
        description: 'Show other sentence'
      },
      // Audio
      {
        ...GlobalShortcuts.PLAY_AUDIO,
        action: () => this.handlePlayCurrentAudio(),
        context: 'learning',
        description: 'Play sentence audio'
      },
      {
        ...GlobalShortcuts.REPLAY_AUDIO,
        action: () => this.handlePlayCurrentAudio(),
        context: 'learning',
        description: 'Replay sentence audio'
      },
      // Navigation shortcuts
      {
        key: CommonKeys.HOME,
        action: () => this.goToFirstSentence(),
        context: 'learning',
        description: 'Go to first sentence'
      },
      {
        key: CommonKeys.END,
        action: () => this.goToLastSentence(),
        context: 'learning',
        description: 'Go to last sentence'
      },
    ];

    this.keyboardUnsubscribe = useKeyboardBindings(bindings);
  }

  private async handleNextAction() {
    // Don't handle if we're loading, have an error, or showing completion
    if (this.isLoading || this.error || this.showCompletion || this.isProcessing) return;

    // Don't handle if no words available
    if (!this.wordsWithSentences.length) return;

    // Check if this is the last sentence, if so finish learning, otherwise go to next
    if (this.isLastSentence()) {
      this.handleFinishLearning();
    } else {
      await this.goToNextSentence();
    }
  }

  private handleMarkCurrentWordKnown() {
    if (this.isLoading || this.error || this.showCompletion || this.isProcessing) return;
    
    const currentWord = this.getCurrentWord();
    if (currentWord && !currentWord.known) {
      this.handleWordStatusChange(currentWord, true);
    }
  }

  private handleMarkCurrentWordIgnored() {
    if (this.isLoading || this.error || this.showCompletion || this.isProcessing) return;
    
    const currentWord = this.getCurrentWord();
    if (currentWord && !currentWord.ignored) {
      this.handleWordStatusChange(currentWord, false);
    }
  }

  /**
   * Load a single audio file into cache
   */
  private async loadAudioIntoCache(audioPath: string): Promise<void> {
    if (this.audioCache.has(audioPath)) {
      return; // Already cached
    }

    try {
      // Load audio as ArrayBuffer (more efficient than base64)
      const result = await window.electronAPI.audio.loadAudioBase64(audioPath);
      if (result && result.data) {
        // Create Blob and Blob URL (faster than data URLs for browser)
        const blob = new Blob([result.data], { type: result.mimeType });
        const blobUrl = URL.createObjectURL(blob);
        this.audioCache.set(audioPath, blobUrl);
        this.blobUrlCache.set(audioPath, blobUrl);
      }
    } catch (error) {
      console.warn(`Failed to load audio for ${audioPath}:`, error);
      throw error;
    }
  }

  /**
   * Ensure current sentence's audio is loaded and ready
   * Prioritizes current audio for instant playback
   */
  private async ensureCurrentSentenceAudioLoaded(): Promise<void> {
    const currentSentence = this.getCurrentSentence();
    if (!currentSentence?.audioPath) {
      return;
    }

    const audioPath = currentSentence.audioPath;
    
    // If already cached, we're done
    if (this.audioCache.has(audioPath)) {
      return;
    }

    try {
      await this.loadAudioIntoCache(audioPath);
    } catch (error) {
      console.warn(`Failed to load current sentence audio:`, error);
      // Continue anyway - will fall back to IPC playback
    }
  }

  /**
   * Preload the next sentence's audio after current one is ready
   * This ensures smooth transitions between sentences
   */
  private preloadNextSentenceAudio(): void {
    const currentWord = this.getCurrentWord();
    if (!currentWord) {
      return;
    }

    let nextSentence: Sentence | null = null;

    // Check if there's a next sentence in the current word
    if (this.currentSentenceIndex < currentWord.sentences.length - 1) {
      nextSentence = currentWord.sentences[this.currentSentenceIndex + 1];
    } else if (this.currentWordIndex < this.wordsWithSentences.length - 1) {
      // Move to next word's first sentence
      const nextWord = this.wordsWithSentences[this.currentWordIndex + 1];
      if (nextWord && nextWord.sentences.length > 0) {
        nextSentence = nextWord.sentences[0];
      }
    }

    if (!nextSentence?.audioPath) {
      return; // No next sentence or no audio path
    }

    const nextAudioPath = nextSentence.audioPath;
    
    // Skip if already cached
    if (this.audioCache.has(nextAudioPath)) {
      return;
    }

    // Load next sentence's audio in background (non-blocking)
    void this.loadAudioIntoCache(nextAudioPath).catch(error => {
      console.warn(`Failed to preload next sentence audio:`, error);
      // Non-critical - will load on-demand if needed
    });
  }

  /**
   * Pre-load all audio files for the review session into memory cache
   * This allows instant playback without file system access
   * Optimized: Skips already cached files and loads in parallel
   */
  private async preloadReviewAudio(wordsWithSentences: WordWithSentences[]): Promise<void> {
    try {
      // Collect all audio paths from all sentences
      const audioPaths: string[] = [];
      for (const wordWithSentences of wordsWithSentences) {
        for (const sentence of wordWithSentences.sentences) {
          if (sentence.audioPath && !this.audioCache.has(sentence.audioPath)) {
            audioPaths.push(sentence.audioPath);
          }
        }
      }
      
      if (audioPaths.length === 0) {
        return;
      }
      
      console.log(`Pre-loading ${audioPaths.length} audio files into cache for review mode...`);
      
      // Load all audio files in parallel (small files, so parallel loading is fine)
      const loadPromises = audioPaths.map(async (audioPath) => {
        try {
          await this.loadAudioIntoCache(audioPath);
        } catch (error) {
          console.warn(`Failed to preload audio for ${audioPath}:`, error);
          // Continue loading other files even if one fails
        }
      });
      
      await Promise.all(loadPromises);
      console.log(`Audio cache ready: ${this.audioCache.size} files loaded`);
    } catch (error) {
      console.error('Error preloading audio:', error);
      // Don't fail review if audio caching fails - will fall back to file system
    }
  }

  /**
   * Play audio immediately - don't wait for loading
   */
  private async handlePlayCurrentAudio() {
    if (this.isLoading || this.error || this.showCompletion) return;
    
    const currentSentence = this.getCurrentSentence();
    const currentWord = this.getCurrentWord();
    if (!currentSentence?.audioPath || !currentWord) {
      return;
    }

    try {
      const audioPath = currentSentence.audioPath;

      // Stop any currently playing audio
      this.stopCachedAudio();

      // Try to use cached audio first (instant playback)
      const cachedAudio = this.audioCache.get(audioPath);
      if (cachedAudio) {
        // Use HTML5 Audio API to play from memory
        this.currentAudioElement = new Audio(cachedAudio);
        
        // Set playback speed
        this.currentAudioElement.playbackRate = this.playbackSpeed;

        // Handle errors and cleanup
        this.currentAudioElement.addEventListener('ended', () => {
          this.currentAudioElement = null;
          // Increment strength when audio finishes playing
          void this.incrementStrengthForWord(currentWord.id);
          // Auto-scroll to next sentence after 2 seconds if enabled
          if (this.autoScrollEnabled) {
            this.clearAutoScrollTimer();
            this.autoScrollTimer = window.setTimeout(() => {
              if (!this.isLastSentence()) {
                void this.goToNextSentence();
              }
              this.autoScrollTimer = null;
            }, 2000);
          }
        });

        this.currentAudioElement.addEventListener('error', (e) => {
          console.warn('Error playing cached audio, falling back to IPC:', e);
          this.currentAudioElement = null;
          // Fall back to IPC playback
          void window.electronAPI.audio.playAudio(audioPath)
            .then(() => void this.incrementStrengthForWord(currentWord.id))
            .catch(err => {
              console.error('Failed to play audio via IPC:', err);
            });
        });

        try {
          await this.currentAudioElement.play();
          return; // Success - audio playing from cache
        } catch (playError) {
          console.warn('Failed to play cached audio:', playError);
          this.currentAudioElement = null;
          // Fall through to IPC playback
        }
      }

      // Not cached: Start IPC playback immediately (non-blocking, returns quickly)
      // IPC playback starts immediately and plays in background
      void window.electronAPI.audio.playAudio(audioPath)
        .then(() => void this.incrementStrengthForWord(currentWord.id))
        .catch(err => {
          console.error('Failed to play audio via IPC:', err);
        });
      
      // Load audio into cache in background for next time (non-blocking)
      if (!this.audioCache.has(audioPath)) {
        void this.loadAudioIntoCache(audioPath).catch(err => {
          console.warn(`Failed to load audio into cache: ${err}`);
        });
      }
    } catch (error) {
      console.error('Failed to play audio:', error);
    }
  }

  /**
   * Stop currently playing cached audio
   */
  private stopCachedAudio(): void {
    // Clear auto-scroll timer when stopping audio
    this.clearAutoScrollTimer();
    
    if (this.currentAudioElement) {
      this.currentAudioElement.pause();
      this.currentAudioElement.currentTime = 0;
      this.currentAudioElement = null;
    }
    // Also stop any IPC audio playback
    window.electronAPI.audio.stopAudio().catch(() => {
      // Ignore errors when stopping
    });
  }

  private handleSentenceAudioPlayed(event: CustomEvent<{ wordId?: number }>) {
    const wordId = event.detail?.wordId;
    if (!wordId) {
      return;
    }

    void this.incrementStrengthForWord(wordId);
  }

  private handleSentenceAudioCompleted(event: CustomEvent<{ wordId?: number }>) {
    // Auto-scroll to next sentence after audio finishes (2.5 seconds delay)
    // The extra 0.5 seconds accounts for the buffer in the audio generator
    // plus gives users a moment to process what they just heard
    if (this.autoScrollEnabled) {
      this.clearAutoScrollTimer();
      this.autoScrollTimer = window.setTimeout(() => {
        if (!this.isLastSentence()) {
          void this.goToNextSentence();
        }
        this.autoScrollTimer = null;
      }, 2500); // 2.5 seconds delay after audio completes
    }
  }

  private handleSentenceAudioRegenerated(event: CustomEvent<{ sentenceId: number; audioPath: string }>) {
    const { sentenceId, audioPath } = event.detail || ({} as any);
    if (!sentenceId || !audioPath) return;

    // Update the audioPath inside our wordsWithSentences structure so
    // parent-level keyboard shortcuts use the fresh path too
    const wIndex = this.currentWordIndex;
    const sIndex = this.currentSentenceIndex;
    const currentWord = this.wordsWithSentences[wIndex];
    if (!currentWord) return;

    const targetIndex = currentWord.sentences.findIndex(s => s.id === sentenceId);
    if (targetIndex === -1) return;

    const updatedSentences = currentWord.sentences.map((s, idx) =>
      idx === targetIndex ? { ...s, audioPath } : s
    );
    const updatedWords = this.wordsWithSentences.map((w, idx) =>
      idx === wIndex ? { ...w, sentences: updatedSentences } : w
    );
    this.wordsWithSentences = updatedWords;

    // Ensure our current pointer stays in sync
    this.currentSentenceIndex = sIndex;
  }

  private async handleStartNewSession(): Promise<void> {
    if (this.isLoading) {
      return;
    }

    this.showCompletion = false;
    this.sessionSummary = null;
    this.error = '';
    this.currentWordIndex = 0;
    this.currentSentenceIndex = 0;
    this.lastRecordedSentenceId = null;

    try {
      this.isLoading = true;
      router.goToLearning();
      sessionManager.clearLearningSession();

      await this.loadAllWords();
      await this.loadSelectedWords();

      const routeData = router.getRouteData<{ specificWords?: Word[] }>();
      if (!routeData?.specificWords?.length) {
        const appended = await this.maybeAppendNewWordsToSession();
        if (appended) {
          await this.loadSelectedWords();
        }
      }

      await this.loadWordsAndSentences();
      this.restoreSessionProgress();
      this.sessionStartTime = Date.now();
      this.saveProgressToSession();
    } catch (error) {
      console.error('Failed to start new learning session:', error);
      this.error = 'Failed to start a new learning session. Please try again.';
    } finally {
      this.isLoading = false;
    }
  }

  private async handleWordAddedFromSentence(event: CustomEvent<{ wordId: number; word: string; translation: string }>): Promise<void> {
    const { wordId, word } = event.detail;
    await this.refreshQueueSummary();

    try {
      const newWord = await window.electronAPI.database.getWordById(wordId);
      if (newWord) {
        this.allWords = [...this.allWords.filter(existing => existing.id !== newWord.id), newWord];
      } else {
        await this.loadAllWords();
      }
    } catch (error) {
      console.error('Failed to load newly added word:', error);
    }
  }

  private handleWordAdditionError(event: CustomEvent<{ word: string; message: string }>): void {
    const { word, message } = event.detail;
    this.showInfo(`Failed to add "${word}": ${message}`, 'error');
  }

  private handleWordAdditionSkipped(event: CustomEvent<{ word: string }>): void {
    const { word } = event.detail;
    this.showInfo(`"${word}" is already in your vocabulary.`, 'info', 3000);
  }

  private async incrementStrengthForWord(wordId: number): Promise<void> {
    const word = this.wordsWithSentences.find(w => w.id === wordId);
    if (!word) {
      return;
    }

    const currentStrength = typeof word.strength === 'number' ? word.strength : 0;
    const newStrength = currentStrength + 1;
    this.applyStrengthUpdate(wordId, newStrength);

    try {
      await window.electronAPI.database.updateWordStrength(wordId, newStrength);
    } catch (error) {
      console.error('Failed to update word strength after sentence exposure:', error);
    }
  }

  private applyStrengthUpdate(wordId: number, strength: number): void {
    this.wordsWithSentences = this.wordsWithSentences.map(word =>
      word.id === wordId ? { ...word, strength } : word
    );

    this.selectedWords = this.selectedWords.map(word =>
      word.id === wordId ? { ...word, strength } : word
    );

    this.allWords = this.allWords.map(word =>
      word.id === wordId ? { ...word, strength } : word
    );
  }

  private goToFirstSentence() {
    if (this.isLoading || this.error || this.showCompletion || this.isProcessing) return;
    
    this.currentWordIndex = 0;
    this.currentSentenceIndex = 0;
    this.saveProgressToSession();
  }

  private goToLastSentence() {
    if (this.isLoading || this.error || this.showCompletion || this.isProcessing) return;
    
    if (this.wordsWithSentences.length > 0) {
      this.currentWordIndex = this.wordsWithSentences.length - 1;
      const lastWord = this.wordsWithSentences[this.currentWordIndex];
      this.currentSentenceIndex = Math.max(0, lastWord.sentences.length - 1);
      this.saveProgressToSession();
    }
  }

  private renderQueueStatus() {
    const { queued, processing, failed, processingWords, queuedWords } = this.queueSummary;
    const pending = queued + processing - failed;

    if (pending <= 0) {
      return null;
    }

    const formatWordList = (words: Array<{ word: string }>, max = 3) => {
      if (!words.length) {
        return '';
      }
      const names = words.map(item => `“${item.word}”`);
      if (names.length <= max) {
        return names.join(', ');
      }
      return `${names.slice(0, max).join(', ')} + ${names.length - max} more`;
    };

    const runningWords = processingWords?.filter(w => w.status === 'processing');

    const processingList = runningWords?.length ? formatWordList(runningWords) : '';
    const queuedList = queuedWords?.length ? formatWordList(queuedWords) : '';

    const detailParts = [
      processing > 0 && processingList ? `Running: ${processingList}` : '',
      queued > 0 && queuedList ? `Queued: ${queuedList}` : ''
    ].filter(Boolean);

    return html`
      <div class="queue-status">
        <span>
          Generating sentences for ${pending} ${pending === 1 ? 'word' : 'words'}.
          ${detailParts.length ? html`<span> ${detailParts.join(' • ')}</span>` : ''}
        </span>
      </div>
    `;
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
        </div>
      `;
    }

    if (this.wordsWithSentences.length === 0) {
      return html`
        <div class="learning-container">
          <div class="empty-state">
            <h3>No Learning Content Available</h3>
            <p>No sentences were found for the selected words.</p>
          </div>
        </div>
      `;
    }

    // Check for completion first, regardless of current word/sentence state
    if (this.showCompletion && this.sessionSummary) {
      return html`
        <div class="learning-container">
          <session-complete
            .sessionSummary=${this.sessionSummary}
            @start-new-learning-session=${this.handleStartNewSession}
          ></session-complete>
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
            </div>
          </div>
        </div>
      `;
    }

    return html`
      <div class="learning-container">
        <div class="learning-header">
        </div>

        ${this.infoMessage ? html`
          <div class="info-banner ${this.infoMessageType}">
            ${this.infoMessage}
          </div>
        ` : ''}

        <div class="progress-section">
          <div class="progress-info">
            <div class="progress-text">
              <span class="word-counter">Word ${this.currentWordIndex + 1} of ${this.wordsWithSentences.length}</span>
            </div>
            <div class="progress-text">
              Overall: ${currentSentenceNumber} of ${totalSentences} sentences
            </div>
            <div style="display: flex; align-items: center; gap: var(--spacing-sm);">
              <div class="playback-speed-control">
                <span class="playback-speed-label">Speed</span>
                <div class="playback-speed-buttons">
                  <button
                    class="playback-speed-button ${this.playbackSpeed === 0.8 ? 'active' : ''}"
                    @click=${() => this.setPlaybackSpeed(0.8)}
                    title="0.8x speed"
                  >
                    0.8x
                  </button>
                  <button
                    class="playback-speed-button ${this.playbackSpeed === 1.0 ? 'active' : ''}"
                    @click=${() => this.setPlaybackSpeed(1.0)}
                    title="1x speed (normal)"
                  >
                    1x
                  </button>
                  <button
                    class="playback-speed-button ${this.playbackSpeed === 1.2 ? 'active' : ''}"
                    @click=${() => this.setPlaybackSpeed(1.2)}
                    title="1.2x speed"
                  >
                    1.2x
                  </button>
                  <button
                    class="playback-speed-button ${this.playbackSpeed === 1.4 ? 'active' : ''}"
                    @click=${() => this.setPlaybackSpeed(1.4)}
                    title="1.4x speed"
                  >
                    1.4x
                  </button>
                </div>
              </div>
              <div class="auto-scroll-toggle" style="margin-bottom: 0;">
                <span class="auto-scroll-label" style="font-size: 12px;">Auto-scroll</span>
                <div 
                  class="auto-scroll-switch ${this.autoScrollEnabled ? 'active' : ''}"
                  @click=${this.isLastSentence() ? undefined : this.toggleAutoScroll}
                  title=${this.isLastSentence() ? 'Auto-scroll disabled at end of session' : 'Auto-scroll to next sentence 2 seconds after audio stops'}
                  style="width: 40px; height: 20px; ${this.isLastSentence() ? 'opacity: 0.5; cursor: not-allowed;' : 'cursor: pointer;'}"
                >
                  <div class="auto-scroll-slider" style="width: 16px; height: 16px; top: 2px; left: 2px;"></div>
                </div>
              </div>
            </div>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${progressPercent}%"></div>
          </div>
        </div>

        <sentence-viewer
          .sentence=${currentSentence}
          .targetWord=${currentWord}
          .allWords=${this.allWords}
          .displayLastSeen=${this.currentSentenceDisplayLastSeen}
          .isFirstSentence=${this.isFirstSentence()}
          .isLastSentence=${this.isLastSentence()}
          .isProcessing=${this.isProcessing}
          @word-clicked=${this.handleWordClicked}
          @mark-word-known=${this.handleMarkWordKnown}
          @mark-word-ignored=${this.handleMarkWordIgnored}
          @remove-sentence=${this.handleRemoveCurrentSentence}
          @show-other-sentence=${this.handleShowOtherSentence}
          @sentence-audio-played=${this.handleSentenceAudioPlayed}
          @sentence-audio-completed=${this.handleSentenceAudioCompleted}
          @sentence-audio-regenerated=${this.handleSentenceAudioRegenerated}
          @word-added-from-sentence=${this.handleWordAddedFromSentence}
          @word-addition-error=${this.handleWordAdditionError}
          @word-addition-skipped=${this.handleWordAdditionSkipped}
          @previous-sentence=${this.handlePreviousSentence}
          @next-sentence=${this.handleNextSentence}
        ></sentence-viewer>
      </div>
    `;
  }
}
