import { existsSync } from 'fs';
import { AudioGenerator } from '../../shared/types/audio';
import { createAudioError } from '../../shared/utils/error.js';
import { getLogger } from '../utils/logger.js';
import { Logger } from '../../shared/utils/logger.js';

/**
 * Base class for audio generators with shared playback functionality
 * Provides common implementation for playAudio and stopAudio methods
 */
export abstract class BaseAudioGenerator implements AudioGenerator {
  protected currentAudioProcess?: any; // Track current audio process
  protected currentPlayPromise?: { resolve: () => void; reject: (error: any) => void }; // Store promise callbacks for playback completion
  protected readonly logger: Logger;

  constructor() {
    this.logger = getLogger();
  }

  /**
   * Play audio file using system command
   * Returns a promise that resolves when audio playback completes
   */
  async playAudio(audioPath: string): Promise<void> {
    if (!await this.audioExists(audioPath)) {
      throw createAudioError(`Audio file not found: ${audioPath}`, 'FILE_NOT_FOUND', { audioPath });
    }

    // Stop any currently playing audio first
    this.stopAudio();

    // Use 'afplay' command on macOS to play audio files
    const { spawn } = await import('child_process');
    this.currentAudioProcess = spawn('afplay', [audioPath]);
    
    // Return a promise that resolves when the audio finishes playing
    return new Promise<void>((resolve, reject) => {
      if (!this.currentAudioProcess) {
        reject(createAudioError('Audio process not created', 'PLAYBACK_FAILED', { audioPath }));
        return;
      }

      // Store promise callbacks so stopAudio can reject if needed
      this.currentPlayPromise = { resolve, reject };

      // Resolve when audio finishes playing
      this.currentAudioProcess.on('close', (code: number | null) => {
        const promise = this.currentPlayPromise;
        this.currentAudioProcess = undefined;
        this.currentPlayPromise = undefined;
        
        // Add a small buffer delay to ensure audio has fully stopped playing
        // This prevents race conditions where the process exits slightly before audio finishes
        setTimeout(() => {
          // Treat exit code 0 (success) and null (signal termination, often normal) as success
          // Null can occur when the process is terminated by a signal after successful completion
          if (code === 0 || code === null) {
            // Audio played successfully
            if (promise) {
              promise.resolve();
            }
          } else {
            // Audio playback exited with error code
            if (promise) {
              promise.reject(createAudioError(`Audio playback exited with code ${code}`, 'PLAYBACK_FAILED', { audioPath }));
            }
          }
        }, 200); // 200ms buffer to ensure audio fully finishes
      });
      
      // Reject on process error
      this.currentAudioProcess.on('error', (error: Error) => {
        const promise = this.currentPlayPromise;
        this.currentAudioProcess = undefined;
        this.currentPlayPromise = undefined;
        if (promise) {
          promise.reject(createAudioError(`Audio playback error: ${error.message}`, 'PLAYBACK_FAILED', { audioPath, cause: error }));
        }
      });
    });
  }

  /**
   * Stop currently playing audio
   */
  stopAudio(): void {
    if (this.currentAudioProcess) {
      try {
        this.currentAudioProcess.kill('SIGTERM');
        this.currentAudioProcess = undefined;
        
        // Reject the promise if there's one waiting for playback to complete
        if (this.currentPlayPromise) {
          const promise = this.currentPlayPromise;
          this.currentPlayPromise = undefined;
          promise.reject(createAudioError('Audio playback was stopped', 'PLAYBACK_STOPPED', { audioPath: '' }));
        }
      } catch (error) {
        this.logger.warn({ error }, 'Failed to stop audio process');
      }
    }
  }

  /**
   * Check if audio file exists
   */
  async audioExists(audioPath: string): Promise<boolean> {
    return existsSync(audioPath);
  }

  // Abstract methods that must be implemented by subclasses
  abstract generateAudio(text: string, language: string, word?: string, wordId?: number, sentenceId?: number, variantId?: number, voiceId?: string): Promise<string>;
}

