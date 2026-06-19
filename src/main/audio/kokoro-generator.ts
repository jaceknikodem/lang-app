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

    // English translation audio (flow mode) is stored under the selected language's
    // directory, but must be voiced and phonemized as English — otherwise the server
    // would route it through the selected language's voice/G2P (e.g. a Japanese voice
    // phonemizing English, producing a heavy accent).
    const ttsLanguage = word === 'english_sentence' ? 'english' : language;

    await this.callTTSEndpoint(text, ttsLanguage, audioPath, voiceId);
    return audioPath;
  }

  async generateAudioBatch(
    items: Array<{ text: string; language: string; outputPath: string; voiceId?: string }>
  ): Promise<Array<{ outputPath: string; success: boolean; error?: string }>> {
    if (items.length === 0) return [];

    // Split into uncached (need generation) and cached (already on disk)
    const toGenerate: typeof items = [];
    const cached: Array<{ outputPath: string; success: boolean }> = [];
    for (const item of items) {
      if (await this.audioExists(item.outputPath)) {
        cached.push({ outputPath: item.outputPath, success: true });
      } else {
        const dir = dirname(item.outputPath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        toGenerate.push(item);
      }
    }

    if (toGenerate.length === 0) return cached;

    const url = `${serviceConfig.lemmatization.serverUrl}/tts-batch`;
    const payload = toGenerate.map((item) => ({
      text: item.text,
      language: item.language,
      output_path: item.outputPath,
      voice: item.voiceId || this.getVoiceForLanguage(item.language),
    }));

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120000),
      });
    } catch (error) {
      // If batch endpoint is unreachable, mark all as failed
      return [
        ...cached,
        ...toGenerate.map((item) => ({
          outputPath: item.outputPath,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        })),
      ];
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({ detail: response.statusText }));
      const errMsg = (body as { detail?: string }).detail ?? response.statusText;
      return [
        ...cached,
        ...toGenerate.map((item) => ({ outputPath: item.outputPath, success: false, error: errMsg })),
      ];
    }

    const data = (await response.json()) as {
      results: Array<{ output_path?: string; success: boolean; error?: string }>;
    };

    const batchResults = data.results.map((r, i) => ({
      outputPath: r.output_path ?? toGenerate[i].outputPath,
      success: r.success,
      error: r.error,
    }));

    return [...cached, ...batchResults];
  }

  async generateTextAudioRaw(
    items: Array<{ text: string; language: string }>
  ): Promise<Array<{ text: string; audioData: ArrayBuffer | null }>> {
    if (items.length === 0) return [];

    const url = `${serviceConfig.lemmatization.serverUrl}/tts-batch`;
    const payload = items.map((item) => ({
      text: item.text,
      language: item.language,
      voice: this.getVoiceForLanguage(item.language),
      // no output_path → server returns audio_data
    }));

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120000),
      });
    } catch (error) {
      this.logger.warn({ error }, 'TTS raw batch service unreachable');
      return items.map((item) => ({ text: item.text, audioData: null }));
    }

    if (!response.ok) {
      this.logger.warn({ status: response.status }, 'TTS raw batch failed');
      return items.map((item) => ({ text: item.text, audioData: null }));
    }

    const data = (await response.json()) as {
      results: Array<{ success: boolean; audio_data?: string; error?: string }>;
    };

    return data.results.map((r, i) => {
      if (!r.success || !r.audio_data) return { text: items[i].text, audioData: null };
      const binary = Buffer.from(r.audio_data, 'base64');
      const arrayBuffer = new ArrayBuffer(binary.length);
      new Uint8Array(arrayBuffer).set(binary);
      return { text: items[i].text, audioData: arrayBuffer };
    });
  }

  private async callTTSEndpoint(
    text: string,
    language: string,
    outputPath: string,
    voiceId?: string
  ): Promise<void> {
    const results = await this.generateAudioBatch([{ text, language, outputPath, voiceId }]);
    const result = results[0];
    if (!result?.success) {
      throw createAudioError(
        `TTS generation failed: ${result?.error ?? 'unknown error'}`,
        'GENERATION_FAILED'
      );
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

    if (variantId !== undefined && word === '_variant_sentence') {
      return join(this.audioDirectory, lang, `variant_sentence_${variantId}${this.fileExtension}`);
    }

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
