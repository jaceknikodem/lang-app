import { css } from 'lit';

export const wordSelectorStyles = css`
  :host {
    display: block;
    max-width: 1000px;
    margin: 0 auto;
  }

  .word-selector-container {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  }

  .header-section {
    text-align: center;
  }

  .header-title {
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 var(--spacing-sm) 0;
  }

  .header-subtitle {
    font-size: 14px;
    color: var(--text-secondary);
    margin: 0;
  }

  .topic-info {
    background: var(--primary-light);
    padding: var(--spacing-md);
    border-radius: var(--border-radius);
    border: 1px solid var(--primary-color);
    text-align: center;
    margin-bottom: var(--spacing-sm);
  }

  .topic-label {
    font-size: 12px;
    color: var(--text-secondary);
    margin: 0 0 var(--spacing-xs) 0;
  }

  .topic-name {
    font-size: 16px;
    font-weight: 600;
    color: var(--primary-color);
    margin: 0;
  }

  .selection-controls {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: var(--spacing-md);
    background: var(--background-secondary);
    border-radius: var(--border-radius);
    flex-wrap: wrap;
    gap: var(--spacing-sm);
    text-align: center;
  }

  .selection-info {
    font-size: 14px;
    color: var(--text-secondary);
  }

  .word-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(450px, 1fr));
    gap: var(--spacing-md);
  }

  .word-list.processed {
    grid-template-columns: repeat(2, 1fr);
  }

  .word-item {
    background: var(--background-primary);
    border: 2px solid var(--border-color);
    border-radius: var(--border-radius);
    padding: var(--spacing-md);
    cursor: pointer;
    transition: all 0.2s ease;
    position: relative;
  }

  .word-item:hover {
    border-color: var(--primary-color);
    box-shadow: var(--shadow-light);
  }

  .word-item.disabled {
    cursor: default;
    pointer-events: none;
    opacity: 0.8;
  }

  .word-item.disabled:hover {
    border-color: var(--border-color);
    box-shadow: none;
  }

  .word-item.selected {
    border-color: var(--primary-color);
    background: var(--primary-light);
  }

  .word-item.known {
    border-color: #4caf50;
    background: #e8f5e8;
    opacity: 0.7;
  }

  .word-item.known .word-content {
    text-decoration: line-through;
  }

  .word-actions {
    position: absolute;
    top: var(--spacing-sm);
    right: var(--spacing-sm);
    display: flex;
    flex-direction: row;
    gap: var(--spacing-xs);
    align-items: center;
  }

  .known-btn {
    background: #4caf50;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    transition: background-color 0.2s ease;
    white-space: nowrap;
    min-width: 110px;
  }

  .known-btn:hover {
    background: #45a049;
  }

  .known-btn.active {
    background: #2e7d32;
  }

  .undo-btn {
    background: #ff9800;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 11px;
    cursor: pointer;
    transition: background-color 0.2s ease;
    white-space: nowrap;
    min-width: 50px;
  }

  .undo-btn:hover {
    background: #f57c00;
  }

  .word-content {
    margin-right: calc(var(--spacing-lg) + 120px);
    display: flex;
    align-items: baseline;
    gap: var(--spacing-sm);
    flex-wrap: wrap;
  }

  .word-item.disabled .word-content {
    margin-right: var(--spacing-sm);
  }

  .word-foreign {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    position: relative;
    display: inline-block;
  }

  .word-reading-tooltip {
    display: none;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    background: #1a1a2e;
    border: 1px solid #444;
    border-radius: 8px;
    padding: 8px 12px;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    z-index: 100;
  }

  .word-reading-tooltip::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 6px solid transparent;
    border-top-color: #1a1a2e;
  }

  .word-foreign:hover .word-reading-tooltip {
    display: flex;
  }

  .tooltip-hiragana {
    font-size: 15px;
    color: #e8e8f0;
    letter-spacing: 0.05em;
  }

  .tooltip-romaji {
    font-size: 11px;
    color: #9090b0;
    letter-spacing: 0.08em;
  }

  .word-translation {
    font-size: 14px;
    color: var(--text-secondary);
    margin: 0;
  }

  .word-frequency {
    font-size: 12px;
    padding: 2px 6px;
    border-radius: 12px;
    font-weight: 500;
    text-transform: uppercase;
  }

  .frequency-high {
    background: #e8f5e8;
    color: #2e7d32;
  }

  .frequency-medium {
    background: #fff3e0;
    color: #f57c00;
  }

  .frequency-low {
    background: #ffebee;
    color: #d32f2f;
  }

  .frequency-tier {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    background: #f5f5f5;
    color: #666;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    white-space: nowrap;
  }

  .action-section {
    display: flex;
    justify-content: center;
  }

  .primary-actions {
    display: flex;
    gap: var(--spacing-sm);
    flex-wrap: wrap;
    justify-content: center;
  }

  .start-btn {
    min-width: 180px;
  }

  .error-message {
    color: var(--error-color);
    background: #ffebee;
    padding: var(--spacing-md);
    border-radius: var(--border-radius);
    border: 1px solid #ffcdd2;
    text-align: center;
  }

  .success-message {
    color: var(--text-primary);
    background: var(--background-secondary);
    padding: var(--spacing-md);
    border-radius: var(--border-radius);
    border: 1px solid var(--border-color);
    text-align: center;
  }

  .empty-state {
    text-align: center;
    color: var(--text-secondary);
    padding: var(--spacing-xl);
  }

  @media (max-width: 768px) {
    .word-list {
      grid-template-columns: 1fr;
    }

    .selection-controls {
      flex-direction: column;
      align-items: stretch;
    }

    .primary-actions {
      width: 100%;
    }

    .start-btn {
      width: 100%;
    }
  }
`;
