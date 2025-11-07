import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { app } from 'electron';
import { AudioConfig, AudioError } from '../../shared/types/audio';
import { DatabaseLayer } from '../../shared/types/database';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { BaseAudioGenerator } from './base-audio-generator';

const execFileAsync = promisify(execFile);

// Simple queue to limit ElevenLabs API calls to 1 concurrent request
let apiRequestQueue: Promise<any> = Promise.resolve();

function queueApiRequest<T>(fn: () => Promise<T>): Promise<T> {
  const current = apiRequestQueue.then(() => fn());
  apiRequestQueue = current.catch(() => {});
  return current;
}

/**
 * ElevenLabs TTS Audio Generator
 * Handles audio file generation using ElevenLabs API, caching, and playback
 */
export class ElevenLabsAudioGenerator extends BaseAudioGenerator {
  private config: AudioConfig;
  private database?: DatabaseLayer;
  private lastUsedVoiceId?: string; // Track the last voiceID used for generation
  private voiceMap: Record<string, string[]> = {}; // Voice IDs mapped by language
  private voiceMapLoaded = false; // Track if voice mappings have been loaded

  constructor(config?: Partial<AudioConfig>, database?: DatabaseLayer) {
    super();
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

    // Load voice mappings from database (non-blocking, will use defaults if not loaded yet)
    if (database) {
      this.loadVoiceMappings().catch(error => {
        console.warn('Failed to load voice mappings during construction, using defaults:', error);
      });
    } else {
      // No database, use defaults immediately
      this.voiceMap = { ...ElevenLabsAudioGenerator.DEFAULT_VOICE_MAP };
      this.voiceMapLoaded = true;
    }
  }

  /**
   * Generate audio file for given text using ElevenLabs API
   * Returns path to generated audio file
   */
  async generateAudio(text: string, language: string, word?: string, wordId?: number, sentenceId?: number, variantId?: number, voiceId?: string): Promise<string> {
    if (!text || text.trim().length === 0) {
      throw this.createAudioError('GENERATION_FAILED', 'Text cannot be empty');
    }

    if (!this.config.elevenLabsApiKey) {
      throw this.createAudioError('API_ERROR', 'ElevenLabs API key not configured');
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

      // Get voice ID for the language (use provided voiceId if available, otherwise select randomly)
      const finalVoiceId = voiceId || await this.getVoiceForLanguage(language);
      
      // Store the voiceID that was used for this generation
      this.lastUsedVoiceId = finalVoiceId;

      // Make API request to ElevenLabs (rate-limited to 1 concurrent request)
      const audioBuffer = await queueApiRequest(() => this.callElevenLabsAPI(text, finalVoiceId));

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
   *   - After sentence audio: /audio/<lang>/word_<word_id>/after_sentence_<sentence_id>.<extension>
   *   - Sentence audio: /audio/<lang>/<word_id>/<sentence_id>.<extension>
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
   * Default voice IDs mapped by language
   * Multiple voices per language for variety
   */
  private static readonly DEFAULT_VOICE_MAP: Record<string, string[]> = {
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
   * Load voice mappings from database
   */
  private async loadVoiceMappings(): Promise<void> {
    if (!this.database) {
      this.voiceMap = { ...ElevenLabsAudioGenerator.DEFAULT_VOICE_MAP };
      this.voiceMapLoaded = true;
      return;
    }

    try {
      const stored = await this.database.getSetting('elevenlabs_voice_ids');
      if (stored && stored.trim() && stored !== '{}') {
        const parsed = JSON.parse(stored);
        // Merge with defaults for any missing languages
        this.voiceMap = {
          ...ElevenLabsAudioGenerator.DEFAULT_VOICE_MAP,
          ...parsed
        };
        // Ensure all language codes are also included (e.g., 'pt' and 'portuguese')
        for (const [lang, voices] of Object.entries(this.voiceMap)) {
          if (lang.length > 2) {
            // Full language name, also add 2-letter code
            const code = this.getLanguageCode(lang);
            if (code && !this.voiceMap[code]) {
              this.voiceMap[code] = voices as string[];
            }
          }
        }
      } else {
        // No stored settings or empty, use defaults
        this.voiceMap = { ...ElevenLabsAudioGenerator.DEFAULT_VOICE_MAP };
      }
      this.voiceMapLoaded = true;
    } catch (error) {
      console.warn('Failed to load voice mappings from database, using defaults:', error);
      this.voiceMap = { ...ElevenLabsAudioGenerator.DEFAULT_VOICE_MAP };
      this.voiceMapLoaded = true;
    }
  }

  /**
   * Get language code from full language name (e.g., 'portuguese' -> 'pt')
   */
  private getLanguageCode(language: string): string | null {
    const langMap: Record<string, string> = {
      'portuguese': 'pt',
      'italian': 'it',
      'polish': 'pl',
      'spanish': 'es',
      'indonesian': 'id',
    };
    return langMap[language.toLowerCase()] || null;
  }

  /**
   * Get voice mappings (for settings UI)
   */
  async getVoiceMappings(): Promise<Record<string, string[]>> {
    if (!this.voiceMapLoaded) {
      await this.loadVoiceMappings();
    }
    return { ...this.voiceMap };
  }

  /**
   * Save voice mappings to database
   */
  async saveVoiceMappings(mappings: Record<string, string[]>): Promise<void> {
    if (!this.database) {
      throw new Error('Database not available for saving voice mappings');
    }

    try {
      // Clean up the mappings - remove language code duplicates (keep full names)
      const cleaned: Record<string, string[]> = {};
      for (const [lang, voices] of Object.entries(mappings)) {
        // Only store full language names, not codes
        if (lang.length > 2 || !this.getLanguageCodeFromCode(lang)) {
          cleaned[lang] = voices;
        }
      }

      const json = JSON.stringify(cleaned);
      await this.database.setSetting('elevenlabs_voice_ids', json);
      
      // Reload to update the internal map
      await this.loadVoiceMappings();
    } catch (error) {
      throw new Error(`Failed to save voice mappings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get full language name from code (e.g., 'pt' -> 'portuguese')
   */
  private getLanguageCodeFromCode(code: string): string | null {
    const codeMap: Record<string, string> = {
      'pt': 'portuguese',
      'it': 'italian',
      'pl': 'polish',
      'es': 'spanish',
      'id': 'indonesian',
    };
    return codeMap[code.toLowerCase()] || null;
  }

  /**
   * Reset voice mappings to defaults
   */
  async resetVoiceMappingsToDefaults(): Promise<void> {
    if (!this.database) {
      throw new Error('Database not available for resetting voice mappings');
    }

    try {
      // Delete the setting to use defaults
      await this.database.setSetting('elevenlabs_voice_ids', '');
      
      // Reload to update the internal map with defaults
      await this.loadVoiceMappings();
    } catch (error) {
      throw new Error(`Failed to reset voice mappings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get appropriate voice ID for language
   * Randomly selects from multiple voices per language for variety
   */
  async getVoiceForLanguage(language: string): Promise<string> {
    // Ensure voice mappings are loaded
    if (!this.voiceMapLoaded) {
      await this.loadVoiceMappings();
    }

    const lang = language.toLowerCase();
    const voices = this.voiceMap[lang];
    
    if (voices && voices.length > 0) {
      return voices[Math.floor(Math.random() * voices.length)];
    }
    
    return ElevenLabsAudioGenerator.DEFAULT_VOICE;
  }

  /**
   * Get the last voiceID that was used for audio generation
   */
  getLastUsedVoiceId(): string | undefined {
    return this.lastUsedVoiceId;
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
  protected createAudioError(code: AudioError['code'], message: string, audioPath?: string, cause?: unknown): AudioError {
    // @ts-expect-error - Error constructor with cause is supported in Node.js 16.9.0+ but TypeScript types may not include it
    const error = new Error(message, { cause }) as AudioError;
    error.code = code;
    error.audioPath = audioPath;
    return error;
  }
}
