import { css } from 'lit';

export const learningModeStyles = css`
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

  .nav-info {
    display: flex;
    gap: var(--spacing-md);
    align-items: center;
  }

  .keyboard-hint {
    font-size: 0.8em;
    opacity: 0.7;
    font-weight: normal;
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
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-md);
    padding: var(--spacing-xl);
    text-align: center;
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
`;
