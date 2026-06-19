/**
 * Quiz mode component for vocabulary assessment
 */

import { html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Word, QuizQuestion, QuizSession, QuizResult } from '../../shared/types/core.js';
import { STRENGTH_BOOST_CONFIG } from '../../shared/constants/index.js';
import { sharedStyles } from '../styles/shared.js';
import { buttonStyles } from '../styles/button.styles.js';
import { stateStyles } from '../styles/state.styles.js';
import { quizModeStyles } from './quiz-mode.styles.js';
import { router } from '../utils/router.js';
import { sessionManager, type QuizSessionState } from '../utils/session-manager.js';
import { useKeyboardBindings, GlobalShortcuts, CommonKeys } from '../utils/keyboard-manager.js';
import { BaseComponent } from './base-component.js';
import { audioPlayer } from '../utils/audio-player-service.js';
import { AudioPlaybackController } from './audio-playback-controller.js';
import './session-complete.js';
import './progress-bar.js';
import type { SessionSummary } from './session-complete.js';
import { RecordingController } from './recording-controller.js';
import { TranscriptionController } from './transcription-controller.js';
import { checkProficiencyLevel } from '../utils/app-initializer.js';
import { type ProficiencyLevel } from '../../shared/utils/similarity-threshold.js';
import { logger } from '../utils/logger.js';
import {
  initializeSpeechRecognition,
  startSpeechRecognitionCheck,
} from '../utils/speech-recognition-checker.js';
import {
  buildQuizFromWords,
  restoreQuizFromSession as restoreQuizFromSessionService,
} from '../utils/quiz-session-service.js';
import { type QuizTranscriptionResult } from './quiz-question.js';
import './quiz-question.js';

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
  private audio = new AudioPlaybackController(this);

  @state()
  private transcriptionResult: QuizTranscriptionResult | null = null;

  @state()
  private isTranscribing = false;

  @state()
  private speechRecognitionReady = false;

  @state()
  private autoplayEnabled = false;

  @state()
  private audioOnlyMode = false;

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

  static styles = [sharedStyles, buttonStyles, stateStyles, quizModeStyles];

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
      const result = await restoreQuizFromSessionService(savedSession);

      if (result.status === 'needs_fresh_start') {
        await this.loadSelectedWords();
        if (this.selectedWords.length === 0) {
          this.error = 'No words available for quiz. Please start a new learning session first.';
          return;
        }
        await this.startQuiz();
        return;
      }

      this.audioOnlyMode = result.audioOnlyMode;
      this.quizSession = {
        questions: result.questions,
        currentQuestionIndex: result.currentQuestionIndex,
        score: result.score,
        totalQuestions: result.totalQuestions,
        isComplete: result.isComplete,
      };

      if (this.quizSession.currentQuestionIndex < result.questions.length) {
        this.currentQuestion = result.questions[this.quizSession.currentQuestionIndex];
      } else {
        this.quizSession.currentQuestionIndex = result.questions.length - 1;
        this.currentQuestion = result.questions[this.quizSession.currentQuestionIndex];
      }

      this.selectedWords = result.words;

      await this.ensureCurrentQuestionAudioLoaded();
      this.preloadNextQuestionAudio();
      void this.preloadQuizAudio(result.questions);
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
      const result = await buildQuizFromWords(this.selectedWords);

      switch (result.status) {
        case 'no_words':
          this.error = 'No words available for quiz. All selected words are marked as known.';
          return;
        case 'no_sentences':
          this.error =
            'No sentences found for the selected words. Please review words in learning mode first.';
          return;
        case 'built':
          this.quizSession = {
            questions: result.questions,
            currentQuestionIndex: 0,
            score: 0,
            totalQuestions: result.questions.length,
            isComplete: false,
          };
          this.currentQuestion = result.questions[0];
          sessionManager.startNewQuizSession(result.wordIds, this.audioOnlyMode);
          await this.ensureCurrentQuestionAudioLoaded();
          this.preloadNextQuestionAudio();
          void this.preloadQuizAudio(result.questions);
          void this.maybeAutoplayCurrentQuestion(true);
          break;
      }
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

  private stopCachedAudio(): void {
    this.audio.stopSync();
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
    const isLastQuestion =
      this.quizSession.currentQuestionIndex + 1 >= this.quizSession.totalQuestions;

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
          <quiz-question
            .question=${this.currentQuestion}
            .showAnswer=${this.showAnswer}
            .showResult=${this.showResult}
            .lastResult=${this.lastResult}
            .audioOnlyMode=${this.audioOnlyMode}
            .transcriptionResult=${this.transcriptionResult}
            .isTranscribing=${this.isTranscribing}
            .isRecording=${this.recording.isRecording}
            .hasRecording=${!!this.recording.currentRecording}
            .recordingTime=${this.recording.recordingTime}
            .speechRecognitionReady=${this.speechRecognitionReady}
            .streamingTranscriptionText=${this.transcription.streamingTranscriptionText}
            .proficiencyLevel=${this.currentProficiencyLevel}
            .isLastQuestion=${isLastQuestion}
            @reveal-answer=${this.revealAnswer}
            @srs-answer=${(e: CustomEvent<{ recall: 0 | 1 | 2 | 3 }>) =>
              this.handleSRSAnswer(e.detail.recall)}
            @play-audio=${this.playAudio}
            @start-recording=${this.recording.startRecording}
            @stop-recording=${this.recording.stopRecording}
            @cancel-recording=${this.recording.cancelRecording}
          ></quiz-question>
        </div>
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
