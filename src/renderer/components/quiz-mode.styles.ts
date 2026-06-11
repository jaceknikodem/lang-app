import { css } from 'lit';

export const quizModeStyles = css`
  :host {
    display: block;
    width: 100%;
    height: 100%;
  }

  .quiz-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    max-width: 1000px;
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

  .cancel-recording-button:hover {
    background: var(--background-secondary);
    border-color: var(--text-tertiary);
    color: var(--text-primary);
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
`;
