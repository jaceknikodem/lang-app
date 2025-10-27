/**
 * Speech recognition service using whisper-node
 * Handles transcription of recorded audio files for pronunciation practice
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// Use system whisper-cpp binary instead of whisper-node
import { spawn } from 'child_process';
import { promisify } from 'util';
const execFile = promisify(require('child_process').execFile);

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
  private whisperBinaryPath: string = '/opt/homebrew/bin/whisper-cli';
  private modelPath: string = '';
  private defaultModelPath: string;
  private isInitialized: boolean = false;

  constructor() {
    // Look for models in the models/ folder first, then project directory, then Downloads
    const projectDir = process.cwd();
    const homeDir = require('os').homedir();
    
    // Model search locations in order of preference
    const searchPaths = [
      path.join(projectDir, 'models'),  // New models/ folder
      projectDir,
      path.join(homeDir, 'Downloads')
    ];
    
    // Common model filenames to look for (including your specific model)
    const commonModels = [
      'ggml-small-q5_1.bin',  // Your specific model
      'ggml-small.bin',       // Standard small model
      'ggml-base.bin',
      'ggml-base.en.bin', 
      'ggml-small.en.bin',
      'ggml-medium.bin',
      'ggml-large.bin'
    ];
    
    // Find the first available model
    this.defaultModelPath = '';
    for (const searchPath of searchPaths) {
      for (const modelName of commonModels) {
        const modelFile = path.join(searchPath, modelName);
        if (fs.existsSync(modelFile)) {
          this.defaultModelPath = modelFile;
          this.modelPath = searchPath;
          console.log(`Found Whisper model: ${modelFile}`);
          return; // Exit both loops when found
        }
      }
    }
  }

  /**
   * Initialize the speech recognition service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      console.log('Initializing speech recognition service...');
      
      // Check if whisper binary is available
      await this.checkWhisperAvailability();

      // Check if we have a model
      if (!this.defaultModelPath) {
        throw new Error('No Whisper model found in Downloads folder. Please download a model (e.g., ggml-base.bin)');
      }

      this.isInitialized = true;
      console.log('Speech recognition service initialized successfully');
      console.log(`Using model: ${this.defaultModelPath}`);
      console.log(`Using binary: ${this.whisperBinaryPath}`);
      
    } catch (error) {
      console.error('Speech recognition initialization failed:', error);
      const speechError = new Error(`Failed to initialize speech recognition: ${error instanceof Error ? error.message : 'Unknown error'}`) as SpeechRecognitionError;
      speechError.code = 'WHISPER_NOT_AVAILABLE';
      throw speechError;
    }
  }

  /**
   * Transcribe audio file to text using system whisper-cpp binary
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

      // Check file size - if too small, likely no speech
      const stats = fs.statSync(filePath);
      if (stats.size < 1000) { // Less than 1KB
        throw new Error('Audio recording is too short or empty. Please record a longer sample.');
      }

      console.log(`Transcribing audio: ${filePath} (${(stats.size / 1024).toFixed(1)} KB)`);
      console.log(`Using model: ${this.defaultModelPath}`);

      // Build whisper-cli command arguments with conservative settings
      const args = [
        '-m', this.defaultModelPath,  // Model path
        '-f', filePath,               // Input file
        '--output-txt',               // Output as text
        '--no-timestamps',            // No timestamps for cleaner output
        '--no-prints',                // Reduce verbose output
        '--temperature', '0.0',       // Use deterministic output (no randomness)
        '--best-of', '1',             // Use single best candidate
        '--beam-size', '5',           // Use reasonable beam size for quality
        '--entropy-thold', '2.4',     // Default entropy threshold
        '--logprob-thold', '-1.0',    // Default log probability threshold
        '--no-speech-thold', '0.6',   // Default no-speech threshold
        '--suppress-nst'              // Suppress non-speech tokens
      ];

      // Always specify language to prevent hallucination
      const language = options.language && options.language !== 'auto' ? options.language : 'es'; // Default to Spanish
      args.push('-l', language);
      
      // Limit duration to prevent processing too much audio (max 5 seconds)
      args.push('-d', '5000');
      
      console.log(`Using language: ${language}`);

      console.log('Whisper command:', this.whisperBinaryPath, args.join(' '));

      // Execute whisper-cli
      let result;
      try {
        const { stdout, stderr } = await execFile(this.whisperBinaryPath, args, {
          timeout: 60000, // 60 second timeout
          maxBuffer: 1024 * 1024 // 1MB buffer
        });

        console.log('Whisper stdout length:', stdout.length);
        console.log('Whisper stdout preview:', stdout.substring(0, 200) + (stdout.length > 200 ? '...' : ''));
        if (stderr) {
          console.log('Whisper stderr:', stderr);
        }

        result = stdout;
        
      } catch (execError) {
        console.error('Whisper execution error:', execError);
        
        const errorMessage = execError instanceof Error ? execError.message : String(execError);
        
        // Check if it's actually an error or just stderr output
        if (execError && typeof execError === 'object' && 'stdout' in execError) {
          // If we have stdout, it might not be a real error
          result = (execError as any).stdout || '';
          console.log('Whisper completed with stderr but has output:', result);
        } else if (errorMessage.includes('timeout')) {
          throw new Error('Transcription took too long. The audio file may be too large.');
        } else if (errorMessage.includes('model') || errorMessage.includes('ggml')) {
          throw new Error('Whisper model file is invalid or corrupted. Please re-download the model.');
        } else if (errorMessage.includes('audio') || errorMessage.includes('format')) {
          throw new Error('Invalid audio format. Please ensure the recording is in WAV format.');
        } else {
          throw new Error(`Whisper transcription failed: ${errorMessage}`);
        }
      }

      // Parse the result
      let transcribedText = '';
      
      if (typeof result === 'string') {
        // Clean up the output - whisper-cli often includes extra info
        const lines = result.split('\n');
        
        // Find lines that look like transcribed text (not metadata)
        const textLines = lines.filter(line => {
          const trimmed = line.trim();
          return trimmed.length > 0 && 
                 !trimmed.startsWith('[') && 
                 !trimmed.includes('whisper_') &&
                 !trimmed.includes('load time') &&
                 !trimmed.includes('sample time') &&
                 !trimmed.includes('encode time') &&
                 !trimmed.includes('decode time') &&
                 !trimmed.includes('total time');
        });
        
        // Join all text and clean it up
        let rawText = textLines.join(' ').trim();
        
        console.log('Raw transcription before cleaning:', rawText);
        
        // Remove repeated [Música], [Music], and similar tokens
        transcribedText = this.cleanTranscriptionText(rawText);
        
        console.log('Cleaned transcription:', transcribedText);
      }

      if (!transcribedText || transcribedText.length === 0) {
        throw new Error('No speech detected in audio. Please speak more clearly or check your microphone.');
      }

      console.log(`Transcription completed: "${transcribedText}"`);

      return {
        text: transcribedText,
        language: options.language
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
   * Get available models (scan models/ folder, current directory and Downloads folder)
   */
  getAvailableModels(): string[] {
    const models: string[] = [];
    
    // Scan models/ folder, project directory and Downloads
    const searchPaths = [
      path.join(process.cwd(), 'models'),  // New models/ folder
      process.cwd(),
      path.join(require('os').homedir(), 'Downloads')
    ];
    
    for (const searchPath of searchPaths) {
      try {
        const files = fs.readdirSync(searchPath);
        const modelFiles = files.filter(file => 
          file.startsWith('ggml-') && file.endsWith('.bin')
        );
        
        for (const modelFile of modelFiles) {
          const fullPath = path.join(searchPath, modelFile);
          if (fs.existsSync(fullPath) && !models.includes(modelFile)) {
            models.push(modelFile);
          }
        }
      } catch (error) {
        // Ignore errors reading directories
      }
    }
    
    return models;
  }

  /**
   * Set model path
   */
  async setModelPath(modelPath: string): Promise<void> {
    if (!fs.existsSync(modelPath)) {
      throw new Error(`Model file not found: ${modelPath}`);
    }

    this.defaultModelPath = modelPath;
    console.log(`Model path set to: ${modelPath}`);
  }

  /**
   * Get current model path
   */
  getCurrentModelPath(): string {
    return this.defaultModelPath;
  }

  /**
   * Check if service is initialized
   */
  isServiceInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Check if whisper binary is available on the system
   */
  private async checkWhisperAvailability(): Promise<void> {
    try {
      // Check if whisper-cli binary exists
      if (!fs.existsSync(this.whisperBinaryPath)) {
        throw new Error(`Whisper binary not found at ${this.whisperBinaryPath}`);
      }

      // Test the binary
      const { stdout } = await execFile(this.whisperBinaryPath, ['--help']);
      console.log('System whisper-cpp binary is available');
      
    } catch (error) {
      console.error('Whisper availability check failed:', error);
      throw new Error(`System whisper-cpp binary is not available: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

    // Only include basic options for better compatibility
    if (options.temperature !== undefined) whisperOptions.temperature = options.temperature;
    if (options.initial_prompt !== undefined) whisperOptions.initial_prompt = options.initial_prompt;

    return whisperOptions;
  }



  /**
   * Clean transcription text by removing unwanted tokens and repetitions
   */
  private cleanTranscriptionText(text: string): string {
    // Remove bracketed tokens like [Música], [Music], [Applause], etc.
    let cleaned = text.replace(/\[.*?\]/g, '');
    
    // Remove extra whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    // Remove common whisper artifacts
    cleaned = cleaned.replace(/\b(música|music|applause|laughter|silence|gracias|thank you)\b/gi, '');
    
    // Remove non-Latin characters that indicate hallucination (Tamil, Chinese, etc.)
    cleaned = cleaned.replace(/[\u0B80-\u0BFF\u4E00-\u9FFF\u0900-\u097F]/g, '');
    
    // Remove words that are clearly not Spanish/English (common hallucinations)
    const badWords = /\b(seiten|怎麼|பட|cus|te\s+cus|lo\s+de\s+la\s+怎麼)\b/gi;
    cleaned = cleaned.replace(badWords, '');
    
    // Split into words and validate each word
    const words = cleaned.split(' ').filter(word => {
      const trimmed = word.trim();
      if (trimmed.length === 0) return false;
      
      // Filter out words with mixed scripts or obvious garbage
      if (/[^\w\sáéíóúüñ¿¡]/i.test(trimmed)) return false;
      
      // Filter out very short fragments that don't make sense
      if (trimmed.length === 1 && !/[aeiouáéíóú]/i.test(trimmed)) return false;
      
      return true;
    });
    
    // Remove repeated words (sometimes whisper repeats words)
    const filteredWords = [];
    let lastWord = '';
    let repeatCount = 0;
    
    for (const word of words) {
      if (word.toLowerCase() === lastWord.toLowerCase()) {
        repeatCount++;
        // Allow up to 1 repetition, then skip
        if (repeatCount <= 1) {
          filteredWords.push(word);
        }
      } else {
        filteredWords.push(word);
        lastWord = word;
        repeatCount = 0;
      }
    }
    
    // Final cleanup
    cleaned = filteredWords.join(' ').replace(/\s+/g, ' ').trim();
    
    // If the result is too short or looks like garbage, reject it
    if (cleaned.length < 3 || filteredWords.length === 0) {
      throw new Error('Transcription result appears to be invalid or too short.');
    }
    
    return cleaned;
  }

  /**
   * Type guard to check if error is SpeechRecognitionError
   */
  private isSpeechRecognitionError(error: unknown): error is SpeechRecognitionError {
    return error instanceof Error && 'code' in error && 
           ['MODEL_NOT_FOUND', 'TRANSCRIPTION_FAILED', 'FILE_NOT_FOUND', 'INVALID_AUDIO_FORMAT', 'WHISPER_NOT_AVAILABLE'].includes((error as SpeechRecognitionError).code);
  }
}