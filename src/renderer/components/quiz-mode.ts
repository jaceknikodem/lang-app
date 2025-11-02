/**
 * Quiz mode component for vocabulary assessment
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Word, Sentence, QuizQuestion, QuizSession, QuizResult } from '../../shared/types/core.js';
import { sharedStyles } from '../styles/shared.js';
import { router } from '../utils/router.js';
import { sessionManager, type QuizSessionState } from '../utils/session-manager.js';
import { keyboardManager, useKeyboardBindings, GlobalShortcuts, CommonKeys } from '../utils/keyboard-manager.js';
import './session-complete.js';
import type { SessionSummary } from './session-complete.js';
import type { RecordingResult } from './audio-recorder.js';
import type { RecordingOptions, RecordingSession } from '../../shared/types/audio.js';

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
  private isRecording = false;

  @state()
  private recordingTime = 0;

  @state()
  private currentRecording: RecordingResult | null = null;

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
  private streamingTranscriptionText: string | null = null;

  @state()
  private speechRecognitionReady = false;

  private transcriptionProgressUnsubscribe: (() => void) | null = null;

  @state()
  private autoplayEnabled = false;

  @state()
  private audioOnlyMode = false;

  @state()
  private useTextInput = false;

  @state()
  private textInputValue = '';

  private sessionStartTime = Date.now();
  private keyboardUnsubscribe?: () => void;
  private lastAutoplayKey: string | null = null;
  private recordingTimer: number | null = null;
  private recordingStatusCheckTimer: number | null = null;
  private speechRecognitionCheckTimer: number | null = null;
  
  // Audio cache: Map of audioPath -> blob URL
  // Using Blob URLs instead of data URLs for better performance (no base64 encoding/decoding)
  private audioCache: Map<string, string> = new Map(); // audioPath -> blob URL
  private blobUrlCache: Map<string, string> = new Map(); // audioPath -> blob URL (for cleanup)
  // HTML5 Audio instances for playing cached audio
  private currentAudioElement: HTMLAudioElement | null = null;

  private handleExternalLanguageChange = async (event: Event) => {
    const detail = (event as CustomEvent<{ language?: string }>).detail;
    const newLanguage = detail?.language;

    if (!newLanguage) {
      return;
    }

    // Reload quiz data for the new language
    try {
      this.isLoading = true;
      this.error = null;
      
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
      console.error('Failed to reload quiz data after language change:', error);
      this.error = 'Failed to reload quiz data. Please try again.';
      this.isLoading = false;
    }
  };

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
        margin-left: auto;
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

      .question-actions {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        flex-shrink: 0;
      }

      .record-button {
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
      }

      .record-button:hover {
        border-color: var(--primary-color);
        color: var(--primary-color);
        background: rgba(0, 0, 0, 0.03);
      }

      .record-button.active {
        background: var(--primary-color);
        border-color: var(--primary-color);
        color: white;
      }

      .record-button.active:hover {
        background: var(--primary-dark);
        border-color: var(--primary-dark);
      }

      .record-button.recording {
        background: var(--error-color);
        border-color: var(--error-color);
        color: white;
      }

      .record-button.recording:hover {
        background: var(--error-dark);
        border-color: var(--error-dark);
      }

      .record-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        background: var(--background-secondary);
        border-color: var(--border-color);
        color: var(--text-secondary);
      }

      .record-button:disabled:hover {
        opacity: 0.5;
        border-color: var(--border-color);
        background: var(--background-secondary);
        color: var(--text-secondary);
      }

      .question-text {
        font-size: 18px;
        font-weight: 500;
        color: var(--text-primary);
        line-height: 1.4;
        flex: 1;
        text-align: center;
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
        margin-top: var(--spacing-md);
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
        margin-bottom: var(--spacing-sm);
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

      .answer-word {
        font-size: 28px;
        font-weight: 600;
        color: var(--primary-color);
        margin: var(--spacing-sm) 0;
        letter-spacing: 0.5px;
      }

      .sentence-pair {
        font-size: 16px;
        color: var(--text-primary);
        margin: var(--spacing-md) 0 0 0;
        line-height: 1.4;
        text-align: left;
      }

      .sentence-label {
        display: block;
        font-size: 14px;
        font-weight: 600;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: var(--spacing-xs);
      }

      .sentence-text {
        display: block;
        font-weight: 500;
        margin: var(--spacing-xs) 0;
      }

      .sentence-translation {
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
        margin-bottom: var(--spacing-lg);
      }

      .recording-status-container {
        padding: var(--spacing-md);
        background: var(--background-primary);
        border-radius: var(--border-radius);
        border: 2px solid var(--error-color);
        margin-bottom: var(--spacing-md);
      }

      .recording-status {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .recording-indicator {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        font-size: 14px;
        color: var(--error-color);
        font-weight: 500;
      }

      .recording-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--error-color);
        animation: pulse 1.5s ease-in-out infinite;
      }

      @keyframes pulse {
        0%, 100% {
          opacity: 1;
        }
        50% {
          opacity: 0.5;
        }
      }

      .recording-time {
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
        font-variant-numeric: tabular-nums;
      }

      .cancel-recording-button {
        padding: var(--spacing-xs) var(--spacing-sm);
        border: 1px solid var(--border-color);
        background: var(--background-secondary);
        color: var(--text-primary);
        border-radius: var(--border-radius);
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s ease;
        margin-top: var(--spacing-xs);
      }

      .cancel-recording-button:hover {
        background: var(--error-light);
        border-color: var(--error-color);
        color: var(--error-color);
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

      .input-mode-toggle {
        display: flex;
        gap: var(--spacing-sm);
        justify-content: center;
        margin-bottom: var(--spacing-md);
      }

      .input-mode-button {
        padding: var(--spacing-xs) var(--spacing-md);
        border: 2px solid var(--border-color);
        background: var(--background-primary);
        color: var(--text-primary);
        border-radius: var(--border-radius);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .input-mode-button:hover {
        border-color: var(--primary-color);
        background: var(--primary-light);
      }

      .input-mode-button.active {
        background: var(--primary-color);
        color: white;
        border-color: var(--primary-color);
      }

      .text-input-container {
        margin-top: var(--spacing-md);
      }

      .text-input-field {
        width: 100%;
        max-width: 500px;
        padding: var(--spacing-sm) var(--spacing-md);
        border: 2px solid var(--border-color);
        border-radius: var(--border-radius);
        font-size: 16px;
        font-family: inherit;
        background: var(--background-primary);
        color: var(--text-primary);
        line-height: 1.5;
        display: block;
        margin: 0 auto;
      }

      .text-input-field:focus {
        outline: none;
        border-color: var(--primary-color);
        box-shadow: 0 0 0 3px rgba(var(--primary-color-rgb, 66, 153, 225), 0.1);
      }

      .text-input-submit {
        margin-top: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--primary-color);
        color: white;
        border: none;
        border-radius: var(--border-radius);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        width: auto;
        min-width: 120px;
        display: block;
        margin-left: auto;
        margin-right: auto;
      }

      .text-input-submit:hover {
        background: var(--primary-dark);
      }

      .text-input-submit:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .text-input-hint {
        font-size: 12px;
        color: var(--text-secondary);
        margin-top: var(--spacing-xs);
        text-align: center;
        font-style: italic;
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

      .color-coded-text {
        display: inline;
      }

      .color-coded-text span {
        margin-right: 4px;
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

      .error-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-md);
        padding: var(--spacing-xl);
        text-align: center;
      }

      .error-message {
        color: var(--error-color);
        background: var(--error-light);
        padding: var(--spacing-md);
        border-radius: var(--border-radius);
        border: 1px solid var(--error-color);
        text-align: center;
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
          margin-left: 0;
          justify-content: flex-end;
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
          margin-bottom: var(--spacing-lg);
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

    // Listen for language changes
    document.addEventListener('language-changed', this.handleExternalLanguageChange);

    // Setup keyboard bindings
    this.setupKeyboardBindings();

    // Set up transcription progress listener for streaming updates
    this.transcriptionProgressUnsubscribe = window.electronAPI.audio.onTranscriptionProgress(
      (payload) => {
        if (payload.isFinal) {
          // Final transcription received, clear streaming text
          this.streamingTranscriptionText = null;
        } else {
          // Intermediate transcription update
          this.streamingTranscriptionText = payload.text;
          this.requestUpdate();
        }
      }
    );

    // Initialize speech recognition asynchronously (non-blocking, Whisper is optional)
    // Don't await - let it run in background so quiz can start even if Whisper is unavailable
    this.initializeSpeechRecognition().catch(err => {
      console.warn('Speech recognition initialization failed (non-blocking):', err);
    });
    
    // Start periodic check of speech recognition readiness (includes server availability)
    this.startSpeechRecognitionCheck();
    
    // Also check immediately in case Whisper is already available
    this.checkSpeechRecognitionReady().catch(err => {
      console.warn('Initial speech recognition check failed:', err);
    });

    // Load autoplay preference
    await this.loadAutoplaySetting();

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
    
    // Clean up transcription progress listener
    if (this.transcriptionProgressUnsubscribe) {
      this.transcriptionProgressUnsubscribe();
      this.transcriptionProgressUnsubscribe = null;
    }
    
    // Clean up recording timers
    this.clearRecordingTimer();
    this.clearRecordingStatusCheck();
    this.clearSpeechRecognitionCheck();
    
    // Cancel any ongoing recording
    if (this.isRecording) {
      this.cancelRecording().catch(err => {
        console.error('Error cancelling recording on disconnect:', err);
      });
    }

    // Clean up language change listener
    document.removeEventListener('language-changed', this.handleExternalLanguageChange);

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

      // Restore direction and audio-only mode
      this.direction = savedSession.direction;
      this.audioOnlyMode = savedSession.audioOnlyMode ?? false;

      // Generate quiz questions from words in the saved order
      const questions: QuizQuestion[] = [];

      for (const wordId of savedSession.wordIds) {
        const word = words.find(w => w.id === wordId);
        if (!word) continue;

        // Get a random sentence for this word
        const sentence = await window.electronAPI.quiz.getRandomSentenceForWord(word.id);

        if (sentence) {
          questions.push({
            word,
            sentence,
            direction: savedSession.direction
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
        direction: savedSession.direction,
        score: savedSession.score,
        totalQuestions: savedSession.totalQuestions,
        isComplete: savedSession.isComplete
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

      console.log(`Restored quiz session: Question ${this.quizSession.currentQuestionIndex + 1}/${this.quizSession.totalQuestions}, Score: ${this.quizSession.score}`);

    } catch (error) {
      console.error('Error restoring quiz session:', error);
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
      const wordsToQuiz = this.selectedWords.filter(word => !word.known);

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
      const wordIds = shuffledQuestions.map(q => q.word.id);

      this.quizSession = {
        questions: shuffledQuestions,
        currentQuestionIndex: 0,
        direction: this.direction,
        score: 0,
        totalQuestions: shuffledQuestions.length,
        isComplete: false
      };

      this.currentQuestion = shuffledQuestions[0];
      
      // Save quiz session to session manager (creates new session)
      sessionManager.startNewQuizSession(wordIds, this.direction, this.audioOnlyMode);
      
      // Prioritize: Load current question's audio first, then autoplay
      // This ensures audio is ready before playback starts
      await this.ensureCurrentQuestionAudioLoaded();
      
      // Load next question's audio right after current one is ready
      this.preloadNextQuestionAudio();
      
      // Pre-load remaining audio files in background (non-blocking)
      void this.preloadQuizAudio(shuffledQuestions);
      
      void this.maybeAutoplayCurrentQuestion(true);

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
      // Save word IDs in the order they appear (preserves shuffle)
      const wordIds = this.quizSession.questions.map(q => q.word.id);
      
      sessionManager.updateQuizSession({
        wordIds,
        currentQuestionIndex: this.quizSession.currentQuestionIndex,
        score: this.quizSession.score,
        totalQuestions: this.quizSession.totalQuestions,
        isComplete: this.quizSession.isComplete,
        direction: this.quizSession.direction,
        audioOnlyMode: this.audioOnlyMode
      });
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

    const word = this.currentQuestion.word;
    const recallLabels = ['Failed', 'Hard', 'Good', 'Easy'];
    
    console.log(`[Quiz] ========== SUBMITTING REVIEW ==========`);
    console.log(`[Quiz] Question ${this.quizSession.currentQuestionIndex + 1}/${this.quizSession.totalQuestions}`);
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
      lastStudied: word.lastStudied?.toISOString() ?? 'never'
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
          lastStudied: updatedWord.lastStudied?.toISOString() ?? 'never'
        });
        
        console.log(`[Quiz] Changes observed:`, {
          strength: `${word.strength ?? 20} → ${updatedWord.strength ?? 20}`,
          intervalDays: `${word.intervalDays ?? 1} → ${updatedWord.intervalDays ?? 1}`,
          easeFactor: `${word.easeFactor ?? 2.5} → ${updatedWord.easeFactor ?? 2.5}`,
          fsrsDifficulty: `${word.fsrsDifficulty ?? 5.0} → ${updatedWord.fsrsDifficulty ?? 5.0}`,
          fsrsStability: `${word.fsrsStability ?? 1.0} → ${updatedWord.fsrsStability ?? 1.0}`,
          fsrsLapses: `${word.fsrsLapses ?? 0} → ${updatedWord.fsrsLapses ?? 0}`,
          nextDue: `${word.nextDue?.toISOString() ?? 'unknown'} → ${updatedWord.nextDue?.toISOString() ?? 'unknown'}`
        });
        
        // Update the word object before showing the result
        this.currentQuestion.word = updatedWord;
      }

      // Save progress immediately after each answer
      this.saveQuizProgressToSession();

    } catch (error) {
      console.error('[Quiz] Error updating word with SRS:', error);
    }

    // Show result AFTER updating the word so the updated strength is displayed
    this.showResult = true;
    this.lastResult = {
      wordId: word.id,
      correct: recall > 0, // Any non-zero recall counts as correct
      responseTime: Date.now()
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
    this.currentRecording = null;
    this.isTranscribing = false;

    if (this.quizSession.currentQuestionIndex + 1 >= this.quizSession.totalQuestions) {
      // Quiz complete - record the session
      await this.recordQuizSession();
      this.quizSession.isComplete = true;
      this.currentQuestion = null;
    } else {
      // Move to next question
      this.quizSession.currentQuestionIndex++;
      this.currentQuestion = this.quizSession.questions[this.quizSession.currentQuestionIndex];
      
      // Save progress immediately when moving to next question
      this.saveQuizProgressToSession();
      
      // Start audio playback immediately (don't wait for loading)
      void this.maybeAutoplayCurrentQuestion();
      
      // Load current question's audio into cache in background (non-blocking)
      void this.ensureCurrentQuestionAudioLoaded().catch(err => {
        console.warn('Failed to load audio into cache:', err);
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

      // Mark quiz session as complete in session manager
      sessionManager.markQuizSessionComplete();
      
      // Clear quiz session after completion
      sessionManager.clearQuizSession();

      // Show completion screen
      this.showQuizCompletion();

      // Dispatch event for autopilot to check scores after quiz is done
      window.dispatchEvent(new CustomEvent('autopilot-check-trigger'));

    } catch (error) {
      console.error('Error recording quiz session:', error);
      // Don't block the UI for this error
      this.showQuizCompletion();
      // Still trigger autopilot check even on error
      window.dispatchEvent(new CustomEvent('autopilot-check-trigger'));
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

    // Stop any currently playing audio (non-blocking)
    void window.electronAPI.audio.stopAudio().catch(() => {
      // Ignore errors when stopping
    });

    // Play audio immediately (don't wait for loading)
    void this.playAudio();
    
    // Load audio into cache in background for next time (non-blocking)
    void this.ensureCurrentQuestionAudioLoaded().catch(err => {
      console.warn('Failed to load audio into cache:', err);
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
    
    // If already cached, we're done
    if (this.audioCache.has(audioPath)) {
      return;
    }

    try {
      await this.loadAudioIntoCache(audioPath);
    } catch (error) {
      console.warn(`Failed to load current question audio:`, error);
      // Continue anyway - will fall back to IPC playback
    }
  }

  /**
   * Preload the next question's audio after current one is ready
   * This ensures smooth transitions between questions
   */
  private preloadNextQuestionAudio(): void {
    if (!this.quizSession) {
      return;
    }

    const nextIndex = this.quizSession.currentQuestionIndex + 1;
    if (nextIndex >= this.quizSession.questions.length) {
      return; // No next question
    }

    const nextQuestion = this.quizSession.questions[nextIndex];
    if (!nextQuestion?.sentence.audioPath) {
      return; // No audio path for next question
    }

    const nextAudioPath = nextQuestion.sentence.audioPath;
    
    // Skip if already cached
    if (this.audioCache.has(nextAudioPath)) {
      return;
    }

    // Load next question's audio in background (non-blocking)
    void this.loadAudioIntoCache(nextAudioPath).catch(error => {
      console.warn(`Failed to preload next question audio:`, error);
      // Non-critical - will load on-demand if needed
    });
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
   * Pre-load all audio files for the quiz session into memory cache
   * This allows instant playback without file system access
   * Optimized: Skips already cached files and loads in parallel
   */
  private async preloadQuizAudio(questions: QuizQuestion[]): Promise<void> {
    try {
      const audioPaths = questions
        .map(q => q.sentence.audioPath)
        .filter((path): path is string => !!path)
        .filter(path => !this.audioCache.has(path)); // Skip already cached
      
      if (audioPaths.length === 0) {
        return;
      }

      console.log(`Pre-loading ${audioPaths.length} audio files into cache...`);
      
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
      // Don't fail quiz if audio caching fails - will fall back to file system
    }
  }

  /**
   * Play audio using cached data if available, otherwise fall back to IPC
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

      // Try to use cached audio first (instant playback)
      const cachedAudio = this.audioCache.get(audioPath);
      if (cachedAudio) {
        // Use HTML5 Audio API to play from memory
        this.currentAudioElement = new Audio(cachedAudio);
        
        // Handle errors and cleanup
        this.currentAudioElement.addEventListener('ended', () => {
          this.currentAudioElement = null;
          // Track sentence play count
          if (this.currentQuestion?.sentence.id) {
            void window.electronAPI.database.incrementSentencePlayCount(this.currentQuestion.sentence.id).catch(err => {
              console.warn('Failed to increment sentence play count:', err);
            });
          }
        });
        
        this.currentAudioElement.addEventListener('error', (e) => {
          console.warn('Error playing cached audio, falling back to IPC:', e);
          this.currentAudioElement = null;
          // Fall back to IPC playback
          void window.electronAPI.audio.playAudio(audioPath)
            .then(() => {
              // Track sentence play count
              if (this.currentQuestion?.sentence.id) {
                void window.electronAPI.database.incrementSentencePlayCount(this.currentQuestion.sentence.id).catch(err => {
                  console.warn('Failed to increment sentence play count:', err);
                });
              }
            })
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
        .then(() => {
          // Track sentence play count
          if (this.currentQuestion?.sentence.id) {
            void window.electronAPI.database.incrementSentencePlayCount(this.currentQuestion.sentence.id).catch(err => {
              console.warn('Failed to increment sentence play count:', err);
            });
          }
        })
        .catch(err => {
          console.error('Failed to play audio via IPC:', err);
        });
    } catch (error) {
      console.error('Error playing audio:', error);
    }
  }

  /**
   * Stop currently playing cached audio
   */
  private stopCachedAudio(): void {
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
        action: () => this.toggleRecording(),
        context: 'quiz',
        description: 'Toggle pronunciation recorder'
      },
      // Navigation
      {
        ...GlobalShortcuts.ESCAPE,
        action: () => this.handleEscape(),
        context: 'quiz',
        description: 'Cancel recording (if active)'
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

    // Don't handle if recording is in progress
    if (this.isRecording) return;

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
    if (this.isRecording) {
      this.cancelRecording();
    }
    // ESC in quiz mode no longer navigates away - just cancel recording if active
  }



  private async toggleRecording() {
    if (!this.speechRecognitionReady || !this.currentQuestion) return;
    
    if (this.isRecording) {
      await this.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  private async startRecording() {
    if (this.isRecording || !this.speechRecognitionReady || !this.currentQuestion) return;

    try {
      // Get the expected sentence for the initial prompt (if supported)
      const expectedSentence = this.direction === 'foreign-to-english'
        ? this.currentQuestion.sentence.sentence
        : this.currentQuestion.sentence.translation;

      const recordingOptions: RecordingOptions = {
        sampleRate: 16000,
        channels: 1,
        threshold: 0.5,
        silence: '1.0',
        endOnSilence: true
      };

      const session = await window.electronAPI.audio.startRecording(recordingOptions);
      this.isRecording = true;
      this.recordingTime = 0;
      this.currentRecording = null;
      this.transcriptionResult = null;
      this.isTranscribing = false;
      
      // Start recording timer
      this.recordingTimer = window.setInterval(() => {
        this.recordingTime += 1;
      }, 1000);

      // Set up periodic check for recording status (in case of auto-stop)
      this.setupRecordingStatusCheck();
    } catch (error) {
      console.error('Error starting recording:', error);
      this.isRecording = false;
      this.error = `Failed to start recording: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private async stopRecording() {
    if (!this.isRecording) return;

    try {
      const completedSession = await window.electronAPI.audio.stopRecording();
      this.isRecording = false;
      this.clearRecordingTimer();
      this.clearRecordingStatusCheck();

      if (completedSession && !completedSession.isRecording) {
        // Get the recording file path from the session
        const filePath = completedSession.filePath;
        
        // Calculate duration if available
        const duration = completedSession.duration || (Date.now() - completedSession.startTime) / 1000;

        this.currentRecording = {
          session: completedSession,
          filePath,
          duration
        };

        // Automatically perform speech recognition
        await this.performSpeechRecognition();
      }
    } catch (error) {
      console.error('Error stopping recording:', error);
      this.isRecording = false;
      this.clearRecordingTimer();
      this.clearRecordingStatusCheck();
      this.error = `Failed to stop recording: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private async cancelRecording() {
    if (!this.isRecording) return;

    try {
      await window.electronAPI.audio.cancelRecording();
      this.isRecording = false;
      this.currentRecording = null;
      this.transcriptionResult = null;
      this.clearRecordingTimer();
      this.clearRecordingStatusCheck();
    } catch (error) {
      console.error('Error cancelling recording:', error);
      this.isRecording = false;
      this.clearRecordingTimer();
      this.clearRecordingStatusCheck();
    }
  }

  private clearRecordingTimer() {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }
  }

  private setupRecordingStatusCheck() {
    // Clear any existing status check timer
    this.clearRecordingStatusCheck();

    // Check recording status every 500ms to detect auto-stop
    this.recordingStatusCheckTimer = window.setInterval(async () => {
      if (this.isRecording) {
        try {
          const isStillRecording = await window.electronAPI.audio.isRecording();
          if (!isStillRecording) {
            // Recording was stopped automatically (likely due to silence)
            await this.handleRecordingAutoStop();
          }
        } catch (error) {
          console.error('Error checking recording status:', error);
        }
      }
    }, 500);
  }

  private clearRecordingStatusCheck() {
    if (this.recordingStatusCheckTimer) {
      clearInterval(this.recordingStatusCheckTimer);
      this.recordingStatusCheckTimer = null;
    }
  }

  private async handleRecordingAutoStop() {
    this.isRecording = false;
    this.clearRecordingTimer();
    this.clearRecordingStatusCheck();

    try {
      const completedSession = await window.electronAPI.audio.getCurrentRecordingSession();
      
      if (completedSession && !completedSession.isRecording) {
        const filePath = completedSession.filePath;
        const duration = completedSession.duration || (Date.now() - completedSession.startTime) / 1000;

        this.currentRecording = {
          session: completedSession,
          filePath,
          duration
        };

        // Automatically perform speech recognition
        await this.performSpeechRecognition();
      }
    } catch (error) {
      console.error('Error handling auto-stop:', error);
      this.error = 'Recording stopped automatically but there was an error processing it.';
      this.isRecording = false;
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
      // Get the expected sentence based on quiz direction
      const expectedSentence = this.direction === 'foreign-to-english'
        ? this.currentQuestion.sentence.sentence
        : this.currentQuestion.sentence.translation;

      // Compare typed text with expected sentence (same logic as transcription comparison)
      const comparison = await window.electronAPI.audio.compareTranscription(
        typedText,
        expectedSentence
      );

      console.log('Text comparison:', comparison);

      this.transcriptionResult = {
        text: typedText,
        ...comparison
      };

    } catch (error) {
      console.error('Text comparison failed:', error);
      this.transcriptionResult = {
        text: typedText,
        similarity: 0,
        normalizedTranscribed: typedText,
        normalizedExpected: '',
        expectedWords: [],
        transcribedWords: []
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


  private async initializeSpeechRecognition() {
    try {
      // initializeSpeechRecognition() already checks if server is available
      console.log('Quiz: Initializing speech recognition...');
      await window.electronAPI.audio.initializeSpeechRecognition();
      this.speechRecognitionReady = await window.electronAPI.audio.isSpeechRecognitionReady();
      console.log('Quiz: Speech recognition initialized:', this.speechRecognitionReady);

      if (this.speechRecognitionReady) {
        console.log('✓ Speech recognition is ready for use');
      } else {
        console.log('Quiz: Speech recognition not ready (server may be unavailable)');
      }
    } catch (error) {
      console.error('Quiz: Failed to initialize speech recognition:', error);
      this.speechRecognitionReady = false;

      // Show user-friendly message
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn('Speech recognition not available:', errorMessage);
    }
  }

  private startSpeechRecognitionCheck() {
    // Clear any existing timer
    this.clearSpeechRecognitionCheck();
    
    // Check speech recognition readiness (includes server availability) every 5 seconds
    this.speechRecognitionCheckTimer = window.setInterval(async () => {
      await this.checkSpeechRecognitionReady();
    }, 5000);
  }

  private clearSpeechRecognitionCheck() {
    if (this.speechRecognitionCheckTimer !== null) {
      clearInterval(this.speechRecognitionCheckTimer);
      this.speechRecognitionCheckTimer = null;
    }
  }

  private async checkSpeechRecognitionReady() {
    try {
      this.speechRecognitionReady = await window.electronAPI.audio.isSpeechRecognitionReady();
      console.log('Quiz: Speech recognition ready:', this.speechRecognitionReady);
    } catch (error) {
      console.error('Quiz: Failed to check speech recognition readiness:', error);
      this.speechRecognitionReady = false;
    }
  }

  private async performSpeechRecognition() {
    if (!this.currentRecording || !this.currentQuestion || !this.speechRecognitionReady) {
      return;
    }

    this.isTranscribing = true;
    this.transcriptionResult = null;
    this.streamingTranscriptionText = null;

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

      // Transcribe the recorded audio (streaming API)
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

      // Record pronunciation attempt in database (tracks full history)
      if (this.currentQuestion?.sentence?.id) {
        try {
          await window.electronAPI.database.recordPronunciationAttempt(
            this.currentQuestion.sentence.id,
            comparison.similarity,
            expectedSentence, // Expected text
            transcriptionResult.text // Transcribed text
          );
        } catch (error) {
          console.warn('Failed to record pronunciation attempt:', error);
        }
      }

      // If pronunciation score is >= 85%, increase word strength by 5 points
      if (comparison.similarity >= 0.85 && this.currentQuestion) {
        const word = this.currentQuestion.word;
        const currentStrength = word.strength ?? 20;
        const newStrength = Math.min(100, currentStrength + 5);
        
        try {
          console.log(`[Pronunciation] Good pronunciation detected (${Math.round(comparison.similarity * 100)}%). Increasing word strength: ${currentStrength} → ${newStrength}`);
          await window.electronAPI.database.updateWordStrength(word.id, newStrength);
          await window.electronAPI.database.updateLastStudied(word.id);
          
          // Refresh the word data to get updated strength
          const updatedWord = await window.electronAPI.database.getWordById(word.id);
          if (updatedWord) {
            this.currentQuestion.word = updatedWord;
            this.requestUpdate(); // Trigger UI update to show new strength
          }
        } catch (error) {
          console.error('Failed to update word strength after good pronunciation:', error);
        }
      }

    } catch (error) {
      console.error('Speech recognition failed:', error);
      this.transcriptionResult = {
        text: 'Speech recognition failed. Please try again.',
        similarity: 0,
        normalizedTranscribed: '',
        normalizedExpected: '',
        expectedWords: [],
        transcribedWords: []
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
            
            ${this.audioOnlyMode ? html`
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
                  ${this.isRecording ? html`
                    <button 
                      class="record-button recording"
                      @click=${this.stopRecording}
                      title="Stop recording"
                      aria-label="Stop recording"
                    >
                      <span aria-hidden="true">⏹</span>
                    </button>
                  ` : html`
                    <button 
                      class="record-button"
                      @click=${this.startRecording}
                      ?disabled=${!this.speechRecognitionReady}
                      title=${this.speechRecognitionReady ? 'Start recording' : 'Speech recognition not ready'}
                      aria-label="Start recording"
                    >
                      <span aria-hidden="true">🎤</span>
                    </button>
                  `}
                </div>
              </div>
            ` : html`
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
                  ${this.isRecording ? html`
                    <button 
                      class="record-button recording"
                      @click=${this.stopRecording}
                      title="Stop recording"
                      aria-label="Stop recording"
                    >
                      <span aria-hidden="true">⏹</span>
                    </button>
                  ` : html`
                    <button 
                      class="record-button"
                      @click=${this.startRecording}
                      ?disabled=${!this.speechRecognitionReady}
                      title=${this.speechRecognitionReady ? 'Start recording' : 'Speech recognition not ready'}
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

            ${(this.isRecording || this.currentRecording || this.transcriptionResult) ? this.renderRecordingSection() : ''}

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

    if (!this.showAnswer) {
      // Before revealing answer, show both reveal button and difficulty buttons
      return html`
        <div class="answer-buttons">
          <button 
            class="answer-button primary"
            @click=${this.revealAnswer}
          >
            Reveal Answer <span class="keyboard-hint">(Enter)</span>
          </button>
        </div>
        ${difficultyButtons}
      `;
    }

    // After reveal, show the answer and self-assessment buttons
    return html`
      ${this.renderRevealedAnswer()}
      ${difficultyButtons}
    `;
  }

  private renderRevealedAnswer() {
    if (!this.currentQuestion) return '';

    const word = this.currentQuestion.word;
    const sentence = this.currentQuestion.sentence;
    
    // Show the correct answer based on quiz direction
    const correctAnswer = this.direction === 'foreign-to-english'
      ? word.translation
      : word.word;

    return html`
      <div class="revealed-answer">
        <div class="answer-container">
          <div class="answer-word">${correctAnswer}</div>
          ${this.audioOnlyMode ? html`
            <div class="sentence-pair">
              <span class="sentence-label">Sentence:</span>
              <div class="sentence-text">${sentence.sentence}</div>
              <div class="sentence-translation">${sentence.translation}</div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  private renderRecordingSection() {
    if (!this.currentQuestion) return '';

    return html`
      <div class="recording-section">
        ${this.isRecording ? this.renderRecordingStatus() : ''}
        ${this.renderTranscriptionResults()}
      </div>
    `;
  }

  private renderRecordingStatus() {
    const minutes = Math.floor(this.recordingTime / 60);
    const seconds = this.recordingTime % 60;
    const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    return html`
      <div class="recording-status-container">
        <div class="recording-status">
          <div class="recording-indicator">
            <div class="recording-dot"></div>
            Recording... (auto-stop enabled)
          </div>
          <div class="recording-time">${formattedTime}</div>
          <button 
            class="cancel-recording-button"
            @click=${this.cancelRecording}
            title="Cancel recording"
          >
            ✕ Cancel
          </button>
        </div>
      </div>
    `;
  }

  private renderTranscriptionResults() {
    if (this.isTranscribing) {
      return html`
        <div class="transcription-results">
          <div class="transcription-loading">
            <div class="spinner"></div>
            ${this.streamingTranscriptionText ? html`
              <div class="streaming-transcription">
                <div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 8px;">
                  Transcribing...
                </div>
                <div style="font-size: 16px; font-style: italic; color: var(--text-primary);">
                  "${this.streamingTranscriptionText}"
                </div>
              </div>
            ` : html`
              Analyzing your pronunciation...
              ${!this.speechRecognitionReady ? html`
                <div style="margin-top: var(--spacing-sm); font-size: 14px; color: var(--text-secondary);">
                  First-time setup: This may take 1-2 minutes while speech recognition compiles...
                </div>
              ` : ''}
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

    // Determine similarity level and feedback
    let similarityClass = 'poor';
    let feedbackClass = 'poor';
    let feedbackMessage = '';

    if (similarity >= 0.95) {
      similarityClass = 'excellent';
      feedbackClass = 'excellent';
      feedbackMessage = 'Excellent pronunciation! 🎉';
    } else if (similarity >= 0.85) {
      similarityClass = 'good';
      feedbackClass = 'good';
      feedbackMessage = 'Good pronunciation! Keep it up! 👍';
    } else if (similarity >= 0.75) {
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
              return html`<span style="color: ${color}; font-weight: ${wordInfo.matched ? 'normal' : 'bold'};">${wordInfo.word}</span>${!isLast ? ' ' : ''}`;
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
            <div class="similarity-fill ${similarityClass}" style="width: ${similarityPercentage}%"></div>
          </div>
          <span class="similarity-percentage">${similarityPercentage}%</span>
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
