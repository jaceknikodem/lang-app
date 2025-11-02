/**
 * Flow mode component for playing long stitched audio from all sentences
 */

import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import { Word, Sentence } from '../../shared/types/core.js';
import { keyboardManager, useKeyboardBindings, CommonKeys } from '../utils/keyboard-manager.js';

interface FlowSentence {
  sentence: Sentence;
  words: Word[];
  beforeSentenceAudio?: string;
  continuationAudios: string[];
}

@customElement('flow-mode')
export class FlowMode extends LitElement {
  @state()
  private flowSentences: FlowSentence[] = [];

  @state()
  private isLoading = true;

  @state()
  private error = '';

  @state()
  private isStitching = false;

  @state()
  private isPlaying = false;

  @state()
  private showOverlay = false;

  @state()
  private stitchedAudioPath: string | null = null;

  private keyboardUnsubscribe?: () => void;
  private audioElement: HTMLAudioElement | null = null;
  private playbackTimer: number | null = null;
  private playbackStartTime: number | 0 = 0;
  private totalPlaybackTime: number = 0; // Cumulative playback time in seconds
  private lastPauseTime: number | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.loadFlowSentences();

    // Set up keyboard bindings
    this.keyboardUnsubscribe = useKeyboardBindings([
      {
        key: CommonKeys.SPACE,
        action: () => this.handleSpaceKey(),
        description: 'Pause Flow audio'
      }
    ]);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.keyboardUnsubscribe) {
      this.keyboardUnsubscribe();
    }
    this.stopAudio();
  }

  private async loadFlowSentences() {
    try {
      this.isLoading = true;
      this.error = '';

      const sentences = await window.electronAPI.flow.getFlowSentences();
      this.flowSentences = sentences;

      // Collect all audio paths
      const audioPaths: string[] = [];
      for (const item of this.flowSentences) {
        // Add before sentence audio if exists
        if (item.beforeSentenceAudio) {
          audioPaths.push(item.beforeSentenceAudio);
        }
        
        // Add main sentence audio
        if (item.sentence.audioPath) {
          audioPaths.push(item.sentence.audioPath);
        }

        // Add continuation audios
        audioPaths.push(...item.continuationAudios);
      }

      if (audioPaths.length === 0) {
        this.error = 'No audio files found. Please generate some sentences with audio first.';
        return;
      }

      // Stitch audio files
      this.isStitching = true;
      try {
        this.stitchedAudioPath = await window.electronAPI.flow.stitchAudio(audioPaths);
        if (!this.stitchedAudioPath) {
          this.error = 'Failed to stitch audio files. Please ensure ffmpeg is installed.';
        }
      } catch (err) {
        console.error('Error stitching audio:', err);
        this.error = `Failed to stitch audio: ${err instanceof Error ? err.message : 'Unknown error'}`;
      } finally {
        this.isStitching = false;
      }
    } catch (err) {
      console.error('Error loading flow sentences:', err);
      this.error = `Failed to load flow sentences: ${err instanceof Error ? err.message : 'Unknown error'}`;
    } finally {
      this.isLoading = false;
    }
  }

  private async handlePlay() {
    if (!this.stitchedAudioPath) {
      return;
    }

    if (this.isPlaying) {
      this.pauseAudio();
    } else {
      await this.playAudio();
    }
  }

  private async playAudio() {
    if (!this.stitchedAudioPath) {
      return;
    }

    try {
      // Stop any existing audio
      this.stopAudio();

      // Load audio file
      const audioData = await window.electronAPI.audio.loadAudioBase64(this.stitchedAudioPath);
      if (!audioData) {
        throw new Error('Failed to load audio file');
      }

      // Create blob URL
      const blob = new Blob([audioData.data], { type: audioData.mimeType });
      const blobUrl = URL.createObjectURL(blob);

      // Create audio element
      this.audioElement = new Audio(blobUrl);
      
      // Set up event handlers
      this.audioElement.addEventListener('ended', () => {
        this.stopAudio();
      });

      this.audioElement.addEventListener('error', (e) => {
        console.error('Error playing audio:', e);
        this.stopAudio();
        this.error = 'Failed to play audio';
      });

      // Set up timeupdate handler to track playback duration
      this.audioElement.addEventListener('timeupdate', () => {
        if (this.audioElement && this.isPlaying) {
          // Calculate current playback time: accumulated time + current segment time
          const currentPlaybackTime = this.totalPlaybackTime + this.audioElement.currentTime;
          
          // Check if 2 minutes (120 seconds) have elapsed
          if (currentPlaybackTime >= 120 && this.playbackTimer === null) {
            // Dispatch event for autopilot to check scores after 2 minutes of Flow playback
            window.dispatchEvent(new CustomEvent('autopilot-check-trigger'));
            // Mark timer as triggered so we don't trigger multiple times
            this.playbackTimer = 1;
          }
        }
      });

      // Play audio
      await this.audioElement.play();
      this.isPlaying = true;
      this.showOverlay = true;
      
      // When starting/resuming playback, the audio element will continue from its current position
      // We track totalPlaybackTime separately to handle pauses correctly
      this.lastPauseTime = null;
      this.playbackStartTime = Date.now();
      this.playbackTimer = null; // Reset timer trigger flag
    } catch (err) {
      console.error('Error playing audio:', err);
      this.error = `Failed to play audio: ${err instanceof Error ? err.message : 'Unknown error'}`;
      this.stopAudio();
    }
  }

  private pauseAudio() {
    if (this.audioElement && this.isPlaying) {
      // Accumulate the time played in this playback segment
      if (this.audioElement.currentTime > 0) {
        this.totalPlaybackTime += this.audioElement.currentTime;
      }
      
      this.audioElement.pause();
      this.isPlaying = false;
      this.showOverlay = false;
      
      // Reset currentTime to 0 so next resume starts from beginning of audio
      // This allows us to track cumulative playback time correctly
      this.audioElement.currentTime = 0;
      this.lastPauseTime = Date.now();
    }
  }

  private stopAudio() {
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.currentTime = 0;
      
      // Clean up blob URL
      const src = this.audioElement.src;
      if (src.startsWith('blob:')) {
        URL.revokeObjectURL(src);
      }
      
      this.audioElement = null;
    }
    this.isPlaying = false;
    this.showOverlay = false;
    this.playbackStartTime = 0;
    this.playbackTimer = null;
    this.totalPlaybackTime = 0;
    this.lastPauseTime = null;
  }

  private handleSpaceKey() {
    if (this.showOverlay && this.isPlaying) {
      this.pauseAudio();
    }
  }

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        width: 100%;
        height: 100%;
        position: relative;
      }

      .flow-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        padding: var(--spacing-lg);
      }

      .play-button {
        width: 120px;
        height: 120px;
        border-radius: 50%;
        background: var(--primary-color);
        color: white;
        border: none;
        font-size: 48px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s, box-shadow 0.2s;
        box-shadow: var(--shadow-medium);
      }

      .play-button:hover:not(:disabled) {
        transform: scale(1.05);
        box-shadow: var(--shadow-large);
      }

      .play-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .loading, .error {
        text-align: center;
        padding: var(--spacing-lg);
      }

      .error {
        color: var(--error-color);
      }

      .info {
        margin-top: var(--spacing-md);
        text-align: center;
        color: var(--text-secondary);
      }

      .overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.95);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      }

      .pause-icon {
        font-size: 200px;
        color: white;
        opacity: 0.9;
        cursor: pointer;
        user-select: none;
      }

      .pause-icon:hover {
        opacity: 1;
      }
    `
  ];

  render() {
    if (this.isLoading || this.isStitching) {
      return html`
        <div class="flow-container">
          <div class="loading">
            ${this.isStitching ? 'Stitching audio files...' : 'Loading flow sentences...'}
          </div>
        </div>
      `;
    }

    if (this.error) {
      return html`
        <div class="flow-container">
          <div class="error">${this.error}</div>
          <button 
            class="button primary" 
            @click=${this.loadFlowSentences}
            style="margin-top: var(--spacing-md);"
          >
            Retry
          </button>
        </div>
      `;
    }

    const sentenceCount = this.flowSentences.length;
    const totalWords = this.flowSentences.reduce((sum, item) => sum + item.words.length, 0);

    return html`
      <div class="flow-container">
        <button
          class="play-button"
          @click=${this.handlePlay}
          ?disabled=${!this.stitchedAudioPath}
        >
          ${this.isPlaying ? '⏸' : '▶'}
        </button>
        
        <div class="info">
          <p>${sentenceCount} sentences</p>
          <p>${totalWords} connected words</p>
          <p style="margin-top: var(--spacing-sm); font-size: 0.9em; opacity: 0.7;">
            Press spacebar to pause
          </p>
        </div>
      </div>

      ${this.showOverlay ? html`
        <div class="overlay" @click=${this.pauseAudio}>
          <div class="pause-icon">⏸</div>
        </div>
      ` : nothing}
    `;
  }
}

