import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { AudioGenerator, AudioConfig, AudioError } from '../../shared/types/audio';
import { DatabaseLayer } from '../../shared/types/database';

const execFileAsync = promisify(execFile);

/**
 * TTS Audio Generator using macOS 'say' command
 * Handles audio file generation, caching, and playback
 */
export class TTSAudioGenerator implements AudioGenerator {
  private config: AudioConfig;
  private database?: DatabaseLayer;

  constructor(config?: Partial<AudioConfig>, database?: DatabaseLayer) {
    this.config = {
      audioDirectory: join(process.cwd(), 'audio'),
      ttsCommand: 'say',
      fileExtension: '.aiff',
      voice: 'Monica', // Default macOS voice
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
  async generateAudio(text: string, language?: string): Promise<string> {
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

    const audioPath = this.getAudioPath(text);
    
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
   */
  async playAudio(audioPath: string): Promise<void> {
    if (!await this.audioExists(audioPath)) {
      throw this.createAudioError('FILE_NOT_FOUND', `Audio file not found: ${audioPath}`, audioPath);
    }

    try {
      // Use 'afplay' command on macOS to play audio files
      await execFileAsync('afplay', [audioPath]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown playback error';
      throw this.createAudioError('PLAYBACK_FAILED', `Audio playback failed: ${message}`, audioPath);
    }
  }

  /**
   * Check if audio file exists
   */
  async audioExists(audioPath: string): Promise<boolean> {
    return existsSync(audioPath);
  }

  /**
   * Generate standardized audio file path based on text content
   */
  private getAudioPath(text: string): string {
    // Create safe filename from text
    const safeFilename = this.sanitizeFilename(text);
    return join(this.config.audioDirectory, `${safeFilename}${this.config.fileExtension}`);
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
   * Get appropriate voice for language
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
      'spanish': 'Monica',
      'es': 'Monica',
      'polish': 'Zosia',
      'pl': 'Zosia',
    };

    return voiceMap[language.toLowerCase()] || this.config.voice || 'Monica';
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