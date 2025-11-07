import { existsSync } from 'fs';
import { AudioGenerator, AudioError } from '../../shared/types/audio';

/**
 * Base class for audio generators with shared playback functionality
 * Provides common implementation for playAudio and stopAudio methods
 */
export abstract class BaseAudioGenerator implements AudioGenerator {
  protected currentAudioProcess?: any; // Track current audio process
  protected currentPlayPromise?: { resolve: () => void; reject: (error: any) => void }; // Store promise callbacks for playback completion

  /**
   * Play audio file using system command
   * Returns a promise that resolves when audio playback completes
   */
  async playAudio(audioPath: string): Promise<void> {
    if (!await this.audioExists(audioPath)) {
      throw this.createAudioError('FILE_NOT_FOUND', `Audio file not found: ${audioPath}`, audioPath);
    }

    try {
      // Stop any currently playing audio first
      this.stopAudio();

      // Use 'afplay' command on macOS to play audio files
      const { spawn } = await import('child_process');
      this.currentAudioProcess = spawn('afplay', [audioPath]);
      
      // Return a promise that resolves when the audio finishes playing
      return new Promise<void>((resolve, reject) => {
        if (!this.currentAudioProcess) {
          reject(this.createAudioError('PLAYBACK_FAILED', 'Audio process not created', audioPath));
          return;
        }

        // Store promise callbacks so stopAudio can reject if needed
        this.currentPlayPromise = { resolve, reject };

        // Resolve when audio finishes playing
        this.currentAudioProcess.on('close', (code: number | null) => {
          const process = this.currentAudioProcess;
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
                promise.reject(this.createAudioError('PLAYBACK_FAILED', `Audio playback exited with code ${code}`, audioPath));
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
            promise.reject(this.createAudioError('PLAYBACK_FAILED', `Audio playback error: ${error.message}`, audioPath));
          }
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown playback error';
      throw this.createAudioError('PLAYBACK_FAILED', `Audio playback failed: ${message}`, audioPath);
    }
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
          promise.reject(this.createAudioError('PLAYBACK_STOPPED', 'Audio playback was stopped', ''));
        }
      } catch (error) {
        console.warn('Failed to stop audio process:', error);
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
  protected abstract createAudioError(code: AudioError['code'], message: string, audioPath?: string, cause?: unknown): AudioError;
}

