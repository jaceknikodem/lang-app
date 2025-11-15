/**
 * Flow mode component for playing long stitched audio from all sentences
 */

import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { sharedStyles } from '../styles/shared.js';
import { Word, Sentence } from '../../shared/types/core.js';
import { getErrorMessage } from '../../shared/utils/error.js';
import { keyboardManager, CommonKeys } from '../utils/keyboard-manager.js';
import { logger } from '../utils/logger.js';
import { BaseComponent } from './base-component.js';

interface FlowSentence {
  audioPath: string;
  englishAudioPath?: string;
  beforeSentenceAudio?: string;
  afterSentenceAudio?: string;
  continuationAudios: string[];
}

@customElement('flow-mode')
export class FlowMode extends BaseComponent {
  @state()
  private flowSentences: FlowSentence[] = [];

  @state()
  private isStitching = false;

  @state()
  private isPlaying = false;

  @state()
  private showOverlay = false;

  @state()
  private stitchedAudioPath: string | null = null;

  @state()
  private stitchedAudioPathWithEnglish: string | null = null;

  private directKeyHandler?: (event: KeyboardEvent) => void;
  private audioElement: HTMLAudioElement | null = null;
  private playbackTimer: number | null = null;
  private playbackStartTime: number | 0 = 0;
  private totalPlaybackTime: number = 0; // Cumulative playback time in seconds
  private lastPauseTime: number | null = null;
  private pausedPosition: number = 0; // Position where audio was paused (in seconds)
  private pauseEndTimestamps: number[] | null = null; // Pause end timestamps from JSON file
  private currentAudioPath: string | null = null; // Track which audio file is currently playing
  private previousPauseTimestamp: number | null = null; // Previous pause timestamp when pausing
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;
  private animationFrameId: number | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private currentSessionId: number | undefined;
  private audioPlayedCount = 0; // Track number of audio playback events in this session

  connectedCallback() {
    super.connectedCallback();

    // Set initial loading state
    this.isLoading = true;

    // Create flow session for tracking
    window.electronAPI.database
      .getCurrentLanguage()
      .then(async (language) => {
        try {
          this.currentLanguage = language;
          this.currentSessionId = await window.electronAPI.tracking.createSession('flow', language);
        } catch (error) {
          logger.warn({ error, language }, 'Failed to create flow session');
        }
      })
      .catch((err) => {
        logger.warn({ error: err }, 'Failed to get current language for flow session');
      });

    this.loadFlowSentences();

    // Set up direct keyboard listener for flow mode (handles space key when overlay is visible)
    this.directKeyHandler = this.handleDirectKeyDown.bind(this);
    document.addEventListener('keydown', this.directKeyHandler, true);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    // Update session if it exists
    if (this.currentSessionId) {
      void this.updateSessionOnCompletion();
    }

    if (this.directKeyHandler) {
      document.removeEventListener('keydown', this.directKeyHandler, true);
    }
    // Ensure keyboard manager is re-enabled when component is destroyed
    keyboardManager.setEnabled(true);
    this.stopAudio();
  }

  private async updateSessionOnCompletion() {
    if (!this.currentSessionId) return;

    try {
      // Calculate how many sentences were actually played based on pause timestamps
      let sentencesPlayed = 0;

      if (this.pauseEndTimestamps && this.pauseEndTimestamps.length > 0) {
        // Get current playback position (either current time if playing, or paused position if paused)
        const currentPosition = this.audioElement?.currentTime ?? this.pausedPosition;

        // Count how many pause end timestamps (sentence boundaries) we've passed
        // Each pause end timestamp represents the end of a sentence
        sentencesPlayed = this.pauseEndTimestamps.filter(
          (timestamp) => timestamp <= currentPosition
        ).length;
      } else {
        // Fallback: if no pause timestamps available, use total sentences if audio was played
        // This is less accurate but better than 0
        if (this.audioElement && (this.audioElement.currentTime > 0 || this.pausedPosition > 0)) {
          sentencesPlayed = this.flowSentences.length;
        }
      }

      await window.electronAPI.tracking.updateSession(this.currentSessionId, {
        wordCount: 0, // Flow mode doesn't track individual words
        sentenceCount: sentencesPlayed,
        audioPlayedCount: this.audioPlayedCount,
      });
    } catch (error) {
      logger.warn({ error }, 'Failed to update session on completion');
    }
  }

  private async loadFlowSentences() {
    try {
      this.isLoading = true;
      this.error = null;

      // Get current language for per-language caching
      try {
        this.currentLanguage = await window.electronAPI.database.getCurrentLanguage();
      } catch (error) {
        logger.warn({ error }, '[Flow] Failed to get current language');
        this.currentLanguage = null;
      }

      // Check cache first before loading sentences
      let needsStitching = true;
      let needsEnglishStitching = true;
      // Ensure we have a valid language before constructing the path
      if (!this.currentLanguage) {
        logger.warn('[Flow] No current language available, cannot use cache');
        needsStitching = true;
        needsEnglishStitching = true;
      } else {
        const languageSuffix = `_${this.currentLanguage}`;
        const defaultAudioPath = `audio/flow_stitched${languageSuffix}.mp3`;
        const defaultEnglishAudioPath = `audio/flow_stitched_english_${this.currentLanguage}.mp3`;

        // Check if cached files exist and are recent (within 2 hours)
        const stats = await window.electronAPI.flow.getFileStats(defaultAudioPath);
        const englishStats = await window.electronAPI.flow.getFileStats(defaultEnglishAudioPath);

        const twoHours = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

        if (stats) {
          const fileAge = Date.now() - stats.mtime.getTime();
          if (fileAge < twoHours) {
            this.stitchedAudioPath = defaultAudioPath;
            needsStitching = false;
          }
        } else {
          this.stitchedAudioPath = null;
        }

        if (englishStats) {
          const fileAge = Date.now() - englishStats.mtime.getTime();
          if (fileAge < twoHours) {
            this.stitchedAudioPathWithEnglish = defaultEnglishAudioPath;
            needsEnglishStitching = false;
          }
        } else {
          this.stitchedAudioPathWithEnglish = null;
        }
      }

      // Only load sentences and stitch if cache is not valid
      if (needsStitching || needsEnglishStitching) {
        const language = await window.electronAPI.database.getCurrentLanguage();
        const sentences = await window.electronAPI.flow.getFlowSentences(language);
        this.flowSentences = sentences;

        // Collect all audio paths for regular stitching (limited to 200)
        const audioPaths: string[] = [];
        // Collect audio path pairs for English stitching
        const audioPathPairs: Array<[string, string]> = [];

        for (const item of this.flowSentences) {
          if (item.beforeSentenceAudio) {
            audioPaths.push(item.beforeSentenceAudio);
          }
          if (item.audioPath) {
            audioPaths.push(item.audioPath);

            // For English stitching, use the provided English audio path if available
            if (item.englishAudioPath) {
              audioPathPairs.push([item.englishAudioPath, item.audioPath]);
            }
          }
          if (item.afterSentenceAudio) {
            audioPaths.push(item.afterSentenceAudio);
          }
          audioPaths.push(...item.continuationAudios);

          // Stop collecting at 200 files
          if (audioPaths.length >= 200) {
            break;
          }
        }

        // Limit to 200 files
        if (audioPaths.length > 200) {
          audioPaths.splice(200);
        }
        if (audioPathPairs.length > 200) {
          audioPathPairs.splice(200);
        }

        if (audioPaths.length === 0 && audioPathPairs.length === 0) {
          this.error = 'No audio files found. Please generate some sentences with audio first.';
          return;
        }

        // Stitch audio files with language for per-language caching
        this.isStitching = true;
        try {
          // Language is required for stitching
          if (!this.currentLanguage) {
            throw new Error('Current language is required for flow mode audio stitching');
          }

          // Stitch regular audio file
          if (needsStitching && audioPaths.length > 0) {
            this.stitchedAudioPath = await window.electronAPI.flow.stitchAudio(
              audioPaths,
              this.currentLanguage
            );
            if (!this.stitchedAudioPath) {
              this.error = 'Failed to stitch audio files. Please ensure ffmpeg is installed.';
            }
          }

          // Stitch English audio file
          if (needsEnglishStitching && audioPathPairs.length > 0) {
            this.stitchedAudioPathWithEnglish =
              await window.electronAPI.flow.stitchAudioWithEnglish(
                audioPathPairs,
                this.currentLanguage
              );
            if (!this.stitchedAudioPathWithEnglish) {
              logger.warn(
                '[Flow] Failed to stitch audio files with English pattern. Will use regular audio only.'
              );
            }
          }
        } catch (err) {
          logger.error({ error: err }, 'Error stitching audio');
          this.error = `Failed to stitch audio: ${getErrorMessage(err)}`;
        } finally {
          this.isStitching = false;
        }
      } else {
        // If using cache, still load sentences for display purposes (but don't wait for it)
        window.electronAPI.database
          .getCurrentLanguage()
          .then((language) => {
            return window.electronAPI.flow.getFlowSentences(language);
          })
          .then((sentences) => {
            this.flowSentences = sentences;
            this.requestUpdate();
          })
          .catch((err) => {
            logger.warn({ error: err }, 'Failed to load flow sentences for display');
          });
      }
    } catch (err) {
      logger.error({ error: err }, 'Error loading flow sentences');
      this.error = `Failed to load flow sentences: ${getErrorMessage(err)}`;
    } finally {
      this.isLoading = false;
    }
  }

  // Public method that can be called from app-root to start playing
  async handlePlay() {
    // Show overlay immediately, even if stitching is in progress
    this.showOverlay = true;

    if (this.isPlaying) {
      this.pauseAudio();
      return;
    }

    // If stitching is in progress, wait for it to complete
    if (this.isStitching) {
      // Wait for stitching to complete
      const checkInterval = setInterval(() => {
        if (!this.isStitching && this.stitchedAudioPath) {
          clearInterval(checkInterval);
          this.playAudio();
        }
      }, 100);
      return;
    }

    if (!this.stitchedAudioPath && !this.stitchedAudioPathWithEnglish) {
      // If no audio path yet, start loading/stitching
      this.loadFlowSentences().then(() => {
        if (this.stitchedAudioPath || this.stitchedAudioPathWithEnglish) {
          this.playAudio();
        }
      });
      return;
    }

    await this.playAudio();
  }

  private async playAudio() {
    // Randomly select between regular and English audio files
    const availablePaths: string[] = [];
    if (this.stitchedAudioPath) {
      availablePaths.push(this.stitchedAudioPath);
    }
    if (this.stitchedAudioPathWithEnglish) {
      availablePaths.push(this.stitchedAudioPathWithEnglish);
    }

    if (availablePaths.length === 0) {
      return;
    }

    // Randomly select one of the available paths
    const selectedPath = availablePaths[Math.floor(Math.random() * availablePaths.length)];

    if (!selectedPath) {
      return;
    }

    try {
      // If audio element exists and was paused, resume from previous pause or fall back to 0.5s
      if (this.audioElement && !this.isPlaying) {
        let resumePosition: number;
        if (this.previousPauseTimestamp !== null) {
          // Use previous pause timestamp if available
          resumePosition = this.previousPauseTimestamp;
        } else {
          // Fall back to current logic: pause position minus 0.5s (but not negative)
          resumePosition = Math.max(0, this.pausedPosition - 0.5);
        }
        this.audioElement.currentTime = resumePosition;

        // Show overlay first so canvas is in DOM
        this.showOverlay = true;
        this.isPlaying = true;

        // Wait for DOM to update so canvas is accessible
        await this.updateComplete;

        // Re-acquire canvas reference since overlay was hidden
        this.canvasElement = this.shadowRoot?.querySelector(
          '.visualization-canvas'
        ) as HTMLCanvasElement;
        if (this.canvasElement) {
          // Set canvas size
          this.canvasElement.width = 300;
          this.canvasElement.height = 300;
        }

        // Re-setup visualization if needed (audio context might be closed)
        if (!this.audioContext || this.audioContext.state === 'closed') {
          this.setupAudioVisualization();
        }
        if (this.audioContext && this.audioContext.state === 'suspended') {
          await this.audioContext.resume();
        }

        await this.audioElement.play();

        // Wait another frame to ensure everything is ready
        await this.updateComplete;
        requestAnimationFrame(() => {
          // Restart visualization
          this.startVisualization();
        });

        this.lastPauseTime = null;
        return;
      }

      // Stop any existing audio (if playing or stopped)
      if (this.audioElement) {
        this.stopAudio();
      }

      // Load audio file (this also loads pause timestamps if available)
      const audioData = await window.electronAPI.audio.loadAudioBase64(selectedPath);
      if (!audioData) {
        throw new Error('Failed to load audio file');
      }

      // Store pause timestamps and current audio path
      this.pauseEndTimestamps = audioData.pauseEndTimestamps ?? null;
      this.currentAudioPath = selectedPath;
      logger.debug(
        `[Flow] Pause timestamps ${this.pauseEndTimestamps ? `loaded (${this.pauseEndTimestamps.length} pauses)` : 'not available'}`
      );

      // Create blob URL
      const blob = new Blob([audioData.data], { type: audioData.mimeType });
      const blobUrl = URL.createObjectURL(blob);

      // Create audio element
      this.audioElement = new Audio(blobUrl);

      // Set current time to previous pause or paused position if we have one (resume from pause)
      if (this.previousPauseTimestamp !== null) {
        // Use previous pause timestamp if available
        this.audioElement.currentTime = this.previousPauseTimestamp;
      } else if (this.pausedPosition > 0) {
        // Fall back to paused position
        this.audioElement.currentTime = this.pausedPosition;
      }

      // Set up Web Audio API for visualization
      this.setupAudioVisualization();

      // Set up event handlers
      this.audioElement.addEventListener('ended', () => {
        this.stopAudio();
      });

      this.audioElement.addEventListener('error', (e) => {
        logger.error({ error: e }, 'Error playing audio');
        this.stopAudio();
        this.error = 'Failed to play audio';
      });

      // Set up timeupdate handler to track playback duration
      this.audioElement.addEventListener('timeupdate', () => {
        if (this.audioElement && this.isPlaying) {
          // Calculate current playback time for autopilot tracking
          // currentTime is the absolute position in the audio file
          // Use it directly for tracking (it already accounts for resume position)
          const currentPlaybackTime = this.audioElement.currentTime;

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

      // Wait a frame for DOM to update and canvas to be rendered
      await this.updateComplete;
      requestAnimationFrame(() => {
        // Start animation loop for visualization
        this.startVisualization();
      });

      // When starting/resuming playback, the audio element will continue from its current position
      // We track totalPlaybackTime separately to handle pauses correctly
      this.lastPauseTime = null;
      this.playbackStartTime = Date.now();
      this.playbackTimer = null; // Reset timer trigger flag
    } catch (err) {
      logger.error({ error: err }, 'Error playing audio');
      this.error = `Failed to play audio: ${getErrorMessage(err)}`;
      this.stopAudio();
    }
  }

  private pauseAudio() {
    if (this.audioElement && this.isPlaying) {
      // Store the current position for resuming later
      this.pausedPosition = this.audioElement.currentTime;

      // Find previous pause timestamp if pause timestamps are available
      this.previousPauseTimestamp = null;
      if (this.pauseEndTimestamps && this.pauseEndTimestamps.length > 0) {
        // Find the last pause end timestamp that is <= current position
        for (let i = this.pauseEndTimestamps.length - 1; i >= 0; i--) {
          if (this.pauseEndTimestamps[i] <= this.pausedPosition) {
            this.previousPauseTimestamp = this.pauseEndTimestamps[i];
            break;
          }
        }
      }

      this.audioElement.pause();
      this.isPlaying = false;
      this.showOverlay = false;

      // Stop visualization
      this.stopVisualization();

      // Keep currentTime as-is (don't reset to 0) so we can resume from this position
      this.lastPauseTime = Date.now();
    }
  }

  private stopAudio() {
    // Stop visualization
    this.stopVisualization();

    // Close audio context if it exists
    if (this.audioContext) {
      this.audioContext.close().catch((err) => {
        logger.warn({ error: err }, 'Error closing audio context');
      });
      this.audioContext = null;
    }

    this.analyser = null;
    this.dataArray = null;

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
    this.pausedPosition = 0; // Reset pause position when stopping
    this.pauseEndTimestamps = null; // Reset pause timestamps when stopping
    this.currentAudioPath = null; // Reset current audio path when stopping
    this.previousPauseTimestamp = null; // Reset previous pause timestamp when stopping
  }

  private handleDirectKeyDown(event: KeyboardEvent): void {
    // Only handle when overlay is visible
    if (!this.showOverlay) return;

    // Don't handle keys when user is typing in input fields
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    // Handle space key for pause/resume
    if (event.key === CommonKeys.SPACE) {
      event.preventDefault();
      event.stopPropagation();
      if (this.isPlaying) {
        this.pauseAudio();
      } else if (this.stitchedAudioPath || this.stitchedAudioPathWithEnglish) {
        this.playAudio();
      }
      return;
    }

    // Block all other keys when overlay is visible
    event.preventDefault();
    event.stopPropagation();
  }

  // Watch for showOverlay changes to toggle keyboard manager
  willUpdate(changedProperties: Map<string | symbol, unknown>): void {
    super.willUpdate(changedProperties);

    if (changedProperties.has('showOverlay')) {
      // Disable keyboard manager when overlay becomes visible
      // Re-enable when overlay becomes hidden
      keyboardManager.setEnabled(!this.showOverlay);
    }
  }

  private setupAudioVisualization() {
    if (!this.audioElement) {
      logger.warn('[Flow] No audio element available for visualization');
      return;
    }

    try {
      // Create audio context (resume if suspended)
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

      // Resume context if suspended (required for some browsers)
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch((err) => {
          logger.warn({ error: err }, '[Flow] Failed to resume audio context');
        });
      }

      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;

      const bufferLength = this.analyser.frequencyBinCount;
      // Create Uint8Array with explicit buffer to satisfy TypeScript
      const buffer = new ArrayBuffer(bufferLength);
      this.dataArray = new Uint8Array(buffer);

      // Connect audio element to analyser
      // Note: createMediaElementSource disconnects the audio element from its default output
      const source = this.audioContext.createMediaElementSource(this.audioElement);
      source.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);

      logger.debug('[Flow] Audio visualization setup complete');
    } catch (err) {
      logger.error({ error: err }, '[Flow] Failed to set up audio visualization');
      // Non-critical - visualization will just not work
    }
  }

  private startVisualization() {
    // Get canvas reference - it might not exist until overlay is shown
    if (!this.canvasElement) {
      this.canvasElement = this.shadowRoot?.querySelector(
        '.visualization-canvas'
      ) as HTMLCanvasElement;
      if (this.canvasElement) {
        // Set canvas size
        this.canvasElement.width = 300;
        this.canvasElement.height = 300;
      }
    }

    if (!this.canvasElement || !this.analyser || !this.dataArray || !this.isPlaying) {
      console.log('[Flow] Visualization not ready:', {
        canvas: !!this.canvasElement,
        analyser: !!this.analyser,
        dataArray: !!this.dataArray,
        isPlaying: this.isPlaying,
      });
      return;
    }

    const canvas = this.canvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const baseRadius = 80; // Base radius of the circle (reduced to stay within canvas)
    const maxRadiusChange = 40; // Maximum change in radius based on amplitude

    const animate = () => {
      if (!this.isPlaying || !this.analyser || !this.dataArray) {
        return;
      }

      // Get audio data - use frequency data for more reactive visualization
      if (!this.dataArray) return;

      // Use type assertion to satisfy TypeScript - the API accepts Uint8Array
      // Use getByteFrequencyData for more noticeable visual response
      this.analyser.getByteFrequencyData(this.dataArray as any);

      // Calculate average amplitude from frequency data
      let sum = 0;
      for (let i = 0; i < this.dataArray.length; i++) {
        sum += this.dataArray[i];
      }
      const average = sum / this.dataArray.length;
      const normalizedAmplitude = average / 255; // Normalize to 0-1 (frequency data is 0-255)

      // Calculate radius based on amplitude (with more dramatic effect)
      // Apply exponential scaling for more pronounced wobble
      const amplifiedAmplitude = Math.pow(normalizedAmplitude, 0.7); // Make it more sensitive to changes
      const radiusChange = amplifiedAmplitude * maxRadiusChange * 2.0; // Increased multiplier for more wobble
      const currentRadius = baseRadius + radiusChange;

      // Calculate opacity pulse (more noticeable)
      const opacity = 0.5 + normalizedAmplitude * 0.4; // Range: 0.5 to 0.9

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw wobbling circle
      ctx.beginPath();
      ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(150, 150, 150, ${opacity})`; // Grey color
      ctx.lineWidth = 3;
      ctx.stroke();

      // Continue animation
      this.animationFrameId = requestAnimationFrame(animate);
    };

    this.animationFrameId = requestAnimationFrame(animate);
  }

  private stopVisualization() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.canvasElement) {
      const ctx = this.canvasElement.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
      }
      // Don't clear canvasElement reference - we'll re-acquire it when needed
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

      .overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 1);
        z-index: 10000;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.4s ease-in-out;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .overlay.visible {
        opacity: 1;
        pointer-events: auto;
      }

      .visualization-container {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }

      .visualization-canvas {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
      }

      .pause-icon {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 48px;
        color: rgba(150, 150, 150, 0.9);
        z-index: 1;
        pointer-events: none;
        user-select: none;
        transition:
          opacity 0.2s,
          transform 0.2s,
          font-size 0.2s;
        opacity: 0.8;
      }

      .visualization-container:hover .pause-icon {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1.3);
        font-size: 62px;
      }
    `,
  ];

  firstUpdated(changedProperties: Map<string | number | symbol, unknown>) {
    super.firstUpdated(changedProperties);
    // Get canvas reference after first render
    this.canvasElement = this.shadowRoot?.querySelector(
      '.visualization-canvas'
    ) as HTMLCanvasElement;
    if (this.canvasElement) {
      // Set canvas size
      this.canvasElement.width = 300;
      this.canvasElement.height = 300;
    }
  }

  render() {
    return html`
      <div class="overlay ${this.showOverlay ? 'visible' : ''}">
        ${this.showOverlay
          ? html`
              <div class="visualization-container" @click=${this.pauseAudio} title="Pause">
                <canvas class="visualization-canvas"></canvas>
                <div class="pause-icon">⏸</div>
              </div>
            `
          : ''}
      </div>
    `;
  }
}
