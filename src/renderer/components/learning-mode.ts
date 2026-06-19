/**
 * Learning mode component for sentence review and word interaction
 */

import { html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import { buttonStyles } from '../styles/button.styles.js';
import { stateStyles } from '../styles/state.styles.js';
import { learningModeStyles } from './learning-mode.styles.js';
import { router } from '../utils/router.js';
import { sessionManager } from '../utils/session-manager.js';
import { Word, Sentence } from '../../shared/types/core.js';
import { STRENGTH_BOOST_CONFIG } from '../../shared/constants/index.js';
import { useKeyboardBindings, GlobalShortcuts } from '../utils/keyboard-manager.js';
import { loadCurrentLanguage, loadLemmatizationModel } from '../utils/language-manager.js';
import { BaseComponent } from './base-component.js';
import { logger } from '../utils/logger.js';
import { audioPlayer } from '../utils/audio-player-service.js';
import { JobMonitorController } from './job-monitor-controller.js';
import { AudioPlaybackController } from './audio-playback-controller.js';
import { buildSentenceAudioSequence } from './sentence-audio-controller.js';
import {
  WordWithSentences,
  loadSelectedWords,
  loadWordsAndSentences,
  maybeAppendNewWordsToSession,
  prepareSentencesForWord,
  restoreSessionProgress,
  saveProgressToSession,
} from '../utils/learning-session-service.js';
import './sentence-viewer.js';
import './session-complete.js';
import './progress-bar.js';
import './learning-controls.js';
import type { SessionSummary } from './session-complete.js';

@customElement('learning-mode')
export class LearningMode extends BaseComponent {
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
  private isProcessing = false;

  @state()
  private showCompletion = false;

  @state()
  private sessionSummary: SessionSummary | null = null;

  @state()
  private infoMessage = '';

  @state()
  private infoMessageType: 'info' | 'success' | 'error' = 'info';

  @state()
  private autoScrollEnabled = false;

  @state()
  private playbackSpeed: number = 1.0; // 0.9x, 1x, 1.1x, 1.2x

  @state()
  private currentPlayingAudio: 'before' | 'main' | 'after' | null = null;

  @state()
  private audioOnlyMode = false;

  private keyboardUnsubscribe?: () => void;
  private lastRecordedSentenceId: number | null = null;
  private lastSeenSentenceId: number | null = null;
  private jobMonitor = new JobMonitorController(this, {
    getCurrentLanguage: () => this.currentLanguage,
    loadCurrentLanguage: () => this.loadCurrentLanguage(),
    onWordReady: (wordId) => this.handleJobWordReady(wordId),
    onWordFailed: () =>
      this.showInfo('Sentence generation failed for a word. Please retry from the queue.', 'error'),
  });
  private audio = new AudioPlaybackController(this);

  private infoTimeoutId: number | undefined;
  private currentSentenceDisplayLastSeen?: Date;
  private autoScrollTimer: number | null = null;

  // Track which sentence last started playing audio (to detect if audio completed vs never started)
  private lastSentenceWithAudioStarted: number | null = null;

  // Track which words have already had their strength incremented in this session
  // This prevents double incrementing when multiple audio files play (before-sentence + main)
  // or when navigating next/previous
  private wordsIncrementedThisSession: Set<number> = new Set();

  protected override handleExternalLanguageChange = async (event: Event): Promise<void> => {
    const detail = (event as CustomEvent<{ language?: string }>).detail;
    const newLanguage = detail?.language;

    // Check if language actually changed BEFORE calling super (which updates currentLanguage)
    if (!newLanguage || newLanguage === this.currentLanguage) {
      return;
    }

    // Call base class handler (this will update this.currentLanguage)
    await super.handleExternalLanguageChange(event);

    // Reload all data for the new language
    try {
      // Load lemmatization model for the new language (async, non-blocking)
      void loadLemmatizationModel(newLanguage);

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

      // Restore playback speed for the new language
      this.loadPlaybackSpeed();

      // Refresh queue summary
      await this.jobMonitor.refreshQueueSummary();

      // Explicitly request update to ensure component re-renders with new language data
      this.requestUpdate();
    } catch (error) {
      logger.error({ error }, 'Failed to reload data after language change');
    }
  };

  static styles = [sharedStyles, buttonStyles, stateStyles, learningModeStyles];

  async connectedCallback() {
    super.connectedCallback();
    window.addEventListener('stop-auto-scroll', this.handleStopAutoScroll);

    // Set initial loading state
    this.isLoading = true;

    // Reset session tracking for fresh session
    this.wordsIncrementedThisSession.clear();

    await this.loadCurrentLanguage();

    await this.createTrackingSession('learning', this.currentLanguage || 'spanish');

    // Setup keyboard bindings
    this.setupKeyboardBindings();

    // Load all words for highlighting purposes
    await this.loadAllWords();

    // Load persisted UI preferences
    try {
      const audioOnlySetting = await window.electronAPI.database.getSetting(
        'learning_audio_only_mode'
      );
      if (audioOnlySetting !== null) {
        this.audioOnlyMode = audioOnlySetting === 'true';
      }
    } catch (error) {
      logger.error({ error }, 'Failed to load audio only mode setting');
    }

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

    // Load playback speed from session manager
    this.loadPlaybackSpeed();

    this.jobMonitor.start();
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    // Update session if it exists and hasn't been completed
    if (this.currentSessionId && !this.showCompletion) {
      void this.updateSessionOnCompletion();
    }

    // Clean up keyboard bindings
    if (this.keyboardUnsubscribe) {
      this.keyboardUnsubscribe();
    }

    // Clean up audio cache and playing audio (fire-and-forget is fine here since component is being destroyed)
    void this.stopCachedAudio();

    this.clearInfoTimeout();
    this.clearAutoScrollTimer();
    window.removeEventListener('stop-auto-scroll', this.handleStopAutoScroll);
  }

  private async loadCurrentLanguage(): Promise<void> {
    this.currentLanguage = await loadCurrentLanguage('spanish');
    const languageToUse = this.currentLanguage || 'spanish';

    // Load lemmatization model for the current language (async, non-blocking)
    void loadLemmatizationModel(languageToUse);
  }

  private async loadAllWords() {
    try {
      // Load all words (including known ones) for highlighting purposes
      // Filter by current language to avoid loading words from other languages
      const language =
        this.currentLanguage || (await window.electronAPI.database.getCurrentLanguage());
      this.allWords = await window.electronAPI.database.getAllWords(language, true, false);
      logger.debug({ wordCount: this.allWords.length }, 'Loaded all words for highlighting');
    } catch (error) {
      logger.error({ error }, 'Failed to load all words');
      // Don't set error state here as this is not critical for basic functionality
    }
  }

  private async loadSelectedWords(): Promise<void> {
    if (!this.currentLanguage) await this.loadCurrentLanguage();
    try {
      this.selectedWords = await loadSelectedWords(this.currentLanguage);
    } catch (error) {
      logger.error({ error }, 'Failed to load words');
      this.error = 'Failed to load words from database.';
    }
  }

  private async loadWordsAndSentences(): Promise<void> {
    if (!this.selectedWords.length) {
      this.error = 'No words available for learning. Please start a new learning session.';
      this.isLoading = false;
      return;
    }

    this.wordsIncrementedThisSession.clear();
    this.isLoading = true;
    this.error = null;

    try {
      this.wordsWithSentences = await loadWordsAndSentences(
        this.selectedWords,
        this.currentLanguage
      );

      if (this.wordsWithSentences.length === 0) {
        logger.warn('No words have sentences available for learning');
        this.error =
          'No sentences available for the selected words. Please generate new words or check if sentence generation completed successfully.';
      } else {
        void this.preloadReviewAudio(this.wordsWithSentences);
        await this.ensureCurrentSentenceAudioLoaded();
        this.preloadNextSentenceAudio();
      }
    } catch (err) {
      logger.error({ error: err }, 'Failed to load words and sentences');
      this.error = 'Failed to load learning content. Please try again.';
    } finally {
      this.isLoading = false;
    }
  }

  private async maybeAppendNewWordsToSession(): Promise<boolean> {
    return maybeAppendNewWordsToSession(this.currentLanguage);
  }

  private async handleJobWordReady(wordId: number): Promise<void> {
    try {
      if (!this.currentLanguage) await this.loadCurrentLanguage();

      const word = await window.electronAPI.database.getWordById(wordId);
      if (word) {
        if (this.currentLanguage && word.language !== this.currentLanguage) {
          this.allWords = [...this.allWords.filter((existing) => existing.id !== word.id), word];
          return;
        }

        this.allWords = [...this.allWords.filter((existing) => existing.id !== word.id), word];

        const sentences = await window.electronAPI.database.getSentencesByWord(word.id);
        const preparedSentences = prepareSentencesForWord(word, sentences);

        if (!preparedSentences.length) {
          logger.warn(
            { word: word.word, wordId: word.id },
            'Word has no sentences ready after job completion'
          );
          return;
        }

        const existingWordIndex = this.wordsWithSentences.findIndex((w) => w.id === word.id);
        const sentenceIds = preparedSentences.map((s) => s.id);
        const audioPaths = preparedSentences.map((s) => s.audioPath || '');

        if (existingWordIndex !== -1) {
          this.wordsWithSentences = this.wordsWithSentences.map((existing, index) =>
            index === existingWordIndex ? { ...word, sentences: preparedSentences } : existing
          );
          this.selectedWords = this.selectedWords.map((existing) =>
            existing.id === word.id ? word : existing
          );
          if (sentenceIds.length > 0) {
            sessionManager.appendSentencesToLearningSession(sentenceIds, audioPaths);
          }
        } else {
          sessionManager.appendWordsToLearningSession([word.id]);
          this.selectedWords = [...this.selectedWords, word];
          this.wordsWithSentences = [
            ...this.wordsWithSentences,
            { ...word, sentences: preparedSentences },
          ];
          if (sentenceIds.length > 0) {
            sessionManager.appendSentencesToLearningSession(sentenceIds, audioPaths);
          }
        }
      } else {
        await this.loadAllWords();
      }
    } catch (error) {
      logger.error({ error }, 'Unable to fetch word after job completion');
    }
  }

  private showInfo(
    message: string,
    type: 'info' | 'success' | 'error' = 'info',
    duration = 4000
  ): void {
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

  private handleStopAutoScroll = (): void => {
    this.clearAutoScrollTimer();
    this.autoScrollEnabled = false;
  };

  private toggleAutoScroll(): void {
    this.autoScrollEnabled = !this.autoScrollEnabled;
    // Clear any existing timer when toggling off
    if (!this.autoScrollEnabled) {
      this.clearAutoScrollTimer();
    } else {
      // When enabling, check if current audio has already been played
      const currentSentence = this.getCurrentSentence();
      const currentSentenceId = currentSentence?.id;

      // If audio is currently playing, don't jump immediately - let existing logic handle it
      // (will jump 1.5s after audio completes)
      if (this.currentPlayingAudio !== null) {
        // Audio is currently playing - let existing logic handle it
        return;
      }

      // Audio is not currently playing - check if it was already played
      if (currentSentenceId && this.lastSentenceWithAudioStarted === currentSentenceId) {
        // Audio was already played and completed - jump after 1.5s
        this.clearAutoScrollTimer();
        this.autoScrollTimer = window.setTimeout(() => {
          if (!this.isLastSentence()) {
            void this.goToNextSentence();
          }
          this.autoScrollTimer = null;
        }, 1500); // 1.5 seconds delay
      }
      // If audio hasn't been played yet (lastSentenceWithAudioStarted !== currentSentenceId),
      // don't jump immediately - let existing logic handle it when audio completes
      // (will jump 1.5s after audio completes)
    }
  }

  private toggleAudioOnlyMode(): void {
    this.audioOnlyMode = !this.audioOnlyMode;
    void window.electronAPI.database
      .setSetting('learning_audio_only_mode', String(this.audioOnlyMode))
      .catch((error: unknown) => logger.error({ error }, 'Failed to save audio only mode setting'));
  }

  private setPlaybackSpeed(speed: number): void {
    this.playbackSpeed = speed;

    // Save to session manager (per-language)
    sessionManager.setPlaybackSpeed(speed);

    // Update audio player playback speed
    audioPlayer.setPlaybackSpeed(speed);
  }

  private loadPlaybackSpeed(): void {
    // Load playback speed from session manager (per-language)
    this.playbackSpeed = sessionManager.getPlaybackSpeed();

    // Update audio player playback speed
    audioPlayer.setPlaybackSpeed(this.playbackSpeed);
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
        // Set displayLastSeen once when sentence changes - keep it stable to prevent re-renders
        // This prevents unnecessary re-renders of the "Last seen" UI
        const wIndex = this.currentWordIndex;
        const sIndex = this.currentSentenceIndex;
        if (this.wordsWithSentences[wIndex]?.sentences[sIndex]) {
          const currentSentenceObj = this.wordsWithSentences[wIndex].sentences[sIndex];
          const previousLastShown = currentSentenceObj.lastShown;

          // Only set displayLastSeen once per sentence change - don't update it again
          // This ensures the UI doesn't recalculate/re-render unnecessarily
          if (this.lastSeenSentenceId !== currentSentenceObj.id) {
            this.lastSeenSentenceId = currentSentenceObj.id;
            this.currentSentenceDisplayLastSeen = previousLastShown
              ? new Date(previousLastShown)
              : undefined;
            // Reset audio tracking when sentence changes
            this.lastSentenceWithAudioStarted = null;
          }

          // Update sentence.lastShown optimistically (but only if it's different)
          // Check if lastShown needs updating (not updated in the last second)
          const now = Date.now();
          const lastShownTime = previousLastShown?.getTime() ?? 0;
          if (now - lastShownTime > 1000) {
            const updatedWords = this.wordsWithSentences.map((w, wi) => {
              if (wi !== wIndex) return w;
              const updatedSentences = w.sentences.map((s, si) =>
                si === sIndex ? { ...s, lastShown: new Date() } : s
              );
              return { ...w, sentences: updatedSentences };
            });
            this.wordsWithSentences = updatedWords;
          }
        }

        // Fire and forget; no need to block UI
        window.electronAPI.database
          .updateSentenceLastShown(currentSentence.id)
          .catch((err) =>
            logger.warn(
              { error: err, sentenceId: currentSentence.id },
              'Failed to update sentence last_shown'
            )
          );
      }

      // Disable auto-scroll when we reach the last sentence
      if (this.isLastSentence() && this.autoScrollEnabled) {
        this.autoScrollEnabled = false;
        this.clearAutoScrollTimer();
      }
    }
  }

  private restoreSessionProgress(): void {
    const progress = restoreSessionProgress(this.wordsWithSentences);
    if (progress) {
      this.currentWordIndex = progress.wordIndex;
      this.currentSentenceIndex = progress.sentenceIndex;
    }
  }

  private getCurrentWord(): WordWithSentences | null {
    return this.wordsWithSentences[this.currentWordIndex] || null;
  }

  private getCurrentSentence(): Sentence | null {
    const currentWord = this.getCurrentWord();
    return currentWord?.sentences[this.currentSentenceIndex] || null;
  }

  private getPreviousSentence(): Sentence | null {
    // Check if we can go back within the current word
    if (this.currentSentenceIndex > 0) {
      const currentWord = this.getCurrentWord();
      return currentWord?.sentences[this.currentSentenceIndex - 1] || null;
    }

    // Otherwise, check the previous word's last sentence
    if (this.currentWordIndex > 0) {
      const previousWord = this.wordsWithSentences[this.currentWordIndex - 1];
      if (previousWord && previousWord.sentences.length > 0) {
        return previousWord.sentences[previousWord.sentences.length - 1];
      }
    }

    return null;
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
      const wordIndex = this.wordsWithSentences.findIndex((w) => w.id === word.id);
      if (wordIndex !== -1) {
        this.wordsWithSentences[wordIndex] = {
          ...this.wordsWithSentences[wordIndex],
          known,
          ignored: !known,
          strength: known ? 100 : this.wordsWithSentences[wordIndex].strength,
        };
      }

      // Also update the allWords array for highlighting
      const allWordsIndex = this.allWords.findIndex((w) => w.id === word.id);
      if (allWordsIndex !== -1) {
        this.allWords[allWordsIndex] = {
          ...this.allWords[allWordsIndex],
          known,
          ignored: !known,
          strength: known ? 100 : this.allWords[allWordsIndex].strength,
        };
      }

      // Save progress immediately after updating word status
      this.saveProgressToSession();

      this.requestUpdate();
    } catch (error) {
      logger.error({ error }, 'Failed to update word status');
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
    void this.goToPreviousSentence();
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

    // Stop any currently playing audio immediately
    await this.stopCachedAudio();

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
        logger.warn(
          { word: currentWord.word, wordId: currentWord.id },
          'No other sentence found for word'
        );
        this.isProcessing = false;
        return;
      }

      // Remove old audio from cache if it exists and is different from new one
      if (oldAudioPath && oldAudioPath !== newSentence.audioPath) {
        audioPlayer.revoke(oldAudioPath);
      }

      // Replace the sentence in wordsWithSentences
      const updatedWords = this.wordsWithSentences.map((word) => {
        if (word.id !== currentWord.id) {
          return word;
        }

        const updatedSentences = word.sentences.map((sentence, index) =>
          index === this.currentSentenceIndex ? newSentence : sentence
        );

        return {
          ...word,
          sentences: updatedSentences,
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
      logger.error({ error }, 'Failed to load other sentence');
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
        .map((word) => {
          if (word.id !== currentWord.id) {
            return word;
          }

          const remainingSentences = word.sentences.filter(
            (sentence) => sentence.id !== currentSentence.id
          );
          return {
            ...word,
            sentences: remainingSentences,
          };
        })
        .filter((word) => word.sentences.length > 0);

      this.wordsWithSentences = updatedWords;

      if (updatedWords.length === 0) {
        this.currentWordIndex = 0;
        this.currentSentenceIndex = 0;

        if (!this.showCompletion) {
          await this.handleFinishLearning();
        }
        return;
      }

      const newWordIndex = Math.min(this.currentWordIndex, updatedWords.length - 1);
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
      logger.error({ error }, 'Failed to delete sentence');
      window.alert('Failed to remove sentence. Please try again.');
    } finally {
      this.isProcessing = false;
    }
  }

  private async goToPreviousSentence() {
    // Clear auto-scroll timer when manually navigating
    this.clearAutoScrollTimer();

    // Stop any currently playing audio immediately before navigation
    await this.stopCachedAudio();

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

    // Stop any currently playing audio immediately before navigation
    await this.stopCachedAudio();

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
    void this.ensureCurrentSentenceAudioLoaded().catch((err) => {
      logger.warn({ error: err }, 'Failed to load audio into cache');
    });

    // Immediately load next sentence's audio in background
    this.preloadNextSentenceAudio();

    // Note: Audio autoplay is handled by sentence-viewer component when sentence changes
    // It will start playing immediately without waiting for loading
  }

  private saveProgressToSession(): void {
    saveProgressToSession(this.currentWordIndex, this.currentSentenceIndex);
  }

  private isFirstSentence(): boolean {
    return this.currentWordIndex === 0 && this.currentSentenceIndex === 0;
  }

  private isLastSentence(): boolean {
    const currentWord = this.getCurrentWord();
    if (!currentWord) return true;

    return (
      this.currentWordIndex === this.wordsWithSentences.length - 1 &&
      this.currentSentenceIndex === currentWord.sentences.length - 1
    );
  }

  private async handleFinishLearning() {
    console.log('handleFinishLearning called');

    // Record the learning session
    await this.recordLearningSession();

    // Show completion screen
    this.showSessionCompletion();

    console.log('showCompletion set to:', this.showCompletion);

    // Dispatch event for autopilot to check scores after review is done
    window.dispatchEvent(new CustomEvent('autopilot-check-trigger'));
  }

  private async recordLearningSession() {
    try {
      // Record study session in database
      await window.electronAPI.database.recordStudySession(this.selectedWords.length);

      // Update learning session with final counts
      await this.updateSessionOnCompletion();

      // Clear the learning session so next time it will load fresh words from database
      sessionManager.clearLearningSession();
      logger.debug('Learning session cleared after completion');
    } catch (error) {
      logger.error({ error }, 'Failed to record learning session');
    }
  }

  private async updateSessionOnCompletion() {
    const sentenceCount = this.wordsWithSentences.reduce(
      (total, word) => total + word.sentences.length,
      0
    );
    await this.finalizeTrackingSession(this.selectedWords.length, sentenceCount);
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
      nextRecommendation,
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
        description: 'Next sentence / Finish learning',
      },
      {
        ...GlobalShortcuts.PREVIOUS,
        action: () => this.goToPreviousSentence(),
        context: 'learning',
        description: 'Previous sentence',
      },
      // Word actions
      {
        ...GlobalShortcuts.MARK_KNOWN,
        action: () => this.handleMarkCurrentWordKnown(),
        context: 'learning',
        description: 'Mark current word as known',
      },
      {
        ...GlobalShortcuts.MARK_IGNORED,
        action: () => this.handleMarkCurrentWordIgnored(),
        context: 'learning',
        description: 'Mark current word as ignored',
      },
      {
        key: 'o',
        action: () => this.handleShowOtherSentence(),
        context: 'learning',
        description: 'Show other sentence',
      },
      // Audio
      {
        ...GlobalShortcuts.PLAY_AUDIO,
        action: () => this.handlePlayCurrentAudio(),
        context: 'learning',
        description: 'Play sentence audio',
      },
      {
        ...GlobalShortcuts.TOGGLE_AUDIO_ONLY,
        action: () => this.toggleAudioOnlyMode(),
        context: 'learning',
        description: 'Toggle show/hide English',
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

  private async ensureCurrentSentenceAudioLoaded(): Promise<void> {
    const currentSentence = this.getCurrentSentence();
    if (!currentSentence?.audioPath) return;
    try {
      const { audioPaths } = buildSentenceAudioSequence(currentSentence);
      await audioPlayer.preloadMultiple(audioPaths);
    } catch (error) {
      logger.warn({ error }, 'Failed to load current sentence audio');
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

    void audioPlayer.preload(nextAudioPath).catch((error) => {
      logger.warn({ error, audioPath: nextAudioPath }, `Failed to preload next sentence audio`);
    });
  }

  private async preloadReviewAudio(wordsWithSentences: WordWithSentences[]): Promise<void> {
    try {
      const allPaths = new Set<string>();
      const sentences = wordsWithSentences.flatMap((w) => w.sentences);
      for (const s of sentences) {
        try {
          const { audioPaths } = buildSentenceAudioSequence(s);
          audioPaths.forEach((p) => allPaths.add(p));
        } catch (err) {
          logger.warn({ error: err }, 'Failed to build audio sequence for preload');
        }
      }
      if (allPaths.size === 0) return;
      logger.debug(
        { audioFileCount: allPaths.size },
        `Pre-loading ${allPaths.size} audio files into cache for review mode...`
      );
      await audioPlayer.preloadMultiple([...allPaths]);
      logger.debug('Audio cache ready');
    } catch (error) {
      logger.error({ error }, 'Error preloading audio');
    }
  }

  private async handlePlayCurrentAudio() {
    if (this.isLoading || this.error || this.showCompletion) return;

    const currentSentence = this.getCurrentSentence();
    const currentWord = this.getCurrentWord();
    if (!currentSentence?.audioPath || !currentWord) return;

    try {
      await this.stopCachedAudio();

      if (currentSentence.id) {
        this.lastSentenceWithAudioStarted = currentSentence.id;
      }

      const { audioPaths, audioTypes } = buildSentenceAudioSequence(currentSentence);
      if (audioPaths.length === 0) return;

      let currentIndex = 0;
      this.currentPlayingAudio = audioTypes[0];

      await audioPlayer.playSequence(audioPaths, {
        playbackSpeed: this.playbackSpeed,
        onEnded: () => {
          currentIndex++;
          if (currentIndex < audioTypes.length) {
            this.currentPlayingAudio = audioTypes[currentIndex];
            this.requestUpdate();
          } else {
            this.currentPlayingAudio = null;
            this.requestUpdate();
            void this.incrementStrengthForWord(currentWord.id);
            if (currentSentence.id) {
              void window.electronAPI.database
                .incrementSentencePlayCount(currentSentence.id)
                .catch((err) =>
                  logger.warn(
                    { error: err, sentenceId: currentSentence.id },
                    'Failed to increment sentence play count'
                  )
                );
            }
            if (currentSentence.id && this.currentLanguage) {
              this.trackAudioPlayback({
                sentenceId: currentSentence.id,
                audioPath: currentSentence.audioPath!,
                language: this.currentLanguage,
                mode: 'learning',
                playbackSpeed: this.playbackSpeed,
              });
            }
            if (this.autoScrollEnabled) {
              this.clearAutoScrollTimer();
              this.autoScrollTimer = window.setTimeout(() => {
                if (!this.isLastSentence()) void this.goToNextSentence();
                this.autoScrollTimer = null;
              }, 1500);
            }
          }
        },
        onError: (error) => {
          logger.error({ error }, 'Failed to play audio sequence');
          this.currentPlayingAudio = null;
          this.requestUpdate();
        },
      });

      void audioPlayer
        .preload(currentSentence.audioPath)
        .catch((err) =>
          logger.warn(
            { error: err, audioPath: currentSentence.audioPath },
            'Failed to preload audio'
          )
        );
    } catch (error) {
      logger.error({ error }, 'Failed to play audio');
      this.currentPlayingAudio = null;
      this.requestUpdate();
    }
  }

  private async stopCachedAudio(): Promise<void> {
    this.clearAutoScrollTimer();
    this.currentPlayingAudio = null;
    await this.audio.stop();
  }

  private handleSentenceAudioPlayed(event: CustomEvent<{ wordId?: number }>) {
    const wordId = event.detail?.wordId;
    if (!wordId) {
      return;
    }

    void this.incrementStrengthForWord(wordId);
  }

  private handleSentenceAudioCompleted(_event: CustomEvent<{ wordId?: number }>) {
    // Auto-scroll to next sentence after audio finishes (1.5 seconds delay)
    if (this.autoScrollEnabled) {
      this.clearAutoScrollTimer();
      this.autoScrollTimer = window.setTimeout(() => {
        if (!this.isLastSentence()) {
          void this.goToNextSentence();
        }
        this.autoScrollTimer = null;
      }, 1500); // 1.5 seconds delay after audio completes
    }
  }

  private handleSentenceAudioRegenerated(
    event: CustomEvent<{
      sentenceId: number;
      audioPath: string;
      audioType?: 'before' | 'main' | 'after';
    }>
  ) {
    const { sentenceId, audioPath, audioType } = event.detail || ({} as any);
    if (!sentenceId || !audioPath) return;

    const wIndex = this.currentWordIndex;
    const sIndex = this.currentSentenceIndex;
    const currentWord = this.wordsWithSentences[wIndex];
    if (!currentWord) return;

    const targetIndex = currentWord.sentences.findIndex((s) => s.id === sentenceId);
    if (targetIndex === -1) return;

    const updatedSentences = currentWord.sentences.map((s, idx) => {
      if (idx !== targetIndex) return s;
      if (audioType === 'before') return { ...s, beforeSentenceAudioPath: audioPath };
      if (audioType === 'after') return { ...s, afterSentenceAudioPath: audioPath };
      return { ...s, audioPath };
    });
    const updatedWords = this.wordsWithSentences.map((w, idx) =>
      idx === wIndex ? { ...w, sentences: updatedSentences } : w
    );
    this.wordsWithSentences = updatedWords;

    this.currentSentenceIndex = sIndex;
  }

  private async handleStartNewSession(): Promise<void> {
    if (this.isLoading) {
      return;
    }

    this.showCompletion = false;
    this.sessionSummary = null;
    this.error = null;
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
      logger.error({ error }, 'Failed to start new learning session');
      this.error = 'Failed to start a new learning session. Please try again.';
    } finally {
      this.isLoading = false;
    }
  }

  private async handleWordAddedFromSentence(
    event: CustomEvent<{ wordId: number; word: string; translation: string }>
  ): Promise<void> {
    const { wordId } = event.detail;
    await this.jobMonitor.refreshQueueSummary();

    try {
      const newWord = await window.electronAPI.database.getWordById(wordId);
      if (newWord) {
        this.allWords = [
          ...this.allWords.filter((existing) => existing.id !== newWord.id),
          newWord,
        ];
      } else {
        await this.loadAllWords();
      }
    } catch (error) {
      logger.error({ error, wordId }, 'Failed to load newly added word');
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

  private goToTopicSelection() {
    router.goToTopicSelection();
  }

  private async incrementStrengthForWord(wordId: number): Promise<void> {
    // Only increment strength once per session per word
    // This prevents double incrementing when:
    // - Multiple audio files play (before-sentence + main sentence)
    // - Navigating next/previous triggers audio playback
    if (this.wordsIncrementedThisSession.has(wordId)) {
      return;
    }

    const word = this.wordsWithSentences.find((w) => w.id === wordId);
    if (!word) {
      return;
    }

    // Mark this word as incremented for this session
    this.wordsIncrementedThisSession.add(wordId);

    const currentStrength = typeof word.strength === 'number' ? word.strength : 0;
    const newStrength = currentStrength + STRENGTH_BOOST_CONFIG.SENTENCE_PLAYED;
    this.applyStrengthUpdate(wordId, newStrength);

    try {
      await window.electronAPI.database.updateWordStrength(wordId, newStrength);
    } catch (error) {
      logger.error({ error, wordId }, 'Failed to update word strength after sentence exposure');
    }
  }

  private applyStrengthUpdate(wordId: number, strength: number): void {
    this.wordsWithSentences = this.wordsWithSentences.map((word) =>
      word.id === wordId ? { ...word, strength } : word
    );

    this.selectedWords = this.selectedWords.map((word) =>
      word.id === wordId ? { ...word, strength } : word
    );

    this.allWords = this.allWords.map((word) =>
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
    const { queued, processing, failed, processingWords, queuedWords } =
      this.jobMonitor.queueSummary;
    const pending = queued + processing - failed;

    if (pending <= 0) {
      return null;
    }

    const formatWordList = (words: Array<{ word: string }>, max = 3) => {
      if (!words.length) {
        return '';
      }
      const names = words.map((item) => `"${item.word}"`);
      if (names.length <= max) {
        return names.join(', ');
      }
      return `${names.slice(0, max).join(', ')} + ${names.length - max} more`;
    };

    const runningWords = processingWords?.filter((w) => w.status === 'processing');

    const processingList = runningWords?.length ? formatWordList(runningWords) : '';
    const queuedList = queuedWords?.length ? formatWordList(queuedWords) : '';

    const detailParts = [
      processing > 0 && processingList ? `Running: ${processingList}` : '',
      queued > 0 && queuedList ? `Queued: ${queuedList}` : '',
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
          <div class="error-container">
            <div class="error-message">${this.error}</div>
            <button class="action-button primary" @click=${this.goToTopicSelection}>
              Select Words
            </button>
          </div>
        </div>
      `;
    }

    if (this.wordsWithSentences.length === 0) {
      // Check if there are words but no sentences, vs no words at all
      const hasWordsButNoSentences = this.selectedWords.length > 0;
      return html`
        <div class="learning-container">
          <div class="empty-state">
            <h3>No Learning Content Available</h3>
            ${hasWordsButNoSentences
              ? html`
                  <p>
                    You have ${this.selectedWords.length}
                    word${this.selectedWords.length === 1 ? '' : 's'}, but no sentences have been
                    generated yet.
                  </p>
                  <p>
                    Please generate sentences for your words first, or select new words to review.
                  </p>
                `
              : html`
                  <p>
                    No words available for review. Please add words and generate sentences for them.
                  </p>
                `}
            <button class="action-button primary" @click=${this.goToTopicSelection}>
              Select Words
            </button>
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
        <div class="learning-header"></div>

        ${this.infoMessage
          ? html` <div class="info-banner ${this.infoMessageType}">${this.infoMessage}</div> `
          : ''}

        <div class="progress-section">
          <div class="progress-info">
            <div class="progress-text">
              <span class="word-counter"
                >Word ${this.currentWordIndex + 1} of ${this.wordsWithSentences.length}</span
              >
            </div>
            <learning-controls
              .playbackSpeed=${this.playbackSpeed}
              .autoScrollEnabled=${this.autoScrollEnabled}
              .audioOnlyMode=${this.audioOnlyMode}
              .isLastSentence=${this.isLastSentence()}
              @speed-change=${(e: CustomEvent<{ speed: number }>) =>
                this.setPlaybackSpeed(e.detail.speed)}
              @auto-scroll-change=${() => this.toggleAutoScroll()}
              @audio-only-change=${() => this.toggleAudioOnlyMode()}
            ></learning-controls>
          </div>
          <progress-bar .value=${progressPercent} height="4px"></progress-bar>
        </div>

        <sentence-viewer
          .sentence=${currentSentence}
          .targetWord=${currentWord}
          .allWords=${this.allWords}
          .displayLastSeen=${this.currentSentenceDisplayLastSeen}
          .isFirstSentence=${this.isFirstSentence()}
          .isLastSentence=${this.isLastSentence()}
          .isProcessing=${this.isProcessing}
          .currentPlayingAudio=${this.currentPlayingAudio}
          .audioOnlyMode=${this.audioOnlyMode}
          .autoScrollEnabled=${this.autoScrollEnabled}
          .currentSessionId=${this.currentSessionId}
          .playbackSpeed=${this.playbackSpeed}
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
