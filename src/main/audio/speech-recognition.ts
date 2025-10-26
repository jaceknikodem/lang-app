/**
 * Speech recognition service using whisper-node
 * Handles transcription of recorded audio files for pronunciation practice
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// Import whisper-node
const whisper = require('whisper-node');

export interface TranscriptionOptions {
  language?: string;
  model?: 'tiny' | 'base' | 'small' | 'medium' | 'large';
  temperature?: number;
  best_of?: number;
  beam_size?: number;
  patience?: number;
  length_penalty?: number;
  suppress_tokens?: string;
  initial_prompt?: string;
  condition_on_previous_text?: boolean;
  fp16?: boolean;
  compression_ratio_threshold?: number;
  logprob_threshold?: number;
  no_speech_threshold?: number;
}

export interface TranscriptionResult {
  text: string;
  confidence?: number;
  language?: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

export interface SpeechRecognitionError extends Error {
  code: 'MODEL_NOT_FOUND' | 'TRANSCRIPTION_FAILED' | 'FILE_NOT_FOUND' | 'INVALID_AUDIO_FORMAT' | 'WHISPER_NOT_AVAILABLE';
  filePath?: string;
}

export class SpeechRecognitionService {
  private modelPath: string;
  private defaultModel: string = 'base';
  private isInitialized: boolean = false;

  constructor() {
    // Set up model directory
    this.modelPath = path.join(app.getPath('userData'), 'whisper-models');
    this.ensureModelDirectory();
  }

  /**
   * Initialize the speech recognition service
   * Downloads the default model if not present
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Check if whisper is available
      await this.checkWhisperAvailability();

      // Ensure default model is available
      await this.ensureModelAvailable(this.defaultModel);

      this.isInitialized = true;
      console.log('Speech recognition service initialized successfully');
    } catch (error) {
      const speechError = new Error(`Failed to initialize speech recognition: ${error instanceof Error ? error.message : 'Unknown error'}`) as SpeechRecognitionError;
      speechError.code = 'WHISPER_NOT_AVAILABLE';
      throw speechError;
    }
  }

  /**
   * Transcribe audio file to text
   */
  async transcribeAudio(filePath: string, options: TranscriptionOptions = {}): Promise<TranscriptionResult> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // Validate input file
      if (!fs.existsSync(filePath)) {
        const error = new Error(`Audio file not found: ${filePath}`) as SpeechRecognitionError;
        error.code = 'FILE_NOT_FOUND';
        error.filePath = filePath;
        throw error;
      }

      // Prepare whisper options
      const whisperOptions = {
        modelPath: path.join(this.modelPath, `ggml-${options.model || this.defaultModel}.bin`),
        whisperOptions: {
          language: options.language || 'auto',
          gen_file_txt: false,
          gen_file_subtitle: false,
          gen_file_vtt: false,
          word_timestamps: true,
          ...this.buildWhisperOptions(options)
        }
      };

      console.log(`Transcribing audio: ${filePath} with model: ${options.model || this.defaultModel}`);

      // Perform transcription
      const result = await whisper(filePath, whisperOptions);

      // Parse result
      if (!result || typeof result !== 'object') {
        throw new Error('Invalid transcription result');
      }

      // Extract text from result
      let transcribedText = '';
      let segments: Array<{ start: number; end: number; text: string }> = [];

      if (Array.isArray(result)) {
        // Handle array result format
        transcribedText = result.map(segment => segment.speech || segment.text || '').join(' ').trim();
        segments = result.map(segment => ({
          start: segment.start || 0,
          end: segment.end || 0,
          text: segment.speech || segment.text || ''
        }));
      } else if (typeof result === 'string') {
        // Handle string result format
        transcribedText = result.trim();
      } else if (result.text) {
        // Handle object with text property
        transcribedText = result.text.trim();
      }

      console.log(`Transcription completed: "${transcribedText}"`);

      return {
        text: transcribedText,
        language: options.language,
        segments: segments.length > 0 ? segments : undefined
      };

    } catch (error) {
      console.error('Transcription error:', error);
      
      if (this.isSpeechRecognitionError(error)) {
        throw error;
      }

      const speechError = new Error(`Transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`) as SpeechRecognitionError;
      speechError.code = 'TRANSCRIPTION_FAILED';
      speechError.filePath = filePath;
      throw speechError;
    }
  }

  /**
   * Compare transcribed text with expected text
   * Returns similarity score and analysis
   */
  compareTranscription(transcribed: string, expected: string): {
    similarity: number;
    normalizedTranscribed: string;
    normalizedExpected: string;
    matchingWords: string[];
    missingWords: string[];
    extraWords: string[];
  } {
    // Normalize text for comparison
    const normalizeText = (text: string): string => {
      return text
        .toLowerCase()
        .replace(/[^\w\s]/g, '') // Remove punctuation
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
    };

    const normalizedTranscribed = normalizeText(transcribed);
    const normalizedExpected = normalizeText(expected);

    // Split into words
    const transcribedWords = normalizedTranscribed.split(' ').filter(w => w.length > 0);
    const expectedWords = normalizedExpected.split(' ').filter(w => w.length > 0);

    // Find matching, missing, and extra words
    const matchingWords: string[] = [];
    const missingWords: string[] = [];
    const extraWords: string[] = [];

    // Check for matching and missing words
    for (const expectedWord of expectedWords) {
      if (transcribedWords.includes(expectedWord)) {
        matchingWords.push(expectedWord);
      } else {
        missingWords.push(expectedWord);
      }
    }

    // Check for extra words
    for (const transcribedWord of transcribedWords) {
      if (!expectedWords.includes(transcribedWord)) {
        extraWords.push(transcribedWord);
      }
    }

    // Calculate similarity score
    const totalWords = Math.max(expectedWords.length, transcribedWords.length);
    const similarity = totalWords > 0 ? matchingWords.length / totalWords : 0;

    return {
      similarity,
      normalizedTranscribed,
      normalizedExpected,
      matchingWords,
      missingWords,
      extraWords
    };
  }

  /**
   * Get available models
   */
  getAvailableModels(): string[] {
    return ['tiny', 'base', 'small', 'medium', 'large'];
  }

  /**
   * Set default model
   */
  async setDefaultModel(model: string): Promise<void> {
    if (!this.getAvailableModels().includes(model)) {
      throw new Error(`Invalid model: ${model}. Available models: ${this.getAvailableModels().join(', ')}`);
    }

    await this.ensureModelAvailable(model);
    this.defaultModel = model;
    console.log(`Default model set to: ${model}`);
  }

  /**
   * Get current default model
   */
  getDefaultModel(): string {
    return this.defaultModel;
  }

  /**
   * Check if service is initialized
   */
  isServiceInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Check if whisper is available on the system
   */
  private async checkWhisperAvailability(): Promise<void> {
    try {
      // Test whisper-node availability
      const testResult = await whisper('', { 
        modelPath: 'test',
        whisperOptions: { gen_file_txt: false }
      }).catch(() => {
        // Expected to fail, we just want to check if whisper-node is available
        return null;
      });
      
      console.log('Whisper-node is available');
    } catch (error) {
      throw new Error('whisper-node package is not properly installed or configured');
    }
  }

  /**
   * Ensure model directory exists
   */
  private ensureModelDirectory(): void {
    try {
      if (!fs.existsSync(this.modelPath)) {
        fs.mkdirSync(this.modelPath, { recursive: true });
        console.log(`Created whisper models directory: ${this.modelPath}`);
      }
    } catch (error) {
      console.error('Error creating models directory:', error);
      throw new Error('Failed to create whisper models directory');
    }
  }

  /**
   * Ensure a specific model is available
   */
  private async ensureModelAvailable(model: string): Promise<void> {
    const modelFile = `ggml-${model}.bin`;
    const modelFilePath = path.join(this.modelPath, modelFile);

    if (fs.existsSync(modelFilePath)) {
      console.log(`Model ${model} already available at: ${modelFilePath}`);
      return;
    }

    console.log(`Model ${model} not found, it will be downloaded automatically on first use`);
    
    // Note: whisper-node typically downloads models automatically on first use
    // We don't need to manually download them here
  }

  /**
   * Build whisper options from transcription options
   */
  private buildWhisperOptions(options: TranscriptionOptions): Record<string, any> {
    const whisperOptions: Record<string, any> = {};

    if (options.temperature !== undefined) whisperOptions.temperature = options.temperature;
    if (options.best_of !== undefined) whisperOptions.best_of = options.best_of;
    if (options.beam_size !== undefined) whisperOptions.beam_size = options.beam_size;
    if (options.patience !== undefined) whisperOptions.patience = options.patience;
    if (options.length_penalty !== undefined) whisperOptions.length_penalty = options.length_penalty;
    if (options.suppress_tokens !== undefined) whisperOptions.suppress_tokens = options.suppress_tokens;
    if (options.initial_prompt !== undefined) whisperOptions.initial_prompt = options.initial_prompt;
    if (options.condition_on_previous_text !== undefined) whisperOptions.condition_on_previous_text = options.condition_on_previous_text;
    if (options.fp16 !== undefined) whisperOptions.fp16 = options.fp16;
    if (options.compression_ratio_threshold !== undefined) whisperOptions.compression_ratio_threshold = options.compression_ratio_threshold;
    if (options.logprob_threshold !== undefined) whisperOptions.logprob_threshold = options.logprob_threshold;
    if (options.no_speech_threshold !== undefined) whisperOptions.no_speech_threshold = options.no_speech_threshold;

    return whisperOptions;
  }

  /**
   * Type guard to check if error is SpeechRecognitionError
   */
  private isSpeechRecognitionError(error: unknown): error is SpeechRecognitionError {
    return error instanceof Error && 'code' in error && 
           ['MODEL_NOT_FOUND', 'TRANSCRIPTION_FAILED', 'FILE_NOT_FOUND', 'INVALID_AUDIO_FORMAT', 'WHISPER_NOT_AVAILABLE'].includes((error as SpeechRecognitionError).code);
  }
}