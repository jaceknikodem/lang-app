/**
 * Status message component for displaying success, error, info, and warning messages
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';

@customElement('status-message')
export class StatusMessage extends LitElement {
  static styles = [
    sharedStyles,
    css`
      .status-message {
        margin-top: var(--spacing-sm);
        padding: var(--spacing-sm);
        border-radius: var(--border-radius-small);
        font-size: 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--spacing-sm);
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

      .status-warning {
        background: #fff3cd;
        color: #856404;
        border: 1px solid #ffc107;
      }

      .message-content {
        flex: 1;
      }

      .dismiss-button {
        background: transparent;
        border: none;
        color: inherit;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        padding: 0;
        opacity: 0.7;
        transition: opacity 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
      }

      .dismiss-button:hover {
        opacity: 1;
      }
    `,
  ];

  @property({ type: String })
  type: 'success' | 'error' | 'info' | 'warning' = 'info';

  @property({ type: String })
  message = '';

  @property({ type: Boolean })
  dismissible = false;

  @state()
  private isDismissed = false;

  private handleDismiss() {
    this.isDismissed = true;
    this.dispatchEvent(
      new CustomEvent('dismiss', {
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    if (this.isDismissed) {
      return nothing;
    }

    return html`
      <div class="status-message status-${this.type}">
        <div class="message-content">${this.message}</div>
        ${this.dismissible
          ? html`
              <button
                class="dismiss-button"
                @click=${this.handleDismiss}
                type="button"
                aria-label="Dismiss message"
              >
                ×
              </button>
            `
          : ''}
      </div>
    `;
  }
}
