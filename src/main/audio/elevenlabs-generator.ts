import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { app } from 'electron';
import { AudioGenerator, AudioConfig, AudioError } from '../../shared/types/audio';
import { DatabaseLayer } from '../../shared/types/database';
import { sanitizeFilename } from '../../shared/utils/sanitizeFilename';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * ElevenLabs TTS Audio Generator
 * Handles audio file generation using ElevenLabs API, caching, and playback
 */
export class ElevenLabsAudioGenerator implements AudioGenerator {
  private config: AudioConfig;
  private database?: DatabaseLayer;
  private currentAudioProcess?: any; // Track current audio process
  private currentPlayPromise?: { resolve: () => void; reject: (error: any) => void }; // Store promise callbacks for playback completion

  constructor(config?: Partial<AudioConfig>, database?: DatabaseLayer) {
    this.config = {
      audioDirectory: join(app.getPath('userData'), 'audio'),
      ttsCommand: 'say',
      fileExtension: '.mp3', // ElevenLabs returns MP3
      rate: 160,
      elevenLabsModel: 'eleven_flash_v2_5',
      ...config
    };

    this.database = database;

    // Ensure audio directory exists
    this.ensureAudioDirectory();
  }

  /**
   * Generate audio file for given text using ElevenLabs API
   * Returns path to generated audio file
   */
  async generateAudio(text: string, language?: string, word?: string, wordId?: number, sentenceId?: number, variantId?: number): Promise<string> {
    if (!text || text.trim().length === 0) {
      throw this.createAudioError('GENERATION_FAILED', 'Text cannot be empty');
    }

    if (!this.config.elevenLabsApiKey) {
      throw this.createAudioError('API_ERROR', 'ElevenLabs API key not configured');
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

      // Get voice ID for the language
      const voiceId = this.getVoiceForLanguage(targetLanguage);

      // Make API request to ElevenLabs
      const audioBuffer = await this.callElevenLabsAPI(text, voiceId);

      // Write audio file
      writeFileSync(audioPath, audioBuffer);

      // Verify file was created
      if (!await this.audioExists(audioPath)) {
        throw this.createAudioError('GENERATION_FAILED', `Audio file not created: ${audioPath}`);
      }

      return audioPath;
    } catch (error) {
      if (error instanceof Error && error.message.includes('API')) {
        throw this.createAudioError('API_ERROR', `ElevenLabs API error: ${error.message}`, audioPath);
      }
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
        console.log('Stopping current audio process (ElevenLabs)...');
        this.currentAudioProcess.kill('SIGTERM');
        this.currentAudioProcess = undefined;
        
        // Reject the promise if there's one waiting for playback to complete
        if (this.currentPlayPromise) {
          const promise = this.currentPlayPromise;
          this.currentPlayPromise = undefined;
          promise.reject(this.createAudioError('PLAYBACK_STOPPED', 'Audio playback was stopped', ''));
        }
        console.log('Audio process stopped successfully (ElevenLabs)');
      } catch (error) {
        console.warn('Failed to stop audio process (ElevenLabs):', error);
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
   * Call ElevenLabs API to generate audio
   */
  private async callElevenLabsAPI(text: string, voiceId: string): Promise<Buffer> {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    
    const requestBody = {
      text: text,
      model_id: this.config.elevenLabsModel,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.5,
        style: 0.0,
        use_speaker_boost: true
      }
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': this.config.elevenLabsApiKey!
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`ElevenLabs API call failed: ${error.message}`);
      }
      throw new Error('ElevenLabs API call failed: Unknown error');
    }
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
   * Voice IDs mapped by language
   * Multiple voices per language for variety
   */
  private static readonly VOICE_MAP: Record<string, string[]> = {
    'portuguese': ['GDzHdQOi6jjf8zaXhCYD', '9pDzHy2OpOgeXM8SeL0t'],
    'pt': ['GDzHdQOi6jjf8zaXhCYD', '9pDzHy2OpOgeXM8SeL0t'],
    'italian': ['oCS6WHyqobqW2UapCSHl', 'CiwzbDpaN3pQXjTgx3ML'],
    'it': ['oCS6WHyqobqW2UapCSHl', 'CiwzbDpaN3pQXjTgx3ML'],
    'polish': ['zzBTsLBFM6AOJtkr1e9b', 'g8ZOdhoD9R6eYKPTjKbE'],
    'pl': ['zzBTsLBFM6AOJtkr1e9b', 'g8ZOdhoD9R6eYKPTjKbE'],
    'spanish': ['Nh2zY9kknu6z4pZy6FhD', 'P951amuWPNCJ0L15rFyC'],
    'es': ['Nh2zY9kknu6z4pZy6FhD', 'P951amuWPNCJ0L15rFyC'],
    'indonesian': ['plgKUYgnlZ1DCNh54DwJ', 'I7sakys8pBZ1Z5f0UhT9'],
    'id': ['plgKUYgnlZ1DCNh54DwJ', 'I7sakys8pBZ1Z5f0UhT9'],
  };

  /**
   * Generic voice ID for languages not in the map
   */
  private static readonly DEFAULT_VOICE = 'pNInz6obpgDQGcFmaJgB';

  /**
   * Get appropriate voice ID for language
   * Randomly selects from multiple voices per language for variety
   */
  private getVoiceForLanguage(language: string): string {
    const lang = language.toLowerCase();
    const voices = ElevenLabsAudioGenerator.VOICE_MAP[lang];
    
    if (voices && voices.length > 0) {
      return voices[Math.floor(Math.random() * voices.length)];
    }
    
    return ElevenLabsAudioGenerator.DEFAULT_VOICE;
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
