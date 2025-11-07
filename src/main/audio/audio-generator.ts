import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { app } from 'electron';
import { AudioConfig } from '../../shared/types/audio';
import { DatabaseLayer } from '../../shared/types/database';
import { createAudioError } from '../../shared/utils/error.js';
import { BaseAudioGenerator } from './base-audio-generator';

const execFileAsync = promisify(execFile);

/**
 * TTS Audio Generator using macOS 'say' command
 * Handles audio file generation, caching, and playback
 */
export class TTSAudioGenerator extends BaseAudioGenerator {
  private config: AudioConfig;

  constructor(config?: Partial<AudioConfig>, _database?: DatabaseLayer) {
    super();
    this.config = {
      audioDirectory: join(app.getPath('userData'), 'audio'),
      ttsCommand: 'say',
      fileExtension: '.aiff',
      rate: 160, // Words per minute
      ...config
    };

    // Ensure audio directory exists
    this.ensureAudioDirectory();
  }

  /**
   * Generate audio file for given text using system TTS
   * Returns path to generated audio file
   * Note: voiceId parameter is ignored for system TTS
   */
  async generateAudio(text: string, language: string, word?: string, wordId?: number, sentenceId?: number, variantId?: number, _voiceId?: string): Promise<string> {
    if (!text || text.trim().length === 0) {
      throw createAudioError('Text cannot be empty', 'GENERATION_FAILED');
    }

    const audioPath = this.getAudioPath(text, language, word, wordId, sentenceId, variantId);

    // Return existing file if it exists (caching)
    if (await this.audioExists(audioPath)) {
      return audioPath;
    }

    // Ensure directory exists for the file
    const dir = dirname(audioPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Build TTS command arguments
    // Use English voice if generating English sentence audio, otherwise use language-specific voice
    const voiceLanguage = word === 'english_sentence' ? 'english' : language;
    const args = [
      '-v', this.getVoiceForLanguage(voiceLanguage),
      '-r', this.config.rate!.toString(),
      '-o', audioPath,
      text
    ];

    // Execute TTS command
    await execFileAsync(this.config.ttsCommand, args);

    // Verify file was created
    if (!await this.audioExists(audioPath)) {
      throw createAudioError(`Audio file not created: ${audioPath}`, 'GENERATION_FAILED', { audioPath });
    }

    return audioPath;
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
      throw createAudioError(`Word ID or variant ID is required for audio file naming. Text: "${text}"`, 'INVALID_PATH');
    }

    if (sentenceId !== undefined && word?.includes('_before_sentence')) {
      // Before sentence audio: /audio/<lang>/word_<word_id>/before_sentence_<sentence_id>.<extension>
      return join(this.config.audioDirectory, language, `word_${wordId}`, `before_sentence_${sentenceId}${this.config.fileExtension}`);
    } else if (sentenceId !== undefined && word?.includes('_after_sentence')) {
      // After sentence audio: /audio/<lang>/word_<word_id>/after_sentence_<sentence_id>.<extension>
      return join(this.config.audioDirectory, language, `word_${wordId}`, `after_sentence_${sentenceId}${this.config.fileExtension}`);
    } else if (sentenceId !== undefined && word === 'english_sentence') {
      // English sentence audio: /audio/<lang>/word_<word_id>/english_sentence_<sentence_id>.<extension>
      return join(this.config.audioDirectory, language, `word_${wordId}`, `english_sentence_${sentenceId}${this.config.fileExtension}`);
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
      'english': 'Alex',
      'en': 'Alex',
    };

    // Return voice for language, defaulting to English if no match found
    return voiceMap[language.toLowerCase()] || 'Alex';
  }

  /**
   * Ensure audio directory exists
   */
  private ensureAudioDirectory(): void {
    if (!existsSync(this.config.audioDirectory)) {
      mkdirSync(this.config.audioDirectory, { recursive: true });
    }
  }
}
