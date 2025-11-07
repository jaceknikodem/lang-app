/**
 * Reusable toggle switch component
 */

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';

@customElement('toggle-switch')
export class ToggleSwitch extends LitElement {
  @property({ type: Boolean })
  checked = false;

  @property({ type: String })
  label = '';

  @property({ type: String })
  title = '';

  static styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        margin-right: var(--spacing-xs);
        font-size: 14px;
        color: var(--text-secondary);
      }

      .toggle-label {
        font-size: 12px;
        color: var(--text-secondary);
        font-weight: 500;
        user-select: none;
      }

      .toggle-switch {
        position: relative;
        width: 40px;
        height: 20px;
        background: var(--border-color);
        border-radius: 10px;
        cursor: pointer;
        transition: background-color 0.3s ease;
      }

      .toggle-switch.active {
        background: var(--primary-color);
      }

      .toggle-slider {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        background: white;
        border-radius: 50%;
        transition: transform 0.3s ease;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      }

      .toggle-switch.active .toggle-slider {
        transform: translateX(20px);
      }

      .toggle-switch:hover {
        border-color: var(--primary-color);
      }
    `,
  ];

  private handleClick(event: Event) {
    event.preventDefault();
    this.dispatchEvent(
      new CustomEvent('toggle-changed', {
        detail: { checked: !this.checked },
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    return html`
      ${this.label ? html`<span class="toggle-label">${this.label}</span>` : ''}
      <div
        class="toggle-switch ${this.checked ? 'active' : ''}"
        @click=${this.handleClick}
        title=${this.title || ''}
        role="switch"
        aria-checked=${this.checked}
      >
        <div class="toggle-slider"></div>
      </div>
    `;
  }
}
