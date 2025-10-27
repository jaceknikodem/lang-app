/**
 * Shared CSS styles and utilities for the application
 */

import { css } from 'lit';

export const sharedStyles = css`
  /* Color palette */
  :host {
    --primary-color: #007AFF;
    --primary-hover: #0056CC;
    --primary-dark: #0056CC;
    --primary-light: #f0f8ff;
    --success-color: #34C759;
    --success-light: #e8f5e8;
    --success-dark: #28A745;
    --warning-color: #FF9500;
    --warning-light: #fff3e0;
    --warning-dark: #E6850E;
    --error-color: #FF3B30;
    --error-light: #ffebee;
    --error-dark: #D32F2F;
    --text-primary: #000000;
    --text-secondary: #666666;
    --text-tertiary: #999999;
    --background-primary: #ffffff;
    --background-secondary: #f5f5f5;
    --border-color: #e0e0e0;
    --shadow-light: 0 2px 10px rgba(0,0,0,0.1);
    --shadow-medium: 0 4px 20px rgba(0,0,0,0.15);
    --border-radius: 8px;
    --border-radius-small: 4px;
    --spacing-xs: 4px;
    --spacing-sm: 8px;
    --spacing-md: 16px;
    --spacing-lg: 24px;
    --spacing-xl: 32px;
  }

  /* Typography */
  .text-primary {
    color: var(--text-primary);
  }

  .text-secondary {
    color: var(--text-secondary);
  }

  .text-tertiary {
    color: var(--text-tertiary);
  }

  .text-center {
    text-align: center;
  }

  .text-large {
    font-size: 18px;
    font-weight: 500;
  }

  .text-medium {
    font-size: 16px;
  }

  .text-small {
    font-size: 14px;
  }

  /* Layout utilities */
  .flex {
    display: flex;
  }

  .flex-column {
    display: flex;
    flex-direction: column;
  }

  .flex-center {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .flex-between {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .gap-xs { gap: var(--spacing-xs); }
  .gap-sm { gap: var(--spacing-sm); }
  .gap-md { gap: var(--spacing-md); }
  .gap-lg { gap: var(--spacing-lg); }
  .gap-xl { gap: var(--spacing-xl); }

  .p-xs { padding: var(--spacing-xs); }
  .p-sm { padding: var(--spacing-sm); }
  .p-md { padding: var(--spacing-md); }
  .p-lg { padding: var(--spacing-lg); }
  .p-xl { padding: var(--spacing-xl); }

  .m-xs { margin: var(--spacing-xs); }
  .m-sm { margin: var(--spacing-sm); }
  .m-md { margin: var(--spacing-md); }
  .m-lg { margin: var(--spacing-lg); }
  .m-xl { margin: var(--spacing-xl); }

  /* Button styles */
  .btn {
    padding: var(--spacing-sm) var(--spacing-md);
    border: none;
    border-radius: var(--border-radius-small);
    cursor: pointer;
    font-size: 16px;
    font-weight: 500;
    transition: all 0.2s ease;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-xs);
    text-decoration: none;
    box-sizing: border-box;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--primary-color);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--primary-hover);
  }

  .btn-secondary {
    background: var(--background-primary);
    color: var(--primary-color);
    border: 2px solid var(--primary-color);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--primary-light);
  }

  .btn-success {
    background: var(--success-color);
    color: white;
  }

  .btn-success:hover:not(:disabled) {
    background: #28A745;
  }

  .btn-warning {
    background: var(--warning-color);
    color: white;
  }

  .btn-warning:hover:not(:disabled) {
    background: #E6850E;
  }

  .btn-large {
    padding: var(--spacing-md) var(--spacing-lg);
    font-size: 18px;
  }

  .btn-small {
    padding: var(--spacing-xs) var(--spacing-sm);
    font-size: 14px;
  }

  /* Card styles */
  .card {
    background: var(--background-primary);
    border-radius: var(--border-radius);
    box-shadow: var(--shadow-light);
    padding: var(--spacing-lg);
    border: 1px solid var(--border-color);
  }

  .card-header {
    margin-bottom: var(--spacing-md);
    padding-bottom: var(--spacing-md);
    border-bottom: 1px solid var(--border-color);
  }

  .card-title {
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .card-subtitle {
    font-size: 14px;
    color: var(--text-secondary);
    margin: var(--spacing-xs) 0 0 0;
  }

  /* Input styles */
  .input {
    padding: var(--spacing-sm) var(--spacing-md);
    border: 2px solid var(--border-color);
    border-radius: var(--border-radius-small);
    font-size: 16px;
    transition: border-color 0.2s ease;
    box-sizing: border-box;
  }

  .input:focus {
    outline: none;
    border-color: var(--primary-color);
  }

  .input::placeholder {
    color: var(--text-tertiary);
  }

  /* Loading states */
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-sm);
    color: var(--text-secondary);
    font-style: italic;
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--border-color);
    border-top: 2px solid var(--primary-color);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  /* Word strength colors */
  .word-strength-0 { background-color: #ffebee; } /* Very weak - light red */
  .word-strength-1 { background-color: #fff3e0; } /* Weak - light orange */
  .word-strength-2 { background-color: #fffde7; } /* Learning - light yellow */
  .word-strength-3 { background-color: #f3e5f5; } /* Good - light purple */
  .word-strength-4 { background-color: #e8f5e8; } /* Strong - light green */
  .word-known { background-color: #c8e6c9; } /* Known - green */
  .word-ignored { background-color: #f5f5f5; color: #999; } /* Ignored - grey */

  /* Window drag region for hidden title bar */
  .drag-region {
    -webkit-app-region: drag;
    height: 30px;
    width: 100%;
    position: fixed;
    top: 0;
    left: 0;
    z-index: 1000;
    background: transparent;
  }

  .no-drag {
    -webkit-app-region: no-drag;
  }

  /* Responsive utilities */
  @media (max-width: 768px) {
    .btn {
      padding: var(--spacing-md);
      font-size: 14px;
    }
    
    .card {
      padding: var(--spacing-md);
    }
  }
`;

export const buttonStyles = css`
  .btn {
    padding: var(--spacing-sm) var(--spacing-md);
    border: none;
    border-radius: var(--border-radius-small);
    cursor: pointer;
    font-size: 16px;
    font-weight: 500;
    transition: all 0.2s ease;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-xs);
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--primary-color);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--primary-hover);
  }
`;