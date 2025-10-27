import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { AudioGenerator, AudioConfig, AudioError } from '../../shared/types/audio';
import { DatabaseLayer } from '../../shared/types/database';
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

  constructor(config?: Partial<AudioConfig>, database?: DatabaseLayer) {
    this.config = {
      audioDirectory: join(process.cwd(), 'audio'),
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
  async generateAudio(text: string, language?: string, word?: string): Promise<string> {
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

    const audioPath = this.getAudioPath(text, targetLanguage, word);

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
      
      // Set up process event handlers but don't wait for completion
      this.currentAudioProcess.on('close', (code: number) => {
        if (this.currentAudioProcess) {
          this.currentAudioProcess = undefined;
        }
      });
      
      this.currentAudioProcess.on('error', (error: Error) => {
        console.warn('Audio playback error:', error);
        if (this.currentAudioProcess) {
          this.currentAudioProcess = undefined;
        }
      });

      // Return immediately without waiting for completion
      // This allows for non-blocking audio playback
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
        console.log('Audio process stopped successfully (ElevenLabs)');
      } catch (error) {
        console.warn('Failed to stop audio process (ElevenLabs):', error);
      }
    } else {
      console.log('No audio process to stop (ElevenLabs)');
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
   * Generate standardized audio file path based on text content
   * Structure: /audio/<lang>/<word>/<sentence>.<extension>
   */
  private getAudioPath(text: string, language: string, word?: string): string {
    // Create safe filename from text
    const safeFilename = this.sanitizeFilename(text);

    // If word is provided, use the new nested structure
    if (word) {
      const safeWord = this.sanitizeFilename(word);
      return join(this.config.audioDirectory, language, safeWord, `${safeFilename}${this.config.fileExtension}`);
    }

    // For standalone words (no parent word context), place directly in language folder
    return join(this.config.audioDirectory, language, `${safeFilename}${this.config.fileExtension}`);
  }

  /**
   * Convert text to safe filename
   */
  private sanitizeFilename(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '') // Remove special characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .substring(0, 100); // Limit length to avoid filesystem issues
  }

  /**
   * Get appropriate voice ID for language
   * Uses Adam voice (multilingual) for all languages
   */
  private getVoiceForLanguage(language: string): string {
    // Use Adam voice (multilingual) for all languages
    // This is a good default voice that works well with multiple languages
    return 'pNInz6obpgDQGcFmaJgB';
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