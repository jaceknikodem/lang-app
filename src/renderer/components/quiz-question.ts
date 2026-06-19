import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { QuizQuestion, QuizResult } from '../../shared/types/core.js';
import {
  getSimilarityClass,
  type ProficiencyLevel,
} from '../../shared/utils/similarity-threshold.js';
import { recordingStyles } from './recording.styles.js';
import { pronunciationStyles } from '../styles/pronunciation.styles.js';
import { renderPronunciation } from '../utils/pronunciation-render.js';
import './recording-status.js';

export interface QuizTranscriptionResult {
  text: string;
  similarity: number;
  normalizedTranscribed: string;
  normalizedExpected: string;
  expectedWords: Array<{ word: string; similarity: number; matched: boolean }>;
  transcribedWords: string[];
}

@customElement('quiz-question')
export class QuizQuestionCard extends LitElement {
  @property({ attribute: false }) question: QuizQuestion | null = null;
  @property({ type: Boolean }) showAnswer = false;
  @property({ type: Boolean }) showResult = false;
  @property({ attribute: false }) lastResult: QuizResult | null = null;
  @property({ type: Boolean }) audioOnlyMode = false;
  @property({ attribute: false }) transcriptionResult: QuizTranscriptionResult | null = null;
  @property({ type: Boolean }) isTranscribing = false;
  @property({ type: Boolean }) isRecording = false;
  @property({ type: Boolean }) hasRecording = false;
  @property({ type: Number }) recordingTime = 0;
  @property({ type: Boolean }) speechRecognitionReady = false;
  @property({ type: String }) streamingTranscriptionText: string | null = null;
  @property({ attribute: false }) proficiencyLevel: ProficiencyLevel | null = null;
  @property({ type: Boolean }) isLastQuestion = false;

  static styles = [
    recordingStyles,
    pronunciationStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-sm);
        width: 100%;
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

      .question-text-block {
        display: flex;
        flex-direction: column;
        align-items: center;
        flex: 1;
      }

      .sentence-pronunciation-line {
        display: block;
      }

      .question-actions {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        flex-shrink: 0;
      }

      .question-text {
        font-size: 18px;
        font-weight: 500;
        color: var(--text-primary);
        line-height: 1.4;
        text-align: center;
      }

      .question-translation {
        font-size: 16px;
        color: var(--text-secondary);
        margin-bottom: var(--spacing-sm);
        font-style: italic;
      }

      .audio-only-controls {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: var(--spacing-xs);
        margin-bottom: var(--spacing-sm);
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
      .record-button.recording {
        background: var(--error-color);
        border-color: var(--error-color);
        color: white;
      }
      .record-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        background: var(--background-secondary);
        border-color: var(--border-color);
        color: var(--text-secondary);
      }

      .answer-buttons {
        display: flex;
        gap: var(--spacing-sm);
        justify-content: center;
        flex-wrap: wrap;
        margin-top: var(--spacing-md);
        margin-bottom: var(--spacing-md);
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
      .answer-button.primary {
        background: var(--primary-color);
        color: white;
        border-color: var(--primary-color);
      }
      .answer-button.primary:hover {
        background: var(--primary-dark);
        border-color: var(--primary-dark);
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
      .kw {
        color: #2563eb;
        font-weight: 700;
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

      .transcription-results {
        margin-top: var(--spacing-md);
        padding: var(--spacing-md);
        background: var(--background-secondary);
        border-radius: var(--border-radius);
        border: 2px solid var(--border-color);
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

      .spinner {
        width: 16px;
        height: 16px;
        border: 2px solid var(--border-color);
        border-top-color: var(--primary-color);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        flex-shrink: 0;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .keyboard-hint {
        font-size: 0.8em;
        opacity: 0.7;
        font-weight: normal;
      }

      @media (max-width: 768px) {
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
      }
    `,
  ];

  private emit(name: string, detail?: unknown) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }));
  }

  private renderTranscriptionResults() {
    if (this.isTranscribing) {
      return html`
        <div class="transcription-results">
          <div class="transcription-loading">
            <div class="spinner"></div>
            ${this.streamingTranscriptionText
              ? html`
                  <div style="display: flex; flex-direction: column; gap: 4px;">
                    <div style="font-size: 14px; color: var(--text-secondary);">
                      Transcribing...
                    </div>
                    <div style="font-size: 16px; font-style: italic; color: var(--text-primary);">
                      "${this.streamingTranscriptionText}"
                    </div>
                  </div>
                `
              : html`Analyzing your pronunciation...`}
          </div>
        </div>
      `;
    }

    if (!this.transcriptionResult) return nothing;

    const result = this.transcriptionResult;
    const similarity = result.similarity;
    const similarityClass = getSimilarityClass(similarity, this.proficiencyLevel);

    return html`
      <div class="transcription-results">
        <div class="transcription-text">
          <div class="label">Expected:</div>
          <div class="text color-coded-text">
            ${result.expectedWords.map((wordInfo, index) => {
              let color = '#28a745';
              if (!wordInfo.matched) color = '#dc3545';
              else if (wordInfo.similarity < 0.9) color = '#ffc107';
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
              style="width: ${Math.round(similarity * 100)}%"
            ></div>
          </div>
          <span class="similarity-percentage">${Math.round(similarity * 100)}%</span>
        </div>
      </div>
    `;
  }

  private renderRecordingSection() {
    if (!this.question) return nothing;
    if (
      !this.isRecording &&
      !this.hasRecording &&
      !this.transcriptionResult &&
      !this.isTranscribing
    )
      return nothing;

    return html`
      <div class="recording-section">
        <recording-status
          .isRecording=${this.isRecording}
          .recordingTime=${this.recordingTime}
          @cancel-recording=${() => this.emit('cancel-recording')}
        ></recording-status>
        ${this.renderTranscriptionResults()}
      </div>
    `;
  }

  /**
   * Render a sentence with the key word highlighted wherever it appears in that
   * exact form. Splitting via Lit templates keeps the text safely escaped.
   */
  private renderHighlightedSentence(text: string, keyword: string) {
    if (!keyword || !text.includes(keyword)) {
      return html`${text}`;
    }
    const parts = text.split(keyword);
    return html`${parts.map((part, i) =>
      i < parts.length - 1 ? html`${part}<span class="kw">${keyword}</span>` : html`${part}`
    )}`;
  }

  private renderRevealedAnswer() {
    if (!this.question) return nothing;

    const word = this.question.word;
    const sentence = this.question.sentence;

    return html`
      <div class="revealed-answer">
        <div class="answer-container">
          <div class="answer-word">${word.translation}</div>
          ${this.audioOnlyMode
            ? html`
                <div class="sentence-pair">
                  <span class="sentence-label">Sentence:</span>
                  <div class="sentence-text">
                    ${this.renderHighlightedSentence(sentence.sentence, word.word)}
                  </div>
                  <div class="sentence-pronunciation-line">
                    ${renderPronunciation(sentence.pronunciation)}
                  </div>
                  <div class="sentence-translation">${sentence.translation}</div>
                </div>
              `
            : html`<div class="sentence-translation">${sentence.translation}</div>`}
        </div>
      </div>
    `;
  }

  private renderQuizButtons() {
    const difficultyButtons = html`
      <div class="answer-buttons">
        <div class="difficulty-buttons">
          <button
            class="answer-button difficulty-fail"
            @click=${() => this.emit('srs-answer', { recall: 0 })}
          >
            Failed ✗ <span class="keyboard-hint">(1)</span>
          </button>
          <button
            class="answer-button difficulty-hard"
            @click=${() => this.emit('srs-answer', { recall: 1 })}
          >
            Hard 😓 <span class="keyboard-hint">(2)</span>
          </button>
          <button
            class="answer-button difficulty-good"
            @click=${() => this.emit('srs-answer', { recall: 2 })}
          >
            Good ✓ <span class="keyboard-hint">(3)</span>
          </button>
          <button
            class="answer-button difficulty-easy"
            @click=${() => this.emit('srs-answer', { recall: 3 })}
          >
            Easy 😊 <span class="keyboard-hint">(4)</span>
          </button>
        </div>
      </div>
    `;

    if (!this.showAnswer) {
      return html`
        <div class="answer-buttons">
          <button class="answer-button primary" @click=${() => this.emit('reveal-answer')}>
            Reveal Answer <span class="keyboard-hint">(Enter)</span>
          </button>
        </div>
        ${difficultyButtons}
      `;
    }

    return html`${this.renderRevealedAnswer()} ${difficultyButtons}`;
  }

  private renderResult() {
    if (!this.lastResult || !this.question) return nothing;

    const isCorrect = this.lastResult.correct;
    const word = this.question.word;

    return html`
      <div class="result-feedback ${isCorrect ? 'correct' : 'incorrect'}">
        <h3>${isCorrect ? 'Correct!' : 'Keep practicing!'}</h3>
        <p><strong>${word.word}</strong> = <strong>${word.translation}</strong></p>
        <p>Word strength: ${word.strength}/100</p>
        <p style="font-size: 14px; color: var(--text-secondary); margin-top: var(--spacing-sm);">
          ${this.isLastQuestion ? 'Finishing quiz...' : 'Moving to next question...'}
        </p>
      </div>
    `;
  }

  render() {
    if (!this.question) return nothing;

    const displayText = this.question.sentence.sentence;
    const questionWord = `"${this.question.word.word}"`;

    const recordButton = this.isRecording
      ? html`
          <button
            class="record-button recording"
            @click=${() => this.emit('stop-recording')}
            title="Stop recording"
            aria-label="Stop recording"
          >
            <span aria-hidden="true">⏹</span>
          </button>
        `
      : html`
          <button
            class="record-button"
            @click=${() => this.emit('start-recording')}
            ?disabled=${!this.speechRecognitionReady}
            title=${this.speechRecognitionReady
              ? 'Start recording'
              : 'Speech recognition not ready'}
            aria-label="Start recording"
          >
            <span aria-hidden="true">🎤</span>
          </button>
        `;

    return html`
      <div class="question-container">
        ${this.audioOnlyMode
          ? html`
              <div class="audio-only-controls">
                <div class="question-actions">
                  <button
                    class="audio-replay-button"
                    @click=${() => this.emit('play-audio')}
                    title="Replay audio"
                    aria-label="Replay audio"
                  >
                    <span aria-hidden="true">🔊</span>
                  </button>
                  ${recordButton}
                </div>
              </div>
            `
          : html`
              <div class="question-text-container">
                <div class="question-text-block">
                  <div class="question-text">
                    ${this.renderHighlightedSentence(displayText, this.question.word.word)}
                  </div>
                  ${renderPronunciation(this.question.sentence.pronunciation)}
                </div>
                <div class="question-actions">
                  <button
                    class="audio-replay-button"
                    @click=${() => this.emit('play-audio')}
                    title="Replay audio"
                    aria-label="Replay audio"
                  >
                    <span aria-hidden="true">🔊</span>
                  </button>
                  ${recordButton}
                </div>
              </div>
            `}

        <div class="question-translation">
          Do you know what ${questionWord} means in this context?
        </div>

        ${this.renderRecordingSection()}
        ${this.showResult ? this.renderResult() : this.renderQuizButtons()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'quiz-question': QuizQuestionCard;
  }
}
