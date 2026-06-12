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

  .loading {
    text-align: center;
    padding: var(--spacing-xl);
  }
`;
