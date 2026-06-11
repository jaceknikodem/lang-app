import { promises as fsPromises } from 'fs';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join, parse, extname } from 'path';
import { app } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { TTSAudioGenerator } from './audio-generator';
import { ElevenLabsAudioGenerator } from './elevenlabs-generator';
import { KokoroAudioGenerator } from './kokoro-generator';
import { AudioGenerator, AudioError } from '../../shared/types/audio';
import { DatabaseLayer } from '../../shared/types/database';
import { AudioRecorder, RecordingSession, RecordingOptions } from './audio-recorder';
import { SpeechRecognitionService, TranscriptionOptions, TranscriptionResult } from './speech-recognition';
import { sanitizeFilename } from '../../shared/utils/sanitizeFilename';
import { getErrorMessage, createAudioError } from '../../shared/utils/error.js';
import { testingConfig, languagesConfig } from '../../shared/config/index.js';
import { getLogger } from '../utils/logger.js';
import { Logger } from '../../shared/utils/logger.js';
import { getElevenlabsModel } from '../../shared/utils/language-config.js';

// Constants for audio stitching
const CACHE_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_AUDIO_FILES = 200;
const FFMPEG_TIMEOUT_SHORT = 5000; // 5 seconds for silence generation
const FFMPEG_TIMEOUT_LONG = 120000; // 120 seconds for long audio stitching
const FFMPEG_MAX_BUFFER = 10 * 1024 * 1024; // 10MB

const execFileAsync = promisify(execFile);

/**
 * Audio service that coordinates audio generation and playback
 * Provides high-level interface for UI integration
 */
export class AudioService {
  private audioGenerator: AudioGenerator;
  private kokoroGenerator: KokoroAudioGenerator | null = null;
  private audioRecorder: AudioRecorder;
  private speechRecognition: SpeechRecognitionService;
  private database?: DatabaseLayer;
  private readonly logger: Logger;

  constructor(audioGenerator?: AudioGenerator, database?: DatabaseLayer) {
    this.logger = getLogger();
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
   * Check for audio backend settings and switch if needed.
   * Priority: tts_backend setting > elevenlabs_api_key (legacy) > system TTS
   */
  private getTTSBackendForLanguage(language: string): 'system' | 'kokoro' | 'elevenlabs' {
    const lang = language.toLowerCase();
    const entry = languagesConfig.find(
      (l) => l.code === lang || l.name === lang
    );
    return entry?.ttsBackend ?? 'system';
  }

  private async checkAndSwitchToAudioBackend(database: DatabaseLayer): Promise<void> {
    if (this.shouldForceSystemTTS()) {
      return;
    }

    try {
      const currentLanguage = await database.getCurrentLanguage();
      const backend = this.getTTSBackendForLanguage(currentLanguage);

      if (backend === 'kokoro') {
        // Kokoro is handled per-call in generateAudio; non-kokoro generator handles the rest
        if (!(this.audioGenerator instanceof TTSAudioGenerator) &&
            !(this.audioGenerator instanceof ElevenLabsAudioGenerator)) {
          this.audioGenerator = new TTSAudioGenerator(undefined, database);
        }
        return;
      }

      if (backend === 'system') {
        if (!(this.audioGenerator instanceof TTSAudioGenerator)) {
          this.audioGenerator = new TTSAudioGenerator(undefined, database);
        }
        return;
      }

      // backend === 'elevenlabs': check for API key
      const apiKey = await database.getSetting('elevenlabs_api_key');
      if (apiKey && apiKey.trim()) {
        if (!(this.audioGenerator instanceof ElevenLabsAudioGenerator)) {
          const model = getElevenlabsModel(currentLanguage) || 'eleven_flash_v2_5';
          this.audioGenerator = new ElevenLabsAudioGenerator(
            { elevenLabsApiKey: apiKey, elevenLabsModel: model },
            database
          );
        }
      } else if (!(this.audioGenerator instanceof TTSAudioGenerator)) {
        this.audioGenerator = new TTSAudioGenerator(undefined, database);
      }
    } catch (error) {
      this.logger.warn({ error }, 'Failed to check audio backend settings, using system TTS');
    }
  }


  /**
   * Switch to ElevenLabs TTS if API key is provided
   */
  async switchToElevenLabs(apiKey: string): Promise<void> {
    if (this.shouldForceSystemTTS()) {
      await this.switchToSystemTTS();
      return;
    }

    // Get model from language config based on current language
    let model = 'eleven_flash_v2_5'; // Default fallback
    if (this.database) {
      try {
        const currentLanguage = await this.database.getCurrentLanguage();
        const languageModel = getElevenlabsModel(currentLanguage);
        if (languageModel) {
          model = languageModel;
        }
      } catch (error) {
        this.logger.warn({ error }, 'Failed to get ElevenLabs model from language config, using default');
      }
    }

    const config = {
      elevenLabsApiKey: apiKey,
      elevenLabsModel: model
    };
    this.audioGenerator = new ElevenLabsAudioGenerator(config, this.database);
    this.logger.info({ model }, 'Switched to ElevenLabs TTS');
  }


  /**
   * Switch back to system TTS
   */
  async switchToSystemTTS(): Promise<void> {
    this.audioGenerator = new TTSAudioGenerator(undefined, this.database);
    this.logger.info('Switched to system TTS');
  }

  /**
   * Generate audio for text with error handling and validation
   * Ensures the currently selected TTS engine is used for generation.
   */
  async generateAudio(text: string, language: string, word?: string, wordId?: number, sentenceId?: number, variantId?: number, voiceId?: string): Promise<string> {
    // Ensure we're using the currently selected TTS engine for non-Japanese
    if (this.database) {
      await this.checkAndSwitchToAudioBackend(this.database);
    }

    try {
      // Validate inputs
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        throw new Error('Text must be a non-empty string');
      }

      if (!language || typeof language !== 'string') {
        throw new Error('Language must be a non-empty string');
      }

      const lang = language.toLowerCase();
      if (this.getTTSBackendForLanguage(lang) === 'kokoro') {
        if (!this.kokoroGenerator) {
          this.kokoroGenerator = new KokoroAudioGenerator();
        }
        const audioPath = await this.kokoroGenerator.generateAudio(text.trim(), lang, word, wordId, sentenceId, variantId, voiceId);
        if (!await this.audioExists(audioPath)) {
          throw new Error(`Audio generation succeeded but file not found: ${audioPath}`);
        }
        return AudioService.getRelativeAudioPath(audioPath);
      }

      // Generate audio and return relative path
      const audioPath = await this.audioGenerator.generateAudio(text.trim(), language.toLowerCase(), word, wordId, sentenceId, variantId, voiceId);

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

      throw createAudioError(`Audio generation failed`, 'GENERATION_FAILED', { cause: error });
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

      throw createAudioError(`Audio playback failed`, 'PLAYBACK_FAILED', { audioPath, cause: error });
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
        this.logger.warn({ audioPath: absolutePath }, 'Audio file not found for normalization');
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
        this.logger.warn({ error: ffmpegError, audioPath }, 'Failed to normalize audio with ffmpeg, using original');
        // Return original if normalization fails
        return audioPath;
      }

      return null;
    } catch (error) {
      this.logger.error({ error, audioPath }, 'Error normalizing audio volume');
      // Return original if normalization fails
      return audioPath;
    }
  }

  /**
   * Get audio file duration in seconds using ffprobe
   * @param audioPath - Absolute path to audio file
   * @returns Duration in seconds
   * @throws Error if unable to determine duration
   */
  private async getAudioDuration(audioPath: string): Promise<number> {
    // Use ffprobe to get duration
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath
    ], {
      timeout: 5000,
      maxBuffer: 1024 * 1024
    });

    const duration = parseFloat(stdout.trim());
    if (isNaN(duration)) {
      throw new Error(`Invalid duration for audio file: ${audioPath}`);
    }
    return duration;
  }

  /**
   * Create a silence audio file with specified duration
   * @param duration - Duration in seconds
   * @param filename - Filename for the silence file (e.g., 'silence.mp3')
   * @returns Path to created silence file or null on failure
   */
  private async createSilenceFile(duration: number, filename: string): Promise<string | null> {
    const audioDir = join(app.getPath('userData'), 'audio');
    const silencePath = join(audioDir, filename);

    // Delete existing file to ensure it's regenerated with correct duration
    if (existsSync(silencePath)) {
      try {
        unlinkSync(silencePath);
      } catch (error) {
        this.logger.warn({ error, silencePath }, 'Failed to delete old silence file');
      }
    }

    try {
      if (!existsSync(audioDir)) {
        mkdirSync(audioDir, { recursive: true });
      }

      this.logger.debug({ silencePath, duration }, '[Flow] Creating silence file');
      await execFileAsync('ffmpeg', [
        '-f', 'lavfi',
        '-i', 'anullsrc=r=44100:cl=stereo',
        '-t', duration.toString(),
        '-c:a', 'libmp3lame',
        '-b:a', '128k',
        '-ar', '44100',
        '-ac', '2',
        '-y',
        silencePath
      ], {
        timeout: FFMPEG_TIMEOUT_SHORT,
        maxBuffer: 1024 * 1024
      });

      // Verify silence file was created
      if (!existsSync(silencePath)) {
        this.logger.error({ silencePath }, '[Flow] Silence file was not created after ffmpeg command');
        return null;
      }
      this.logger.debug({ silencePath }, '[Flow] Silence file created successfully');
      return silencePath;
    } catch (error) {
      this.logger.error({ error, silencePath }, 'Failed to create silence file');
      return null;
    }
  }

  /**
   * Check if cached stitched audio file exists and is recent
   * @param outputPath - Path to the output file
   * @param cacheAgeMs - Maximum age of cache in milliseconds (default: 2 hours)
   * @returns true if cache is valid, false otherwise
   */
  private async checkStitchedAudioCache(outputPath: string, cacheAgeMs: number = CACHE_AGE_MS): Promise<boolean> {
    const { stat, unlink } = fsPromises;
    try {
      const stats = await stat(outputPath);
      const fileAge = Date.now() - stats.mtime.getTime();
      if (fileAge < cacheAgeMs) {
        this.logger.debug({ 
          fileAgeMinutes: Math.round(fileAge / 1000 / 60), 
          outputPath 
        }, '[Flow] Using cached stitched audio file');
        return true;
      } else {
        // Cache expired, delete old file to regenerate
        this.logger.debug({ 
          fileAgeMinutes: Math.round(fileAge / 1000 / 60) 
        }, '[Flow] Cache expired, will regenerate');
        try {
          await unlink(outputPath);
        } catch {
          // Ignore deletion errors
        }
        return false;
      }
    } catch {
      // File doesn't exist, need to create it
      return false;
    }
  }

  /**
   * Build input list with pauses between audio files
   * @param audioFiles - Array of audio file paths (absolute paths)
   * @param silenceFiles - Array of silence file configurations with path and duration
   * @param pattern - Pattern type: 'simple' (silence between each) or 'english' (alternating pattern)
   * @param existingPairs - For 'english' pattern, array of [englishPath, selectedLangPath] pairs
   * @returns Object with inputList and pauseTimestamps (or null if duration tracking failed)
   */
  private async buildInputListWithPauses(
    audioFiles: string[],
    silenceFiles: Array<{ path: string; duration: number }>,
    pattern: 'simple' | 'english',
    existingPairs?: Array<[string, string]>
  ): Promise<{ inputList: string[]; pauseTimestamps: number[] | null }> {
    const inputList: string[] = [];
    let pauseEndTimestamps: number[] | null = null;
    let cumulativeTime = 0;

    // Try to track pause timestamps, but skip if duration retrieval fails
    try {
      pauseEndTimestamps = [];

      if (pattern === 'simple') {
        const silencePath = silenceFiles[0].path;
        const silenceDuration = silenceFiles[0].duration;

        for (let i = 0; i < audioFiles.length; i++) {
          // Verify each audio file exists
          if (!existsSync(audioFiles[i])) {
            this.logger.warn({ audioPath: audioFiles[i] }, '[Flow] Audio file does not exist, skipping');
            continue;
          }

          // Get duration of audio file
          const audioDuration = await this.getAudioDuration(audioFiles[i]);
          inputList.push(audioFiles[i]);
          cumulativeTime += audioDuration;

          // Add silence after this audio file (except for the last one)
          if (i < audioFiles.length - 1) {
            inputList.push(silencePath);
            cumulativeTime += silenceDuration;
            pauseEndTimestamps.push(cumulativeTime);
          }
        }
      } else if (pattern === 'english' && existingPairs) {
        const silence4SecPath = silenceFiles[0].path;
        const silence4SecDuration = silenceFiles[0].duration;
        const silence2SecPath = silenceFiles[1].path;
        const silence2SecDuration = silenceFiles[1].duration;

        for (let i = 0; i < existingPairs.length; i++) {
          const [englishPath, selectedLangPath] = existingPairs[i];

          // Verify each audio file exists
          if (!existsSync(englishPath) || !existsSync(selectedLangPath)) {
            this.logger.warn({ 
              pairIndex: i, 
              englishPath, 
              selectedLangPath 
            }, '[Flow] Audio file pair does not exist, skipping pair');
            continue;
          }

          // Add English audio and track its duration
          const englishDuration = await this.getAudioDuration(englishPath);
          inputList.push(englishPath);
          cumulativeTime += englishDuration;

          // Add 4-second silence after English (always, to separate from selected language)
          inputList.push(silence4SecPath);
          cumulativeTime += silence4SecDuration;
          pauseEndTimestamps.push(cumulativeTime);

          // Add selected language audio and track its duration
          const selectedLangDuration = await this.getAudioDuration(selectedLangPath);
          inputList.push(selectedLangPath);
          cumulativeTime += selectedLangDuration;

          // Add 2-second silence after selected language (except for last pair)
          if (i < existingPairs.length - 1) {
            inputList.push(silence2SecPath);
            cumulativeTime += silence2SecDuration;
            pauseEndTimestamps.push(cumulativeTime);
          }
        }
      }
    } catch (error) {
      // If duration retrieval fails, skip pause tracking but continue with stitching
      this.logger.warn({ error }, '[Flow] Failed to track pause timestamps, skipping pause tracking');
      pauseEndTimestamps = null;

      // Build input list without tracking durations
      if (pattern === 'simple') {
        const silencePath = silenceFiles[0].path;
        for (let i = 0; i < audioFiles.length; i++) {
          if (!existsSync(audioFiles[i])) {
            this.logger.warn({ audioPath: audioFiles[i] }, '[Flow] Audio file does not exist, skipping');
            continue;
          }
          inputList.push(audioFiles[i]);
          if (i < audioFiles.length - 1) {
            inputList.push(silencePath);
          }
        }
      } else if (pattern === 'english' && existingPairs) {
        const silence4SecPath = silenceFiles[0].path;
        const silence2SecPath = silenceFiles[1].path;
        for (let i = 0; i < existingPairs.length; i++) {
          const [englishPath, selectedLangPath] = existingPairs[i];
          if (!existsSync(englishPath) || !existsSync(selectedLangPath)) {
            this.logger.warn({ 
              pairIndex: i, 
              englishPath, 
              selectedLangPath 
            }, '[Flow] Audio file pair does not exist, skipping pair');
            continue;
          }
          inputList.push(englishPath);
          inputList.push(silence4SecPath);
          inputList.push(selectedLangPath);
          if (i < existingPairs.length - 1) {
            inputList.push(silence2SecPath);
          }
        }
      }
    }

    return { inputList, pauseTimestamps: pauseEndTimestamps };
  }

  /**
   * Execute ffmpeg concat filter to stitch audio files
   * @param inputList - Array of input file paths
   * @param outputPath - Path to output file
   * @throws Error if ffmpeg execution fails
   */
  private async executeFfmpegConcat(
    inputList: string[],
    outputPath: string
  ): Promise<void> {
    this.logger.info({ fileCount: inputList.length }, '[Flow] Stitching audio files with re-encoding (this may take a moment)');

    // Build filter complex: normalize all inputs to same format, then concat
    const inputArgs: string[] = [];
    const filterParts: string[] = [];

    // Add all inputs
    for (let i = 0; i < inputList.length; i++) {
      inputArgs.push('-i', inputList[i]);
      filterParts.push(`[${i}:a]aresample=44100:resampler=soxr:ochl=stereo[a${i}]`);
    }

    // Build concat filter
    const concatInputs = inputList.map((_, i) => `[a${i}]`).join('');
    filterParts.push(`${concatInputs}concat=n=${inputList.length}:v=0:a=1[out]`);

    const filterComplex = filterParts.join('; ');

    await execFileAsync('ffmpeg', [
      ...inputArgs,
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-c:a', 'libmp3lame',
      '-b:a', '128k',
      '-ar', '44100',
      '-ac', '2',
      '-y',
      outputPath
    ], {
      timeout: FFMPEG_TIMEOUT_LONG,
      maxBuffer: FFMPEG_MAX_BUFFER
    });

    this.logger.info({ outputPath }, '[Flow] Audio stitching complete');
  }

  /**
   * Save pause timestamps to JSON file
   * @param outputPath - Path to output audio file
   * @param pauseTimestamps - Array of pause end timestamps or null
   */
  private async savePauseTimestamps(outputPath: string, pauseTimestamps: number[] | null): Promise<void> {
    if (pauseTimestamps === null) {
      return;
    }

    const pauseTimestampsPath = outputPath.replace(/\.mp3$/, '.json');
    try {
      await fsPromises.writeFile(pauseTimestampsPath, JSON.stringify(pauseTimestamps), 'utf-8');
      this.logger.debug({ 
        pauseTimestampsPath, 
        pauseCount: pauseTimestamps.length 
      }, '[Flow] Saved pause timestamps');
    } catch (error) {
      this.logger.warn({ error, pauseTimestampsPath }, '[Flow] Failed to save pause timestamps');
    }
  }

  /**
   * Stitch multiple audio files together with 1.5 seconds silence between them
   * Uses ffmpeg to concatenate audio files
   * Returns path to the stitched audio file
   * @param audioPaths - Array of audio file paths to stitch
   * @param language - Language code for cache per language (e.g., 'spanish', 'italian') - required
   */
  async stitchAudio(audioPaths: string[], language: string): Promise<string | null> {
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

      // Limit to MAX_AUDIO_FILES
      if (existingPaths.length > MAX_AUDIO_FILES) {
        this.logger.debug({ originalCount: existingPaths.length }, 'Limiting audio files to 200');
        existingPaths.splice(MAX_AUDIO_FILES);
      }

      const audioDir = join(app.getPath('userData'), 'audio');

      // Create 1.5 second silence file
      const silencePath = await this.createSilenceFile(1.5, 'silence.mp3');
      if (!silencePath) {
        return null;
      }

      // Create output file path with language suffix for per-language caching
      const languageSuffix = `_${language}`;
      const outputPath = join(audioDir, `flow_stitched${languageSuffix}.mp3`);

      // Check cache
      const usingCache = await this.checkStitchedAudioCache(outputPath);
      if (usingCache) {
        return AudioService.getRelativeAudioPath(outputPath);
      }

      this.logger.info({ audioFileCount: existingPaths.length }, '[Flow] Creating new stitched audio file');

      // Build input list with pauses
      const { inputList, pauseTimestamps } = await this.buildInputListWithPauses(
        existingPaths,
        [{ path: silencePath, duration: 1.5 }],
        'simple'
      );

      this.logger.debug({ 
        totalFiles: inputList.length, 
        audioFiles: existingPaths.length, 
        silenceFiles: inputList.length - existingPaths.length 
      }, '[Flow] Built input list');

      // Create temporary file list for ffmpeg
      const fileListPath = join(audioDir, 'flow_concat_list.txt');
      const fileListContent = inputList.map(path => `file '${path.replace(/'/g, "'\\''")}'`).join('\n');
      writeFileSync(fileListPath, fileListContent);

      try {
        // Execute ffmpeg concat
        await this.executeFfmpegConcat(inputList, outputPath);

        // Clean up temporary file list
        try {
          unlinkSync(fileListPath);
        } catch {
          // Ignore cleanup errors
        }

        // Verify output file was created and save pause timestamps
        if (await this.audioExists(outputPath)) {
          await this.savePauseTimestamps(outputPath, pauseTimestamps);
          return AudioService.getRelativeAudioPath(outputPath);
        }
      } catch (error) {
        // Clean up temporary file list on error
        try {
          unlinkSync(fileListPath);
        } catch {
          // Ignore cleanup errors
        }
        throw error;
      }

      return null;
    } catch (error) {
      this.logger.error({ error }, 'Error stitching audio');
      return null;
    }
  }

  /**
   * Stitch audio files together with alternating English and selected language pattern
   * Pattern: sentence_1 (English) - 4-sec - sentence_1 (selected language) - 2-sec - sentence_2 (English) - 4-sec - sentence_2 (selected language)...
   * Uses ffmpeg to concatenate audio files
   * Returns path to the stitched audio file
   * @param audioPathPairs - Array of [englishPath, selectedLanguagePath] pairs for each sentence
   * @param language - Language code for cache per language (e.g., 'spanish', 'italian') - required
   */
  async stitchAudioWithEnglish(audioPathPairs: Array<[string, string]>, language: string): Promise<string | null> {
    try {
      if (!audioPathPairs || audioPathPairs.length === 0) {
        return null;
      }

      // Filter out pairs where either path doesn't exist and resolve relative paths
      const existingPairs: Array<[string, string]> = [];
      for (const [englishPath, selectedLangPath] of audioPathPairs) {
        const absoluteEnglishPath = AudioService.resolveAudioPath(englishPath);
        const absoluteSelectedLangPath = AudioService.resolveAudioPath(selectedLangPath);
        if (await this.audioExists(absoluteEnglishPath) && await this.audioExists(absoluteSelectedLangPath)) {
          existingPairs.push([absoluteEnglishPath, absoluteSelectedLangPath]);
        }
      }

      if (existingPairs.length === 0) {
        return null;
      }

      // Limit to MAX_AUDIO_FILES pairs
      if (existingPairs.length > MAX_AUDIO_FILES) {
        this.logger.debug({ originalCount: existingPairs.length }, 'Limiting audio pairs to 200');
        existingPairs.splice(MAX_AUDIO_FILES);
      }

      const audioDir = join(app.getPath('userData'), 'audio');

      // Create 4-second and 2-second silence files
      const silence4SecPath = await this.createSilenceFile(4, 'silence_4sec.mp3');
      const silence2SecPath = await this.createSilenceFile(2, 'silence_2sec.mp3');
      if (!silence4SecPath || !silence2SecPath) {
        return null;
      }

      // Create output file path with language suffix for per-language caching
      const languageSuffix = `_english_${language}`;
      const outputPath = join(audioDir, `flow_stitched${languageSuffix}.mp3`);

      // Check cache
      const usingCache = await this.checkStitchedAudioCache(outputPath);
      if (usingCache) {
        this.logger.debug({ outputPath }, '[Flow] Using cached stitched audio file with English');
        return AudioService.getRelativeAudioPath(outputPath);
      }

      this.logger.info({ sentencePairCount: existingPairs.length }, '[Flow] Creating new stitched audio file with English pattern');

      // Build input list with pauses using English pattern
      const { inputList, pauseTimestamps } = await this.buildInputListWithPauses(
        [],
        [
          { path: silence4SecPath, duration: 4.0 },
          { path: silence2SecPath, duration: 2.0 }
        ],
        'english',
        existingPairs
      );

      this.logger.debug({ 
        totalFiles: inputList.length, 
        audioFiles: existingPairs.length * 2, 
        silenceFiles: inputList.length - existingPairs.length * 2 
      }, '[Flow] Built input list with English pattern');

      // Create temporary file list for ffmpeg
      const fileListPath = join(audioDir, 'flow_concat_list_english.txt');
      const fileListContent = inputList.map(path => `file '${path.replace(/'/g, "'\\''")}'`).join('\n');
      writeFileSync(fileListPath, fileListContent);

      try {
        // Execute ffmpeg concat
        await this.executeFfmpegConcat(inputList, outputPath);
        this.logger.info({ outputPath }, '[Flow] Audio stitching with English pattern complete');

        // Clean up temporary file list
        try {
          unlinkSync(fileListPath);
        } catch {
          // Ignore cleanup errors
        }

        // Verify output file was created and save pause timestamps
        if (await this.audioExists(outputPath)) {
          await this.savePauseTimestamps(outputPath, pauseTimestamps);
          return AudioService.getRelativeAudioPath(outputPath);
        }
      } catch (error) {
        // Clean up temporary file list on error
        try {
          unlinkSync(fileListPath);
        } catch {
          // Ignore cleanup errors
        }
        throw error;
      }

      return null;
    } catch (error) {
      this.logger.error({ error }, 'Error stitching audio with English pattern');
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
      this.logger.warn({ error, audioPath }, 'Error checking audio file existence');
      return false;
    }
  }

  /**
   * Load audio file as ArrayBuffer for caching in renderer
   * Optimized: Returns ArrayBuffer directly (no base64 encoding overhead)
   * Also returns MIME type so renderer can create Blob URLs efficiently
   * Also loads pause timestamps from JSON file if available (for flow mode)
   */
  async loadAudioBase64(audioPath: string): Promise<{ data: ArrayBuffer; mimeType: string; pauseEndTimestamps?: number[] | null } | null> {
    try {
      if (!audioPath || typeof audioPath !== 'string') {
        this.logger.warn({ audioPath }, '[AudioService] Invalid audio path');
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

      // Try to load pause timestamps from corresponding JSON file
      let pauseEndTimestamps: number[] | null = null;
      try {
        const pauseTimestampsPath = absolutePath.replace(/\.(mp3|wav|ogg|aac|flac|aiff|aif)$/i, '.json');
        const pauseTimestampsData = await fsPromises.readFile(pauseTimestampsPath, 'utf-8');
        pauseEndTimestamps = JSON.parse(pauseTimestampsData) as number[];
        this.logger.debug({ pauseTimestampsPath, pauseCount: pauseEndTimestamps.length }, '[AudioService] Loaded pause timestamps');
      } catch (pauseError) {
        // JSON file doesn't exist or is invalid - this is expected for non-flow audio files
        // Only log if it's not a file-not-found error
        if (pauseError instanceof Error && 'code' in pauseError && (pauseError as any).code !== 'ENOENT') {
          this.logger.debug({ error: pauseError, audioPath }, '[AudioService] Failed to load pause timestamps (non-critical)');
        }
        pauseEndTimestamps = null;
      }

      // Return ArrayBuffer and MIME type - renderer will create Blob URL (faster than data URLs)
      // Convert Buffer to ArrayBuffer for IPC serialization (Electron uses structured clone which supports ArrayBuffer)
      // Create a new ArrayBuffer with the same data
      const arrayBuffer = new ArrayBuffer(fileBuffer.length);
      const view = new Uint8Array(arrayBuffer);
      view.set(fileBuffer);
      
      return {
        data: arrayBuffer,
        mimeType,
        pauseEndTimestamps
      };
    } catch (error) {
      // If file doesn't exist, readFile throws - catch and return null
      // Only log non-file-not-found errors to avoid noise from expected missing files
      if (error instanceof Error && 'code' in error && (error as any).code !== 'ENOENT') {
        this.logger.error({ error, audioPath }, '[AudioService] Error loading audio file');
      }
      return null;
    }
  }

  /**
   * Regenerate audio while ensuring the original file is only replaced on success.
   * Ensures the currently selected TTS engine is used for regeneration.
   */
  async regenerateAudio(text: string, language: string, word?: string, wordId?: number, sentenceId?: number, variantId?: number, existingPath?: string): Promise<string> {
    // Ensure we're using the currently selected TTS engine
    if (this.database) {
      await this.checkAndSwitchToAudioBackend(this.database);
    }

    // Resolve existing path to absolute for file operations
    const absoluteExistingPath = existingPath ? AudioService.resolveAudioPath(existingPath) : null;
    let backupPath: string | null = null;

    // Check if existing file exists and create backup if needed
    if (absoluteExistingPath && await this.audioExists(absoluteExistingPath)) {
      const parsed = parse(absoluteExistingPath);
      backupPath = join(parsed.dir, `${parsed.name}.bak${parsed.ext}`);
      
      // Remove any stale backup (log errors but don't fail)
      try {
        await fsPromises.unlink(backupPath);
      } catch (error) {
        // Only log if it's not a "file not found" error (expected for first-time backup)
        if (error instanceof Error && 'code' in error && (error as any).code !== 'ENOENT') {
          this.logger.warn({ error, backupPath }, 'Failed to remove stale backup file');
        }
      }
      
      await fsPromises.rename(absoluteExistingPath, backupPath);
    }

    try {
      const newPath = await this.generateAudio(text, language, word, wordId, sentenceId, variantId);

      // Clean up backup on success (log errors but don't fail)
      if (backupPath) {
        try {
          await fsPromises.unlink(backupPath);
        } catch (error) {
          this.logger.warn({ error, backupPath }, 'Failed to clean up backup file after successful regeneration');
        }
      }

      // Return relative path (generateAudio already returns relative path)
      return newPath;
    } catch (error) {
      // Restore backup on failure if it exists
      if (backupPath && absoluteExistingPath) {
        try {
          await fsPromises.rename(backupPath, absoluteExistingPath);
        } catch (restoreError) {
          this.logger.error({ error: restoreError, backupPath, absoluteExistingPath }, 'Failed to restore previous audio backup');
        }
      }
      throw error;
    }
  }

  /**
   * Generate audio for a sentence and return the path
   * Convenience method for sentence-specific audio generation
   */
  async generateSentenceAudio(sentence: string, language: string, word?: string, wordId?: number, sentenceId?: number): Promise<string> {
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
        this.logger.warn({ error }, 'Failed to determine language for external audio, using default "unknown"');
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
  async generateBatchAudio(texts: string[], language: string, word?: string, wordId?: number, sentenceIds?: number[]): Promise<string[]> {
    const results: string[] = [];

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      const sentenceId = sentenceIds && i < sentenceIds.length ? sentenceIds[i] : undefined;
      try {
        const audioPath = await this.generateAudio(text, language, word, wordId, sentenceId, undefined);
        results.push(audioPath);
      } catch (error) {
        // Log error but continue with other texts
        this.logger.error({ error, text, language, wordId, sentenceId }, 'Failed to generate audio');
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
      const errorMsg = getErrorMessage(error);
      if (errorMsg.includes('sox')) {
        throw createAudioError('Audio recording requires sox. Please install it with: brew install sox', 'RECORDING_FAILED', { cause: error });
      } else {
        throw createAudioError(`Failed to start recording`, 'RECORDING_FAILED', { cause: error });
      }
    }
  }

  /**
   * Stop current recording
   */
  async stopRecording(): Promise<RecordingSession | null> {
    try {
      return await this.audioRecorder.stopRecording();
    } catch (error) {
      throw createAudioError(`Failed to stop recording`, 'RECORDING_FAILED', { cause: error });
    }
  }

  /**
   * Cancel current recording
   */
  async cancelRecording(): Promise<void> {
    try {
      await this.audioRecorder.cancelRecording();
    } catch (error) {
      throw createAudioError(`Failed to cancel recording`, 'RECORDING_FAILED', { cause: error });
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
      this.logger.error({ error }, 'Error getting recording devices');
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
      throw createAudioError(`Failed to delete recording`, 'FILE_OPERATION_FAILED', { cause: error });
    }
  }

  /**
   * Get recording file information
   */
  async getRecordingInfo(filePath: string): Promise<{ size: number; duration?: number } | null> {
    try {
      return await this.audioRecorder.getRecordingInfo(filePath);
    } catch (error) {
      this.logger.error({ error, filePath }, 'Error getting recording info');
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
      this.logger.debug('AudioService: Checking speech recognition availability...');
      await this.speechRecognition.initialize();
      this.logger.info('AudioService: Speech recognition available');
    } catch (error) {
      // Don't throw - just log. isSpeechRecognitionReady() will return false.
      // This allows components to gracefully handle unavailable servers.
      this.logger.warn({ error }, 'AudioService: Speech recognition not available');
    }
  }

  /**
   * Transcribe recorded audio to text
   */
  async transcribeAudio(filePath: string, options: TranscriptionOptions): Promise<TranscriptionResult> {
    try {
      return await this.speechRecognition.transcribeAudio(filePath, options);
    } catch (error) {
      throw createAudioError(`Failed to transcribe audio`, 'RECORDING_FAILED', { cause: error });
    }
  }

  /**
   * Compare transcribed text with expected sentence
   * Returns similarity analysis for pronunciation feedback
   * @param proficiencyLevel Optional proficiency level to adjust similarity thresholds
   */
  async compareTranscription(
    transcribed: string,
    expected: string,
    proficiencyLevel?: string | null
  ): Promise<{
    similarity: number;
    normalizedTranscribed: string;
    normalizedExpected: string;
    expectedWords: Array<{ word: string; similarity: number; matched: boolean }>;
    transcribedWords: string[];
  }> {
    return this.speechRecognition.compareTranscription(transcribed, expected, proficiencyLevel as any);
  }

  /**
   * Check if speech recognition is ready (server available)
   * Simply checks if the Whisper server is available on localhost:8080
   */
  async isSpeechRecognitionReady(): Promise<boolean> {
    try {
      return await this.speechRecognition.isServerAvailable();
    } catch (error) {
      this.logger.error({ error }, 'Error checking Whisper server availability');
      return false;
    }
  }

  /**
   * Get current audio generation service and model information
   */
  getAudioGenerationInfo(): { service: string; model?: string; voiceId?: string } {
    const generatorName = this.audioGenerator.constructor.name;
    
    if (generatorName === 'ElevenLabsAudioGenerator') {
      const config = (this.audioGenerator as any).config;
      const voiceId = (this.audioGenerator as any).getLastUsedVoiceId?.();
      return {
        service: 'elevenlabs',
        model: config?.elevenLabsModel || 'eleven_flash_v2_5',
        voiceId: voiceId
      };
    }

    if (generatorName === 'KokoroAudioGenerator') {
      return { service: 'kokoro', model: 'Kokoro-82M-v1.0' };
    }

    return { service: 'system-tts' };
  }

  /**
   * Get voice mappings for ElevenLabs (only works if ElevenLabs is active)
   */
  async getVoiceMappings(): Promise<Record<string, string[]>> {
    const generatorName = this.audioGenerator.constructor.name;
    
    if (generatorName === 'ElevenLabsAudioGenerator') {
      return await (this.audioGenerator as ElevenLabsAudioGenerator).getVoiceMappings();
    }
    
    throw new Error('Voice mappings are only available when ElevenLabs TTS is active');
  }

  /**
   * Save voice mappings for ElevenLabs (only works if ElevenLabs is active)
   */
  async saveVoiceMappings(mappings: Record<string, string[]>): Promise<void> {
    const generatorName = this.audioGenerator.constructor.name;
    
    if (generatorName === 'ElevenLabsAudioGenerator') {
      await (this.audioGenerator as ElevenLabsAudioGenerator).saveVoiceMappings(mappings);
      return;
    }
    
    throw new Error('Voice mappings can only be saved when ElevenLabs TTS is active');
  }

  /**
   * Reset voice mappings to defaults (only works if ElevenLabs is active)
   */
  async resetVoiceMappingsToDefaults(): Promise<void> {
    const generatorName = this.audioGenerator.constructor.name;
    
    if (generatorName === 'ElevenLabsAudioGenerator') {
      await (this.audioGenerator as ElevenLabsAudioGenerator).resetVoiceMappingsToDefaults();
      return;
    }
    
    throw new Error('Voice mappings can only be reset when ElevenLabs TTS is active');
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

  private buildExternalAudioPath(sentence: string, language: string, _word: string | undefined, extension: string, wordId?: number, sentenceId?: number): string {
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
    return testingConfig.e2eForceLocalServices;
  }

  /**
   * Type guard to check if error is AudioError
   */
  private isAudioError(error: unknown): error is AudioError {
    return error instanceof Error && 'code' in error &&
      ['GENERATION_FAILED', 'PLAYBACK_FAILED', 'PLAYBACK_STOPPED', 'FILE_NOT_FOUND', 'INVALID_PATH', 'RECORDING_FAILED', 'FILE_OPERATION_FAILED', 'API_ERROR'].includes((error as AudioError).code);
  }
}
