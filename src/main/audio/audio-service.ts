import { promises as fsPromises } from 'fs';
import { join, parse, extname } from 'path';
import { app } from 'electron';
import { TTSAudioGenerator } from './audio-generator';
import { ElevenLabsAudioGenerator } from './elevenlabs-generator';
import { AudioGenerator, AudioError } from '../../shared/types/audio';
import { DatabaseLayer } from '../../shared/types/database';
import { AudioRecorder, RecordingSession, RecordingOptions } from './audio-recorder';
import { SpeechRecognitionService, TranscriptionOptions, TranscriptionResult } from './speech-recognition';
import { sanitizeFilename } from '../../shared/utils/sanitizeFilename';

/**
 * Audio service that coordinates audio generation and playback
 * Provides high-level interface for UI integration
 */
export class AudioService {
  private audioGenerator: AudioGenerator;
  private audioRecorder: AudioRecorder;
  private speechRecognition: SpeechRecognitionService;
  private database?: DatabaseLayer;

  constructor(audioGenerator?: AudioGenerator, database?: DatabaseLayer) {
    this.database = database;
    if (audioGenerator) {
      this.audioGenerator = audioGenerator;
    } else if (this.shouldForceSystemTTS()) {
      this.audioGenerator = new TTSAudioGenerator(undefined, database);
    } else {
      this.audioGenerator = this.createDefaultAudioGenerator(database);
    }
    this.audioRecorder = new AudioRecorder();
    this.speechRecognition = new SpeechRecognitionService();
  }

  /**
   * Create default audio generator based on available settings
   */
  private createDefaultAudioGenerator(database?: DatabaseLayer): AudioGenerator {
    if (this.shouldForceSystemTTS()) {
      return new TTSAudioGenerator(undefined, database);
    }

    // Try to get API keys from database settings asynchronously
    if (database) {
      // Check for ElevenLabs settings in the background
      this.checkAndSwitchToAudioBackend(database);
    }
    
    // Default to system TTS initially
    return new TTSAudioGenerator(undefined, database);
  }

  /**
   * Check for audio backend settings (ElevenLabs) and switch if available
   */
  private async checkAndSwitchToAudioBackend(database: DatabaseLayer): Promise<void> {
    if (this.shouldForceSystemTTS()) {
      return;
    }

    try {
      // Check for ElevenLabs settings
      const model = await database.getSetting('elevenlabs_model');
      
      // If model is disabled, use system TTS
      if (model === 'disabled') {
        return; // Keep using system TTS
      }

      const apiKey = await database.getSetting('elevenlabs_api_key');
      if (apiKey && apiKey.trim()) {
        console.log('ElevenLabs API key found, switching to ElevenLabs TTS');
        const config = {
          elevenLabsApiKey: apiKey,
          elevenLabsModel: model || 'eleven_flash_v2_5'
        };
        this.audioGenerator = new ElevenLabsAudioGenerator(config, database);
      }
    } catch (error) {
      console.warn('Failed to check audio backend settings, using system TTS:', error);
    }
  }

  /**
   * Check for ElevenLabs settings and switch if available
   * @deprecated Use checkAndSwitchToAudioBackend instead
   */
  private async checkAndSwitchToElevenLabs(database: DatabaseLayer): Promise<void> {
    return this.checkAndSwitchToAudioBackend(database);
  }

  /**
   * Switch to ElevenLabs TTS if API key is provided
   */
  async switchToElevenLabs(apiKey: string): Promise<void> {
    if (this.shouldForceSystemTTS()) {
      await this.switchToSystemTTS();
      return;
    }

    try {
      // Get model from database if available
      let model = 'eleven_flash_v2_5'; // Default to flash model
      if (this.database) {
        try {
          const savedModel = await this.database.getSetting('elevenlabs_model');
          if (savedModel && savedModel !== 'disabled') {
            model = savedModel;
          } else if (savedModel === 'disabled') {
            // If model is disabled, switch to system TTS instead
            await this.switchToSystemTTS();
            return;
          }
        } catch (error) {
          console.warn('Failed to get ElevenLabs model from database, using default');
        }
      }

      const config = {
        elevenLabsApiKey: apiKey,
        elevenLabsModel: model
      };
      this.audioGenerator = new ElevenLabsAudioGenerator(config, this.database);
      console.log('Switched to ElevenLabs TTS with model:', model);
    } catch (error) {
      console.error('Failed to switch to ElevenLabs TTS:', error);
      throw error;
    }
  }


  /**
   * Switch back to system TTS
   */
  async switchToSystemTTS(): Promise<void> {
    try {
      this.audioGenerator = new TTSAudioGenerator(undefined, this.database);
      console.log('Switched to system TTS');
    } catch (error) {
      console.error('Failed to switch to system TTS:', error);
      throw error;
    }
  }

  /**
   * Generate audio for text with error handling and validation
   * Ensures the currently selected TTS engine is used for generation.
   */
  async generateAudio(text: string, language?: string, word?: string, wordId?: number, sentenceId?: number, variantId?: number): Promise<string> {
    // Ensure we're using the currently selected TTS engine
    if (this.database) {
      await this.checkAndSwitchToAudioBackend(this.database);
    }

    try {
      // Validate inputs
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        throw new Error('Text must be a non-empty string');
      }

      // Language is now optional - will be retrieved from database if not provided
      const targetLanguage = language ? language.toLowerCase() : undefined;

      // Generate audio and return relative path
      const audioPath = await this.audioGenerator.generateAudio(text.trim(), targetLanguage, word, wordId, sentenceId, variantId);

      // Verify the file was actually created
      if (!await this.audioExists(audioPath)) {
        throw new Error(`Audio generation succeeded but file not found: ${audioPath}`);
      }

      // Convert absolute path to relative path for storage in database
      return AudioService.getRelativeAudioPath(audioPath);
    } catch (error) {
      // Re-throw AudioError as-is, wrap other errors
      if (this.isAudioError(error)) {
        throw error;
      }

      const audioError = new Error(`Audio generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`) as AudioError;
      audioError.code = 'GENERATION_FAILED';
      throw audioError;
    }
  }

  /**
   * Play audio file with validation and error handling
   */
  async playAudio(audioPath: string): Promise<void> {
    try {
      // Validate input
      if (!audioPath || typeof audioPath !== 'string') {
        throw new Error('Audio path must be specified');
      }

      // Resolve relative path to absolute path
      const absolutePath = AudioService.resolveAudioPath(audioPath);

      // Check if file exists before attempting playback
      if (!await this.audioExists(absolutePath)) {
        const error = new Error(`Audio file not found: ${absolutePath}`) as AudioError;
        error.code = 'FILE_NOT_FOUND';
        error.audioPath = absolutePath;
        throw error;
      }

      // Play the audio
      await this.audioGenerator.playAudio(absolutePath);
    } catch (error) {
      // Re-throw AudioError as-is, wrap other errors
      if (this.isAudioError(error)) {
        throw error;
      }

      const audioError = new Error(`Audio playback failed: ${error instanceof Error ? error.message : 'Unknown error'}`) as AudioError;
      audioError.code = 'PLAYBACK_FAILED';
      audioError.audioPath = audioPath;
      throw audioError;
    }
  }

  /**
   * Stop currently playing audio
   */
  stopAudio(): void {
    this.audioGenerator.stopAudio();
  }

  /**
   * Normalize/amplify audio volume for playback
   * Uses ffmpeg to amplify the audio to a target volume level
   */
  async normalizeAudioVolume(audioPath: string, targetDb: number = 0): Promise<string | null> {
    try {
      if (!audioPath || typeof audioPath !== 'string') {
        return null;
      }

      // Resolve relative path to absolute path
      const absolutePath = AudioService.resolveAudioPath(audioPath);

      // Check if file exists
      if (!await this.audioExists(absolutePath)) {
        console.warn('Audio file not found for normalization:', absolutePath);
        return null;
      }

      // Create normalized version path
      const parsedPath = require('path').parse(absolutePath);
      const normalizedPath = require('path').join(
        parsedPath.dir,
        `${parsedPath.name}_normalized${parsedPath.ext}`
      );

      // Check if normalized version already exists
      if (await this.audioExists(normalizedPath)) {
        return AudioService.getRelativeAudioPath(normalizedPath);
      }

      // Use ffmpeg to normalize audio volume
      // -af "volume=5dB" amplifies by 5dB (adjust as needed)
      // -af "loudnorm" normalizes to standard loudness (EBU R128)
      // We'll use volume filter with amplification for simplicity
      const { execFile } = require('child_process');
      const { promisify } = require('util');
      const execFileAsync = promisify(execFile);

      try {
        await execFileAsync('ffmpeg', [
          '-i', absolutePath,
          '-af', `volume=${targetDb}dB`, // Amplify by targetDb (default 0 = normalize to 0dB)
          '-y', // Overwrite output file
          normalizedPath
        ], {
          timeout: 10000,
          maxBuffer: 1024 * 1024
        });

        // Verify normalized file was created
        if (await this.audioExists(normalizedPath)) {
          return AudioService.getRelativeAudioPath(normalizedPath);
        }
      } catch (ffmpegError) {
        console.warn('Failed to normalize audio with ffmpeg, using original:', ffmpegError);
        // Return original if normalization fails
        return audioPath;
      }

      return null;
    } catch (error) {
      console.error('Error normalizing audio volume:', error);
      // Return original if normalization fails
      return audioPath;
    }
  }

  /**
   * Stitch multiple audio files together with 2 seconds silence between them
   * Uses ffmpeg to concatenate audio files
   * Returns path to the stitched audio file
   */
  async stitchAudio(audioPaths: string[]): Promise<string | null> {
    try {
      if (!audioPaths || audioPaths.length === 0) {
        return null;
      }

      // Filter out paths that don't exist and resolve relative paths
      const existingPaths: string[] = [];
      for (const path of audioPaths) {
        const absolutePath = AudioService.resolveAudioPath(path);
        if (await this.audioExists(absolutePath)) {
          existingPaths.push(absolutePath);
        }
      }

      if (existingPaths.length === 0) {
        return null;
      }

      // Limit to 200 files
      if (existingPaths.length > 200) {
        console.log(`Limiting audio files to 200 (had ${existingPaths.length})`);
        existingPaths.splice(200);
      }

      // Create a 2 second silence audio file
      const { execFile } = require('child_process');
      const { promisify } = require('util');
      const execFileAsync = promisify(execFile);
      const { join } = require('path');
      const { existsSync, mkdirSync, writeFileSync, unlinkSync } = require('fs');

      const audioDir = join(app.getPath('userData'), 'audio');
      const silencePath = join(audioDir, 'silence.wav');

      // Create or regenerate silence file (2 seconds, 16kHz, mono, WAV)
      // Delete existing file to ensure it's regenerated with correct duration
      if (existsSync(silencePath)) {
        try {
          unlinkSync(silencePath);
        } catch (error) {
          console.warn('Failed to delete old silence file:', error);
        }
      }

      try {
        if (!existsSync(audioDir)) {
          mkdirSync(audioDir, { recursive: true });
        }

        await execFileAsync('ffmpeg', [
          '-f', 'lavfi',
          '-i', 'anullsrc=r=16000:cl=mono',
          '-t', '2',
          '-acodec', 'pcm_s16le',
          '-y',
          silencePath
        ], {
          timeout: 5000,
          maxBuffer: 1024 * 1024
        });
      } catch (error) {
        console.error('Failed to create silence file:', error);
        return null;
      }

      // Create output file path
      const outputPath = join(audioDir, 'flow_stitched.mp3');

      // Build list of audio files to concatenate (with silence between each)
      const inputList: string[] = [];
      for (let i = 0; i < existingPaths.length; i++) {
        inputList.push(existingPaths[i]);
        if (i < existingPaths.length - 1) {
          inputList.push(silencePath);
        }
      }

      // Create a temporary file list for ffmpeg concat demuxer
      const fileListPath = join(audioDir, 'flow_concat_list.txt');
      
      // Write file list for concat demuxer (escape single quotes in paths)
      const fileListContent = inputList.map(path => `file '${path.replace(/'/g, "'\\''")}'`).join('\n');
      writeFileSync(fileListPath, fileListContent);

      try {
        // Use ffmpeg concat demuxer to concatenate files
        await execFileAsync('ffmpeg', [
          '-f', 'concat',
          '-safe', '0',
          '-i', fileListPath,
          '-c', 'copy',
          '-y',
          outputPath
        ], {
          timeout: 60000, // 60 seconds timeout for long audio
          maxBuffer: 10 * 1024 * 1024 // 10MB buffer
        });

        // Clean up temporary file list
        try {
          unlinkSync(fileListPath);
        } catch (e) {
          // Ignore cleanup errors
        }

      // Verify output file was created and return relative path
      if (await this.audioExists(outputPath)) {
        return AudioService.getRelativeAudioPath(outputPath);
      }
      } catch (error) {
        // Clean up temporary file list on error
        try {
          unlinkSync(fileListPath);
        } catch (e) {
          // Ignore cleanup errors
        }
        throw error;
      }

      return null;
    } catch (error) {
      console.error('Error stitching audio:', error);
      return null;
    }
  }

  /**
   * Check if audio file exists
   */
  async audioExists(audioPath: string): Promise<boolean> {
    try {
      if (!audioPath || typeof audioPath !== 'string') {
        return false;
      }

      // Resolve relative path to absolute path
      const absolutePath = AudioService.resolveAudioPath(audioPath);
      return await this.audioGenerator.audioExists(absolutePath);
    } catch (error) {
      // If there's an error checking existence, assume file doesn't exist
      console.warn(`Error checking audio file existence: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  /**
   * Load audio file as ArrayBuffer for caching in renderer
   * Optimized: Returns ArrayBuffer directly (no base64 encoding overhead)
   * Also returns MIME type so renderer can create Blob URLs efficiently
   */
  async loadAudioBase64(audioPath: string): Promise<{ data: ArrayBuffer; mimeType: string } | null> {
    try {
      if (!audioPath || typeof audioPath !== 'string') {
        return null;
      }

      // Resolve relative path to absolute path
      const absolutePath = AudioService.resolveAudioPath(audioPath);

      // Optimized: Read file directly - if it doesn't exist, readFile will throw
      // This eliminates redundant file existence check (one less async I/O)
      const fileBuffer = await fsPromises.readFile(absolutePath);
      
      // Determine MIME type from file extension
      const ext = extname(absolutePath).toLowerCase();
      let mimeType = 'audio/mpeg'; // default
      if (ext === '.wav') {
        mimeType = 'audio/wav';
      } else if (ext === '.mp3') {
        mimeType = 'audio/mpeg';
      } else if (ext === '.ogg') {
        mimeType = 'audio/ogg';
      } else if (ext === '.aac') {
        mimeType = 'audio/aac';
      } else if (ext === '.flac') {
        mimeType = 'audio/flac';
      } else if (ext === '.aiff' || ext === '.aif') {
        mimeType = 'audio/aiff';
      }

      // Return ArrayBuffer and MIME type - renderer will create Blob URL (faster than data URLs)
      // Convert Buffer to ArrayBuffer for IPC serialization (Electron uses structured clone which supports ArrayBuffer)
      // Create a new ArrayBuffer with the same data
      const arrayBuffer = new ArrayBuffer(fileBuffer.length);
      const view = new Uint8Array(arrayBuffer);
      view.set(fileBuffer);
      
      return {
        data: arrayBuffer,
        mimeType
      };
    } catch (error) {
      // If file doesn't exist, readFile throws - catch and return null
      console.warn(`Error loading audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  }

  /**
   * Regenerate audio while ensuring the original file is only replaced on success.
   * Ensures the currently selected TTS engine is used for regeneration.
   */
  async regenerateAudio(text: string, language?: string, word?: string, wordId?: number, sentenceId?: number, variantId?: number, existingPath?: string): Promise<string> {
    // Ensure we're using the currently selected TTS engine
    if (this.database) {
      await this.checkAndSwitchToAudioBackend(this.database);
    }

      // Resolve existing path to absolute for file operations
      const absoluteExistingPath = existingPath ? AudioService.resolveAudioPath(existingPath) : null;
      let backupPath: string | null = null;
    try {
      if (absoluteExistingPath && await this.audioExists(absoluteExistingPath)) {
        const parsed = parse(absoluteExistingPath);
        backupPath = join(parsed.dir, `${parsed.name}.bak${parsed.ext}`);
        // Remove any stale backup
        await fsPromises.unlink(backupPath).catch(() => {});
        await fsPromises.rename(absoluteExistingPath, backupPath);
      }

      const newPath = await this.generateAudio(text, language, word, wordId, sentenceId, variantId);

      if (backupPath) {
        await fsPromises.unlink(backupPath).catch(() => {});
      }

      // Return relative path (generateAudio already returns relative path)
      return newPath;
    } catch (error) {
      if (backupPath && absoluteExistingPath) {
        try {
          const newExists = await this.audioExists(absoluteExistingPath);
          if (!newExists) {
            await fsPromises.rename(backupPath, absoluteExistingPath);
          } else {
            await fsPromises.unlink(backupPath).catch(() => {});
          }
        } catch (restoreError) {
          console.error('Failed to restore previous audio backup:', restoreError);
        }
      }
      throw error;
    }
  }

  /**
   * Generate audio for a sentence and return the path
   * Convenience method for sentence-specific audio generation
   */
  async generateSentenceAudio(sentence: string, language?: string, word?: string, wordId?: number, sentenceId?: number): Promise<string> {
    return this.generateAudio(sentence, language, word, wordId, sentenceId, undefined);
  }

  /**
   * Download external audio (e.g., from Tatoeba) and store it alongside generated audio.
   * Returns the local file path to the downloaded audio.
   */
  async downloadSentenceAudioFromUrl(
    url: string,
    sentence: string,
    language?: string,
    word?: string,
    wordId?: number,
    sentenceId?: number
  ): Promise<string> {
    if (!url || !sentence) {
      throw new Error('Audio URL and sentence text are required to download external audio.');
    }

    let targetLanguage = language;
    if (!targetLanguage && this.database) {
      try {
        targetLanguage = await this.database.getCurrentLanguage();
      } catch (error) {
        console.warn('Failed to determine language for external audio, using default "unknown"');
      }
    }
    targetLanguage = (targetLanguage || 'unknown').toLowerCase();

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`External audio request failed: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      throw new Error('External audio download succeeded but returned an empty file.');
    }

    const extension = this.resolveExternalAudioExtension(response.headers.get('content-type'), url);
    const audioPath = this.buildExternalAudioPath(sentence, targetLanguage, word, extension, wordId, sentenceId);

    if (await this.audioExists(audioPath)) {
      return AudioService.getRelativeAudioPath(audioPath);
    }

    const audioDir = parse(audioPath).dir;
    await fsPromises.mkdir(audioDir, { recursive: true });
    await fsPromises.writeFile(audioPath, Buffer.from(arrayBuffer));

    if (!await this.audioExists(audioPath)) {
      throw new Error(`External audio saved but file not found: ${audioPath}`);
    }

    // Return relative path for storage in database
    return AudioService.getRelativeAudioPath(audioPath);
  }

  /**
   * Batch generate audio for multiple texts
   * Returns array of paths in same order as input
   */
  async generateBatchAudio(texts: string[], language?: string, word?: string, wordId?: number, sentenceIds?: number[]): Promise<string[]> {
    const results: string[] = [];

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      const sentenceId = sentenceIds && i < sentenceIds.length ? sentenceIds[i] : undefined;
      try {
        const audioPath = await this.generateAudio(text, language, word, wordId, sentenceId, undefined);
        results.push(audioPath);
      } catch (error) {
        // Log error but continue with other texts
        console.error(`Failed to generate audio for "${text}":`, error);
        // Push empty string to maintain array alignment
        results.push('');
      }
    }

    return results;
  }

  /**
   * Start recording audio
   */
  async startRecording(options?: RecordingOptions): Promise<RecordingSession> {
    try {
      return await this.audioRecorder.startRecording(options);
    } catch (error) {
      let errorMessage = 'Failed to start recording';

      if (error instanceof Error) {
        if (error.message.includes('sox')) {
          errorMessage = 'Audio recording requires sox. Please install it with: brew install sox';
        } else {
          errorMessage = `Failed to start recording: ${error.message}`;
        }
      }

      const audioError = new Error(errorMessage) as AudioError;
      audioError.code = 'RECORDING_FAILED';
      throw audioError;
    }
  }

  /**
   * Stop current recording
   */
  async stopRecording(): Promise<RecordingSession | null> {
    try {
      return await this.audioRecorder.stopRecording();
    } catch (error) {
      const audioError = new Error(`Failed to stop recording: ${error instanceof Error ? error.message : 'Unknown error'}`) as AudioError;
      audioError.code = 'RECORDING_FAILED';
      throw audioError;
    }
  }

  /**
   * Cancel current recording
   */
  async cancelRecording(): Promise<void> {
    try {
      await this.audioRecorder.cancelRecording();
    } catch (error) {
      const audioError = new Error(`Failed to cancel recording: ${error instanceof Error ? error.message : 'Unknown error'}`) as AudioError;
      audioError.code = 'RECORDING_FAILED';
      throw audioError;
    }
  }

  /**
   * Get current recording session
   */
  getCurrentRecordingSession(): RecordingSession | null {
    return this.audioRecorder.getCurrentSession();
  }

  /**
   * Check if currently recording
   */
  isRecording(): boolean {
    return this.audioRecorder.isRecording();
  }

  /**
   * Get available recording devices
   */
  async getAvailableRecordingDevices(): Promise<string[]> {
    try {
      return await this.audioRecorder.getAvailableDevices();
    } catch (error) {
      console.error('Error getting recording devices:', error);
      return ['default'];
    }
  }

  /**
   * Delete a recording file
   */
  async deleteRecording(filePath: string): Promise<void> {
    try {
      await this.audioRecorder.deleteRecording(filePath);
    } catch (error) {
      const audioError = new Error(`Failed to delete recording: ${error instanceof Error ? error.message : 'Unknown error'}`) as AudioError;
      audioError.code = 'FILE_OPERATION_FAILED';
      throw audioError;
    }
  }

  /**
   * Get recording file information
   */
  async getRecordingInfo(filePath: string): Promise<{ size: number; duration?: number } | null> {
    try {
      return await this.audioRecorder.getRecordingInfo(filePath);
    } catch (error) {
      console.error('Error getting recording info:', error);
      return null;
    }
  }

  /**
   * Check speech recognition availability
   * Non-blocking: Does not throw errors if server is unavailable.
   * Use isSpeechRecognitionReady() to check if server is available.
   */
  async initializeSpeechRecognition(): Promise<void> {
    try {
      console.log('AudioService: Checking speech recognition availability...');
      await this.speechRecognition.initialize();
      console.log('AudioService: Speech recognition available');
    } catch (error) {
      // Don't throw - just log. isSpeechRecognitionReady() will return false.
      // This allows components to gracefully handle unavailable servers.
      console.warn('AudioService: Speech recognition not available:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Transcribe recorded audio to text
   */
  async transcribeAudio(filePath: string, options?: TranscriptionOptions): Promise<TranscriptionResult> {
    try {
      return await this.speechRecognition.transcribeAudio(filePath, options);
    } catch (error) {
      const audioError = new Error(`Failed to transcribe audio: ${error instanceof Error ? error.message : 'Unknown error'}`) as AudioError;
      audioError.code = 'RECORDING_FAILED';
      throw audioError;
    }
  }

  /**
   * Compare transcribed text with expected sentence
   * Returns similarity analysis for pronunciation feedback
   */
  compareTranscription(transcribed: string, expected: string): {
    similarity: number;
    normalizedTranscribed: string;
    normalizedExpected: string;
    expectedWords: Array<{ word: string; similarity: number; matched: boolean }>;
    transcribedWords: string[];
  } {
    return this.speechRecognition.compareTranscription(transcribed, expected);
  }

  /**
   * Check if speech recognition is ready (server available)
   * Simply checks if the Whisper server is available on localhost:8080
   */
  async isSpeechRecognitionReady(): Promise<boolean> {
    try {
      return await this.speechRecognition.isServerAvailable();
    } catch (error) {
      console.error('Error checking Whisper server availability:', error);
      return false;
    }
  }

  /**
   * Get current audio generation service and model information
   */
  getAudioGenerationInfo(): { service: string; model?: string } {
    const generatorName = this.audioGenerator.constructor.name;
    
    // Check if it's ElevenLabs generator
    if (generatorName === 'ElevenLabsAudioGenerator') {
      const config = (this.audioGenerator as any).config;
      return {
        service: 'elevenlabs',
        model: config?.elevenLabsModel || 'eleven_flash_v2_5'
      };
    }
    
    // Otherwise it's system TTS
    return {
      service: 'system-tts'
    };
  }

  /**
   * Convert absolute audio path to relative path (relative to userData/audio)
   * Returns the path relative to the audio directory, e.g., "spanish/word_7/sentence_1.aiff"
   * Does NOT include "audio/" prefix - paths are stored without it
   */
  static getRelativeAudioPath(absolutePath: string): string {
    if (!absolutePath || typeof absolutePath !== 'string') {
      return absolutePath;
    }
    
    const audioBaseDir = join(app.getPath('userData'), 'audio');
    
    // If path is already relative (doesn't start with audioBaseDir), return as-is
    // but remove "audio/" prefix if present for consistency
    if (!absolutePath.startsWith(audioBaseDir)) {
      // Remove "audio/" prefix if present (legacy compatibility)
      if (absolutePath.startsWith('audio/') || absolutePath.startsWith('audio\\')) {
        return absolutePath.substring(6);
      }
      return absolutePath;
    }
    
    // Extract relative path
    const relativePath = absolutePath.substring(audioBaseDir.length + 1); // +1 to skip the path separator
    return relativePath;
  }

  /**
   * Resolve relative audio path to absolute path
   * Handles both relative paths (e.g., "spanish/word_7/sentence_1.aiff") and absolute paths
   * Also handles legacy paths that include "audio/" prefix
   */
  static resolveAudioPath(path: string): string {
    if (!path || typeof path !== 'string') {
      return path;
    }
    
    // If path is already absolute (starts with / or has drive letter on Windows), return as-is
    if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
      return path;
    }
    
    // Remove "audio/" prefix if present (legacy compatibility)
    let relativePath = path;
    if (relativePath.startsWith('audio/') || relativePath.startsWith('audio\\')) {
      relativePath = relativePath.substring(6); // Remove "audio/" or "audio\"
    }
    
    // Resolve relative path to absolute
    return join(app.getPath('userData'), 'audio', relativePath);
  }

  private buildExternalAudioPath(sentence: string, language: string, word: string | undefined, extension: string, wordId?: number, sentenceId?: number): string {
    const baseDirectory = join(app.getPath('userData'), 'audio');
    const safeLanguage = sanitizeFilename(language || 'unknown');
    const ext = extension.startsWith('.') ? extension : `.${extension}`;

    if (wordId === undefined) {
      throw new Error(`Word ID is required for audio file naming. Sentence: "${sentence}"`);
    }

    if (sentenceId !== undefined) {
      // Sentence audio: /audio/<lang>/word_<word_id>/sentence_<sentence_id>.<extension>
      return join(baseDirectory, safeLanguage, `word_${wordId}`, `sentence_${sentenceId}${ext}`);
    } else {
      // Word audio: /audio/<lang>/word_<word_id>.<extension>
      return join(baseDirectory, safeLanguage, `word_${wordId}${ext}`);
    }
  }

  private resolveExternalAudioExtension(contentType: string | null | undefined, url: string): string {
    if (contentType) {
      const normalized = contentType.toLowerCase();
      if (normalized.includes('mpeg') || normalized.includes('mp3')) {
        return '.mp3';
      }
      if (normalized.includes('wav')) {
        return '.wav';
      }
      if (normalized.includes('ogg')) {
        return '.ogg';
      }
      if (normalized.includes('aac')) {
        return '.aac';
      }
      if (normalized.includes('flac')) {
        return '.flac';
      }
    }

    try {
      const urlPathname = new URL(url).pathname;
      const urlExtension = extname(urlPathname);
      if (urlExtension) {
        return urlExtension;
      }
    } catch {
      // Ignore URL parsing errors and fall back to default
    }

    return '.mp3';
  }

  /**
   * Determine if the system TTS should be forced (used for automated environments)
   */
  private shouldForceSystemTTS(): boolean {
    return process.env.E2E_FORCE_LOCAL_SERVICES === '1';
  }

  /**
   * Type guard to check if error is AudioError
   */
  private isAudioError(error: unknown): error is AudioError {
    return error instanceof Error && 'code' in error &&
      ['GENERATION_FAILED', 'PLAYBACK_FAILED', 'PLAYBACK_STOPPED', 'FILE_NOT_FOUND', 'INVALID_PATH', 'RECORDING_FAILED', 'FILE_OPERATION_FAILED', 'API_ERROR'].includes((error as AudioError).code);
  }
}
