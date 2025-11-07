import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { app } from 'electron';
import { AudioConfig, AudioError } from '../../shared/types/audio';
import { DatabaseLayer } from '../../shared/types/database';
import { sanitizeFilename } from '../../shared/utils/sanitizeFilename';
import { BaseAudioGenerator } from './base-audio-generator';

const execFileAsync = promisify(execFile);

/**
 * TTS Audio Generator using macOS 'say' command
 * Handles audio file generation, caching, and playback
 */
export class TTSAudioGenerator extends BaseAudioGenerator {
  private config: AudioConfig;
  private database?: DatabaseLayer;

  constructor(config?: Partial<AudioConfig>, database?: DatabaseLayer) {
    super();
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
   * Note: voiceId parameter is ignored for system TTS
   */
  async generateAudio(text: string, language: string, word?: string, wordId?: number, sentenceId?: number, variantId?: number, voiceId?: string): Promise<string> {
    if (!text || text.trim().length === 0) {
      throw this.createAudioError('GENERATION_FAILED', 'Text cannot be empty');
    }

    const audioPath = this.getAudioPath(text, language, word, wordId, sentenceId, variantId);

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
        '-v', this.getVoiceForLanguage(language),
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
   * Generate standardized audio file path based on IDs
   * Structure: 
   *   - Continuation audio: /audio/<lang>/variant_<variant_id>.<extension>
   *   - Before sentence audio: /audio/<lang>/word_<word_id>/before_sentence_<sentence_id>.<extension>
   *   - After sentence audio: /audio/<lang>/word_<word_id>/after_sentence_<sentence_id>.<extension>
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
    } else if (sentenceId !== undefined && word?.includes('_after_sentence')) {
      // After sentence audio: /audio/<lang>/word_<word_id>/after_sentence_<sentence_id>.<extension>
      return join(this.config.audioDirectory, language, `word_${wordId}`, `after_sentence_${sentenceId}${this.config.fileExtension}`);
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
   * Create standardized audio error with cause chaining support
   */
  protected createAudioError(code: AudioError['code'], message: string, audioPath?: string, cause?: unknown): AudioError {
    // @ts-expect-error - Error constructor with cause is supported in Node.js 16.9.0+ but TypeScript types may not include it
    const error = new Error(message, { cause }) as AudioError;
    error.code = code;
    error.audioPath = audioPath;
    return error;
  }
}
