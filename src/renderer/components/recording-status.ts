import { LitElement, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { recordingStyles } from './recording.styles.js';

@customElement('recording-status')
export class RecordingStatusElement extends LitElement {
  @property({ type: Boolean }) isRecording = false;
  @property({ type: Number }) recordingTime = 0;

  static styles = recordingStyles;

  render() {
    if (!this.isRecording) return nothing;

    const minutes = Math.floor(this.recordingTime / 60);
    const seconds = this.recordingTime % 60;
    const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    return html`
      <div class="recording-status-container">
        <div class="recording-status">
          <div class="recording-dot"></div>
          <span class="recording-time">${formattedTime}</span>
          <span class="recording-indicator">Recording…</span>
        </div>
        <button
          class="cancel-recording-button"
          @click=${this.handleCancel}
          title="Cancel recording"
        >
          ✕ Cancel
        </button>
      </div>
    `;
  }

  private handleCancel() {
    this.dispatchEvent(new CustomEvent('cancel-recording', { bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'recording-status': RecordingStatusElement;
  }
}
