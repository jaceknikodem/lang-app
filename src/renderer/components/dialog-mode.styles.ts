import { css } from 'lit';

export const dialogModeStyles = css`
  :host {
    display: block;
    width: 100%;
    height: 100%;
  }

  .dialog-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--spacing-lg) var(--spacing-xl);
    gap: var(--spacing-md);
    max-width: 800px;
    margin: 0 auto;
  }

  .dialog-header {
    display: flex;
    justify-content: flex-end;
    margin-bottom: var(--spacing-md);
    width: 100%;
    max-width: 600px;
  }

  .dialog-progress {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    font-size: 14px;
    color: var(--text-secondary);
  }

  .control-bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--spacing-xs);
    width: 100%;
    max-width: 600px;
    padding: 4px var(--spacing-md);
    background: var(--background-primary);
    border-bottom: 1px solid var(--border-color);
    margin-bottom: var(--spacing-sm);
  }

  .dialog-bubbles {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
    width: 100%;
    max-width: 600px;
    margin: 0 auto;
  }

  .dialog-bubble {
    padding: var(--spacing-md) var(--spacing-lg);
    border-radius: 18px;
    max-width: 75%;
    position: relative;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  }

  .bubble-left {
    align-self: flex-start;
    background: var(--background-secondary);
    border-top-left-radius: 4px;
  }

  .previous-corrections {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    margin-top: var(--spacing-sm);
    margin-bottom: var(--spacing-sm);
    padding: var(--spacing-sm);
    background: var(--background-secondary);
    border-radius: 8px;
    border: 1px solid var(--border-color);
  }

  .previous-correction-item {
    display: flex;
    align-items: flex-start;
    gap: var(--spacing-xs);
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .correction-label {
    flex-shrink: 0;
    font-size: 14px;
  }

  .correction-text {
    flex: 1;
    font-style: italic;
  }

  .bubble-right {
    align-self: flex-end;
    background: var(--primary-color);
    color: white;
    border-top-right-radius: 4px;
  }

  .bubble-content {
    flex: 1;
  }

  .bubble-text-container {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    flex-wrap: wrap;
  }

  .bubble-text {
    font-size: 16px;
    margin: 0;
    line-height: 1.5;
    flex: 1;
  }

  .bubble-text span {
    display: inline;
    transition: color 0.2s ease;
  }

  .similarity-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--border-radius-small);
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    min-width: 45px;
    white-space: nowrap;
  }

  .similarity-badge.excellent {
    background: var(--success-light);
    color: var(--success-color);
  }

  .similarity-badge.good {
    background: #d4edda;
    color: #28a745;
  }

  .similarity-badge.fair {
    background: #fff3cd;
    color: #856404;
  }

  .similarity-badge.poor {
    background: var(--error-light);
    color: var(--error-color);
  }

  .bubble-right .similarity-badge {
    background: rgba(255, 255, 255, 0.2);
    color: white;
  }

  .bubble-right .similarity-badge.excellent {
    background: rgba(52, 199, 89, 0.3);
    color: white;
  }

  .bubble-right .similarity-badge.good {
    background: rgba(40, 167, 69, 0.3);
    color: white;
  }

  .bubble-right .similarity-badge.fair {
    background: rgba(255, 193, 7, 0.3);
    color: white;
  }

  .bubble-right .similarity-badge.poor {
    background: rgba(255, 59, 48, 0.3);
    color: white;
  }

  .try-again-button {
    font-size: 14px;
    padding: var(--spacing-sm) var(--spacing-md);
  }

  .bubble-right .bubble-text {
    color: white;
  }

  .bubble-translation {
    font-size: 14px;
    margin: var(--spacing-xs) 0 0 0;
    opacity: 0.8;
    font-style: italic;
  }

  .bubble-right .bubble-translation {
    color: rgba(255, 255, 255, 0.9);
  }

  .typing-indicator {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 24px;
  }

  .typing-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-secondary);
    opacity: 0.7;
    animation: typing-bounce 1.4s ease-in-out infinite;
  }

  .typing-dot:nth-child(1) {
    animation-delay: 0s;
  }

  .typing-dot:nth-child(2) {
    animation-delay: 0.2s;
  }

  .typing-dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes typing-bounce {
    0%,
    60%,
    100% {
      transform: translateY(0);
      opacity: 0.7;
    }
    30% {
      transform: translateY(-8px);
      opacity: 1;
    }
  }

  .response-options {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    width: 100%;
    max-width: 600px;
    margin: var(--spacing-md) auto 0;
  }

  .response-option {
    padding: var(--spacing-sm) var(--spacing-md);
    cursor: default;
    transition: all 0.2s ease;
    border-radius: var(--border-radius-small);
    border: 1px solid #ccc;
    background: var(--background-primary);
  }

  .response-option .sentence {
    font-size: 18px;
    margin: 0 0 var(--spacing-xs) 0;
  }

  .response-option .translation {
    font-size: 14px;
    color: var(--text-secondary);
    margin: 0;
  }

  .cancel-recording-button:hover {
    background: var(--background-secondary);
    border-color: var(--text-tertiary);
    color: var(--text-primary);
  }

  .transcribing-indicator {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    font-size: 14px;
    color: var(--text-primary);
  }

  .transcription-results {
    margin-top: var(--spacing-md);
    padding: var(--spacing-md);
    background: var(--background-primary);
    border-radius: var(--border-radius);
    border: 1px solid var(--border-color);
  }

  .transcription-header {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: var(--spacing-md);
    text-align: center;
  }

  .transcription-loading {
    text-align: center;
    padding: var(--spacing-lg);
  }

  .streaming-transcription {
    margin-top: var(--spacing-md);
  }

  .transcription-text {
    margin: var(--spacing-md) 0;
  }

  .transcription-text .label {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: var(--spacing-xs);
  }

  .transcription-text .text {
    font-size: 16px;
    color: var(--text-primary);
  }

  .color-coded-text {
    line-height: 1.6;
  }

  .similarity-score {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    margin: var(--spacing-md) 0;
    font-size: 14px;
  }

  .similarity-bar {
    flex: 1;
    height: 20px;
    background: var(--background-secondary);
    border-radius: var(--border-radius-small);
    overflow: hidden;
    border: 1px solid var(--border-color);
  }

  .similarity-fill {
    height: 100%;
    transition: width 0.3s ease;
  }

  .similarity-fill.excellent {
    background: var(--success-color);
  }

  .similarity-fill.good {
    background: #28a745;
  }

  .similarity-fill.fair {
    background: #ffc107;
  }

  .similarity-fill.poor {
    background: var(--error-color);
  }

  .similarity-percentage {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    min-width: 45px;
  }

  .pronunciation-feedback {
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--border-radius-small);
    text-align: center;
    font-weight: 500;
    margin-top: var(--spacing-md);
  }

  .pronunciation-feedback.excellent {
    background: var(--success-light);
    color: var(--success-color);
  }

  .pronunciation-feedback.good {
    background: #d4edda;
    color: #28a745;
  }

  .pronunciation-feedback.fair {
    background: #fff3cd;
    color: #856404;
  }

  .pronunciation-feedback.poor {
    background: var(--error-light);
    color: var(--error-color);
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
    flex-shrink: 0;
  }

  .record-button:hover {
    border-color: var(--primary-color);
    color: var(--primary-color);
    background: rgba(0, 0, 0, 0.03);
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

  .record-button.recording {
    background: var(--error-color);
    border-color: var(--error-color);
    color: white;
  }

  .record-button.recording:hover {
    background: var(--error-dark);
    border-color: var(--error-dark);
  }

  .record-button.user-turn {
    background: var(--primary-color);
    border-color: var(--primary-color);
    color: white;
    box-shadow: 0 0 12px rgba(0, 123, 255, 0.5);
    animation: pulse-glow 2s ease-in-out infinite;
  }

  .record-button.user-turn:hover {
    background: var(--primary-dark);
    border-color: var(--primary-dark);
    box-shadow: 0 0 16px rgba(0, 123, 255, 0.7);
  }

  @keyframes pulse-glow {
    0%,
    100% {
      box-shadow: 0 0 12px rgba(0, 123, 255, 0.5);
    }
    50% {
      box-shadow: 0 0 20px rgba(0, 123, 255, 0.8);
    }
  }

  .audio-replay-button:hover {
    border-color: var(--primary-color);
    color: var(--primary-color);
    background: rgba(0, 0, 0, 0.03);
  }

  .audio-replay-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .translations-toggle {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    font-size: 14px;
    color: var(--text-secondary);
  }

  .control-buttons {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    margin-left: auto;
  }

  .translations-switch {
    position: relative;
    width: 40px;
    height: 20px;
    background: var(--border-color);
    border-radius: 10px;
    cursor: pointer;
    transition: background-color 0.3s ease;
  }

  .translations-switch.active {
    background: var(--primary-color);
  }

  .translations-slider {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    background: white;
    border-radius: 50%;
    transition: transform 0.3s ease;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }

  .translations-switch.active .translations-slider {
    transform: translateX(20px);
  }

  .translations-label {
    font-weight: 500;
    user-select: none;
    font-size: 12px;
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

  .loading {
    text-align: center;
    padding: var(--spacing-xl);
  }
`;
