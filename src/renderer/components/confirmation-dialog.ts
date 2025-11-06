/**
 * Confirmation dialog component for confirming destructive actions
 */

import { LitElement, html, css, nothing, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';

@customElement('confirmation-dialog')
export class ConfirmationDialog extends LitElement {
  static styles = [
    sharedStyles,
    css`
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
        animation: fadeIn 0.2s ease;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      .confirmation-content {
        background: white;
        padding: 2rem;
        border-radius: 8px;
        max-width: 400px;
        text-align: center;
        animation: slideUp 0.2s ease;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      }

      @keyframes slideUp {
        from {
          transform: translateY(20px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }

      .confirmation-content h3 {
        color: #dc3545;
        margin-top: 0;
        font-size: 18px;
        font-weight: 600;
      }

      .confirmation-content.variant-default .confirmation-content h3 {
        color: var(--text-primary);
      }

      .confirmation-message {
        margin: 1rem 0;
        line-height: 1.5;
      }

      .confirmation-message p {
        margin: 0.5rem 0;
      }

      .confirmation-message ul {
        text-align: left;
        margin: 1rem 0;
        padding-left: 1.5rem;
      }

      .confirmation-actions {
        display: flex;
        gap: 1rem;
        justify-content: center;
        margin-top: 1.5rem;
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

      .action-button.danger {
        background: var(--error-color);
        color: white;
      }

      .action-button.danger:hover {
        background: var(--error-dark);
      }

      .action-button.secondary {
        background: var(--background-primary);
        color: var(--text-primary);
        border: 1px solid var(--border-color);
      }

      .action-button.secondary:hover {
        background: var(--background-secondary);
      }
    `
  ];

  @property({ type: Boolean })
  open = false;

  @property({ type: String })
  title = '';

  @property({ attribute: false })
  message: string | TemplateResult = '';

  @property({ type: String })
  confirmText = 'Confirm';

  @property({ type: String })
  cancelText = 'Cancel';

  @property({ type: String })
  variant: 'default' | 'danger' = 'default';

  private handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      this.handleCancel();
    }
  }

  private handleEscapeKey(event: KeyboardEvent) {
    if (event.key === 'Escape' && this.open) {
      this.handleCancel();
    }
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this.handleEscapeKey.bind(this));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.handleEscapeKey.bind(this));
  }

  private handleConfirm() {
    this.dispatchEvent(new CustomEvent('confirm', {
      bubbles: true,
      composed: true
    }));
  }

  private handleCancel() {
    this.dispatchEvent(new CustomEvent('cancel', {
      bubbles: true,
      composed: true
    }));
  }

  render() {
    if (!this.open) {
      return nothing;
    }

    return html`
      <div 
        class="confirmation-dialog" 
        @click=${this.handleBackdropClick}
      >
        <div class="confirmation-content variant-${this.variant}">
          <h3>${this.title}</h3>
          <div class="confirmation-message">
            ${typeof this.message === 'string' ? html`<p>${this.message}</p>` : this.message}
          </div>
          <div class="confirmation-actions">
            <button 
              class="action-button ${this.variant === 'danger' ? 'danger' : ''}" 
              @click=${this.handleConfirm}
            >
              ${this.confirmText}
            </button>
            <button 
              class="action-button secondary" 
              @click=${this.handleCancel}
            >
              ${this.cancelText}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

