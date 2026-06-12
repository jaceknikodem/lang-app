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

  .quiz-progress {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    font-size: 14px;
    color: var(--text-secondary);
    margin-left: auto;
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
  }
`;
