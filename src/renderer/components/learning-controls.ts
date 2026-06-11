import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('learning-controls')
export class LearningControls extends LitElement {
  @property({ type: Number }) playbackSpeed = 1.0;
  @property({ type: Boolean }) autoScrollEnabled = false;
  @property({ type: Boolean }) audioOnlyMode = false;
  @property({ type: Boolean }) isLastSentence = false;

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
    }

    .playback-speed-control {
      display: flex;
      align-items: center;
      gap: calc(var(--spacing-xs) + 4px);
      font-size: 12px;
      color: var(--text-secondary);
    }

    .playback-speed-buttons {
      display: flex;
      gap: 2px;
      background: var(--background-secondary);
      border-radius: var(--border-radius-small);
      padding: 2px;
      border: 1px solid var(--border-color);
    }

    .playback-speed-button {
      padding: 2px 8px;
      border: none;
      background: transparent;
      color: var(--text-secondary);
      border-radius: var(--border-radius-small);
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      min-width: 32px;
    }

    .playback-speed-button:hover {
      background: var(--background-primary);
      color: var(--text-primary);
    }

    .playback-speed-button.active {
      background: var(--primary-color);
      color: white;
    }

    .toggle-group {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      font-size: 12px;
      color: var(--text-secondary);
    }

    .toggle-label {
      font-weight: 500;
      user-select: none;
    }

    .toggle-switch {
      position: relative;
      width: 40px;
      height: 20px;
      background: var(--border-color);
      border-radius: 12px;
      cursor: pointer;
      transition: background-color 0.3s ease;
    }

    .toggle-switch.active {
      background: var(--primary-color);
    }

    .toggle-switch.disabled {
      opacity: 0.5;
      cursor: not-allowed;
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
  `;

  private handleSpeedClick(speed: number) {
    this.dispatchEvent(
      new CustomEvent('speed-change', { detail: { speed }, bubbles: true, composed: true })
    );
  }

  private handleAutoScrollClick() {
    if (this.isLastSentence) return;
    this.dispatchEvent(
      new CustomEvent('auto-scroll-change', {
        detail: { enabled: !this.autoScrollEnabled },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleAudioOnlyClick() {
    this.dispatchEvent(
      new CustomEvent('audio-only-change', {
        detail: { enabled: !this.audioOnlyMode },
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    return html`
      <div class="playback-speed-control">
        <div class="playback-speed-buttons">
          <button
            class="playback-speed-button ${this.playbackSpeed === 0.7 ? 'active' : ''}"
            @click=${() => this.handleSpeedClick(0.7)}
            title="0.7x speed"
          >
            0.7x
          </button>
          <button
            class="playback-speed-button ${this.playbackSpeed === 1.0 ? 'active' : ''}"
            @click=${() => this.handleSpeedClick(1.0)}
            title="1x speed (normal)"
          >
            1x
          </button>
          <button
            class="playback-speed-button ${this.playbackSpeed === 1.2 ? 'active' : ''}"
            @click=${() => this.handleSpeedClick(1.2)}
            title="1.2x speed"
          >
            1.2x
          </button>
          <button
            class="playback-speed-button ${this.playbackSpeed === 1.5 ? 'active' : ''}"
            @click=${() => this.handleSpeedClick(1.5)}
            title="1.5x speed"
          >
            1.5x
          </button>
        </div>
      </div>

      <div class="toggle-group">
        <span class="toggle-label">Auto-scroll</span>
        <div
          class="toggle-switch ${this.autoScrollEnabled ? 'active' : ''} ${this.isLastSentence
            ? 'disabled'
            : ''}"
          @click=${this.handleAutoScrollClick}
          title=${this.isLastSentence
            ? 'Auto-scroll disabled at end of session'
            : 'Auto-scroll to next sentence 1.5 seconds after audio stops'}
        >
          <div class="toggle-slider"></div>
        </div>
      </div>

      <div class="toggle-group">
        <span class="toggle-label">Hide English</span>
        <div
          class="toggle-switch ${this.audioOnlyMode ? 'active' : ''}"
          @click=${this.handleAudioOnlyClick}
          title="Hide English translations"
        >
          <div class="toggle-slider"></div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'learning-controls': LearningControls;
  }
}
