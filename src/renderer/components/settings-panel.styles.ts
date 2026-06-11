import { css } from 'lit';

export const settingsPanelStyles = css`
  .settings-container {
    max-width: 600px;
    margin: 0 auto;
    padding: var(--spacing-lg);
  }

  .settings-section {
    margin-bottom: var(--spacing-lg);
    padding: var(--spacing-lg);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius);
    background: var(--background-secondary);
  }

  .settings-section h3 {
    margin-top: 0;
    color: var(--text-primary);
    font-size: 16px;
    font-weight: 600;
  }

  .settings-row {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    gap: var(--spacing-lg);
    margin-bottom: var(--spacing-md);
  }

  .settings-row:last-child {
    margin-bottom: 0;
  }

  .settings-description {
    min-width: 120px;
  }

  .settings-description p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .action-button {
    padding: var(--spacing-md) var(--spacing-lg);
    background: var(--primary-color);
    color: white;
    border: none;
    border-radius: var(--border-radius-small);
    cursor: pointer;
    font-size: 12px;
    min-width: 100px;
    transition: all 0.2s ease;
  }

  .action-button:hover {
    background: var(--primary-hover);
  }

  .action-button:disabled {
    background: var(--text-tertiary);
    cursor: not-allowed;
  }

  .action-button.danger {
    background: var(--error-color);
    color: white;
  }

  .action-button.danger:hover:not(:disabled) {
    background: var(--error-dark);
  }

  .status-message {
    margin-top: var(--spacing-sm);
    padding: var(--spacing-sm);
    border-radius: var(--border-radius-small);
    font-size: 12px;
  }

  .status-success {
    background: var(--success-light);
    color: var(--success-dark);
    border: 1px solid var(--success-color);
  }

  .status-error {
    background: #f8d7da;
    color: #721c24;
    border: 1px solid #f5c6cb;
  }

  .status-info {
    background: #d1ecf1;
    color: #0c5460;
    border: 1px solid #bee5eb;
  }

  .warning-section {
    border-color: #ffc107;
    background: #fff3cd;
    padding: var(--spacing-md);
  }

  .warning-section h3 {
    color: #856404;
  }

  .confirmation-dialog {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .confirmation-content {
    background: white;
    padding: 2rem;
    border-radius: 8px;
    max-width: 400px;
    text-align: center;
  }

  .confirmation-content h3 {
    color: #dc3545;
    margin-top: 0;
  }

  .confirmation-actions {
    display: flex;
    gap: 1rem;
    justify-content: center;
    margin-top: 1.5rem;
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    margin-bottom: 1rem;
  }

  .checkbox-row:last-child {
    margin-bottom: 0;
  }

  .checkbox-row input[type='checkbox'] {
    margin-right: 0.5rem;
    transform: scale(1.2);
  }

  .checkbox-row label {
    cursor: pointer;
    flex: 1;
  }

  .checkbox-description {
    margin-top: 0.25rem;
    color: #666;
    font-size: 0.9rem;
  }

  .dropdown-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .dropdown-row:last-child {
    margin-bottom: 0;
  }

  .dropdown-description {
    flex: 1;
    margin-right: 1rem;
  }

  .dropdown-description p {
    margin: 0;
    color: #666;
    font-size: 0.9rem;
  }

  .model-select {
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: white;
    font-size: 0.9rem;
    min-width: 200px;
    cursor: pointer;
  }

  .model-select:focus {
    outline: none;
    border-color: #007acc;
    box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.2);
  }

  .model-select:disabled {
    background: #f5f5f5;
    color: #999;
    cursor: not-allowed;
  }

  .model-info {
    margin-top: 0.5rem;
    font-size: 0.8rem;
    color: #666;
    font-style: italic;
  }

  .text-input {
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: white;
    font-size: 0.9rem;
    min-width: 300px;
    font-family: monospace;
  }

  .text-input:focus {
    outline: none;
    border-color: #007acc;
    box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.2);
  }

  .text-input:disabled {
    background: #f5f5f5;
    color: #999;
    cursor: not-allowed;
  }

  .text-input[type='password'] {
    letter-spacing: 0.1em;
  }

  .advanced-toggle {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-md);
    padding: var(--spacing-sm) var(--spacing-md);
    background: var(--background-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-small);
    cursor: pointer;
    font-size: 12px;
    color: var(--text-secondary);
    transition: all 0.2s ease;
  }

  .advanced-toggle:hover {
    background: var(--background-tertiary);
    color: var(--text-primary);
  }

  .advanced-toggle-icon {
    transition: transform 0.2s ease;
  }

  .advanced-toggle-icon.expanded {
    transform: rotate(90deg);
  }

  .advanced-settings {
    margin-top: var(--spacing-md);
    padding-top: var(--spacing-md);
    border-top: 1px solid var(--border-color);
  }

  .backup-actions {
    display: flex;
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-md);
  }

  .backup-action {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .backup-action .settings-description {
    margin-right: 0;
    margin-bottom: 0;
  }

  .error-message {
    margin-top: var(--spacing-sm);
    padding: var(--spacing-sm);
    border-radius: var(--border-radius-small);
    font-size: 12px;
    background: #f8d7da;
    color: #721c24;
    border: 1px solid #f5c6cb;
  }
`;
