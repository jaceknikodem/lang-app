import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { app } from 'electron';
import { AudioConfig } from '../../shared/types/audio';
import { DatabaseLayer } from '../../shared/types/database';
import { createAudioError } from '../../shared/utils/error.js';
import { BaseAudioGenerator } from './base-audio-generator';
import { getElevenlabsVoiceIds, getLanguageCode, getLanguageName } from '../../shared/utils/language-config.js';
import { getJapanesePhoneticText } from '../lemmatization/japanese-tokenizer.js';

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
        this.logger.warn({ error }, 'Failed to load voice mappings during construction, using defaults');
      });
    } else {
      // No database, use defaults from config.toml immediately
      this.voiceMap = ElevenLabsAudioGenerator.buildDefaultVoiceMap();
      this.voiceMapLoaded = true;
    }
  }

  /**
   * Generate audio file for given text using ElevenLabs API
   * Returns path to generated audio file
   */
  async generateAudio(text: string, language: string, word?: string, wordId?: number, sentenceId?: number, variantId?: number, voiceId?: string): Promise<string> {
    if (!text || text.trim().length === 0) {
      throw createAudioError('Text cannot be empty', 'GENERATION_FAILED');
    }

    if (!this.config.elevenLabsApiKey) {
      throw createAudioError('ElevenLabs API key not configured', 'API_ERROR');
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

    // Get voice ID for the language (use provided voiceId if available, otherwise select randomly)
    // Use English voice if generating English sentence audio, otherwise use language-specific voice
    const voiceLanguage = word === 'english_sentence' ? 'english' : language;
    const finalVoiceId = voiceId || await this.getVoiceForLanguage(voiceLanguage);
    
    // Store the voiceID that was used for this generation
    this.lastUsedVoiceId = finalVoiceId;

    // For Japanese, convert kanji to hiragana to avoid ElevenLabs mispronunciation
    const isJapanese = voiceLanguage === 'japanese' || voiceLanguage === 'ja';
    const ttsText = isJapanese ? await getJapanesePhoneticText(text) : text;

    // Make API request to ElevenLabs (rate-limited to 1 concurrent request)
    const audioBuffer = await queueApiRequest(() => this.callElevenLabsAPI(ttsText, finalVoiceId, voiceLanguage));

    // Write audio file
    writeFileSync(audioPath, audioBuffer);

    // Verify file was created
    if (!await this.audioExists(audioPath)) {
      throw createAudioError(`Audio file not created: ${audioPath}`, 'GENERATION_FAILED', { audioPath });
    }

    return audioPath;
  }


  /**
   * Call ElevenLabs API to generate audio
   */
  private async callElevenLabsAPI(text: string, voiceId: string, language: string): Promise<Buffer> {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    
    // Get language code for the API (2-letter ISO code)
    const languageCode = getLanguageCode(language);
    
    const requestBody: any = {
      text: text,
      model_id: this.config.elevenLabsModel,
      language_code: languageCode,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.5,
        style: 0.0,
        use_speaker_boost: true
      }
    };
    

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
  }

  /**
   * Generate standardized audio file path based on IDs
   * Structure: 
   *   - Continuation audio: /audio/<lang>/variant_<variant_id>.<extension>
   *   - Before sentence audio: /audio/<lang>/word_<word_id>/before_sentence_<sentence_id>.<extension>
   *   - After sentence audio: /audio/<lang>/word_<word_id>/after_sentence_<sentence_id>.<extension>
   *   - Sentence audio: /audio/<lang>/<word_id>/<sentence_id>.<extension>
   *   - Custom text (no IDs): /audio/<lang>/custom_<hash>.<extension>
   * Requires wordId for word/sentence audio, variantId for continuation audio, or uses text hash for custom text
   */
  private getAudioPath(text: string, language: string, word?: string, wordId?: number, sentenceId?: number, variantId?: number): string {
    if (variantId !== undefined) {
      // Continuation audio: /audio/<lang>/variant_<variant_id>.<extension>
      return join(this.config.audioDirectory, language, `variant_${variantId}${this.config.fileExtension}`);
    }

    if (wordId === undefined) {
      // Custom text without wordId - use hash of text for filename
      // This allows generating audio for arbitrary text selections
      const textHash = createHash('md5').update(text.trim().toLowerCase()).digest('hex').substring(0, 16);
      return join(this.config.audioDirectory, language, `custom_${textHash}${this.config.fileExtension}`);
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
   * Generic voice ID for languages not in the map
   */
  private static readonly DEFAULT_VOICE = 'pNInz6obpgDQGcFmaJgB';

  /**
   * Build default voice map from config.toml
   * This is the single source of truth for default voice IDs
   */
  private static buildDefaultVoiceMap(): Record<string, string[]> {
    const voiceMap: Record<string, string[]> = {};
    
    // Supported languages from config
    const languages = ['spanish', 'italian', 'portuguese', 'polish', 'indonesian', 'japanese', 'english'];
    
    for (const lang of languages) {
      const voiceIds = getElevenlabsVoiceIds(lang);
      if (voiceIds.length > 0) {
        // Add both full name and code
        voiceMap[lang] = voiceIds;
        const code = getLanguageCode(lang);
        if (code) {
          voiceMap[code] = voiceIds;
        }
      }
    }
    
    return voiceMap;
  }

  /**
   * Load voice mappings with priority: Database settings > config.toml > fallback
   */
  private async loadVoiceMappings(): Promise<void> {
    // Start with defaults from config.toml
    const defaultVoiceMap = ElevenLabsAudioGenerator.buildDefaultVoiceMap();
    
    if (!this.database) {
      this.voiceMap = defaultVoiceMap;
      this.voiceMapLoaded = true;
      return;
    }

    try {
      const stored = await this.database.getSetting('elevenlabs_voice_ids');
      if (stored && stored.trim() && stored !== '{}') {
        const parsed = JSON.parse(stored);
        // Merge: config.toml defaults first, then database overrides
        // Database settings take precedence (user customizations)
        this.voiceMap = {
          ...defaultVoiceMap,
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
        // No stored settings or empty, use defaults from config.toml
        this.voiceMap = defaultVoiceMap;
      }
      this.voiceMapLoaded = true;
    } catch (error) {
      this.logger.warn({ error }, 'Failed to load voice mappings from database, using defaults from config.toml');
      this.voiceMap = defaultVoiceMap;
      this.voiceMapLoaded = true;
    }
  }

  /**
   * Get language code from full language name (e.g., 'portuguese' -> 'pt')
   * Uses the shared language-config utility
   */
  private getLanguageCode(language: string): string | null {
    return getLanguageCode(language);
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
   * Uses the shared language-config utility
   */
  private getLanguageCodeFromCode(code: string): string | null {
    return getLanguageName(code);
  }

  /**
   * Reset voice mappings to defaults from config.toml
   */
  async resetVoiceMappingsToDefaults(): Promise<void> {
    if (!this.database) {
      throw new Error('Database not available for resetting voice mappings');
    }

    try {
      // Delete the setting to use defaults from config.toml
      await this.database.setSetting('elevenlabs_voice_ids', '');
      
      // Reload to update the internal map with defaults from config.toml
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
}
