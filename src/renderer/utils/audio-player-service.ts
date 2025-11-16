/**
 * Centralized audio player service for renderer process
 * Provides unified API for playing audio with caching, pause/resume, and sequential playback
 */

import { logger } from './logger.js';

export interface AudioPlayOptions {
  playbackSpeed?: number;
  onEnded?: () => void;
  onError?: (error: Error) => void;
  onTimeUpdate?: (currentTime: number) => void;
}

export interface AudioState {
  isPlaying: boolean;
  isPaused: boolean;
  currentAudioPath: string | null;
  currentTime: number;
  duration: number;
  playbackSpeed: number;
}

export class AudioPlayerService {
  private static instance: AudioPlayerService | null = null;

  private audioElement: HTMLAudioElement | null = null;
  private audioCache: Map<string, string> = new Map(); // audioPath -> blob URL
  private blobUrlCache: Map<string, string> = new Map(); // For cleanup
  private currentAudioPath: string | null = null;
  private pausedPosition: number = 0;
  private playbackSpeed: number = 1.0;
  private playbackQueue: string[] = [];
  private isProcessingQueue: boolean = false;

  // Event handlers
  private onEndedCallbacks: Map<string, (() => void)[]> = new Map();
  private onErrorCallbacks: Map<string, ((error: Error) => void)[]> = new Map();
  private onTimeUpdateCallbacks: Map<string, ((currentTime: number) => void)[]> = new Map();

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): AudioPlayerService {
    if (!AudioPlayerService.instance) {
      AudioPlayerService.instance = new AudioPlayerService();
    }
    return AudioPlayerService.instance;
  }

  /**
   * Play audio immediately (stops any currently playing audio)
   */
  async play(audioPath: string, options: AudioPlayOptions = {}): Promise<void> {
    if (!audioPath) {
      throw new Error('Audio path is required');
    }

    // Stop current playback
    this.stop();

    // Set playback speed
    if (options.playbackSpeed !== undefined) {
      this.playbackSpeed = options.playbackSpeed;
    }

    // Store callbacks
    if (options.onEnded) {
      if (!this.onEndedCallbacks.has(audioPath)) {
        this.onEndedCallbacks.set(audioPath, []);
      }
      this.onEndedCallbacks.get(audioPath)!.push(options.onEnded);
    }

    if (options.onError) {
      if (!this.onErrorCallbacks.has(audioPath)) {
        this.onErrorCallbacks.set(audioPath, []);
      }
      this.onErrorCallbacks.get(audioPath)!.push(options.onError);
    }

    if (options.onTimeUpdate) {
      if (!this.onTimeUpdateCallbacks.has(audioPath)) {
        this.onTimeUpdateCallbacks.set(audioPath, []);
      }
      this.onTimeUpdateCallbacks.get(audioPath)!.push(options.onTimeUpdate);
    }

    this.currentAudioPath = audioPath;

    try {
      // Get or load audio
      const blobUrl = await this.getOrLoadAudio(audioPath);

      // Create audio element
      this.audioElement = new Audio(blobUrl);
      this.audioElement.playbackRate = this.playbackSpeed;

      // Set up event handlers
      this.setupEventHandlers(audioPath);

      // Play
      await this.audioElement.play();
    } catch (error) {
      this.currentAudioPath = null;
      this.audioElement = null;
      const err = error instanceof Error ? error : new Error(String(error));

      // Call error callbacks
      const errorCallbacks = this.onErrorCallbacks.get(audioPath) || [];
      errorCallbacks.forEach((cb) => cb(err));

      throw err;
    }
  }

  /**
   * Play multiple audio files sequentially
   */
  async playSequence(audioPaths: string[], options: AudioPlayOptions = {}): Promise<void> {
    if (audioPaths.length === 0) return;

    // If only one, just play it
    if (audioPaths.length === 1) {
      return this.play(audioPaths[0], options);
    }

    // Play first, then queue the rest
    const firstPath = audioPaths[0];
    const restPaths = audioPaths.slice(1);

    // Set up queue
    this.playbackQueue = restPaths;
    this.isProcessingQueue = true;

    // Play first with onEnded callback to continue queue
    await this.play(firstPath, {
      ...options,
      onEnded: () => {
        if (options.onEnded) {
          options.onEnded();
        }
        // Call processQueue but handle errors since it's async and called from callback
        this.processQueue(options).catch((error) => {
          // If processQueue fails, call onError if provided
          if (options.onError) {
            const err = error instanceof Error ? error : new Error(String(error));
            options.onError(err);
          }
        });
      },
    });
  }

  /**
   * Process playback queue
   */
  private async processQueue(options: AudioPlayOptions): Promise<void> {
    if (this.playbackQueue.length === 0) {
      this.isProcessingQueue = false;
      return;
    }

    const nextPath = this.playbackQueue.shift()!;

    try {
      await this.play(nextPath, {
        ...options,
        onEnded: () => {
          if (options.onEnded) {
            options.onEnded();
          }
          // Wrap processQueue call in error handling to prevent hanging
          this.processQueue(options).catch((error) => {
            // Clear queue state on error
            this.playbackQueue = [];
            this.isProcessingQueue = false;

            // Call onError callback if provided
            if (options.onError) {
              const err = error instanceof Error ? error : new Error(String(error));
              options.onError(err);
            }
          });
        },
      });
    } catch (error) {
      // Clear queue state on error
      this.playbackQueue = [];
      this.isProcessingQueue = false;

      // Call onError callback if provided
      if (options.onError) {
        const err = error instanceof Error ? error : new Error(String(error));
        options.onError(err);
      }

      // Re-throw to allow caller to handle if needed
      throw error;
    }
  }

  /**
   * Stop audio playback
   */
  stop(): void {
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.currentTime = 0;
      this.audioElement = null;
    }

    this.currentAudioPath = null;
    this.pausedPosition = 0;

    // Always clear queue when stopping (user-initiated stops should clear everything)
    this.playbackQueue = [];
    this.isProcessingQueue = false;

    // Clear callbacks
    this.onEndedCallbacks.clear();
    this.onErrorCallbacks.clear();
    this.onTimeUpdateCallbacks.clear();
  }

  /**
   * Pause audio playback (remembers position)
   */
  pause(): void {
    if (this.audioElement && this.currentAudioPath) {
      this.pausedPosition = this.audioElement.currentTime;
      this.audioElement.pause();
    }
  }

  /**
   * Resume audio playback from paused position
   */
  async resume(): Promise<void> {
    if (!this.currentAudioPath) {
      throw new Error('No audio to resume');
    }

    if (this.audioElement) {
      // Already loaded, just resume
      this.audioElement.currentTime = this.pausedPosition;
      await this.audioElement.play();
    } else {
      // Need to reload and resume from position
      const audioPath = this.currentAudioPath;
      const position = this.pausedPosition;

      await this.play(audioPath, {
        playbackSpeed: this.playbackSpeed,
        onTimeUpdate: () => {
          if (this.audioElement && position > 0) {
            this.audioElement.currentTime = position;
            this.pausedPosition = 0; // Reset after setting
          }
        },
      });
    }
  }

  /**
   * Set playback speed
   */
  setPlaybackSpeed(speed: number): void {
    this.playbackSpeed = speed;
    if (this.audioElement) {
      this.audioElement.playbackRate = speed;
    }
  }

  /**
   * Get current audio state
   */
  getState(): AudioState {
    return {
      isPlaying: this.audioElement !== null && !this.audioElement.paused,
      isPaused: this.audioElement !== null && this.audioElement.paused,
      currentAudioPath: this.currentAudioPath,
      currentTime: this.audioElement?.currentTime ?? this.pausedPosition,
      duration: this.audioElement?.duration ?? 0,
      playbackSpeed: this.playbackSpeed,
    };
  }

  /**
   * Preload audio into cache
   */
  async preload(audioPath: string): Promise<void> {
    if (this.audioCache.has(audioPath)) {
      return; // Already cached
    }

    await this.loadAudioIntoCache(audioPath);
  }

  /**
   * Preload multiple audio files
   */
  async preloadMultiple(audioPaths: string[]): Promise<void> {
    const uncached = audioPaths.filter((path) => !this.audioCache.has(path));
    await Promise.all(
      uncached.map((path) =>
        this.loadAudioIntoCache(path).catch((err) => {
          logger.warn({ error: err, audioPath: path }, 'Failed to preload audio');
        })
      )
    );
  }

  /**
   * Clear audio cache
   */
  clearCache(): void {
    // Revoke blob URLs to free memory
    this.blobUrlCache.forEach((url) => URL.revokeObjectURL(url));
    this.audioCache.clear();
    this.blobUrlCache.clear();
  }

  /**
   * Get or load audio (returns blob URL)
   */
  private async getOrLoadAudio(audioPath: string): Promise<string> {
    if (this.audioCache.has(audioPath)) {
      return this.audioCache.get(audioPath)!;
    }

    await this.loadAudioIntoCache(audioPath);
    return this.audioCache.get(audioPath)!;
  }

  /**
   * Load audio into cache
   */
  private async loadAudioIntoCache(audioPath: string): Promise<void> {
    if (this.audioCache.has(audioPath)) {
      return;
    }

    try {
      const result = await window.electronAPI.audio.loadAudioBase64(audioPath);
      if (result && result.data) {
        const blob = new Blob([result.data], { type: result.mimeType });
        const blobUrl = URL.createObjectURL(blob);
        this.audioCache.set(audioPath, blobUrl);
        this.blobUrlCache.set(audioPath, blobUrl);
      }
    } catch (error) {
      logger.warn({ error, audioPath }, 'Failed to load audio into cache');
      throw error;
    }
  }

  /**
   * Set up event handlers for audio element
   */
  private setupEventHandlers(audioPath: string): void {
    if (!this.audioElement) return;

    this.audioElement.addEventListener('ended', () => {
      const callbacks = this.onEndedCallbacks.get(audioPath) || [];
      callbacks.forEach((cb) => cb());

      // Clean up
      this.onEndedCallbacks.delete(audioPath);
      this.onErrorCallbacks.delete(audioPath);
      this.onTimeUpdateCallbacks.delete(audioPath);

      // If not processing queue, clear current audio
      if (!this.isProcessingQueue) {
        this.currentAudioPath = null;
        this.audioElement = null;
      }
    });

    this.audioElement.addEventListener('error', (_e) => {
      const error = new Error('Audio playback error');
      const callbacks = this.onErrorCallbacks.get(audioPath) || [];
      callbacks.forEach((cb) => cb(error));

      // Clean up
      this.onEndedCallbacks.delete(audioPath);
      this.onErrorCallbacks.delete(audioPath);
      this.onTimeUpdateCallbacks.delete(audioPath);

      this.currentAudioPath = null;
      this.audioElement = null;
    });

    this.audioElement.addEventListener('timeupdate', () => {
      if (this.audioElement) {
        const callbacks = this.onTimeUpdateCallbacks.get(audioPath) || [];
        callbacks.forEach((cb) => cb(this.audioElement!.currentTime));
      }
    });
  }
}

// Export singleton instance getter
export const audioPlayer = AudioPlayerService.getInstance();
