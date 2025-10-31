/**
 * Audio recording component for quiz pronunciation practice
 */

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import type { RecordingSession, RecordingOptions } from '../../shared/types/audio.js';

export interface RecordingResult {
  session: RecordingSession;
  filePath: string;
  duration: number;
}

@customElement('audio-recorder')
export class AudioRecorder extends LitElement {
  @property({ type: String })
  prompt = 'Record your pronunciation';

  @property({ type: Boolean })
  disabled = false;

  @property({ type: Object })
  recordingOptions: RecordingOptions = {
    sampleRate: 16000,
    channels: 1,
    threshold: 0.5,
    silence: '1.0',
    endOnSilence: true
  };

  @state()
  private isRecording = false;

  @state()
  private currentSession: RecordingSession | null = null;

  @state()
  private recordingTime = 0;

  @state()
  private error: string | null = null;

  @state()
  private lastRecording: RecordingResult | null = null;

  @state()
  private isPlaying = false;

  private recordingTimer: number | null = null;
  private statusCheckTimer: number | null = null;

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        width: 100%;
      }

      .recorder-container {
        background: var(--background-secondary);
        border-radius: var(--border-radius);
        padding: var(--spacing-lg);
        text-align: center;
        border: 2px solid var(--border-color);
        transition: all 0.2s ease;
      }

      .recorder-container.recording {
        border-color: var(--error-color);
        background: var(--error-light);
      }

      .recorder-prompt {
        font-size: 16px;
        color: var(--text-secondary);
        margin-bottom: var(--spacing-md);
      }

      .silence-info {
        font-size: 12px;
        color: var(--text-secondary);
        margin-bottom: var(--spacing-sm);
        font-style: italic;
      }

      .recording-controls {
        display: flex;
        gap: var(--spacing-md);
        justify-content: center;
        align-items: center;
        margin-bottom: var(--spacing-md);
      }

      .record-button {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        transition: all 0.2s ease;
        position: relative;
      }

      .record-button:not(.recording) {
        background: var(--error-color);
        color: white;
      }

      .record-button:not(.recording):hover {
        background: var(--error-dark);
        transform: scale(1.05);
      }

      .record-button.recording {
        background: var(--error-color);
        color: white;
        animation: pulse 1.5s infinite;
      }

      .record-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }

      @keyframes pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.1); }
        100% { transform: scale(1); }
      }

      .stop-button {
        width: 60px;
        height: 60px;
        border-radius: var(--border-radius);
        background: var(--text-secondary);
        color: white;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        transition: all 0.2s ease;
      }

      .stop-button:hover {
        background: var(--text-primary);
        transform: translateY(-1px);
      }

      .cancel-button {
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: var(--background-primary);
        color: var(--text-secondary);
        border: 2px solid var(--border-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        transition: all 0.2s ease;
      }

      .cancel-button:hover {
        border-color: var(--error-color);
        color: var(--error-color);
      }

      .recording-status {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .recording-time {
        font-size: 18px;
        font-weight: 600;
        color: var(--error-color);
        font-family: monospace;
      }

      .recording-indicator {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        color: var(--error-color);
        font-size: 14px;
        font-weight: 500;
      }

      .recording-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--error-color);
        animation: blink 1s infinite;
      }

      @keyframes blink {
        0%, 50% { opacity: 1; }
        51%, 100% { opacity: 0.3; }
      }

      .playback-section {
        margin-top: var(--spacing-lg);
        padding-top: var(--spacing-lg);
        border-top: 1px solid var(--border-color);
      }


      .recording-info {
        font-size: 14px;
        color: var(--text-secondary);
        margin-top: var(--spacing-sm);
      }

      .error-message {
        background: var(--error-light);
        color: var(--error-dark);
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--border-radius-small);
        font-size: 14px;
        margin-top: var(--spacing-md);
      }

      .success-message {
        background: var(--success-light);
        color: var(--success-dark);
        padding: var(--spacing-sm) var(--spacing-md);
        border-radius: var(--border-radius-small);
        font-size: 14px;
        margin-top: var(--spacing-md);
      }

      @media (max-width: 768px) {
        .recording-controls {
          flex-direction: column;
          gap: var(--spacing-sm);
        }

        .record-button {
          width: 70px;
          height: 70px;
          font-size: 20px;
        }

        .stop-button, .cancel-button {
          width: 50px;
          height: 50px;
          font-size: 16px;
        }

        .playback-controls {
          flex-direction: column;
          gap: var(--spacing-sm);
        }
      }
    `
  ];

  async connectedCallback() {
    super.connectedCallback();
    
    // Check if there's an ongoing recording session
    await this.checkCurrentSession();
    
    // Set up periodic check for recording status (in case of auto-stop)
    this.setupRecordingStatusCheck();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.clearTimer();
    this.clearStatusCheck();
  }

  private async checkCurrentSession() {
    try {
      const session = await window.electronAPI.audio.getCurrentRecordingSession();
      if (session && session.isRecording) {
        this.currentSession = session;
        this.isRecording = true;
        this.startTimer();
      }
    } catch (error) {
      console.error('Error checking current session:', error);
    }
  }

  private async startRecording() {
    if (this.disabled || this.isRecording) return;

    try {
      this.error = null;
      const session = await window.electronAPI.audio.startRecording(this.recordingOptions);
      
      this.currentSession = session;
      this.isRecording = true;
      this.recordingTime = 0;
      this.startTimer();
      this.setupRecordingStatusCheck();

      // Dispatch start event
      this.dispatchEvent(new CustomEvent('recording-started', {
        detail: { session },
        bubbles: true
      }));

    } catch (error) {
      console.error('Error starting recording:', error);
      this.error = `Failed to start recording: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private async stopRecording() {
    if (!this.isRecording) return;

    try {
      const completedSession = await window.electronAPI.audio.stopRecording();
      
      this.isRecording = false;
      this.clearTimer();
      this.clearStatusCheck();
      
      if (completedSession) {
        this.lastRecording = {
          session: completedSession,
          filePath: completedSession.filePath,
          duration: completedSession.duration || 0
        };

        // Dispatch completion event
        this.dispatchEvent(new CustomEvent('recording-completed', {
          detail: { recording: this.lastRecording },
          bubbles: true
        }));
      }

      this.currentSession = null;

    } catch (error) {
      console.error('Error stopping recording:', error);
      this.error = `Failed to stop recording: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.isRecording = false;
      this.clearTimer();
      this.clearStatusCheck();
    }
  }

  private async cancelRecording() {
    if (!this.isRecording) return;

    try {
      await window.electronAPI.audio.cancelRecording();
      
      this.isRecording = false;
      this.currentSession = null;
      this.clearTimer();
      this.clearStatusCheck();

      // Dispatch cancel event
      this.dispatchEvent(new CustomEvent('recording-cancelled', {
        bubbles: true
      }));

    } catch (error) {
      console.error('Error cancelling recording:', error);
      this.error = `Failed to cancel recording: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private async playRecording() {
    if (!this.lastRecording || this.isPlaying) return;

    try {
      this.isPlaying = true;
      await window.electronAPI.audio.playAudio(this.lastRecording.filePath);
      this.isPlaying = false;
    } catch (error) {
      console.error('Error playing recording:', error);
      this.error = `Failed to play recording: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.isPlaying = false;
    }
  }

  private async deleteRecording() {
    if (!this.lastRecording) return;

    try {
      await window.electronAPI.audio.deleteRecording(this.lastRecording.filePath);
      this.lastRecording = null;

      // Dispatch delete event
      this.dispatchEvent(new CustomEvent('recording-deleted', {
        bubbles: true
      }));

    } catch (error) {
      console.error('Error deleting recording:', error);
      this.error = `Failed to delete recording: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private startTimer() {
    this.clearTimer();
    this.recordingTimer = window.setInterval(() => {
      this.recordingTime += 1;
    }, 1000);
  }

  private clearTimer() {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }
  }

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    return this.formatTime(seconds);
  }

  private setupRecordingStatusCheck() {
    this.clearStatusCheck();
    // Check recording status every 500ms to detect auto-stop
    this.statusCheckTimer = window.setInterval(async () => {
      if (this.isRecording) {
        try {
          const isStillRecording = await window.electronAPI.audio.isRecording();
          if (!isStillRecording) {
            // Recording was stopped automatically (likely due to silence)
            await this.handleAutoStop();
          }
        } catch (error) {
          console.error('Error checking recording status:', error);
        }
      }
    }, 500);
  }

  private clearStatusCheck() {
    if (this.statusCheckTimer) {
      clearInterval(this.statusCheckTimer);
      this.statusCheckTimer = null;
    }
  }

  private async handleAutoStop() {
    try {
      // Get the completed session
      const completedSession = await window.electronAPI.audio.getCurrentRecordingSession();
      
      this.isRecording = false;
      this.clearTimer();
      this.clearStatusCheck();
      
      if (completedSession && !completedSession.isRecording) {
        this.lastRecording = {
          session: completedSession,
          filePath: completedSession.filePath,
          duration: completedSession.duration || 0
        };

        // Show success message for auto-stop
        this.error = null;
        
        // Dispatch completion event
        this.dispatchEvent(new CustomEvent('recording-completed', {
          detail: { 
            recording: this.lastRecording,
            autoStopped: true 
          },
          bubbles: true
        }));
      }

      this.currentSession = null;

    } catch (error) {
      console.error('Error handling auto-stop:', error);
      this.error = 'Recording stopped automatically but there was an error processing it.';
      this.isRecording = false;
      this.clearTimer();
      this.clearStatusCheck();
    }
  }

  render() {
    return html`
      <div class="recorder-container ${this.isRecording ? 'recording' : ''}">
        <div class="recorder-prompt">${this.prompt}</div>
        ${this.isRecording ? this.renderRecordingControls() : this.renderIdleControls()}

        ${this.lastRecording && !this.isRecording ? this.renderPlaybackSection() : ''}

        ${this.error ? html`<div class="error-message">${this.error}</div>` : ''}
      </div>
    `;
  }

  private renderIdleControls() {
    return html`
      <div class="recording-controls">
        <button 
          class="record-button"
          @click=${this.startRecording}
          ?disabled=${this.disabled}
          title="Start recording"
        >
          🎤 Practice
        </button>
      </div>
    `;
  }

  private renderRecordingControls() {
    return html`
      <div class="recording-controls">
        <button 
          class="record-button recording"
          @click=${this.stopRecording}
          title="Stop recording"
        >
          ⏹️
        </button>
        
        <button 
          class="cancel-button"
          @click=${this.cancelRecording}
          title="Cancel recording"
        >
          ✕
        </button>
      </div>

      <div class="recording-status">
        <div class="recording-time">${this.formatTime(this.recordingTime)}</div>
        <div class="recording-indicator">
          <div class="recording-dot"></div>
          ${this.recordingOptions.endOnSilence ? 'Recording... (auto-stop enabled)' : 'Recording...'}
        </div>
      </div>
    `;
  }

  private renderPlaybackSection() {
    if (!this.lastRecording) return '';

    return html`
      <div class="playback-section">
      </div>
    `;
  }
}