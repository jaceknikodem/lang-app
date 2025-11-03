/**
 * Flow mode component for playing long stitched audio from all sentences
 */

import { LitElement, html, css } from 'lit';
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

  @state()
  private currentLanguage: string | null = null;

  private keyboardUnsubscribe?: () => void;
  private audioElement: HTMLAudioElement | null = null;
  private playbackTimer: number | null = null;
  private playbackStartTime: number | 0 = 0;
  private totalPlaybackTime: number = 0; // Cumulative playback time in seconds
  private lastPauseTime: number | null = null;
  private pausedPosition: number = 0; // Position where audio was paused (in seconds)
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;
  private animationFrameId: number | null = null;
  private canvasElement: HTMLCanvasElement | null = null;

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

      // Get current language for per-language caching
      try {
        this.currentLanguage = await window.electronAPI.database.getCurrentLanguage();
      } catch (error) {
        console.warn('[Flow] Failed to get current language:', error);
        this.currentLanguage = null;
      }

      // Check cache first before loading sentences
      let needsStitching = true;
      const languageSuffix = this.currentLanguage ? `_${this.currentLanguage}` : '';
      const defaultAudioPath = `audio/flow_stitched${languageSuffix}.mp3`;
      
      // Check if cached file exists and is recent (within 2 hours)
      // Always check the current language-specific path, not a previously cached path
      const pathToCheck = defaultAudioPath;
      const stats = await window.electronAPI.flow.getFileStats(pathToCheck);
      if (stats) {
        const fileAge = Date.now() - stats.mtime.getTime();
        const twoHours = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
        if (fileAge < twoHours) {
          this.stitchedAudioPath = pathToCheck;
          needsStitching = false;
        }
      } else {
        // If the language-specific cache doesn't exist, clear any previous path
        this.stitchedAudioPath = null;
      }

      // Only load sentences and stitch if cache is not valid
      if (needsStitching) {
        const sentences = await window.electronAPI.flow.getFlowSentences();
        this.flowSentences = sentences;

        // Collect all audio paths (limited to 200)
        const audioPaths: string[] = [];
        for (const item of this.flowSentences) {
          if (item.beforeSentenceAudio) {
            audioPaths.push(item.beforeSentenceAudio);
          }
          if (item.sentence.audioPath) {
            audioPaths.push(item.sentence.audioPath);
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

        if (audioPaths.length === 0) {
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
          this.stitchedAudioPath = await window.electronAPI.flow.stitchAudio(audioPaths, this.currentLanguage);
          if (!this.stitchedAudioPath) {
            this.error = 'Failed to stitch audio files. Please ensure ffmpeg is installed.';
          }
        } catch (err) {
          console.error('Error stitching audio:', err);
          this.error = `Failed to stitch audio: ${err instanceof Error ? err.message : 'Unknown error'}`;
        } finally {
          this.isStitching = false;
        }
      } else {
        // If using cache, still load sentences for display purposes (but don't wait for it)
        window.electronAPI.flow.getFlowSentences().then(sentences => {
          this.flowSentences = sentences;
          this.requestUpdate();
        }).catch(err => {
          console.warn('Failed to load flow sentences for display:', err);
        });
      }
    } catch (err) {
      console.error('Error loading flow sentences:', err);
      this.error = `Failed to load flow sentences: ${err instanceof Error ? err.message : 'Unknown error'}`;
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

    if (!this.stitchedAudioPath) {
      // If no audio path yet, start loading/stitching
      this.loadFlowSentences().then(() => {
        if (this.stitchedAudioPath) {
          this.playAudio();
        }
      });
      return;
    }

    await this.playAudio();
  }

  private async playAudio() {
    if (!this.stitchedAudioPath) {
      return;
    }

    try {
      // If audio element exists and was paused, resume from pause position minus 0.5s (but not negative)
      if (this.audioElement && !this.isPlaying) {
        const resumePosition = Math.max(0, this.pausedPosition - 0.5);
        this.audioElement.currentTime = resumePosition;
        
        // Show overlay first so canvas is in DOM
        this.showOverlay = true;
        this.isPlaying = true;
        
        // Wait for DOM to update so canvas is accessible
        await this.updateComplete;
        
        // Re-acquire canvas reference since overlay was hidden
        this.canvasElement = this.shadowRoot?.querySelector('.visualization-canvas') as HTMLCanvasElement;
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
      
      // Set current time to paused position if we have one (resume from pause)
      if (this.pausedPosition > 0) {
        this.audioElement.currentTime = this.pausedPosition;
      }

      // Set up Web Audio API for visualization
      this.setupAudioVisualization();
      
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
      console.error('Error playing audio:', err);
      this.error = `Failed to play audio: ${err instanceof Error ? err.message : 'Unknown error'}`;
      this.stopAudio();
    }
  }

  private pauseAudio() {
    if (this.audioElement && this.isPlaying) {
      // Store the current position for resuming later
      this.pausedPosition = this.audioElement.currentTime;
      
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
      this.audioContext.close().catch(err => {
        console.warn('Error closing audio context:', err);
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
  }

  private handleSpaceKey() {
    if (this.showOverlay && this.isPlaying) {
      this.pauseAudio();
    }
  }

  private setupAudioVisualization() {
    if (!this.audioElement) {
      console.warn('[Flow] No audio element available for visualization');
      return;
    }
    
    try {
      // Create audio context (resume if suspended)
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Resume context if suspended (required for some browsers)
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(err => {
          console.warn('[Flow] Failed to resume audio context:', err);
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
      
      console.log('[Flow] Audio visualization setup complete');
    } catch (err) {
      console.error('[Flow] Failed to set up audio visualization:', err);
      // Non-critical - visualization will just not work
    }
  }

  private startVisualization() {
    // Get canvas reference - it might not exist until overlay is shown
    if (!this.canvasElement) {
      this.canvasElement = this.shadowRoot?.querySelector('.visualization-canvas') as HTMLCanvasElement;
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
        isPlaying: this.isPlaying
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
      const opacity = 0.5 + (normalizedAmplitude * 0.4); // Range: 0.5 to 0.9
      
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
        transition: opacity 0.2s, transform 0.2s, font-size 0.2s;
        opacity: 0.8;
      }

      .visualization-container:hover .pause-icon {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1.3);
        font-size: 62px;
      }
    `
  ];

  firstUpdated(changedProperties: Map<string | number | symbol, unknown>) {
    super.firstUpdated(changedProperties);
    // Get canvas reference after first render
    this.canvasElement = this.shadowRoot?.querySelector('.visualization-canvas') as HTMLCanvasElement;
    if (this.canvasElement) {
      // Set canvas size
      this.canvasElement.width = 300;
      this.canvasElement.height = 300;
    }
  }

  render() {
    return html`
      <div class="overlay ${this.showOverlay ? 'visible' : ''}">
        ${this.showOverlay ? html`
          <div class="visualization-container" @click=${this.pauseAudio} title="Pause">
            <canvas class="visualization-canvas"></canvas>
            <div class="pause-icon">⏸</div>
          </div>
        ` : ''}
      </div>
    `;
  }
}

