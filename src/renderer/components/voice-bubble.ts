/**
 * Voice ID bubble component - displays a voice ID as a removable bubble
 */

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';

@customElement('voice-bubble')
export class VoiceBubble extends LitElement {
  static styles = [
    sharedStyles,
    css`
      .bubble {
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--primary-light);
        color: var(--primary-dark);
        border: 1px solid var(--primary-color);
        border-radius: 16px;
        font-size: 12px;
        font-family: monospace;
        font-weight: 500;
        transition: all 0.2s ease;
      }

      .bubble:hover {
        background: var(--primary-color);
        color: white;
      }

      .bubble.removable {
        padding-right: var(--spacing-xs);
      }

      .bubble-text {
        flex: 1;
      }

      .remove-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        padding: 0;
        margin: 0;
        border: none;
        background: transparent;
        color: inherit;
        border-radius: 50%;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        transition: all 0.2s ease;
        opacity: 0.7;
      }

      .remove-button:hover {
        opacity: 1;
        background: rgba(0, 0, 0, 0.1);
      }

      .bubble:hover .remove-button {
        opacity: 1;
      }

      .bubble:hover .remove-button:hover {
        background: rgba(255, 255, 255, 0.2);
      }
    `,
  ];

  @property({ type: String })
  voiceId = '';

  @property({ type: Boolean })
  removable = false;

  private handleRemove() {
    if (this.removable) {
      this.dispatchEvent(
        new CustomEvent('remove', {
          detail: { voiceId: this.voiceId },
          bubbles: true,
          composed: true,
        })
      );
    }
  }

  render() {
    return html`
      <div class="bubble ${this.removable ? 'removable' : ''}">
        <span class="bubble-text">${this.voiceId}</span>
        ${this.removable
          ? html`
              <button
                class="remove-button"
                @click=${this.handleRemove}
                type="button"
                title="Remove voice ID"
              >
                ×
              </button>
            `
          : ''}
      </div>
    `;
  }
}
