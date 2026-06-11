import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { app } from 'electron';
import { BaseAudioGenerator } from './base-audio-generator.js';
import { createAudioError } from '../../shared/utils/error.js';
import { serviceConfig } from '../../shared/config/index.js';

const VOICES_BY_LANGUAGE: Record<string, string[]> = {
  japanese: ['jf_alpha', 'jf_gongitsune', 'jf_nezumi', 'jf_tebukuro', 'jm_kumo'],
  ja: ['jf_alpha', 'jf_gongitsune', 'jf_nezumi', 'jf_tebukuro', 'jm_kumo'],
  english: ['af_heart', 'af_bella', 'af_nicole', 'am_fenrir', 'am_michael'],
  en: ['af_heart', 'af_bella', 'af_nicole', 'am_fenrir', 'am_michael'],
  spanish: ['ef_dora'],
  es: ['ef_dora'],
  french: ['ff_siwis'],
  fr: ['ff_siwis'],
  italian: ['if_sara'],
  it: ['if_sara'],
  portuguese: ['pf_dora'],
  pt: ['pf_dora'],
  chinese: ['zf_xiaobei', 'zf_xiaoni', 'zm_yunxi'],
  zh: ['zf_xiaobei', 'zf_xiaoni', 'zm_yunxi'],
  korean: ['kf_aria', 'km_junho'],
  ko: ['kf_aria', 'km_junho'],
};

const DEFAULT_VOICE = 'af_heart';

export class KokoroAudioGenerator extends BaseAudioGenerator {
  private readonly audioDirectory: string;
  private readonly fileExtension = '.wav';

  constructor() {
    super();
    this.audioDirectory = join(app.getPath('userData'), 'audio');
    if (!existsSync(this.audioDirectory)) {
      mkdirSync(this.audioDirectory, { recursive: true });
    }
  }

  async generateAudio(
    text: string,
    language: string,
    word?: string,
    wordId?: number,
    sentenceId?: number,
    variantId?: number,
    voiceId?: string
  ): Promise<string> {
    if (!text || text.trim().length === 0) {
      throw createAudioError('Text cannot be empty', 'GENERATION_FAILED');
    }

    const audioPath = this.getAudioPath(text, language, word, wordId, sentenceId, variantId);

    if (await this.audioExists(audioPath)) {
      return audioPath;
    }

    const dir = dirname(audioPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    await this.callTTSEndpoint(text, language, audioPath, voiceId);
    return audioPath;
  }

  private async callTTSEndpoint(
    text: string,
    language: string,
    outputPath: string,
    voiceId?: string
  ): Promise<void> {
    const voice = voiceId || this.getVoiceForLanguage(language);
    const url = `${serviceConfig.lemmatization.serverUrl}/tts`;

    this.logger.debug({ voice, language, outputPath }, 'Calling Python TTS endpoint');

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language, output_path: outputPath, voice }),
        signal: AbortSignal.timeout(60000),
      });
    } catch (error) {
      throw createAudioError(
        `TTS service unreachable: ${error instanceof Error ? error.message : String(error)}`,
        'GENERATION_FAILED',
        { cause: error }
      );
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({ detail: response.statusText }));
      throw createAudioError(
        `TTS generation failed: ${(body as { detail?: string }).detail ?? response.statusText}`,
        'GENERATION_FAILED'
      );
    }

    if (!await this.audioExists(outputPath)) {
      throw createAudioError(`File not found after TTS generation: ${outputPath}`, 'GENERATION_FAILED');
    }
  }

  private getVoiceForLanguage(language: string): string {
    const lang = language.toLowerCase();
    const voices = VOICES_BY_LANGUAGE[lang];
    if (voices && voices.length > 0) {
      return voices[Math.floor(Math.random() * voices.length)];
    }
    return DEFAULT_VOICE;
  }

  private getAudioPath(
    text: string,
    language: string,
    word?: string,
    wordId?: number,
    sentenceId?: number,
    variantId?: number
  ): string {
    const lang = language.toLowerCase();

    if (variantId !== undefined) {
      return join(this.audioDirectory, lang, `variant_${variantId}${this.fileExtension}`);
    }

    if (wordId === undefined) {
      const hash = createHash('md5').update(text.trim().toLowerCase()).digest('hex').substring(0, 16);
      return join(this.audioDirectory, lang, `custom_${hash}${this.fileExtension}`);
    }

    if (sentenceId !== undefined && word?.includes('_before_sentence')) {
      return join(this.audioDirectory, lang, `word_${wordId}`, `before_sentence_${sentenceId}${this.fileExtension}`);
    } else if (sentenceId !== undefined && word?.includes('_after_sentence')) {
      return join(this.audioDirectory, lang, `word_${wordId}`, `after_sentence_${sentenceId}${this.fileExtension}`);
    } else if (sentenceId !== undefined && word === 'english_sentence') {
      return join(this.audioDirectory, lang, `word_${wordId}`, `english_sentence_${sentenceId}${this.fileExtension}`);
    } else if (sentenceId !== undefined) {
      return join(this.audioDirectory, lang, `word_${wordId}`, `sentence_${sentenceId}${this.fileExtension}`);
    } else {
      return join(this.audioDirectory, lang, `word_${wordId}${this.fileExtension}`);
    }
  }
}
