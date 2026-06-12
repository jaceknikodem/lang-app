import { css } from 'lit';

export const buttonStyles = css`
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
`;
