import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { AudioGenerator, AudioConfig, AudioError } from '../../shared/types/audio';
import { DatabaseLayer } from '../../shared/types/database';
import { sanitizeFilename } from '../../shared/utils/sanitizeFilename';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Minimax TTS Audio Generator
 * Handles audio file generation using Minimax API, caching, and playback
 * 
 * Implementation based on official Minimax API documentation:
 * - HTTP API: https://platform.minimax.io/docs/api-reference/speech-t2a-http
 * - WebSocket API: https://platform.minimax.io/docs/guides/speech-t2a-websocket
 * 
 * Currently implements HTTP API for synchronous audio generation.
 * Uses the /v1/t2a_v2 endpoint with hex output format.
 */
export class MinimaxAudioGenerator implements AudioGenerator {
  private config: AudioConfig;
  private database?: DatabaseLayer;
  private currentAudioProcess?: any; // Track current audio process

  constructor(config?: Partial<AudioConfig>, database?: DatabaseLayer) {
    this.config = {
      audioDirectory: join(process.cwd(), 'audio'),
      ttsCommand: 'say',
      fileExtension: '.mp3', // Minimax returns MP3
      rate: 160,
      minimaxModel: 'speech-02-hd', // Default model
      minimaxVoiceId: undefined, // No default voice - will use generic 'default' voice
      ...config
    };

    this.database = database;

    // Ensure audio directory exists
    this.ensureAudioDirectory();
  }

  /**
   * Generate audio file for given text using Minimax API
   * Returns path to generated audio file
   */
  async generateAudio(text: string, language?: string, word?: string): Promise<string> {
    if (!text || text.trim().length === 0) {
      throw this.createAudioError('GENERATION_FAILED', 'Text cannot be empty');
    }

    if (!this.config.minimaxApiKey) {
      throw this.createAudioError('API_ERROR', 'Minimax API key not configured');
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

      // Make API request to Minimax
      const audioBuffer = await this.callMinimaxAPI(text, voiceId);

      // Write audio file
      writeFileSync(audioPath, audioBuffer);

      // Verify file was created
      if (!await this.audioExists(audioPath)) {
        throw this.createAudioError('GENERATION_FAILED', `Audio file not created: ${audioPath}`);
      }

      return audioPath;
    } catch (error) {
      if (error instanceof Error && error.message.includes('API')) {
        throw this.createAudioError('API_ERROR', `Minimax API error: ${error.message}`, audioPath);
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
        console.log('Stopping current audio process (Minimax)...');
        this.currentAudioProcess.kill('SIGTERM');
        this.currentAudioProcess = undefined;
        console.log('Audio process stopped successfully (Minimax)');
      } catch (error) {
        console.warn('Failed to stop audio process (Minimax):', error);
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
   * Call Minimax API to generate audio
   * Based on official API: https://platform.minimax.io/docs/api-reference/speech-t2a-http
   */
  private async callMinimaxAPI(text: string, voiceId: string): Promise<Buffer> {
    const url = 'https://api.minimax.io/v1/t2a_v2';
    
    // Build request body according to official API documentation
    // Reference: https://platform.minimax.io/docs/api-reference/speech-t2a-http
    const requestBody: any = {
      model: this.config.minimaxModel || 'speech-02-hd',
      text: text,
      stream: false,
      language_boost: 'auto',
      output_format: 'hex', // 'hex' or 'url' - using hex for direct binary data
      voice_setting: {
        voice_id: voiceId || 'female_voice', // Use fallback if voiceId is empty
        speed: 1.0,
        vol: 1.0,
        pitch: 0
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3', // 'mp3', 'wav', or 'flac'
        channel: 1
      }
    };

    // Optional: Add voice_modify if needed in the future
    // voice_modify: {
    //   pitch: 0,
    //   intensity: 0,
    //   timbre: 0,
    //   sound_effects: undefined
    // }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.minimaxApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `API request failed: ${response.status} ${response.statusText}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.base_resp && errorJson.base_resp.status_msg) {
            errorMessage += ` - ${errorJson.base_resp.status_msg}`;
          } else {
            errorMessage += ` - ${errorText}`;
          }
        } catch {
          errorMessage += ` - ${errorText}`;
        }
        throw new Error(errorMessage);
      }

      const responseData = await response.json();
      
      // Check for API-level errors in base_resp
      if (responseData.base_resp && responseData.base_resp.status_code !== 0) {
        const statusMsg = responseData.base_resp.status_msg || 'Unknown error';
        throw new Error(`Minimax API error: ${statusMsg}`);
      }
      
      // According to official API documentation, response structure is:
      // {
      //   "data": {
      //     "audio": "<hex_string>"
      //   },
      //   "extra_info": { ... },
      //   "trace_id": "...",
      //   "base_resp": { ... }
      // }
      let audioHex: string | undefined;
      
      // Primary path: data.audio (official API format)
      if (responseData.data && responseData.data.audio) {
        audioHex = responseData.data.audio;
      } 
      // Fallback paths for compatibility
      else if (responseData.audio) {
        audioHex = responseData.audio;
      } else if (responseData.result && responseData.result.audio) {
        audioHex = responseData.result.audio;
      }
      
      if (audioHex && typeof audioHex === 'string') {
        // Convert hex string to buffer (official format when output_format='hex')
        try {
          const buffer = Buffer.from(audioHex, 'hex');
          if (buffer.length === 0) {
            throw new Error('Decoded audio buffer is empty');
          }
          return buffer;
        } catch (parseError) {
          // If hex parsing fails, try base64 as fallback (some implementations may use this)
          try {
            const buffer = Buffer.from(audioHex, 'base64');
            if (buffer.length === 0) {
              throw new Error('Decoded audio buffer is empty');
            }
            return buffer;
          } catch {
            throw new Error(`Failed to parse audio data: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
          }
        }
      }
      
      // If no audio found in expected locations, log the response structure for debugging
      console.error('Unexpected Minimax API response structure:', JSON.stringify(responseData, null, 2));
      throw new Error('No audio data found in Minimax API response');
    } catch (error) {
      if (error instanceof Error) {
        // If the error mentions voice_id access, provide a helpful message
        if (error.message.includes('voice_id') || error.message.includes("don't have access")) {
          throw new Error(`Minimax API call failed: ${error.message}. Please configure minimax_voice_id in settings with a voice ID available to your account.`);
        }
        throw new Error(`Minimax API call failed: ${error.message}`);
      }
      throw new Error('Minimax API call failed: Unknown error');
    }
  }

  /**
   * Generate standardized audio file path based on text content
   * Structure: /audio/<lang>/<word>/<sentence>.<extension>
   */
  private getAudioPath(text: string, language: string, word?: string): string {
    // Create safe filename from text
    const safeFilename = sanitizeFilename(text);

    // If word is provided, use the new nested structure
    if (word) {
      const safeWord = sanitizeFilename(word);
      return join(this.config.audioDirectory, language, safeWord, `${safeFilename}${this.config.fileExtension}`);
    }

    // For standalone words (no parent word context), place directly in language folder
    return join(this.config.audioDirectory, language, `${safeFilename}${this.config.fileExtension}`);
  }

  /**
   * Get appropriate voice ID for language
   * Uses a generic multilingual voice that's available to all users
   */
  private getVoiceForLanguage(language: string): string {
    // If a specific voice ID is configured, use it
    if (this.config.minimaxVoiceId) {
      return this.config.minimaxVoiceId;
    }

    // Use a generic voice ID that's likely to be available
    // Minimax voice IDs are account-specific, so we use a common pattern
    // Users can configure minimax_voice_id in settings if needed
    // Note: Minimax voice IDs vary by account - this is a fallback
    // Common patterns include voice IDs like 'female', 'male', or specific names
    // We'll try a simple pattern, but users may need to configure their own voice_id
    return 'female_voice'; // Generic voice ID - user may need to configure minimax_voice_id if unavailable
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

