import { css } from 'lit';

export const recordingStyles = css`
  .recording-section {
    margin-top: var(--spacing-md);
    margin-bottom: var(--spacing-lg);
  }

  .recording-status-container {
    padding: var(--spacing-sm) var(--spacing-md);
    background: #fff5f5;
    border-radius: var(--border-radius);
    border-top: 2px solid rgba(255, 59, 48, 0.2);
    margin-bottom: var(--spacing-sm);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-md);
  }

  .recording-status {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    flex: 1;
  }

  .recording-indicator {
    font-size: 13px;
    color: var(--text-secondary);
    font-weight: 400;
  }

  .recording-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ff3b30;
    animation: recording-pulse 1.2s ease-in-out infinite;
    flex-shrink: 0;
  }

  @keyframes recording-pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.6;
      transform: scale(1.1);
    }
  }

  .recording-time {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .cancel-recording-button {
    padding: var(--spacing-xs) var(--spacing-sm);
    border: 1px solid var(--border-color);
    background: var(--background-primary);
    color: var(--text-secondary);
    border-radius: var(--border-radius-small);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }

  .cancel-recording-button:hover {
    background: var(--background-secondary);
    border-color: var(--text-tertiary);
    color: var(--text-primary);
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
`;
