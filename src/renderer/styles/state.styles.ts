import { css } from 'lit';

export const stateStyles = css`
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
`;
