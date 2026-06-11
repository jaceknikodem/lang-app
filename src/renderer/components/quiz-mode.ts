/**
 * Quiz mode component for vocabulary assessment
 */

import { html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Word, QuizQuestion, QuizSession, QuizResult } from '../../shared/types/core.js';
import { STRENGTH_BOOST_CONFIG } from '../../shared/constants/index.js';
import { sharedStyles } from '../styles/shared.js';
import { quizModeStyles } from './quiz-mode.styles.js';
import { recordingStyles } from './recording.styles.js';
import { router } from '../utils/router.js';
import { sessionManager, type QuizSessionState } from '../utils/session-manager.js';
import { useKeyboardBindings, GlobalShortcuts, CommonKeys } from '../utils/keyboard-manager.js';
import { BaseComponent } from './base-component.js';
import { audioPlayer } from '../utils/audio-player-service.js';
import './session-complete.js';
import './progress-bar.js';
import type { SessionSummary } from './session-complete.js';
import { RecordingController } from './recording-controller.js';
import { TranscriptionController } from './transcription-controller.js';
import './recording-status.js';
import { checkProficiencyLevel } from '../utils/app-initializer.js';
import {
  getSimilarityClass,
  type ProficiencyLevel,
} from '../../shared/utils/similarity-threshold.js';
import { logger } from '../utils/logger.js';
import { shuffleArray } from '../utils/array-utils.js';
import {
  initializeSpeechRecognition,
  startSpeechRecognitionCheck,
} from '../utils/speech-recognition-checker.js';

@customElement('quiz-mode')
export class QuizMode extends BaseComponent {
  @state()
  private quizSession: QuizSession | null = null;

  @state()
  private currentQuestion: QuizQuestion | null = null;

  @state()
  private showResult = false;

  @state()
  private showAnswer = false;

  @state()
  private lastResult: QuizResult | null = null;

  @state()
  private showCompletion = false;

  @state()
  private sessionSummary: SessionSummary | null = null;

  @state()
  private selectedWords: Word[] = [];

  private recording = new RecordingController(this, {
    onBeforeStart: () => this.stopCachedAudio(),
    onRecordingComplete: () => this.performSpeechRecognition(),
    onError: (msg) => {
      this.error = msg;
    },
  });

  private transcription = new TranscriptionController(this);

  @state()
  private transcriptionResult: {
    text: string;
    similarity: number;
    normalizedTranscribed: string;
    normalizedExpected: string;
    expectedWords: Array<{ word: string; similarity: number; matched: boolean }>;
    transcribedWords: string[];
  } | null = null;

  @state()
  private isTranscribing = false;

  @state()
  private speechRecognitionReady = false;

  @state()
  private autoplayEnabled = false;

  @state()
  private audioOnlyMode = false;

  @state()
  private useTextInput = false;

  @state()
  private textInputValue = '';

  private keyboardUnsubscribe?: () => void;
  private lastAutoplayKey: string | null = null;
  private speechRecognitionCheckCleanup: (() => void) | null = null;

  private currentProficiencyLevel: ProficiencyLevel | null = null;

  protected override handleExternalLanguageChange = async (event: Event): Promise<void> => {
    // Call base class handler first
    await super.handleExternalLanguageChange(event);

    const detail = (event as CustomEvent<{ language?: string }>).detail;
    const newLanguage = detail?.language;

    if (!newLanguage) {
      return;
    }

    // Reload quiz data for the new language
    try {
      this.isLoading = true;
      this.error = null;

      // Load proficiency level for the new language
      const proficiency = await checkProficiencyLevel(newLanguage);
      this.currentProficiencyLevel = proficiency as ProficiencyLevel | null;

      // Load words from database for the new language
      await this.loadSelectedWords();

      if (this.selectedWords.length === 0) {
        this.error = 'No words available for quiz. Please start a new learning session first.';
        this.isLoading = false;
        return;
      }

      // Start a fresh quiz session with the new language's words
      await this.startQuiz();
    } catch (error) {
      logger.error({ error }, 'Failed to reload quiz data after language change');
      this.error = 'Failed to reload quiz data. Please try again.';
      this.isLoading = false;
    }
  };

  static styles = [sharedStyles, quizModeStyles, recordingStyles];

  async connectedCallback() {
    super.connectedCallback();

    // Setup keyboard bindings
    this.setupKeyboardBindings();

    initializeSpeechRecognition()
      .then((ready) => {
        this.speechRecognitionReady = ready;
      })
      .catch((err) => {
        logger.warn({ error: err }, 'Speech recognition initialization failed (non-blocking)');
        this.speechRecognitionReady = false;
      });

    this.speechRecognitionCheckCleanup = startSpeechRecognitionCheck((ready) => {
      this.speechRecognitionReady = ready;
      this.requestUpdate();
    });

    // Load autoplay preference
    await this.loadAutoplaySetting();

    // Load proficiency level and create quiz session for tracking
    try {
      this.currentLanguage = await window.electronAPI.database.getCurrentLanguage();
      const proficiency = await checkProficiencyLevel(this.currentLanguage);
      this.currentProficiencyLevel = proficiency as ProficiencyLevel | null;
    } catch (error) {
      logger.warn({ error }, 'Failed to load proficiency level');
    }
    if (this.currentLanguage) {
      await this.createTrackingSession('quiz', this.currentLanguage);
    }

    // Check if there's an existing quiz session to restore
    const savedQuizSession = sessionManager.getQuizSession();

    if (savedQuizSession && !savedQuizSession.isComplete) {
      // Restore existing quiz
      await this.restoreQuizFromSession(savedQuizSession);
    } else {
      // Start a fresh quiz session
      // Load words from database first
      await this.loadSelectedWords();

      if (this.selectedWords.length === 0) {
        this.error = 'No words available for quiz. Please start a new learning session first.';
        return;
      }

      // Start a fresh quiz session
      await this.startQuiz();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    // Update session if it exists and quiz isn't complete
    if (this.currentSessionId && !this.quizSession?.isComplete) {
      void this.updateSessionOnCompletion();
    }

    this.speechRecognitionCheckCleanup?.();
    this.speechRecognitionCheckCleanup = null;

    // Clean up keyboard bindings
    if (this.keyboardUnsubscribe) {
      this.keyboardUnsubscribe();
    }

    // Clean up audio cache and playing audio
    this.stopCachedAudio();
  }

  private async restoreQuizFromSession(savedSession: QuizSessionState) {
    this.isLoading = true;
    this.error = null;

    try {
      // Load words from the saved word IDs in the same order (preserves shuffle)
      const words = await window.electronAPI.database.getWordsByIds(savedSession.wordIds);

      if (words.length === 0 || words.length !== savedSession.wordIds.length) {
        // Some words might have been deleted, clear the session and start fresh
        sessionManager.clearQuizSession();
        await this.loadSelectedWords();
        if (this.selectedWords.length === 0) {
          this.error = 'No words available for quiz. Please start a new learning session first.';
          return;
        }
        await this.startQuiz();
        return;
      }

      // Restore audio-only mode
      this.audioOnlyMode = savedSession.audioOnlyMode ?? false;

      // Generate quiz questions from words in the saved order
      const questions: QuizQuestion[] = [];

      for (const wordId of savedSession.wordIds) {
        const word = words.find((w) => w.id === wordId);
        if (!word) continue;

        // Get a random sentence for this word
        const sentence = await window.electronAPI.quiz.getRandomSentenceForWord(word.id);

        if (sentence) {
          questions.push({
            word,
            sentence,
          });
        }
      }

      if (questions.length === 0) {
        this.error = 'No sentences found for the saved words. Please start a new quiz.';
        sessionManager.clearQuizSession();
        return;
      }

      // Restore quiz session state
      this.quizSession = {
        questions,
        currentQuestionIndex: savedSession.currentQuestionIndex,
        score: savedSession.score,
        totalQuestions: savedSession.totalQuestions,
        isComplete: savedSession.isComplete,
      };

      // Restore current question
      if (this.quizSession.currentQuestionIndex < questions.length) {
        this.currentQuestion = questions[this.quizSession.currentQuestionIndex];
      } else {
        // If we're past the end (shouldn't happen), go to the last question
        this.quizSession.currentQuestionIndex = questions.length - 1;
        this.currentQuestion = questions[this.quizSession.currentQuestionIndex];
      }

      // Set selected words for compatibility
      this.selectedWords = words;

      // Prioritize: Load current question's audio first
      await this.ensureCurrentQuestionAudioLoaded();

      // Load next question's audio right after current one is ready
      this.preloadNextQuestionAudio();

      // Pre-load remaining audio files in background (non-blocking)
      void this.preloadQuizAudio(questions);

      void this.maybeAutoplayCurrentQuestion(true);

      logger.info(
        {
          questionIndex: this.quizSession.currentQuestionIndex + 1,
          totalQuestions: this.quizSession.totalQuestions,
          score: this.quizSession.score,
        },
        'Restored quiz session'
      );
    } catch (error) {
      logger.error({ error }, 'Error restoring quiz session');
      this.error = 'Failed to restore quiz session. Starting a new quiz.';
      sessionManager.clearQuizSession();
      await this.loadSelectedWords();
      if (this.selectedWords.length > 0) {
        await this.startQuiz();
      }
    } finally {
      this.isLoading = false;
    }
  }

  private async startQuiz() {
    if (this.selectedWords.length === 0) {
      this.error = 'No words selected for quiz';
      return;
    }

    this.isLoading = true;
    this.error = null;

    try {
      // Filter out known words - we don't want to quiz on words marked as known
      const wordsToQuiz = this.selectedWords.filter((word) => !word.known);

      if (wordsToQuiz.length === 0) {
        this.error = 'No words available for quiz. All selected words are marked as known.';
        return;
      }

      // Generate quiz questions from words
      const questions: QuizQuestion[] = [];

      for (const word of wordsToQuiz) {
        // Get a random sentence for this word
        const sentence = await window.electronAPI.quiz.getRandomSentenceForWord(word.id);

        if (sentence) {
          questions.push({
            word,
            sentence,
          });
        }
      }

      if (questions.length === 0) {
        this.error =
          'No sentences found for the selected words. Please review words in learning mode first.';
        return;
      }

      // Shuffle questions for variety
      const shuffledQuestions = shuffleArray(questions);
      const wordIds = shuffledQuestions.map((q) => q.word.id);

      this.quizSession = {
        questions: shuffledQuestions,
        currentQuestionIndex: 0,
        score: 0,
        totalQuestions: shuffledQuestions.length,
        isComplete: false,
      };

      this.currentQuestion = shuffledQuestions[0];

      // Save quiz session to session manager (creates new session)
      sessionManager.startNewQuizSession(wordIds, this.audioOnlyMode);

      // Prioritize: Load current question's audio first, then autoplay
      // This ensures audio is ready before playback starts
      await this.ensureCurrentQuestionAudioLoaded();

      // Load next question's audio right after current one is ready
      this.preloadNextQuestionAudio();

      // Pre-load remaining audio files in background (non-blocking)
      void this.preloadQuizAudio(shuffledQuestions);

      void this.maybeAutoplayCurrentQuestion(true);
    } catch (error) {
      logger.error({ error }, 'Error starting quiz');
      this.error = 'Failed to start quiz. Please try again.';
    } finally {
      this.isLoading = false;
    }
  }

  private async loadAutoplaySetting() {
    try {
      const autoplaySetting = await window.electronAPI.database.getSetting('autoplay_audio');
      this.autoplayEnabled = autoplaySetting === 'true';
    } catch (error) {
      logger.error({ error }, 'Failed to load autoplay setting');
      this.autoplayEnabled = false;
    }
  }

  private async loadSelectedWords() {
    try {
      // Always load the weakest words from database for targeted practice
      const language = await window.electronAPI.database.getCurrentLanguage();
      const words = await window.electronAPI.quiz.getWeakestWords(10, language);
      this.selectedWords = words;
      logger.info({ wordCount: this.selectedWords.length }, 'Loaded weakest words for quiz');
    } catch (error) {
      logger.error({ error }, 'Failed to load words');
      this.error = 'Failed to load words from database.';
    }
  }

  private saveQuizProgressToSession() {
    if (this.quizSession) {
      // Save word IDs in the order they appear (preserves shuffle)
      const wordIds = this.quizSession.questions.map((q) => q.word.id);

      sessionManager.updateQuizSession({
        wordIds,
        currentQuestionIndex: this.quizSession.currentQuestionIndex,
        score: this.quizSession.score,
        totalQuestions: this.quizSession.totalQuestions,
        isComplete: this.quizSession.isComplete,
        audioOnlyMode: this.audioOnlyMode,
      });
    }
  }

  private revealAnswer() {
    this.showAnswer = true;
  }

  private async handleAnswer(correct: boolean) {
    // Legacy method - map to SRS values
    const srsRecall = correct ? 2 : 0;
    await this.handleSRSAnswer(srsRecall);
  }

  private async handleSRSAnswer(recall: 0 | 1 | 2 | 3) {
    if (!this.quizSession || !this.currentQuestion) return;

    const word = this.currentQuestion.word;
    const recallLabels = ['Failed', 'Hard', 'Good', 'Easy'];

    console.log(`[Quiz] ========== SUBMITTING REVIEW ==========`);
    console.log(
      `[Quiz] Question ${this.quizSession.currentQuestionIndex + 1}/${this.quizSession.totalQuestions}`
    );
    console.log(`[Quiz] Word: "${word.word}" (ID: ${word.id})`);
    console.log(`[Quiz] User rating: ${recall} (${recallLabels[recall]})`);
    console.log(`[Quiz] Word state BEFORE update:`, {
      strength: word.strength ?? 20,
      intervalDays: word.intervalDays ?? 1,
      easeFactor: word.easeFactor ?? 2.5,
      nextDue: word.nextDue?.toISOString() ?? 'unknown',
      fsrsDifficulty: word.fsrsDifficulty ?? 5.0,
      fsrsStability: word.fsrsStability ?? 1.0,
      fsrsLapses: word.fsrsLapses ?? 0,
      fsrsLastRating: word.fsrsLastRating ?? null,
      lastReview: word.lastReview?.toISOString() ?? 'never',
      lastStudied: word.lastStudied?.toISOString() ?? 'never',
    });

    if (recall > 0) {
      this.quizSession.score++;
    }

    // Update word using SRS system and save progress immediately
    // Do this BEFORE showing the result so the updated strength is displayed
    try {
      console.log(`[Quiz] Calling SRS service to process review...`);
      await window.electronAPI.srs.processReview(word.id, recall);
      await window.electronAPI.database.updateLastStudied(word.id);

      // Refresh the word data to get updated SRS values
      const updatedWord = await window.electronAPI.database.getWordById(word.id);
      if (updatedWord) {
        console.log(`[Quiz] Word state AFTER update:`, {
          strength: updatedWord.strength ?? 20,
          intervalDays: updatedWord.intervalDays ?? 1,
          easeFactor: updatedWord.easeFactor ?? 2.5,
          nextDue: updatedWord.nextDue?.toISOString() ?? 'unknown',
          fsrsDifficulty: updatedWord.fsrsDifficulty ?? 5.0,
          fsrsStability: updatedWord.fsrsStability ?? 1.0,
          fsrsLapses: updatedWord.fsrsLapses ?? 0,
          fsrsLastRating: updatedWord.fsrsLastRating ?? null,
          lastReview: updatedWord.lastReview?.toISOString() ?? 'never',
          lastStudied: updatedWord.lastStudied?.toISOString() ?? 'never',
        });

        console.log(`[Quiz] Changes observed:`, {
          strength: `${word.strength ?? 20} → ${updatedWord.strength ?? 20}`,
          intervalDays: `${word.intervalDays ?? 1} → ${updatedWord.intervalDays ?? 1}`,
          easeFactor: `${word.easeFactor ?? 2.5} → ${updatedWord.easeFactor ?? 2.5}`,
          fsrsDifficulty: `${word.fsrsDifficulty ?? 5.0} → ${updatedWord.fsrsDifficulty ?? 5.0}`,
          fsrsStability: `${word.fsrsStability ?? 1.0} → ${updatedWord.fsrsStability ?? 1.0}`,
          fsrsLapses: `${word.fsrsLapses ?? 0} → ${updatedWord.fsrsLapses ?? 0}`,
          nextDue: `${word.nextDue?.toISOString() ?? 'unknown'} → ${updatedWord.nextDue?.toISOString() ?? 'unknown'}`,
        });

        // Update the word object before showing the result
        this.currentQuestion.word = updatedWord;
      }

      // Save progress immediately after each answer
      this.saveQuizProgressToSession();
    } catch (error) {
      logger.error({ error }, '[Quiz] Error updating word with SRS');
    }

    // Show result AFTER updating the word so the updated strength is displayed
    this.showResult = true;
    this.lastResult = {
      wordId: word.id,
      correct: recall > 0, // Any non-zero recall counts as correct
      responseTime: Date.now(),
    };

    console.log(`[Quiz] ========== REVIEW COMPLETE ==========\n`);

    // Automatically move to next question after a short delay
    setTimeout(() => {
      this.nextQuestion();
    }, 1500); // 1.5 second delay to show the result briefly
  }

  private async nextQuestion() {
    if (!this.quizSession) return;

    this.showResult = false;
    this.showAnswer = false;
    this.lastResult = null;
    this.transcriptionResult = null;
    this.recording.clearRecordingState();
    this.isTranscribing = false;

    if (this.quizSession.currentQuestionIndex + 1 >= this.quizSession.totalQuestions) {
      // Quiz complete - save progress one last time before recording
      this.saveQuizProgressToSession();

      // Mark as complete before recording
      this.quizSession.isComplete = true;

      // Record the session
      await this.recordQuizSession();

      this.currentQuestion = null;
    } else {
      // Move to next question
      this.quizSession.currentQuestionIndex++;
      this.currentQuestion = this.quizSession.questions[this.quizSession.currentQuestionIndex];

      // Save progress immediately when moving to next question
      this.saveQuizProgressToSession();

      // Reload autoplay setting to respect user toggles
      await this.loadAutoplaySetting();

      // Start audio playback immediately (don't wait for loading)
      void this.maybeAutoplayCurrentQuestion();

      // Load current question's audio into cache in background (non-blocking)
      void this.ensureCurrentQuestionAudioLoaded().catch((err) => {
        logger.warn({ error: err }, 'Failed to load audio into cache');
      });

      // Immediately load next question's audio in background
      this.preloadNextQuestionAudio();
    }
  }

  private async recordQuizSession() {
    if (!this.quizSession) return;

    try {
      // Record the study session in the database
      await window.electronAPI.database.recordStudySession(this.quizSession.totalQuestions);

      // Update learning session with final counts
      await this.updateSessionOnCompletion();

      // Mark quiz session as complete in session manager
      sessionManager.markQuizSessionComplete();

      // Clear quiz session after completion
      sessionManager.clearQuizSession();

      // Show completion screen
      this.showQuizCompletion();

      // Dispatch event for autopilot to check scores after quiz is done
      window.dispatchEvent(new CustomEvent('autopilot-check-trigger'));
    } catch (error) {
      logger.error({ error }, 'Error recording quiz session');
      // Don't block the UI for this error, but ensure session is cleared
      sessionManager.clearQuizSession();
      this.showQuizCompletion();
      // Still trigger autopilot check even on error
      window.dispatchEvent(new CustomEvent('autopilot-check-trigger'));
    }
  }

  private async updateSessionOnCompletion() {
    if (!this.quizSession) return;
    await this.finalizeTrackingSession(
      this.quizSession.totalQuestions,
      this.quizSession.totalQuestions
    );
  }

  private showQuizCompletion() {
    if (!this.quizSession) return;

    const timeSpent = Math.round((Date.now() - this.sessionStartTime) / (1000 * 60)); // minutes
    const percentage = Math.round((this.quizSession.score / this.quizSession.totalQuestions) * 100);

    // Determine next recommendation based on quiz performance
    let nextRecommendation: SessionSummary['nextRecommendation'] = 'new-topic';

    if (percentage < 50) {
      nextRecommendation = 'continue-learning';
    } else if (percentage < 70) {
      nextRecommendation = 'practice-weak';
    }

    this.sessionSummary = {
      type: 'quiz',
      wordsStudied: this.quizSession.totalQuestions,
      timeSpent,
      quizScore: this.quizSession.score,
      quizTotal: this.quizSession.totalQuestions,
      completedWords: this.selectedWords,
      nextRecommendation,
    };

    this.showCompletion = true;
  }

  private async maybeAutoplayCurrentQuestion(force = false) {
    if (!this.autoplayEnabled || !this.currentQuestion) {
      return;
    }

    const currentIndex = this.quizSession?.currentQuestionIndex ?? null;
    const sentenceId = this.currentQuestion.sentence?.id ?? null;
    const autoplayKey =
      currentIndex !== null && sentenceId !== null
        ? `${currentIndex}-${sentenceId}`
        : currentIndex !== null
          ? `${currentIndex}`
          : sentenceId !== null
            ? `sentence-${sentenceId}`
            : null;

    if (!force && autoplayKey && this.lastAutoplayKey === autoplayKey) {
      return;
    }

    if (autoplayKey) {
      this.lastAutoplayKey = autoplayKey;
    }

    const audioPath = this.currentQuestion.sentence.audioPath;
    if (!audioPath) {
      return;
    }

    // Stop any currently playing audio (non-blocking)
    void window.electronAPI.audio.stopAudio().catch(() => {
      // Ignore errors when stopping
    });

    // Play audio immediately (don't wait for loading)
    void this.playAudio();

    // Load audio into cache in background for next time (non-blocking)
    void this.ensureCurrentQuestionAudioLoaded().catch((err) => {
      logger.warn({ error: err }, 'Failed to load audio into cache');
    });
  }

  /**
   * Ensure current question's audio is loaded and ready
   * Prioritizes current audio for instant playback
   */
  private async ensureCurrentQuestionAudioLoaded(): Promise<void> {
    if (!this.currentQuestion?.sentence.audioPath) {
      return;
    }

    const audioPath = this.currentQuestion.sentence.audioPath;

    void audioPlayer.preload(audioPath).catch((error) => {
      logger.warn({ error, audioPath }, 'Failed to load current question audio');
    });
  }

  private preloadNextQuestionAudio(): void {
    if (!this.quizSession) {
      return;
    }

    const nextIndex = this.quizSession.currentQuestionIndex + 1;
    if (nextIndex >= this.quizSession.questions.length) {
      return;
    }

    const nextAudioPath = this.quizSession.questions[nextIndex]?.sentence.audioPath;
    if (!nextAudioPath) {
      return;
    }

    void audioPlayer.preload(nextAudioPath).catch((error) => {
      logger.warn({ error, audioPath: nextAudioPath }, 'Failed to preload next question audio');
    });
  }

  private async preloadQuizAudio(questions: QuizQuestion[]): Promise<void> {
    try {
      const audioPaths = questions
        .map((q) => q.sentence.audioPath)
        .filter((path): path is string => !!path);
      await audioPlayer.preloadMultiple(audioPaths);
      logger.info('Audio cache ready');
    } catch (error) {
      logger.error({ error }, 'Error preloading audio');
    }
  }

  /**
   * Play audio using audio player service
   */
  private async playAudio() {
    if (!this.currentQuestion) return;

    try {
      const audioPath = this.currentQuestion.sentence.audioPath;
      if (!audioPath) {
        return;
      }

      // Stop any currently playing audio
      this.stopCachedAudio();

      // Track audio playback immediately when scheduled (assume it will play)
      if (this.currentQuestion?.sentence.id) {
        const sentenceId = this.currentQuestion.sentence.id;
        // Track sentence play count
        void window.electronAPI.database.incrementSentencePlayCount(sentenceId).catch((err) => {
          logger.warn({ error: err, sentenceId }, 'Failed to increment sentence play count');
        });

        if (this.currentLanguage) {
          this.trackAudioPlayback({
            sentenceId,
            audioPath,
            language: this.currentLanguage,
            mode: 'quiz',
          });
        }
      }

      // Play audio using audio player service
      await audioPlayer.play(audioPath, {
        playbackSpeed: 1.0, // Quiz mode doesn't have playback speed control
        onError: (error: Error) => {
          logger.error({ error }, 'Failed to play audio');
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error playing audio');
    }
  }

  /**
   * Stop currently playing audio
   */
  private stopCachedAudio(): void {
    audioPlayer.stop();
    // Also stop any IPC audio playback
    window.electronAPI.audio.stopAudio().catch(() => {
      // Ignore errors when stopping
    });
  }

  private restartQuiz() {
    this.quizSession = null;
    this.currentQuestion = null;
    this.showResult = false;
    this.showAnswer = false;
    this.lastResult = null;
    this.error = null;
    this.lastAutoplayKey = null;
  }

  private goToLearning() {
    router.goToLearning();
  }

  private goToTopicSelection() {
    router.goToTopicSelection();
  }

  private setupKeyboardBindings() {
    const bindings = [
      // Quiz setup
      {
        key: CommonKeys.ENTER,
        action: () => this.handleEnterKey(),
        context: 'quiz',
        description: 'Start quiz / Reveal answer / Continue',
      },

      // Audio only mode
      {
        ...GlobalShortcuts.TOGGLE_AUDIO_ONLY,
        action: () => this.toggleAudioOnlyMode(),
        context: 'quiz',
        description: 'Toggle show/hide English',
      },
      // Audio controls
      {
        ...GlobalShortcuts.PLAY_AUDIO,
        action: () => this.playAudio(),
        context: 'quiz',
        description: 'Play sentence audio',
      },
      // SRS difficulty ratings (when answer is revealed)
      {
        ...GlobalShortcuts.SRS_FAIL,
        action: () => this.handleSRSAnswer(0),
        context: 'quiz',
        description: 'Rate as Failed (when answer revealed)',
      },
      {
        ...GlobalShortcuts.SRS_HARD,
        action: () => this.handleSRSAnswer(1),
        context: 'quiz',
        description: 'Rate as Hard (when answer revealed)',
      },
      {
        ...GlobalShortcuts.SRS_GOOD,
        action: () => this.handleSRSAnswer(2),
        context: 'quiz',
        description: 'Rate as Good (when answer revealed)',
      },
      {
        ...GlobalShortcuts.SRS_EASY,
        action: () => this.handleSRSAnswer(3),
        context: 'quiz',
        description: 'Rate as Easy (when answer revealed)',
      },
      // Pronunciation practice
      {
        ...GlobalShortcuts.RECORD_PRONUNCIATION,
        action: () => this.toggleRecording(),
        context: 'quiz',
        description: 'Toggle pronunciation recorder',
      },
      // Navigation
      {
        ...GlobalShortcuts.ESCAPE,
        action: () => this.handleEscape(),
        context: 'quiz',
        description: 'Cancel recording (if active)',
      },
    ];

    this.keyboardUnsubscribe = useKeyboardBindings(bindings);
  }

  private handleEnterKey() {
    // Don't handle if we're loading or have an error
    if (!this.quizSession || this.isLoading || this.error) {
      return;
    }

    // Don't handle if quiz is complete
    if (this.quizSession.isComplete) return;

    // Don't handle if recording is in progress
    if (this.recording.isRecording) return;

    // If showing result, the auto-advance will handle progression
    if (this.showResult) return;

    // If answer is not revealed yet, reveal it
    if (!this.showAnswer) {
      this.revealAnswer();
      return;
    }

    // If answer is revealed but no result yet, we're in self-assessment mode
    // Don't auto-advance here as user needs to select difficulty
  }

  private handleEscape() {
    if (this.recording.isRecording) {
      void this.recording.cancelRecording();
    }
    // ESC in quiz mode no longer navigates away - just cancel recording if active
  }

  private async toggleRecording() {
    if (!this.speechRecognitionReady || !this.currentQuestion) return;

    if (this.recording.isRecording) {
      await this.recording.stopRecording();
    } else {
      this.transcriptionResult = null;
      this.isTranscribing = false;
      await this.recording.startRecording();
    }
  }

  private handleTextInputSubmit() {
    if (!this.textInputValue.trim() || !this.currentQuestion) {
      return;
    }

    // Directly compare the typed text with the expected sentence
    this.performTextComparison(this.textInputValue.trim());
  }

  private async performTextComparison(typedText: string) {
    if (!this.currentQuestion) {
      return;
    }

    this.isTranscribing = true;
    this.transcriptionResult = null;

    try {
      // Get the expected sentence (foreign language)
      const expectedSentence = this.currentQuestion.sentence.sentence;

      // Compare typed text with expected sentence (same logic as transcription comparison)
      const comparison = await window.electronAPI.audio.compareTranscription(
        typedText,
        expectedSentence,
        this.currentProficiencyLevel
      );

      logger.debug({ comparison }, 'Text comparison');

      this.transcriptionResult = {
        text: typedText,
        ...comparison,
      };
    } catch (error) {
      logger.error({ error }, 'Text comparison failed');
      this.transcriptionResult = {
        text: typedText,
        similarity: 0,
        normalizedTranscribed: typedText,
        normalizedExpected: '',
        expectedWords: [],
        transcribedWords: [],
      };
    } finally {
      this.isTranscribing = false;
    }
  }

  private toggleAudioOnlyMode() {
    this.audioOnlyMode = !this.audioOnlyMode;
    // Save the audio-only mode setting to session
    this.saveQuizProgressToSession();
  }

  private async performSpeechRecognition() {
    const currentRecording = this.recording.currentRecording;
    if (!currentRecording || !this.currentQuestion || !this.speechRecognitionReady) {
      return;
    }

    this.isTranscribing = true;
    this.transcriptionResult = null;
    this.transcription.clear();

    try {
      const expectedSentence = this.currentQuestion.sentence.sentence;
      const currentLanguage = await window.electronAPI.database.getCurrentLanguage();

      logger.debug(
        { filePath: currentRecording.filePath, expectedSentence, language: currentLanguage },
        'Transcribing audio'
      );

      const transcriptionResult = await window.electronAPI.audio.transcribeAudio(
        currentRecording.filePath,
        { language: currentLanguage }
      );

      logger.debug({ transcriptionResult }, 'Transcription result');

      const comparison = await window.electronAPI.audio.compareTranscription(
        transcriptionResult.text,
        expectedSentence,
        this.currentProficiencyLevel
      );

      logger.debug({ comparison }, 'Transcription comparison');

      this.transcriptionResult = {
        text: transcriptionResult.text,
        ...comparison,
      };

      if (this.currentQuestion?.sentence?.id) {
        try {
          await window.electronAPI.database.recordPronunciationAttempt(
            this.currentQuestion.sentence.id,
            comparison.similarity,
            expectedSentence,
            transcriptionResult.text,
            currentRecording.filePath || null
          );
        } catch (error) {
          logger.warn({ error }, 'Failed to record pronunciation attempt');
        }
      }

      // Apply pronunciation boost based on similarity score (2-4 points depending on quality)
      if (this.currentQuestion) {
        const word = this.currentQuestion.word;
        const boost = STRENGTH_BOOST_CONFIG.getPronunciationBoost(comparison.similarity);

        if (boost > 0) {
          const currentStrength = word.strength ?? 20;
          const newStrength = Math.min(100, currentStrength + boost);

          try {
            logger.info(
              {
                similarity: Math.round(comparison.similarity * 100),
                wordId: word.id,
                strengthChange: `${currentStrength} → ${newStrength} (+${boost})`,
              },
              '[Pronunciation] Good pronunciation detected, increasing word strength'
            );
            await window.electronAPI.database.updateWordStrength(word.id, newStrength);
            await window.electronAPI.database.updateLastStudied(word.id);

            // Refresh the word data to get updated strength
            const updatedWord = await window.electronAPI.database.getWordById(word.id);
            if (updatedWord) {
              this.currentQuestion.word = updatedWord;
              this.requestUpdate(); // Trigger UI update to show new strength
            }
          } catch (error) {
            logger.error(
              { error, wordId: word.id },
              'Failed to update word strength after good pronunciation'
            );
          }
        }
      }
    } catch (error) {
      logger.error({ error }, 'Speech recognition failed');
      this.transcriptionResult = {
        text: 'Speech recognition failed. Please try again.',
        similarity: 0,
        normalizedTranscribed: '',
        normalizedExpected: '',
        expectedWords: [],
        transcribedWords: [],
      };
    } finally {
      this.isTranscribing = false;
    }
  }

  render() {
    if (this.error) {
      return html`
        <div class="quiz-container">
          <div class="error-container">
            <div class="error-message">${this.error}</div>
            <button class="action-button primary" @click=${this.goToTopicSelection}>
              Select Words
            </button>
          </div>
        </div>
      `;
    }

    if (this.isLoading) {
      return html`
        <div class="quiz-container">
          <div class="loading-container">
            <div class="loading">
              <div class="spinner"></div>
              Preparing quiz...
            </div>
          </div>
        </div>
      `;
    }

    // Show loading if no session yet (quiz is starting automatically)
    if (!this.quizSession) {
      return html`
        <div class="quiz-container">
          <div class="loading-container">
            <div class="loading">
              <div class="spinner"></div>
              Starting quiz...
            </div>
          </div>
        </div>
      `;
    }

    // Show quiz complete screen
    if (this.quizSession.isComplete) {
      if (this.showCompletion && this.sessionSummary) {
        return html`
          <div class="quiz-container">
            <session-complete .sessionSummary=${this.sessionSummary}></session-complete>
          </div>
        `;
      }
      return this.renderQuizComplete();
    }

    // Show current question
    return this.renderQuestion();
  }

  private renderQuestion() {
    if (!this.quizSession || !this.currentQuestion) return html``;

    const progress =
      ((this.quizSession.currentQuestionIndex + 1) / this.quizSession.totalQuestions) * 100;
    const question = this.currentQuestion;

    // Always show foreign language sentence
    const displayText = question.sentence.sentence;

    // The word we're asking about
    const questionWord = `"${question.word.word}"`;

    return html`
      <div class="quiz-container">
        <div class="quiz-header">
          <div class="quiz-progress">
            <span
              >${this.quizSession.currentQuestionIndex + 1} /
              ${this.quizSession.totalQuestions}</span
            >
            <progress-bar .value=${progress} height="4px" style="width: 150px;"></progress-bar>
            <div class="audio-only-toggle" style="margin-bottom: 0;">
              <span class="audio-only-label" style="font-size: 12px;">Audio Only</span>
              <div
                class="audio-only-switch ${this.audioOnlyMode ? 'active' : ''}"
                @click=${this.toggleAudioOnlyMode}
                title="Toggle audio only mode"
                style="width: 40px; height: 20px;"
              >
                <div
                  class="audio-only-slider"
                  style="width: 16px; height: 16px; top: 2px; left: 2px;"
                ></div>
              </div>
            </div>
          </div>
        </div>

        <div class="quiz-content">
          <div class="question-container">
            ${this.audioOnlyMode
              ? html`
                  <div class="audio-only-controls">
                    <div class="question-actions">
                      <button
                        class="audio-replay-button"
                        @click=${this.playAudio}
                        title="Replay audio"
                        aria-label="Replay audio"
                      >
                        <span aria-hidden="true">🔊</span>
                      </button>
                      ${this.recording.isRecording
                        ? html`
                            <button
                              class="record-button recording"
                              @click=${this.recording.stopRecording}
                              title="Stop recording"
                              aria-label="Stop recording"
                            >
                              <span aria-hidden="true">⏹</span>
                            </button>
                          `
                        : html`
                            <button
                              class="record-button"
                              @click=${this.recording.startRecording}
                              ?disabled=${!this.speechRecognitionReady}
                              title=${this.speechRecognitionReady
                                ? 'Start recording'
                                : 'Speech recognition not ready'}
                              aria-label="Start recording"
                            >
                              <span aria-hidden="true">🎤</span>
                            </button>
                          `}
                    </div>
                  </div>
                `
              : html`
                  <div class="question-text-container">
                    <div class="question-text">${displayText}</div>
                    <div class="question-actions">
                      <button
                        class="audio-replay-button"
                        @click=${this.playAudio}
                        title="Replay audio"
                        aria-label="Replay audio"
                      >
                        <span aria-hidden="true">🔊</span>
                      </button>
                      ${this.recording.isRecording
                        ? html`
                            <button
                              class="record-button recording"
                              @click=${this.recording.stopRecording}
                              title="Stop recording"
                              aria-label="Stop recording"
                            >
                              <span aria-hidden="true">⏹</span>
                            </button>
                          `
                        : html`
                            <button
                              class="record-button"
                              @click=${this.recording.startRecording}
                              ?disabled=${!this.speechRecognitionReady}
                              title=${this.speechRecognitionReady
                                ? 'Start recording'
                                : 'Speech recognition not ready'}
                              aria-label="Start recording"
                            >
                              <span aria-hidden="true">🎤</span>
                            </button>
                          `}
                    </div>
                  </div>
                `}

            <div class="question-translation">
              Do you know what ${questionWord} means in this context?
            </div>

            ${this.recording.isRecording ||
            this.recording.currentRecording ||
            this.transcriptionResult
              ? this.renderRecordingSection()
              : ''}
            ${this.showResult ? this.renderResult() : this.renderQuizButtons()}
          </div>
        </div>
      </div>
    `;
  }

  private renderQuizButtons() {
    // Always show the difficulty prompt and buttons
    const difficultyButtons = html`
      <div class="answer-buttons">
        <div class="difficulty-buttons">
          <button class="answer-button difficulty-fail" @click=${() => this.handleSRSAnswer(0)}>
            Failed ✗ <span class="keyboard-hint">(1)</span>
          </button>
          <button class="answer-button difficulty-hard" @click=${() => this.handleSRSAnswer(1)}>
            Hard 😓 <span class="keyboard-hint">(2)</span>
          </button>
          <button class="answer-button difficulty-good" @click=${() => this.handleSRSAnswer(2)}>
            Good ✓ <span class="keyboard-hint">(3)</span>
          </button>
          <button class="answer-button difficulty-easy" @click=${() => this.handleSRSAnswer(3)}>
            Easy 😊 <span class="keyboard-hint">(4)</span>
          </button>
        </div>
      </div>
    `;

    if (!this.showAnswer) {
      // Before revealing answer, show both reveal button and difficulty buttons
      return html`
        <div class="answer-buttons">
          <button class="answer-button primary" @click=${this.revealAnswer}>
            Reveal Answer <span class="keyboard-hint">(Enter)</span>
          </button>
        </div>
        ${difficultyButtons}
      `;
    }

    // After reveal, show the answer and self-assessment buttons
    return html` ${this.renderRevealedAnswer()} ${difficultyButtons} `;
  }

  private renderRevealedAnswer() {
    if (!this.currentQuestion) return '';

    const word = this.currentQuestion.word;
    const sentence = this.currentQuestion.sentence;

    // Show the correct answer (English translation)
    const correctAnswer = word.translation;

    return html`
      <div class="revealed-answer">
        <div class="answer-container">
          <div class="answer-word">${correctAnswer}</div>
          ${this.audioOnlyMode
            ? html`
                <div class="sentence-pair">
                  <span class="sentence-label">Sentence:</span>
                  <div class="sentence-text">${sentence.sentence}</div>
                  <div class="sentence-translation">${sentence.translation}</div>
                </div>
              `
            : ''}
        </div>
      </div>
    `;
  }

  private renderRecordingSection() {
    if (!this.currentQuestion) return '';

    return html`
      <div class="recording-section">
        <recording-status
          .isRecording=${this.recording.isRecording}
          .recordingTime=${this.recording.recordingTime}
          @cancel-recording=${this.recording.cancelRecording}
        ></recording-status>
        ${this.renderTranscriptionResults()}
      </div>
    `;
  }

  private renderTranscriptionResults() {
    if (this.isTranscribing) {
      return html`
        <div class="transcription-results">
          <div class="transcription-loading">
            <div class="spinner"></div>
            ${this.transcription.streamingTranscriptionText
              ? html`
                  <div class="streaming-transcription">
                    <div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 8px;">
                      Transcribing...
                    </div>
                    <div style="font-size: 16px; font-style: italic; color: var(--text-primary);">
                      "${this.transcription.streamingTranscriptionText}"
                    </div>
                  </div>
                `
              : html`
                  Analyzing your pronunciation...
                  ${!this.speechRecognitionReady
                    ? html`
                        <div
                          style="margin-top: var(--spacing-sm); font-size: 14px; color: var(--text-secondary);"
                        >
                          First-time setup: This may take 1-2 minutes while speech recognition
                          compiles...
                        </div>
                      `
                    : ''}
                `}
          </div>
        </div>
      `;
    }

    if (!this.transcriptionResult) {
      return '';
    }

    const result = this.transcriptionResult;
    const similarity = result.similarity;
    const similarityPercentage = Math.round(similarity * 100);

    // Determine similarity level based on proficiency level
    const similarityClass = getSimilarityClass(similarity, this.currentProficiencyLevel);

    return html`
      <div class="transcription-results">
        <div class="transcription-text">
          <div class="label">Expected:</div>
          <div class="text color-coded-text">
            ${result.expectedWords.map((wordInfo, index) => {
              // Color code based on similarity: green for matched, yellow for partial, red for missing
              let color = '#28a745'; // green for matched
              if (!wordInfo.matched) {
                color = '#dc3545'; // red for missing/not matched
              } else if (wordInfo.similarity < 0.9) {
                color = '#ffc107'; // yellow for partial match
              }

              const isLast = index === result.expectedWords.length - 1;
              return html`<span
                  style="color: ${color}; font-weight: ${wordInfo.matched ? 'normal' : 'bold'};"
                  >${wordInfo.word}</span
                >${!isLast ? ' ' : ''}`;
            })}
          </div>
        </div>

        <div class="transcription-text">
          <div class="label">You said:</div>
          <div class="text">"${result.text}"</div>
        </div>

        <div class="similarity-score">
          <span>Similarity:</span>
          <div class="similarity-bar">
            <div
              class="similarity-fill ${similarityClass}"
              style="width: ${similarityPercentage}%"
            ></div>
          </div>
          <span class="similarity-percentage">${similarityPercentage}%</span>
        </div>
      </div>
    `;
  }

  private renderResult() {
    if (!this.lastResult || !this.currentQuestion) return html``;

    const isCorrect = this.lastResult.correct;
    const word = this.currentQuestion.word;

    return html`
      <div class="result-feedback ${isCorrect ? 'correct' : 'incorrect'}">
        <h3>${isCorrect ? 'Correct!' : 'Keep practicing!'}</h3>
        <p><strong>${word.word}</strong> = <strong>${word.translation}</strong></p>
        <p>Word strength: ${word.strength}/100</p>
        <p style="font-size: 14px; color: var(--text-secondary); margin-top: var(--spacing-sm);">
          ${this.quizSession!.currentQuestionIndex + 1 >= this.quizSession!.totalQuestions
            ? 'Finishing quiz...'
            : 'Moving to next question...'}
        </p>
      </div>
    `;
  }

  private renderQuizComplete() {
    if (!this.quizSession) return html``;

    const percentage = Math.round((this.quizSession.score / this.quizSession.totalQuestions) * 100);
    const correctAnswers = this.quizSession.score;
    const incorrectAnswers = this.quizSession.totalQuestions - this.quizSession.score;

    // Calculate performance message
    let performanceMessage = '';
    let performanceClass = '';

    if (percentage >= 90) {
      performanceMessage = 'Excellent work! You have mastered these words.';
      performanceClass = 'excellent';
    } else if (percentage >= 70) {
      performanceMessage = 'Good job! Keep practicing to improve further.';
      performanceClass = 'good';
    } else if (percentage >= 50) {
      performanceMessage = 'Not bad! Review the words you missed and try again.';
      performanceClass = 'okay';
    } else {
      performanceMessage = 'Keep studying! These words need more practice.';
      performanceClass = 'needs-work';
    }

    return html`
      <div class="quiz-container">
        <div class="quiz-content">
          <div class="quiz-complete">
            <h2>Quiz Complete!</h2>

            <div class="final-score">${percentage}%</div>

            <div class="score-details">
              <p>
                You got <strong>${correctAnswers}</strong> out of
                <strong>${this.quizSession.totalQuestions}</strong> questions correct.
              </p>
              <p class="performance-message ${performanceClass}">${performanceMessage}</p>
            </div>

            <div class="score-breakdown">
              <div class="score-item correct">
                <span class="score-label">Correct</span>
                <span class="score-value">${correctAnswers}</span>
              </div>
              <div class="score-item incorrect">
                <span class="score-label">Incorrect</span>
                <span class="score-value">${incorrectAnswers}</span>
              </div>
            </div>

            <div class="quiz-actions">
              <button class="action-button" @click=${this.restartQuiz}>Retake Quiz</button>
              <button class="action-button" @click=${this.goToLearning}>Review Words</button>
              <button class="action-button primary" @click=${this.goToTopicSelection}>
                New Topic
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
