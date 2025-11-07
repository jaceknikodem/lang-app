/**
 * Progress bar component for displaying progress
 */

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';

@customElement('progress-bar')
export class ProgressBar extends LitElement {
  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
      }

      .progress-bar {
        width: 100%;
        height: 4px;
        background: var(--background-secondary);
        border-radius: 2px;
        overflow: hidden;
      }

      .progress-bar.has-label {
        margin-top: var(--spacing-xs);
      }

      .progress-fill {
        height: 100%;
        background: var(--primary-color);
        transition: width 0.3s ease;
      }

      .progress-fill.variant-primary {
        background: var(--primary-color);
      }

      .progress-fill.variant-success {
        background: var(--success-color);
      }

      .progress-label {
        font-size: 12px;
        color: var(--text-secondary);
        margin-bottom: var(--spacing-xs);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .progress-label-text {
        font-weight: 500;
      }

      .progress-percentage {
        font-variant-numeric: tabular-nums;
        color: var(--text-secondary);
      }
    `,
  ];

  @property({ type: Number })
  value = 0;

  @property({ type: Number })
  max = 100;

  @property({ type: Boolean })
  showLabel = false;

  @property({ type: String })
  label = '';

  @property({ type: String })
  variant: 'default' | 'primary' | 'success' = 'default';

  @property({ type: String })
  height = '4px';

  private get percentage(): number {
    if (this.max === 0) return 0;
    const percentage = (this.value / this.max) * 100;
    return Math.min(100, Math.max(0, percentage));
  }

  render() {
    const percentage = this.percentage;
    const displayLabel = this.showLabel ? this.label || `${Math.round(percentage)}%` : '';

    return html`
      ${this.showLabel
        ? html`
            <div class="progress-label">
              <span class="progress-label-text">${displayLabel}</span>
              ${this.showLabel && !this.label
                ? html` <span class="progress-percentage">${Math.round(percentage)}%</span> `
                : ''}
            </div>
          `
        : ''}
      <div
        class="progress-bar ${this.showLabel ? 'has-label' : ''}"
        style="height: ${this.height};"
      >
        <div
          class="progress-fill variant-${this.variant === 'default' ? 'primary' : this.variant}"
          style="width: ${percentage}%;"
        ></div>
      </div>
    `;
  }
}
