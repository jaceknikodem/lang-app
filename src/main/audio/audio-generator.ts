import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { app } from 'electron';
import { AudioGenerator, AudioConfig, AudioError } from '../../shared/types/audio';
import { DatabaseLayer } from '../../shared/types/database';
import { sanitizeFilename } from '../../shared/utils/sanitizeFilename';

const execFileAsync = promisify(execFile);

/**
 * TTS Audio Generator using macOS 'say' command
 * Handles audio file generation, caching, and playback
 */
export class TTSAudioGenerator implements AudioGenerator {
  private config: AudioConfig;
  private database?: DatabaseLayer;
  private currentAudioProcess?: any; // Track current audio process
  private currentPlayPromise?: { resolve: () => void; reject: (error: any) => void }; // Track current play promise

  constructor(config?: Partial<AudioConfig>, database?: DatabaseLayer) {
    this.config = {
      audioDirectory: join(app.getPath('userData'), 'audio'),
      ttsCommand: 'say',
      fileExtension: '.aiff',
      rate: 160, // Words per minute
      ...config
    };

    this.database = database;

    // Ensure audio directory exists
    this.ensureAudioDirectory();
  }

  /**
   * Generate audio file for given text using system TTS
   * Returns path to generated audio file
   */
  async generateAudio(text: string, language?: string, word?: string, wordId?: number, sentenceId?: number, variantId?: number): Promise<string> {
    if (!text || text.trim().length === 0) {
      throw this.createAudioError('GENERATION_FAILED', 'Text cannot be empty');
    }

    // Get language from database if not provided
    let targetLanguage = language;
    if (!targetLanguage && this.database) {
      try {
        targetLanguage = await this.database.getCurrentLanguage();
      } catch (error) {
        console.warn('Failed to get current language from database, using default');
        targetLanguage = 'spanish';
      }
    }
    targetLanguage = targetLanguage || 'spanish';

    const audioPath = this.getAudioPath(text, targetLanguage, word, wordId, sentenceId, variantId);

    // Return existing file if it exists (caching)
    if (await this.audioExists(audioPath)) {
      return audioPath;
    }

    try {
      // Ensure directory exists for the file
      const dir = dirname(audioPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Build TTS command arguments
      const args = [
        '-v', this.getVoiceForLanguage(targetLanguage),
        '-r', this.config.rate!.toString(),
        '-o', audioPath,
        text
      ];

      // Execute TTS command
      await execFileAsync(this.config.ttsCommand, args);

      // Verify file was created
      if (!await this.audioExists(audioPath)) {
        throw this.createAudioError('GENERATION_FAILED', `Audio file not created: ${audioPath}`);
      }

      return audioPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown TTS error';
      throw this.createAudioError('GENERATION_FAILED', `TTS generation failed: ${message}`, audioPath);
    }
  }

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
          console.warn('Audio playback error:', error);
          const process = this.currentAudioProcess;
          this.currentAudioProcess = undefined;
          const promise = this.currentPlayPromise;
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
        console.log('Stopping current audio process...');
        this.currentAudioProcess.kill('SIGTERM');
        
        // Reject any pending play promise
        if (this.currentPlayPromise) {
          this.currentPlayPromise.reject(this.createAudioError('PLAYBACK_STOPPED', 'Audio playback was stopped', ''));
          this.currentPlayPromise = undefined;
        }
        
        this.currentAudioProcess = undefined;
        console.log('Audio process stopped successfully');
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

  /**
   * Generate standardized audio file path based on IDs
   * Structure: 
   *   - Continuation audio: /audio/<lang>/variant_<variant_id>.<extension>
   *   - Before sentence audio: /audio/<lang>/word_<word_id>/before_sentence_<sentence_id>.<extension>
   *   - Sentence audio: /audio/<lang>/<word_id>/<sentence_id>.<extension>
   *   - Word audio: /audio/<lang>/<word_id>.<extension>
   * Requires wordId for word/sentence audio, variantId for continuation audio
   */
  private getAudioPath(text: string, language: string, word?: string, wordId?: number, sentenceId?: number, variantId?: number): string {
    if (variantId !== undefined) {
      // Continuation audio: /audio/<lang>/variant_<variant_id>.<extension>
      return join(this.config.audioDirectory, language, `variant_${variantId}${this.config.fileExtension}`);
    }

    if (wordId === undefined) {
      throw this.createAudioError('INVALID_PATH', `Word ID or variant ID is required for audio file naming. Text: "${text}"`);
    }

    if (sentenceId !== undefined && word?.includes('_before_sentence')) {
      // Before sentence audio: /audio/<lang>/word_<word_id>/before_sentence_<sentence_id>.<extension>
      return join(this.config.audioDirectory, language, `word_${wordId}`, `before_sentence_${sentenceId}${this.config.fileExtension}`);
    } else if (sentenceId !== undefined) {
      // Sentence audio: /audio/<lang>/<word_id>/<sentence_id>.<extension>
      return join(this.config.audioDirectory, language, `word_${wordId}`, `sentence_${sentenceId}${this.config.fileExtension}`);
    } else {
      // Word audio: /audio/<lang>/<word_id>.<extension>
      return join(this.config.audioDirectory, language, `word_${wordId}${this.config.fileExtension}`);
    }
  }

  /**
   * Get appropriate voice for language
   * Voice selection is purely based on the target language, no global configuration
   */
  private getVoiceForLanguage(language: string): string {
    // Map languages to macOS voices with proper locale-specific voices
    const voiceMap: Record<string, string> = {
      'indonesian': 'Damayanti',
      'id': 'Damayanti',
      'portuguese': 'Luciana',
      'pt': 'Luciana',
      'italian': 'Alice',
      'it': 'Alice',
      'spanish': 'Eddy (Spanish (Mexico))',
      'es': 'Eddy (Spanish (Mexico))',
      'polish': 'Zosia',
      'pl': 'Zosia',
    };

    // Always return a non-English voice, defaulting to Spanish if no match found
    // This ensures we never accidentally use the system default English voice
    return voiceMap[language.toLowerCase()] || 'Eddy (Spanish (Mexico))';
  }

  /**
   * Ensure audio directory exists
   */
  private ensureAudioDirectory(): void {
    if (!existsSync(this.config.audioDirectory)) {
      mkdirSync(this.config.audioDirectory, { recursive: true });
    }
  }

  /**
   * Create standardized audio error
   */
  private createAudioError(code: AudioError['code'], message: string, audioPath?: string): AudioError {
    const error = new Error(message) as AudioError;
    error.code = code;
    error.audioPath = audioPath;
    return error;
  }
}
