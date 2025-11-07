/**
 * Language proficiency level selector component
 */

import { LitElement, html, css } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';

export type ProficiencyLevel = 'newbie' | 'a1' | 'a2' | 'b1';

@customElement('language-proficiency-selector')
export class LanguageProficiencySelector extends LitElement {
  @property({ type: String })
  language = '';

  @property({ type: String })
  currentLevel: ProficiencyLevel | null = null;

  @state()
  private selectedLevel: ProficiencyLevel = 'newbie';

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
      }

      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      }

      .modal-content {
        background: white;
        padding: 2rem;
        border-radius: 12px;
        max-width: 500px;
        width: 90%;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        position: relative;
      }

      .close-button {
        position: absolute;
        top: 1rem;
        right: 1rem;
        background: none;
        border: none;
        font-size: 24px;
        color: var(--text-tertiary);
        cursor: pointer;
        padding: 0;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: all 0.2s ease;
        line-height: 1;
      }

      .close-button:hover {
        background: var(--background-secondary);
        color: var(--text-primary);
      }

      .modal-title {
        font-size: 24px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 var(--spacing-md) 0;
        text-align: center;
      }

      .modal-subtitle {
        font-size: 16px;
        color: var(--text-secondary);
        margin: 0 0 var(--spacing-lg) 0;
        text-align: center;
      }

      .slider-container {
        margin: var(--spacing-xl) 0;
      }

      .slider {
        width: 100%;
        height: 8px;
        border-radius: 4px;
        background: var(--background-secondary);
        outline: none;
        -webkit-appearance: none;
        appearance: none;
        margin: var(--spacing-lg) 0;
      }

      .slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: var(--primary-color);
        cursor: pointer;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      }

      .slider::-moz-range-thumb {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: var(--primary-color);
        cursor: pointer;
        border: none;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      }

      .level-labels {
        display: flex;
        justify-content: space-between;
        margin-top: var(--spacing-sm);
        margin-bottom: var(--spacing-lg);
      }

      .level-label {
        font-size: 14px;
        font-weight: 500;
        color: var(--text-secondary);
        cursor: pointer;
        transition: color 0.2s ease;
        text-align: center;
        flex: 1;
      }

      .level-label.active {
        color: var(--primary-color);
        font-weight: 600;
      }

      .level-description {
        background: var(--background-secondary);
        padding: var(--spacing-md);
        border-radius: var(--border-radius);
        margin-top: var(--spacing-lg);
        margin-bottom: var(--spacing-lg);
        min-height: 60px;
      }

      .level-description-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 var(--spacing-xs) 0;
      }

      .level-description-text {
        font-size: 13px;
        color: var(--text-secondary);
        margin: 0;
        line-height: 1.5;
      }

      .button-container {
        display: flex;
        gap: var(--spacing-md);
        justify-content: flex-end;
        margin-top: var(--spacing-lg);
      }

      .button {
        padding: var(--spacing-md) var(--spacing-lg);
        border: none;
        border-radius: var(--border-radius-small);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        min-width: 100px;
      }

      .button-primary {
        background: var(--primary-color);
        color: white;
      }

      .button-primary:hover {
        background: var(--primary-hover);
      }

      .button-secondary {
        background: var(--background-secondary);
        color: var(--text-primary);
        border: 1px solid var(--border-color);
      }

      .button-secondary:hover {
        background: var(--background-tertiary);
      }
    `,
  ];

  connectedCallback() {
    super.connectedCallback();
    if (this.currentLevel) {
      this.selectedLevel = this.currentLevel;
    }
  }

  private getLevelValue(level: ProficiencyLevel): number {
    const levels: ProficiencyLevel[] = ['newbie', 'a1', 'a2', 'b1'];
    return levels.indexOf(level);
  }

  private getLevelFromValue(value: number): ProficiencyLevel {
    const levels: ProficiencyLevel[] = ['newbie', 'a1', 'a2', 'b1'];
    return levels[Math.round(value)];
  }

  private handleSliderChange(event: Event) {
    const slider = event.target as HTMLInputElement;
    const value = parseInt(slider.value);
    this.selectedLevel = this.getLevelFromValue(value);
  }

  private handleLevelClick(level: ProficiencyLevel) {
    this.selectedLevel = level;
    const slider = this.shadowRoot?.querySelector('.slider') as HTMLInputElement;
    if (slider) {
      slider.value = this.getLevelValue(level).toString();
    }
  }

  private getLevelDisplayName(level: ProficiencyLevel): string {
    const names: Record<ProficiencyLevel, string> = {
      newbie: 'Newbie',
      a1: 'A1',
      a2: 'A2',
      b1: 'B1',
    };
    return names[level];
  }

  private getLevelDescription(level: ProficiencyLevel): string {
    const descriptions: Record<ProficiencyLevel, string> = {
      newbie:
        'Just starting out. Can recognize a few words but need help with basic phrases and pronunciation.',
      a1: 'Beginner level. Can understand and use familiar everyday expressions and very basic phrases aimed at the satisfaction of concrete needs.',
      a2: 'Elementary level. Can understand sentences and frequently used expressions related to areas of immediate relevance.',
      b1: 'Intermediate level. Can understand the main points of clear standard input on familiar matters regularly encountered in work, school, leisure, etc.',
    };
    return descriptions[level];
  }

  private capitalizeLanguage(language: string): string {
    return language.charAt(0).toUpperCase() + language.slice(1);
  }

  private async handleConfirm() {
    this.dispatchEvent(
      new CustomEvent('proficiency-selected', {
        detail: { level: this.selectedLevel },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleCancel() {
    this.dispatchEvent(
      new CustomEvent('proficiency-cancelled', {
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    const sliderValue = this.getLevelValue(this.selectedLevel);
    const levels: ProficiencyLevel[] = ['newbie', 'a1', 'a2', 'b1'];

    return html`
      <div
        class="modal-overlay"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) {
            this.handleCancel();
          }
        }}
      >
        <div class="modal-content">
          <button class="close-button" @click=${this.handleCancel} title="Close">×</button>
          <h2 class="modal-title">New to ${this.capitalizeLanguage(this.language)}?</h2>
          <p class="modal-subtitle">What level are you at?</p>

          <div class="slider-container">
            <input
              type="range"
              min="0"
              max="3"
              step="1"
              value=${sliderValue}
              class="slider"
              @input=${this.handleSliderChange}
            />

            <div class="level-labels">
              ${levels.map(
                (level) => html`
                  <span
                    class="level-label ${this.selectedLevel === level ? 'active' : ''}"
                    @click=${() => this.handleLevelClick(level)}
                  >
                    ${this.getLevelDisplayName(level)}
                  </span>
                `
              )}
            </div>

            <div class="level-description">
              <div class="level-description-title">
                ${this.getLevelDisplayName(this.selectedLevel)}
              </div>
              <p class="level-description-text">${this.getLevelDescription(this.selectedLevel)}</p>
            </div>
          </div>

          <div class="button-container">
            <button class="button button-primary" @click=${this.handleConfirm}>Continue</button>
          </div>
        </div>
      </div>
    `;
  }
}
