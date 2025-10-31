/**
 * Quiz mode component for vocabulary assessment
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Word, Sentence, QuizQuestion, QuizSession, QuizResult } from '../../shared/types/core.js';
import { sharedStyles } from '../styles/shared.js';
import { router } from '../utils/router.js';
import { sessionManager } from '../utils/session-manager.js';
import { keyboardManager, useKeyboardBindings, GlobalShortcuts, CommonKeys } from '../utils/keyboard-manager.js';
import './session-complete.js';
import './audio-recorder.js';
import type { SessionSummary } from './session-complete.js';
import type { RecordingResult } from './audio-recorder.js';

@customElement('quiz-mode')
export class QuizMode extends LitElement {

  @property({ type: String })
  direction: 'foreign-to-english' | 'english-to-foreign' = 'foreign-to-english';

  @state()
  private quizSession: QuizSession | null = null;

  @state()
  private isLoading = false;

  @state()
  private error: string | null = null;

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

  @state()
  private showRecorder = false;

  @state()
  private currentRecording: RecordingResult | null = null;

  @state()
  private transcriptionResult: {
    text: string;
    similarity: number;
    normalizedTranscribed: string;
    normalizedExpected: string;
    matchingWords: string[];
    missingWords: string[];
    extraWords: string[];
  } | null = null;

  @state()
  private isTranscribing = false;

  @state()
  private speechRecognitionReady = false;

  @state()
  private autoplayEnabled = false;

  @state()
  private audioOnlyMode = false;

  private sessionStartTime = Date.now();
  private keyboardUnsubscribe?: () => void;
  private lastAutoplayKey: string | null = null;

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }

      .quiz-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        max-width: 800px;
        margin: 0 auto;
        padding: var(--spacing-sm);
      }

      .quiz-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--spacing-sm);
        padding-bottom: var(--spacing-xs);
        border-bottom: 1px solid var(--border-color);
      }

      .quiz-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
      }

      .quiz-progress {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        font-size: 14px;
        color: var(--text-secondary);
      }

      .progress-bar {
        width: 150px;
        height: 4px;
        background: var(--background-secondary);
        border-radius: 2px;
        overflow: hidden;
      }

      .progress-fill {
        height: 100%;
        background: var(--primary-color);
        transition: width 0.3s ease;
      }

      .quiz-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        align-items: center;
        text-align: center;
        gap: var(--spacing-sm);
        padding-top: var(--spacing-sm);
      }

      .question-container {
        background: var(--background-secondary);
        border-radius: var(--border-radius);
        padding: var(--spacing-lg);
        width: 100%;
        max-width: 600px;
        box-shadow: var(--shadow-light);
      }

      .question-text-container {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        margin-bottom: var(--spacing-sm);
      }

      .question-text {
        font-size: 18px;
        font-weight: 500;
        color: var(--text-primary);
        line-height: 1.4;
        flex: 1;
        text-align: left;
      }

      .question-translation {
        font-size: 16px;
        color: var(--text-secondary);
        margin-bottom: var(--spacing-sm);
        font-style: italic;
      }

      .direction-indicator {
        font-size: 12px;
        color: var(--text-secondary);
        margin-bottom: var(--spacing-xs);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .answer-buttons {
        display: flex;
        gap: var(--spacing-sm);
        justify-content: center;
        flex-wrap: wrap;
      }

      .answer-button {
        padding: var(--spacing-sm) var(--spacing-md);
        border: 2px solid var(--border-color);
        background: var(--background-primary);
        color: var(--text-primary);
        border-radius: var(--border-radius);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        min-width: 120px;
      }

      .answer-button:hover {
        border-color: var(--primary-color);
        background: var(--primary-light);
      }

      .answer-button.correct {
        background: var(--success-color);
        border-color: var(--success-color);
        color: white;
      }

      .answer-button.incorrect {
        background: var(--error-color);
        border-color: var(--error-color);
        color: white;
      }

      .answer-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        background: var(--background-secondary);
        border-color: var(--border-color);
        color: var(--text-secondary);
      }

      .answer-button:disabled:hover {
        background: var(--background-secondary);
        border-color: var(--border-color);
        transform: none;
      }

      .answer-button.primary {
        background: var(--primary-color);
        color: white;
        border-color: var(--primary-color);
      }

      .answer-button.primary:hover {
        background: var(--primary-dark);
        color: white;
        border-color: var(--primary-dark);
      }

      /* SRS Difficulty Button Styles */
      .difficulty-prompt {
        margin-bottom: var(--spacing-sm);
        text-align: center;
      }

      .difficulty-prompt p {
        margin: 0;
        font-size: 16px;
        font-weight: 500;
        color: var(--text-primary);
      }

      .difficulty-buttons {
        display: flex;
        gap: var(--spacing-xs);
        justify-content: center;
        flex-wrap: wrap;
      }

      .difficulty-fail {
        background: #fee2e2;
        border-color: #fca5a5;
        color: #dc2626;
      }

      .difficulty-fail:hover {
        background: #fecaca;
        border-color: #f87171;
      }

      .difficulty-hard {
        background: #fef3c7;
        border-color: #fcd34d;
        color: #d97706;
      }

      .difficulty-hard:hover {
        background: #fde68a;
        border-color: #f59e0b;
      }

      .difficulty-good {
        background: #dcfce7;
        border-color: #86efac;
        color: #16a34a;
      }

      .difficulty-good:hover {
        background: #bbf7d0;
        border-color: #4ade80;
      }

      .difficulty-easy {
        background: #dbeafe;
        border-color: #93c5fd;
        color: #2563eb;
      }

      .difficulty-easy:hover {
        background: #bfdbfe;
        border-color: #60a5fa;
      }

      .revealed-answer {
        margin: var(--spacing-md) 0;
        padding: var(--spacing-md);
        background: var(--background-secondary);
        border-radius: var(--border-radius);
        border-left: 4px solid var(--primary-color);
        text-align: center;
      }

      .answer-container h3 {
        margin: 0 0 var(--spacing-sm) 0;
        color: var(--text-primary);
        font-size: 18px;
        font-weight: 600;
      }

      .word-pair {
        font-size: 20px;
        color: var(--text-primary);
        margin: var(--spacing-sm) 0;
        font-weight: 500;
      }

      .sentence-pair {
        font-size: 16px;
        color: var(--text-primary);
        margin: var(--spacing-md) 0 0 0;
        line-height: 1.4;
      }

      .sentence-label {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .sentence-pair strong {
        display: block;
        margin: var(--spacing-xs) 0;
      }

      .sentence-pair em {
        display: block;
        color: var(--text-secondary);
        font-style: italic;
        margin-top: var(--spacing-xs);
      }

      .result-feedback {
        background: var(--background-secondary);
        border-radius: var(--border-radius);
        padding: var(--spacing-sm);
        margin-top: var(--spacing-sm);
        text-align: center;
      }

      .result-feedback.correct {
        border-left: 4px solid var(--success-color);
      }

      .result-feedback.incorrect {
        border-left: 4px solid var(--error-color);
      }

      .next-button {
        background: var(--primary-color);
        color: white;
        border: none;
        border-radius: var(--border-radius);
        padding: var(--spacing-sm) var(--spacing-md);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        margin-top: var(--spacing-sm);
      }

      .next-button:hover {
        background: var(--primary-dark);
        color: white;
      }

      .quiz-complete {
        text-align: center;
        background: var(--background-secondary);
        border-radius: var(--border-radius);
        padding: var(--spacing-md);
        max-width: 500px;
        margin: 0 auto;
      }

      .final-score {
        font-size: 48px;
        font-weight: 700;
        color: var(--primary-color);
        margin-bottom: var(--spacing-md);
      }

      .score-details {
        font-size: 18px;
        color: var(--text-secondary);
        margin-bottom: var(--spacing-sm);
      }

      .performance-message {
        font-weight: 500;
        margin-top: var(--spacing-md);
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--border-radius-small);
      }

      .performance-message.excellent {
        background: var(--success-light);
        color: var(--success-dark);
      }

      .performance-message.good {
        background: var(--primary-light);
        color: var(--primary-dark);
      }

      .performance-message.okay {
        background: var(--warning-light);
        color: var(--warning-dark);
      }

      .performance-message.needs-work {
        background: var(--error-light);
        color: var(--error-dark);
      }

      .score-breakdown {
        display: flex;
        gap: var(--spacing-sm);
        justify-content: center;
        margin-bottom: var(--spacing-md);
      }

      .score-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: var(--spacing-md);
        border-radius: var(--border-radius);
        min-width: 80px;
      }

      .score-item.correct {
        background: var(--success-light);
        color: var(--success-dark);
      }

      .score-item.incorrect {
        background: var(--error-light);
        color: var(--error-dark);
      }

      .score-label {
        font-size: 14px;
        font-weight: 500;
        margin-bottom: var(--spacing-xs);
      }

      .score-value {
        font-size: 24px;
        font-weight: 700;
      }

      .quiz-actions {
        display: flex;
        gap: var(--spacing-md);
        justify-content: center;
        flex-wrap: wrap;
      }

      .action-button {
        padding: var(--spacing-sm) var(--spacing-md);
        border: 2px solid var(--primary-color);
        background: var(--background-primary);
        color: var(--primary-color);
        border-radius: var(--border-radius);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .action-button:hover {
        background: var(--primary-color);
        color: white;
      }

      .action-button.primary {
        background: var(--primary-color);
        color: white;
      }

      .action-button.primary:hover {
        background: var(--primary-dark);
        color: white;
      }







      .recording-section {
        margin-top: var(--spacing-md);
        padding: var(--spacing-md);
        background: var(--background-primary);
        border-radius: var(--border-radius);
        border: 2px solid var(--primary-color);
      }

      .recording-header {
        text-align: center;
        margin-bottom: var(--spacing-md);
      }

      .language-label {
        display: inline-block;
        background: var(--primary-color);
        color: white;
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: var(--border-radius-small);
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .sentence-to-record {
        font-size: 20px;
        font-weight: 500;
        color: var(--text-primary);
        text-align: center;
        margin-bottom: var(--spacing-md);
        padding: var(--spacing-sm);
        background: var(--background-secondary);
        border-radius: var(--border-radius);
        border-left: 4px solid var(--primary-color);
        line-height: 1.4;
      }

      .sentence-placeholder {
        font-size: 16px;
        color: var(--text-secondary);
        text-align: center;
        margin-bottom: var(--spacing-md);
        padding: var(--spacing-sm);
        background: var(--background-secondary);
        border-radius: var(--border-radius);
        border-left: 4px solid var(--border-color);
        font-style: italic;
      }

      .close-recorder-button {
        background: var(--text-secondary);
        color: white;
        border: none;
        border-radius: var(--border-radius);
        padding: var(--spacing-xs) var(--spacing-sm);
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s ease;
        margin-top: var(--spacing-md);
      }

      .close-recorder-button:hover {
        background: var(--text-primary);
        color: white;
      }

      .audio-only-toggle {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-md);
        justify-content: center;
        font-size: 14px;
        color: var(--text-secondary);
      }

      .audio-only-switch {
        position: relative;
        width: 50px;
        height: 24px;
        background: var(--border-color);
        border-radius: 12px;
        cursor: pointer;
        transition: background-color 0.3s ease;
      }

      .audio-only-switch.active {
        background: var(--primary-color);
      }

      .audio-only-slider {
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

      .audio-only-switch.active .audio-only-slider {
        transform: translateX(26px);
      }

      .quiz-header .audio-only-switch.active .audio-only-slider {
        transform: translateX(18px);
      }

      .audio-only-label {
        font-weight: 500;
        user-select: none;
      }

      .question-text.hidden {
        opacity: 0.1;
        filter: blur(8px);
        pointer-events: none;
        user-select: none;
      }

      .question-translation.hidden {
        opacity: 0.1;
        filter: blur(8px);
        pointer-events: none;
        user-select: none;
      }

      .audio-only-hint {
        background: var(--primary-light);
        color: var(--primary-dark);
        padding: var(--spacing-sm);
        border-radius: var(--border-radius);
        font-size: 14px;
        text-align: center;
        margin-bottom: var(--spacing-sm);
        border: 1px solid var(--primary-color);
      }

      .audio-only-controls {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: var(--spacing-xs);
        margin-bottom: var(--spacing-sm);
      }

      .audio-only-controls .audio-only-hint {
        width: 100%;
        margin-bottom: 0;
      }

      .audio-replay-button {
        background: var(--background-primary);
        border: 1px solid var(--border-color);
        border-radius: 999px;
        padding: 4px 12px;
        font-size: 13px;
        color: var(--text-secondary);
        display: inline-flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        transition: all 0.2s ease;
        white-space: nowrap;
        line-height: 1.2;
        flex-shrink: 0;
      }

      .audio-replay-button:hover {
        border-color: var(--primary-color);
        color: var(--primary-color);
        background: rgba(0, 0, 0, 0.03);
      }

      .audio-replay-label {
        font-size: 12px;
        letter-spacing: 0.3px;
      }

      .transcription-results {
        margin-top: var(--spacing-md);
        padding: var(--spacing-md);
        background: var(--background-secondary);
        border-radius: var(--border-radius);
        border: 2px solid var(--border-color);
      }

      .transcription-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-md);
        font-weight: 600;
        color: var(--text-primary);
      }

      .transcription-loading {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        color: var(--text-secondary);
        font-style: italic;
      }

      .transcription-text {
        background: var(--background-primary);
        padding: var(--spacing-md);
        border-radius: var(--border-radius);
        margin-bottom: var(--spacing-md);
        border-left: 4px solid var(--primary-color);
      }

      .transcription-text .label {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--text-secondary);
        margin-bottom: var(--spacing-xs);
      }

      .transcription-text .text {
        font-size: 16px;
        color: var(--text-primary);
        line-height: 1.4;
      }

      .similarity-score {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        margin-bottom: var(--spacing-md);
      }

      .similarity-bar {
        flex: 1;
        height: 8px;
        background: var(--background-primary);
        border-radius: 4px;
        overflow: hidden;
      }

      .similarity-fill {
        height: 100%;
        transition: width 0.3s ease;
        border-radius: 4px;
      }

      .similarity-fill.excellent {
        background: var(--success-color);
      }

      .similarity-fill.good {
        background: var(--primary-color);
      }

      .similarity-fill.fair {
        background: var(--warning-color);
      }

      .similarity-fill.poor {
        background: var(--error-color);
      }

      .similarity-percentage {
        font-weight: 600;
        min-width: 50px;
        text-align: right;
      }

      .word-analysis {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: var(--spacing-md);
        margin-top: var(--spacing-md);
      }

      .word-group {
        background: var(--background-primary);
        padding: var(--spacing-sm);
        border-radius: var(--border-radius);
        text-align: center;
      }

      .word-group.matching {
        border-left: 4px solid var(--success-color);
      }

      .word-group.missing {
        border-left: 4px solid var(--error-color);
      }

      .word-group.extra {
        border-left: 4px solid var(--warning-color);
      }

      .word-group .label {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        margin-bottom: var(--spacing-xs);
      }

      .word-group.matching .label {
        color: var(--success-color);
      }

      .word-group.missing .label {
        color: var(--error-color);
      }

      .word-group.extra .label {
        color: var(--warning-color);
      }

      .word-group .count {
        font-size: 18px;
        font-weight: 700;
        margin-bottom: var(--spacing-xs);
      }

      .word-group .words {
        font-size: 12px;
        color: var(--text-secondary);
        line-height: 1.3;
      }

      .pronunciation-feedback {
        margin-top: var(--spacing-md);
        padding: var(--spacing-md);
        border-radius: var(--border-radius);
        text-align: center;
        font-weight: 500;
      }

      .pronunciation-feedback.excellent {
        background: var(--success-light);
        color: var(--success-dark);
        border: 1px solid var(--success-color);
      }

      .pronunciation-feedback.good {
        background: var(--primary-light);
        color: var(--primary-dark);
        border: 1px solid var(--primary-color);
      }

      .pronunciation-feedback.fair {
        background: var(--warning-light);
        color: var(--warning-dark);
        border: 1px solid var(--warning-color);
      }

      .pronunciation-feedback.poor {
        background: var(--error-light);
        color: var(--error-dark);
        border: 1px solid var(--error-color);
      }

      .keyboard-hint {
        font-size: 0.8em;
        opacity: 0.7;
        font-weight: normal;
      }

      @media (max-width: 768px) {
        .quiz-container {
          padding: var(--spacing-md);
        }

        .quiz-header {
          flex-direction: column;
          gap: var(--spacing-sm);
          align-items: stretch;
        }

        .quiz-progress {
          justify-content: center;
        }

        .question-text-container {
          flex-direction: column;
          align-items: center;
          gap: var(--spacing-sm);
        }

        .question-text {
          font-size: 18px;
          text-align: center;
        }

        .answer-buttons {
          flex-direction: column;
          align-items: center;
        }

        .answer-button {
          width: 100%;
          max-width: 250px;
        }



        .recording-section {
          margin-top: var(--spacing-md);
          padding: var(--spacing-md);
        }

        .sentence-to-record {
          font-size: 18px;
          margin-bottom: var(--spacing-sm);
          padding: var(--spacing-xs);
        }
      }
    `
  ];

  async connectedCallback() {
    super.connectedCallback();

    // Setup keyboard bindings
    this.setupKeyboardBindings();

    // Initialize speech recognition
    await this.initializeSpeechRecognition();

    // Load autoplay preference
    await this.loadAutoplaySetting();

    // Load words from database first
    await this.loadSelectedWords();

    if (this.selectedWords.length === 0) {
      this.error = 'No words available for quiz. Please start a new learning session first.';
      return;
    }

    // Start a fresh quiz session
    await this.startQuiz();
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    // Clean up keyboard bindings
    if (this.keyboardUnsubscribe) {
      this.keyboardUnsubscribe();
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
      // Use the weakest words loaded from database
      const wordsToQuiz = this.selectedWords;

      // Generate quiz questions from words
      const questions: QuizQuestion[] = [];

      for (const word of wordsToQuiz) {
        // Get a random sentence for this word
        const sentence = await window.electronAPI.quiz.getRandomSentenceForWord(word.id);

        if (sentence) {
          questions.push({
            word,
            sentence,
            direction: this.direction
          });
        }
      }

      if (questions.length === 0) {
        this.error = 'No sentences found for the selected words. Please review words in learning mode first.';
        return;
      }

      // Shuffle questions for variety
      const shuffledQuestions = this.shuffleArray(questions);

      this.quizSession = {
        questions: shuffledQuestions,
        currentQuestionIndex: 0,
        direction: this.direction,
        score: 0,
        totalQuestions: shuffledQuestions.length,
        isComplete: false
      };

      this.currentQuestion = shuffledQuestions[0];
      void this.maybeAutoplayCurrentQuestion(true);

      // Save initial quiz state to session
      this.saveQuizProgressToSession();

    } catch (error) {
      console.error('Error starting quiz:', error);
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
      console.error('Failed to load autoplay setting:', error);
      this.autoplayEnabled = false;
    }
  }

  private async loadSelectedWords() {
    try {
      // Always load the weakest words from database for targeted practice
      const words = await window.electronAPI.quiz.getWeakestWords(10);
      this.selectedWords = words;
      console.log('Loaded weakest words for quiz:', this.selectedWords.length);
    } catch (error) {
      console.error('Failed to load words:', error);
      this.error = 'Failed to load words from database.';
    }
  }



  private saveQuizProgressToSession() {
    if (this.quizSession) {
      sessionManager.updateQuizProgress(
        this.quizSession.currentQuestionIndex,
        this.quizSession.score,
        this.quizSession.totalQuestions
      );
    }
  }

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
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

    this.showResult = true;
    this.lastResult = {
      wordId: this.currentQuestion.word.id,
      correct: recall > 0, // Any non-zero recall counts as correct
      responseTime: Date.now()
    };

    if (recall > 0) {
      this.quizSession.score++;
    }

    // Update word using SRS system and save progress immediately
    try {
      await window.electronAPI.srs.processReview(this.currentQuestion.word.id, recall);
      await window.electronAPI.database.updateLastStudied(this.currentQuestion.word.id);

      // Refresh the word data to get updated SRS values
      const updatedWord = await window.electronAPI.database.getWordById(this.currentQuestion.word.id);
      if (updatedWord) {
        this.currentQuestion.word = updatedWord;
      }

      // Save progress immediately after each answer
      this.saveQuizProgressToSession();

    } catch (error) {
      console.error('Error updating word with SRS:', error);
    }

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

    if (this.quizSession.currentQuestionIndex + 1 >= this.quizSession.totalQuestions) {
      // Quiz complete - record the session
      await this.recordQuizSession();
      this.quizSession.isComplete = true;
      this.currentQuestion = null;
    } else {
      // Move to next question
      this.quizSession.currentQuestionIndex++;
      this.currentQuestion = this.quizSession.questions[this.quizSession.currentQuestionIndex];
      void this.maybeAutoplayCurrentQuestion();

      // Save progress immediately when moving to next question
      this.saveQuizProgressToSession();
    }
  }

  private async recordQuizSession() {
    if (!this.quizSession) return;

    try {
      // Record the study session in the database
      await window.electronAPI.database.recordStudySession(this.quizSession.totalQuestions);

      // Clear session progress since we're completing
      sessionManager.clearSession();

      // Show completion screen
      this.showQuizCompletion();

    } catch (error) {
      console.error('Error recording quiz session:', error);
      // Don't block the UI for this error
      this.showQuizCompletion();
    }
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
      nextRecommendation
    };

    this.showCompletion = true;
  }

  private async maybeAutoplayCurrentQuestion(force = false) {
    if (!this.autoplayEnabled || !this.currentQuestion) {
      return;
    }

    const currentIndex = this.quizSession?.currentQuestionIndex ?? null;
    const sentenceId = this.currentQuestion.sentence?.id ?? null;
    const autoplayKey = currentIndex !== null && sentenceId !== null
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

    try {
      await window.electronAPI.audio.stopAudio();
    } catch (error) {
      console.warn('Failed to stop audio before autoplay:', error);
    }

    await this.playAudio();
  }

  private async playAudio() {
    if (!this.currentQuestion) return;

    try {
      const audioPath = this.currentQuestion.sentence.audioPath;
      if (audioPath) {
        await window.electronAPI.audio.playAudio(audioPath);
      }
    } catch (error) {
      console.error('Error playing audio:', error);
    }
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
        description: 'Start quiz / Reveal answer / Continue'
      },

      // Audio only mode
      {
        ...GlobalShortcuts.TOGGLE_AUDIO_ONLY,
        action: () => this.toggleAudioOnlyMode(),
        context: 'quiz',
        description: 'Toggle audio-only mode'
      },
      // Audio controls
      {
        ...GlobalShortcuts.PLAY_AUDIO,
        action: () => this.playAudio(),
        context: 'quiz',
        description: 'Play sentence audio'
      },
      {
        ...GlobalShortcuts.REPLAY_AUDIO,
        action: () => this.playAudio(),
        context: 'quiz',
        description: 'Replay sentence audio'
      },
      // SRS difficulty ratings (when answer is revealed)
      {
        ...GlobalShortcuts.SRS_FAIL,
        action: () => this.handleSRSAnswer(0),
        context: 'quiz',
        description: 'Rate as Failed (when answer revealed)'
      },
      {
        ...GlobalShortcuts.SRS_HARD,
        action: () => this.handleSRSAnswer(1),
        context: 'quiz',
        description: 'Rate as Hard (when answer revealed)'
      },
      {
        ...GlobalShortcuts.SRS_GOOD,
        action: () => this.handleSRSAnswer(2),
        context: 'quiz',
        description: 'Rate as Good (when answer revealed)'
      },
      {
        ...GlobalShortcuts.SRS_EASY,
        action: () => this.handleSRSAnswer(3),
        context: 'quiz',
        description: 'Rate as Easy (when answer revealed)'
      },
      // Pronunciation practice
      {
        ...GlobalShortcuts.RECORD_PRONUNCIATION,
        action: () => this.toggleRecorder(),
        context: 'quiz',
        description: 'Toggle pronunciation recorder'
      },
      // Navigation
      {
        ...GlobalShortcuts.ESCAPE,
        action: () => this.handleEscape(),
        context: 'quiz',
        description: 'Close recorder / Back to topic selection'
      }
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

    // Don't handle if recorder is open (let recorder handle its own keys)
    if (this.showRecorder) return;

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
    if (this.showRecorder) {
      this.toggleRecorder();
    } else {
      this.goToTopicSelection();
    }
  }



  private toggleRecorder() {
    this.showRecorder = !this.showRecorder;
    this.currentRecording = null;
    this.transcriptionResult = null;
    this.isTranscribing = false;
  }

  private toggleAudioOnlyMode() {
    this.audioOnlyMode = !this.audioOnlyMode;
  }

  private async handleRecordingCompleted(event: CustomEvent<{ recording: RecordingResult; autoStopped?: boolean }>) {
    this.currentRecording = event.detail.recording;
    const autoStopped = event.detail.autoStopped || false;

    console.log('Recording completed:', {
      recording: this.currentRecording,
      autoStopped,
      sentence: this.currentQuestion?.sentence.sentence,
      word: this.currentQuestion?.word.word
    });

    // Show success feedback
    if (autoStopped) {
      console.log('Recording stopped automatically due to silence detection');
    }

    // Perform speech recognition on the recorded audio
    await this.performSpeechRecognition();
  }

  private handleRecordingCancelled() {
    this.currentRecording = null;
    this.transcriptionResult = null;
    console.log('Recording cancelled');
  }

  private async initializeSpeechRecognition() {
    try {
      console.log('Quiz: Initializing speech recognition...');
      await window.electronAPI.audio.initializeSpeechRecognition();
      this.speechRecognitionReady = await window.electronAPI.audio.isSpeechRecognitionReady();
      console.log('Quiz: Speech recognition initialized:', this.speechRecognitionReady);

      if (this.speechRecognitionReady) {
        console.log('✓ Speech recognition is ready for use');
      }
    } catch (error) {
      console.error('Quiz: Failed to initialize speech recognition:', error);
      this.speechRecognitionReady = false;

      // Show user-friendly message
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn('Speech recognition not available:', errorMessage);
    }
  }

  private async performSpeechRecognition() {
    if (!this.currentRecording || !this.currentQuestion || !this.speechRecognitionReady) {
      return;
    }

    this.isTranscribing = true;
    this.transcriptionResult = null;

    try {
      // Get the expected sentence based on quiz direction
      const expectedSentence = this.direction === 'foreign-to-english'
        ? this.currentQuestion.sentence.sentence
        : this.currentQuestion.sentence.translation;

      // Get the current language for transcription
      const currentLanguage = await window.electronAPI.database.getCurrentLanguage();

      // Determine transcription language based on quiz direction
      const transcriptionLanguage = this.direction === 'foreign-to-english'
        ? currentLanguage
        : 'en'; // English for english-to-foreign direction

      console.log('Transcribing audio:', {
        filePath: this.currentRecording.filePath,
        expectedSentence,
        transcriptionLanguage
      });

      // Transcribe the recorded audio
      const transcriptionResult = await window.electronAPI.audio.transcribeAudio(
        this.currentRecording.filePath,
        {
          language: transcriptionLanguage,
          model: 'base' // Use base model for good balance of speed and accuracy
        }
      );

      console.log('Transcription result:', transcriptionResult);

      // Compare transcription with expected sentence
      const comparison = await window.electronAPI.audio.compareTranscription(
        transcriptionResult.text,
        expectedSentence
      );

      console.log('Transcription comparison:', comparison);

      this.transcriptionResult = {
        text: transcriptionResult.text,
        ...comparison
      };

    } catch (error) {
      console.error('Speech recognition failed:', error);
      this.transcriptionResult = {
        text: 'Speech recognition failed. Please try again.',
        similarity: 0,
        normalizedTranscribed: '',
        normalizedExpected: '',
        matchingWords: [],
        missingWords: [],
        extraWords: []
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

    const progress = ((this.quizSession.currentQuestionIndex + 1) / this.quizSession.totalQuestions) * 100;
    const question = this.currentQuestion;

    // Determine what to show based on quiz direction
    const displayText = this.direction === 'foreign-to-english'
      ? question.sentence.sentence
      : question.sentence.translation;

    // The word we're asking about (not the answer!)
    const questionWord = this.direction === 'foreign-to-english'
      ? `"${question.word.word}"`
      : `"${question.word.translation}"`;

    return html`
      <div class="quiz-container">
        <div class="quiz-header">
          <h2 class="quiz-title">Quiz Mode</h2>
          <div class="quiz-progress">
            <span>${this.quizSession.currentQuestionIndex + 1} / ${this.quizSession.totalQuestions}</span>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${progress}%"></div>
            </div>
            <span>Score: ${this.quizSession.score}</span>
            <div class="audio-only-toggle" style="margin-bottom: 0;">
              <span class="audio-only-label" style="font-size: 12px;">Audio Only</span>
              <div 
                class="audio-only-switch ${this.audioOnlyMode ? 'active' : ''}"
                @click=${this.toggleAudioOnlyMode}
                title="Toggle audio only mode"
                style="width: 40px; height: 20px;"
              >
                <div class="audio-only-slider" style="width: 16px; height: 16px; top: 2px; left: 2px;"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="quiz-content">
          <div class="question-container">
            <div class="direction-indicator">
              ${this.direction === 'foreign-to-english' ? 'Foreign → English' : 'English → Foreign'}
            </div>
            
            ${this.audioOnlyMode ? html`
              <div class="audio-only-controls">
                <button 
                  class="audio-replay-button" 
                  @click=${this.playAudio} 
                  title="Replay audio"
                  aria-label="Replay audio"
                >
                  <span aria-hidden="true">🔊</span>
                  <span class="audio-replay-label">Replay audio</span>
                </button>
              </div>
            ` : html`
              <div class="question-text-container">
                <div class="question-text">${displayText}</div>
                <button 
                  class="audio-replay-button" 
                  @click=${this.playAudio}
                  title="Replay audio"
                  aria-label="Replay audio"
                >
                  <span aria-hidden="true">🔊</span>
                  <span class="audio-replay-label">Replay audio</span>
                </button>
              </div>
            `}

            <div class="question-translation">
              Do you know what ${questionWord} means in this context?
            </div>

            ${this.showRecorder ? this.renderRecordingSection() : ''}

            ${this.showResult ? this.renderResult() : this.renderQuizButtons()}
          </div>
        </div>
      </div>
    `;
  }

  private renderQuizButtons() {
    if (!this.showAnswer) {
      // First show the reveal button
      return html`
        <div class="answer-buttons">
          <button 
            class="answer-button primary"
            @click=${this.revealAnswer}
          >
            Reveal Answer <span class="keyboard-hint">(Enter)</span>
          </button>
          <button 
            class="answer-button"
            @click=${this.toggleRecorder}
            ?disabled=${!this.speechRecognitionReady}
            title=${this.speechRecognitionReady ? 'Practice pronunciation with speech recognition' : 'Speech recognition not available - setting up for first use'}
          >
            🎤 Practice Pronunciation${this.speechRecognitionReady ? '' : ' (Setting up...)'}
          </button>
        </div>
      `;
    }

    // After reveal, show the answer and self-assessment buttons
    return html`
      ${this.renderRevealedAnswer()}
      <div class="answer-buttons">
        <div class="difficulty-prompt">
          <p>How well did you know this?</p>
        </div>
        <div class="difficulty-buttons">
          <button 
            class="answer-button difficulty-fail"
            @click=${() => this.handleSRSAnswer(0)}
          >
            Failed ✗ <span class="keyboard-hint">(1)</span>
          </button>
          <button 
            class="answer-button difficulty-hard"
            @click=${() => this.handleSRSAnswer(1)}
          >
            Hard 😓 <span class="keyboard-hint">(2)</span>
          </button>
          <button 
            class="answer-button difficulty-good"
            @click=${() => this.handleSRSAnswer(2)}
          >
            Good ✓ <span class="keyboard-hint">(3)</span>
          </button>
          <button 
            class="answer-button difficulty-easy"
            @click=${() => this.handleSRSAnswer(3)}
          >
            Easy 😊 <span class="keyboard-hint">(4)</span>
          </button>
        </div>
      </div>
    `;
  }

  private renderRevealedAnswer() {
    if (!this.currentQuestion) return '';

    const word = this.currentQuestion.word;
    const sentence = this.currentQuestion.sentence;

    return html`
      <div class="revealed-answer">
        <div class="answer-container">
          <h3>Answer:</h3>
          <p class="word-pair">
            <strong>${word.word}</strong> = <strong>${word.translation}</strong>
          </p>
          ${this.audioOnlyMode ? html`
            <p class="sentence-pair">
              <span class="sentence-label">Sentence:</span><br>
              <strong>${sentence.sentence}</strong><br>
              <em>${sentence.translation}</em>
            </p>
          ` : ''}
        </div>
      </div>
    `;
  }

  private renderRecordingSection() {
    if (!this.currentQuestion) return '';

    const sentenceToRecord = this.direction === 'foreign-to-english'
      ? this.currentQuestion.sentence.sentence
      : this.currentQuestion.sentence.translation;

    const languageLabel = this.direction === 'foreign-to-english'
      ? 'Foreign Language'
      : 'English';

    const prompt = `Try pronouncing this ${languageLabel.toLowerCase()} sentence:`;

    const isAudioOnly = this.audioOnlyMode;

    return html`
      <div class="recording-section">
        <div class="recording-header">
          <span class="language-label">${languageLabel}</span>
        </div>
        ${isAudioOnly ? html`
          <div class="sentence-placeholder">
            Sentence hidden in audio-only mode. Repeat what you hear to practice pronunciation.
          </div>
        ` : html`
          <div class="sentence-to-record">
            "${sentenceToRecord}"
          </div>
        `}
        <audio-recorder
          .prompt=${prompt}
          @recording-completed=${this.handleRecordingCompleted}
          @recording-cancelled=${this.handleRecordingCancelled}
        ></audio-recorder>
        
        ${this.renderTranscriptionResults()}
        
        <button class="close-recorder-button" @click=${this.toggleRecorder}>
          Close Recorder
        </button>
      </div>
    `;
  }

  private renderTranscriptionResults() {
    if (this.isTranscribing) {
      return html`
        <div class="transcription-results">
          <div class="transcription-loading">
            <div class="spinner"></div>
            Analyzing your pronunciation...
            ${!this.speechRecognitionReady ? html`
              <div style="margin-top: var(--spacing-sm); font-size: 14px; color: var(--text-secondary);">
                First-time setup: This may take 1-2 minutes while speech recognition compiles...
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }

    if (!this.transcriptionResult) {
      return '';
    }

    const similarity = this.transcriptionResult.similarity;
    const similarityPercentage = Math.round(similarity * 100);

    // Determine similarity level and feedback
    let similarityClass = 'poor';
    let feedbackClass = 'poor';
    let feedbackMessage = '';

    if (similarity >= 0.9) {
      similarityClass = 'excellent';
      feedbackClass = 'excellent';
      feedbackMessage = 'Excellent pronunciation! 🎉';
    } else if (similarity >= 0.7) {
      similarityClass = 'good';
      feedbackClass = 'good';
      feedbackMessage = 'Good pronunciation! Keep it up! 👍';
    } else if (similarity >= 0.5) {
      similarityClass = 'fair';
      feedbackClass = 'fair';
      feedbackMessage = 'Not bad! Try to match the original more closely. 🤔';
    } else {
      similarityClass = 'poor';
      feedbackClass = 'poor';
      feedbackMessage = 'Keep practicing! Listen to the audio again and try to match it. 💪';
    }

    return html`
      <div class="transcription-results">
        <div class="transcription-header">
          🎤 Speech Recognition Results
        </div>

        <div class="transcription-text">
          <div class="label">Expected:</div>
          <div class="text">"${this.transcriptionResult.normalizedExpected}"</div>
        </div>

        <div class="transcription-text">
          <div class="label">You said:</div>
          <div class="text">"${this.transcriptionResult.text}"</div>
        </div>

        <div class="similarity-score">
          <span>Similarity:</span>
          <div class="similarity-bar">
            <div class="similarity-fill ${similarityClass}" style="width: ${similarityPercentage}%"></div>
          </div>
          <span class="similarity-percentage">${similarityPercentage}%</span>
        </div>

        <div class="word-analysis">
          <div class="word-group matching">
            <div class="label">Correct</div>
            <div class="count">${this.transcriptionResult.matchingWords.length}</div>
            <div class="words">${this.transcriptionResult.matchingWords.join(', ') || 'None'}</div>
          </div>
          <div class="word-group missing">
            <div class="label">Missing</div>
            <div class="count">${this.transcriptionResult.missingWords.length}</div>
            <div class="words">${this.transcriptionResult.missingWords.join(', ') || 'None'}</div>
          </div>
          <div class="word-group extra">
            <div class="label">Extra</div>
            <div class="count">${this.transcriptionResult.extraWords.length}</div>
            <div class="words">${this.transcriptionResult.extraWords.join(', ') || 'None'}</div>
          </div>
        </div>

        <div class="pronunciation-feedback ${feedbackClass}">
          ${feedbackMessage}
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
        <p>
          <strong>${word.word}</strong> = <strong>${word.translation}</strong>
        </p>
        <p>Word strength: ${word.strength}/100</p>
        <p style="font-size: 14px; color: var(--text-secondary); margin-top: var(--spacing-sm);">
          ${this.quizSession!.currentQuestionIndex + 1 >= this.quizSession!.totalQuestions ? 'Finishing quiz...' : 'Moving to next question...'}
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
              <p>You got <strong>${correctAnswers}</strong> out of <strong>${this.quizSession.totalQuestions}</strong> questions correct.</p>
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
              <button class="action-button" @click=${this.restartQuiz}>
                Retake Quiz
              </button>
              <button class="action-button" @click=${this.goToLearning}>
                Review Words
              </button>
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
