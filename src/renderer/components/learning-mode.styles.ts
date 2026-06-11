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

  .progress-bar {
    width: 100%;
    height: 4px;
    background: var(--border-color);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--primary-color);
    transition: width 0.3s ease;
  }

  .nav-info {
    display: flex;
    gap: var(--spacing-md);
    align-items: center;
  }

  .error-message {
    color: var(--error-color);
    background: var(--error-light);
    padding: var(--spacing-md);
    border-radius: var(--border-radius);
    border: 1px solid var(--error-color);
    text-align: center;
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

  .auto-scroll-toggle {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    font-size: 14px;
    color: var(--text-secondary);
  }

  .auto-scroll-switch {
    position: relative;
    width: 50px;
    height: 24px;
    background: var(--border-color);
    border-radius: 12px;
    cursor: pointer;
    transition: background-color 0.3s ease;
  }

  .auto-scroll-switch.active {
    background: var(--primary-color);
  }

  .auto-scroll-slider {
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

  .auto-scroll-switch.active .auto-scroll-slider {
    transform: translateX(22px);
  }

  .auto-scroll-label {
    font-weight: 500;
    user-select: none;
  }

  .playback-speed-control {
    display: flex;
    align-items: center;
    gap: calc(var(--spacing-xs) + 4px);
    font-size: 12px;
    color: var(--text-secondary);
  }

  .playback-speed-label {
    font-weight: 500;
    user-select: none;
  }

  .playback-speed-buttons {
    display: flex;
    gap: 2px;
    background: var(--background-secondary);
    border-radius: var(--border-radius-small);
    padding: 2px;
    border: 1px solid var(--border-color);
  }

  .playback-speed-button {
    padding: 2px 8px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    border-radius: var(--border-radius-small);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    min-width: 32px;
  }

  .playback-speed-button:hover {
    background: var(--background-primary);
    color: var(--text-primary);
  }

  .playback-speed-button.active {
    background: var(--primary-color);
    color: white;
  }

  .audio-only-toggle {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    font-size: 12px;
    color: var(--text-secondary);
  }

  .audio-only-switch {
    position: relative;
    width: 40px;
    height: 20px;
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
    width: 16px;
    height: 16px;
    background: white;
    border-radius: 50%;
    transition: transform 0.3s ease;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }

  .audio-only-switch.active .audio-only-slider {
    transform: translateX(20px);
  }

  .audio-only-label {
    font-weight: 500;
    user-select: none;
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
