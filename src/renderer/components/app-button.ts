/**
 * Button component for consistent button styling across the application
 */

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';

@customElement('app-button')
export class AppButton extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: inline-block;
      }

      button {
        padding: var(--spacing-md) var(--spacing-lg);
        background: var(--primary-color);
        color: white;
        border: none;
        border-radius: var(--border-radius-small);
        cursor: pointer;
        font-size: 12px;
        min-width: 100px;
        transition: all 0.2s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-sm);
        font-family: inherit;
        line-height: 1;
      }

      button:hover:not(:disabled) {
        background: var(--primary-hover);
      }

      button:disabled {
        background: var(--text-tertiary);
        cursor: not-allowed;
        opacity: 0.6;
      }

      button.variant-primary {
        background: var(--primary-color);
        color: white;
      }

      button.variant-primary:hover:not(:disabled) {
        background: var(--primary-hover);
      }

      button.variant-danger {
        background: var(--error-color);
        color: white;
      }

      button.variant-danger:hover:not(:disabled) {
        background: var(--error-dark);
      }

      button.variant-secondary {
        background: var(--background-primary);
        color: var(--primary-color);
        border: 2px solid var(--primary-color);
      }

      button.variant-secondary:hover:not(:disabled) {
        background: var(--primary-light);
      }

      button.variant-icon-only {
        padding: var(--spacing-sm);
        min-width: auto;
        width: 32px;
        height: 32px;
      }

      button.size-small {
        padding: var(--spacing-sm) var(--spacing-md);
        font-size: 11px;
        min-width: 80px;
      }

      button.size-medium {
        padding: var(--spacing-md) var(--spacing-lg);
        font-size: 12px;
        min-width: 100px;
      }

      button.size-large {
        padding: var(--spacing-lg) var(--spacing-xl);
        font-size: 14px;
        min-width: 120px;
      }

      .loading-spinner {
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top: 2px solid currentColor;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }

      .button-icon {
        font-size: 14px;
        line-height: 1;
      }
    `,
  ];

  @property({ type: String })
  variant: 'primary' | 'danger' | 'secondary' | 'icon-only' = 'primary';

  @property({ type: String })
  size: 'small' | 'medium' | 'large' = 'medium';

  @property({ type: Boolean })
  disabled = false;

  @property({ type: Boolean })
  loading = false;

  @property({ type: String })
  icon = '';

  @property({ type: String })
  type: 'button' | 'submit' | 'reset' = 'button';

  render() {
    return html`
      <button
        class="variant-${this.variant} size-${this.size}"
        ?disabled=${this.disabled || this.loading}
        type=${this.type}
        @click=${this.handleClick}
      >
        ${this.loading ? html` <span class="loading-spinner"></span> ` : ''}
        ${this.icon && !this.loading ? html` <span class="button-icon">${this.icon}</span> ` : ''}
        <slot></slot>
      </button>
    `;
  }

  private handleClick(event: MouseEvent) {
    if (this.disabled || this.loading) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // Let the event bubble up naturally
  }
}
