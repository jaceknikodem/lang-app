import { css } from 'lit';

export const appRootStyles = css`
  :host {
    display: block;
    width: 100%;
    height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .app-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    max-width: 1000px;
    margin: 0 auto;
    padding: var(--spacing-md);
    box-sizing: border-box;
  }

  .app-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-lg);
    padding-bottom: var(--spacing-sm);
    border-bottom: 1px solid var(--border-color);
  }

  .app-title {
    font-size: 22px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
  }

  .navigation {
    display: flex;
    gap: var(--spacing-sm);
    align-items: center;
    flex: 1;
  }

  .language-dropdown {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .language-select {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    padding: var(--spacing-xs) var(--spacing-sm);
    background: var(--background-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-small);
    font-size: 12px;
    color: var(--text-primary);
    cursor: pointer;
    transition: all 0.2s ease;
    min-width: 100px;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
  }

  .stats-display {
    display: flex;
    gap: var(--spacing-xs);
    align-items: center;
  }

  .stat-box {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--border-radius-small);
    cursor: help;
    font-size: 12px;
  }

  .stat-box .stat-value {
    font-size: 13px;
    font-weight: 500;
  }

  .stat-box.known {
    background: rgba(76, 175, 80, 0.05);
  }

  .stat-box.known .stat-value {
    color: rgba(76, 175, 80, 0.7);
  }

  .stat-box.strong {
    background: rgba(33, 150, 243, 0.05);
  }

  .stat-box.strong .stat-value {
    color: rgba(33, 150, 243, 0.7);
  }

  .stat-box.weak {
    background: rgba(255, 152, 0, 0.05);
  }

  .stat-box.weak .stat-value {
    color: rgba(255, 152, 0, 0.7);
  }

  .stat-box.new {
    background: rgba(158, 158, 158, 0.05);
  }

  .stat-box.new .stat-value {
    color: rgba(158, 158, 158, 0.7);
  }

  .stat-box.pronunciation {
    background: rgba(156, 39, 176, 0.05);
  }

  .stat-box.pronunciation .stat-value {
    color: rgba(156, 39, 176, 0.7);
  }

  .stat-box.proficiency-score {
    background: rgba(0, 150, 136, 0.1);
    border-color: rgba(0, 150, 136, 0.3);
  }

  .stat-box.proficiency-score .stat-value {
    color: rgba(0, 150, 136, 0.8);
  }

  .stat-box.proficiency {
    background: rgba(0, 150, 136, 0.05);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .stat-box.proficiency:hover {
    background: rgba(0, 150, 136, 0.15);
    transform: translateY(-1px);
  }

  .stat-box.proficiency .stat-value {
    color: rgba(0, 150, 136, 0.7);
  }

  .proficiency-level-badge {
    color: rgba(0, 150, 136, 0.8);
  }

  .tooltip {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-bottom: var(--spacing-xs);
    padding: var(--spacing-xs) var(--spacing-sm);
    background: var(--background-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-small);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    white-space: nowrap;
    font-size: 11px;
    color: var(--text-primary);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
    z-index: 1000;
  }

  .stat-box:hover .tooltip {
    opacity: 1;
  }

  .language-select:hover {
    border-color: var(--primary-color);
    background: var(--primary-light);
  }

  .language-select:focus {
    outline: none;
    border-color: var(--primary-color);
    box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.2);
  }

  .transition-indicator {
    position: fixed;
    top: 80px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000;
    background: var(--background-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-small);
    padding: var(--spacing-sm) var(--spacing-md);
    font-size: 13px;
    color: var(--text-secondary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease-in-out;
    white-space: nowrap;
  }

  .transition-indicator.visible {
    opacity: 1;
  }

  .language-option {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    padding: var(--spacing-xs);
  }

  .language-flag {
    font-size: 14px;
  }

  .language-name {
    font-weight: 500;
  }

  .nav-button {
    padding: var(--spacing-sm) var(--spacing-md);
    border: 1px solid var(--primary-color);
    background: var(--background-primary);
    color: var(--primary-color);
    border-radius: var(--border-radius-small);
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    transition: all 0.2s ease;
  }

  .nav-button:hover {
    background: var(--primary-light);
  }

  .nav-button.active {
    background: var(--primary-color);
    color: white;
  }

  .nav-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .flow-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.95);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    cursor: pointer;
  }

  .flow-pause-icon {
    font-size: 200px;
    color: white;
    opacity: 0.9;
    user-select: none;
  }

  .flow-pause-icon:hover {
    opacity: 1;
  }

  .close-button {
    padding: var(--spacing-xs) var(--spacing-sm);
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    border-radius: var(--border-radius-small);
    cursor: pointer;
    font-size: 18px;
    font-weight: 300;
    line-height: 1;
    transition: all 0.2s ease;
    opacity: 0.5;
  }

  .close-button:hover {
    color: var(--text-secondary);
    opacity: 0.8;
    background: var(--background-secondary);
  }

  .settings-button {
    padding: var(--spacing-xs) var(--spacing-sm);
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    border-radius: var(--border-radius-small);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    transition: all 0.2s ease;
    opacity: 0.5;
  }

  .settings-button:hover {
    color: var(--text-secondary);
    opacity: 0.8;
    background: var(--background-secondary);
  }

  .settings-button.active {
    opacity: 1;
    color: var(--primary-color);
  }

  .nav-left-group {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .nav-right-group {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    margin-left: auto;
  }

  .content-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .route-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: auto;
  }

  .placeholder {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--text-secondary);
    gap: var(--spacing-md);
  }

  .placeholder h3 {
    font-size: 24px;
    color: var(--text-primary);
    margin: 0;
  }

  .placeholder p {
    font-size: 16px;
    margin: 0;
    max-width: 400px;
  }

  .loading-container {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  @media (max-width: 768px) {
    .app-container {
      padding: var(--spacing-sm);
    }

    .app-header {
      flex-direction: column;
      gap: var(--spacing-md);
      align-items: stretch;
    }

    .navigation {
      justify-content: center;
      flex-wrap: wrap;
    }

    .nav-button {
      flex: 1;
      text-align: center;
      min-width: 80px;
    }

    .language-dropdown {
      margin-left: 0;
      margin-top: var(--spacing-xs);
      order: 10;
      flex-basis: 100%;
      display: flex;
      justify-content: center;
    }

    .language-select {
      min-width: 120px;
    }
  }
`;
