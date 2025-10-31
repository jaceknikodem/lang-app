/**
 * Speech recognition service using Whisper HTTP server
 * Handles transcription of recorded audio files for pronunciation practice
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

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
  private whisperServerUrl: string = 'http://127.0.0.1:8080';
  private isInitialized: boolean = false;

  // Map app language names to Whisper language codes
  private readonly LANGUAGE_CODE_MAP: Record<string, string> = {
    'spanish': 'es',
    'italian': 'it',
    'portuguese': 'pt',
    'polish': 'pl',
    'indonesian': 'id',
    // Also handle ISO codes directly
    'es': 'es',
    'it': 'it',
    'pt': 'pt',
    'pl': 'pl',
    'id': 'id'
  };

  constructor() {
    // Server URL can be overridden via environment variable
    if (process.env.WHISPER_SERVER_URL) {
      this.whisperServerUrl = process.env.WHISPER_SERVER_URL;
    }
  }

  /**
   * Convert app language name to Whisper language code
   */
  private mapLanguageToWhisperCode(language: string): string {
    const normalized = language.toLowerCase().trim();
    return this.LANGUAGE_CODE_MAP[normalized] || 'es'; // Default to Spanish if unknown
  }

  /**
   * Fix WAV file headers using ffmpeg to ensure correct format
   * Converts to: 16kHz sample rate, mono (1 channel), PCM s16le format
   * Returns path to fixed file, or null if ffmpeg is not available
   */
  private async fixWavFile(filePath: string): Promise<string> {
    // Create temporary file for the fixed WAV
    const fixedFilePath = filePath.replace(/\.wav$/i, '_fixed.wav');
    
    console.log('Fixing WAV file headers with ffmpeg...');
    
    // Run ffmpeg to fix the WAV file:
    // -ar 16000: Set audio sample rate to 16kHz
    // -ac 1: Set audio channels to 1 (mono)
    // -c:a pcm_s16le: Set audio codec to PCM signed 16-bit little-endian
    await execFileAsync('ffmpeg', [
      '-i', filePath,           // Input file
      '-ar', '16000',          // Sample rate: 16kHz
      '-ac', '1',              // Channels: 1 (mono)
      '-c:a', 'pcm_s16le',     // Codec: PCM signed 16-bit little-endian
      '-y',                    // Overwrite output file if it exists
      fixedFilePath            // Output file
    ], {
      timeout: 5000, // 5 second timeout
      maxBuffer: 1024 * 1024 // 1MB buffer
    });
    return fixedFilePath;
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
      console.log(`Connecting to Whisper server at: ${this.whisperServerUrl}`);
      
      // Check if Whisper server is available
      await this.checkWhisperServerAvailability();

      this.isInitialized = true;
      console.log('Speech recognition service initialized successfully');
      console.log(`Using Whisper server: ${this.whisperServerUrl}`);
      
    } catch (error) {
      console.error('Speech recognition initialization failed:', error);
      const speechError = new Error(`Failed to initialize speech recognition: ${error instanceof Error ? error.message : 'Unknown error'}`) as SpeechRecognitionError;
      speechError.code = 'WHISPER_NOT_AVAILABLE';
      throw speechError;
    }
  }

  /**
   * Transcribe audio file to text using Whisper HTTP server
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
      let stats = fs.statSync(filePath);
      console.log(`Transcribing audio: ${filePath} (${(stats.size / 1024).toFixed(1)} KB)`);

      // Fix WAV headers using ffmpeg to ensure correct sample rate, channels, and format
      // This prevents decoder issues where corrupted headers make the file appear hours long
      const fileToTranscribe = await this.fixWavFile(filePath);
      
      // Map language to Whisper language code (default to Spanish if not specified)
      const inputLanguage = options.language && options.language !== 'auto' ? options.language : 'spanish';
      const whisperLanguageCode = this.mapLanguageToWhisperCode(inputLanguage);
      console.log(`Using language: ${inputLanguage} -> Whisper code: ${whisperLanguageCode}`);

      // Use Whisper.cpp Server API format: /inference with file parameter
      // API: curl 127.0.0.1:8080/inference -H "Content-Type: multipart/form-data" 
      //      -F file="@<file-path>" -F temperature="0.0" -F response_format="json"
      //      -F translate="false" -F language="es"
      const url = `${this.whisperServerUrl}/inference`;
      console.log(`Transcribing audio via Whisper server: ${url}`);

      // Read the fixed file as a buffer for native FormData
      const fileBuffer = await fs.promises.readFile(fileToTranscribe);
      const filename = path.basename(fileToTranscribe);
      
      // Create native FormData (available in Node.js 18+)
      const formData = new FormData();
      
      // Create a Blob from the buffer and append to FormData
      // Native FormData works with Blob, which is compatible with fetch
      const audioBlob = new Blob([fileBuffer], { type: 'audio/wav' });
      formData.append('file', audioBlob, filename);
      
      // Add language code (mapped from app language name to Whisper code)
      formData.append('language', whisperLanguageCode);
      
      // Set temperature (default to 0.0 for deterministic output)
      const temperature = options.temperature !== undefined ? options.temperature : 0.0;
      formData.append('temperature', temperature.toString());
      
      // Request JSON response format
      formData.append('response_format', 'json');
      
      // Additional Whisper parameters for better transcription quality/speed
      formData.append('no_speech_thold', '0.8');  // Threshold for detecting no speech
      formData.append('no_timestamps', 'true');  // Don't include timestamps in output
      formData.append('best_of', '1');            // Use single best candidate
      formData.append('beam_size', '1');          // Use beam size of 1 for speed
      
      console.log('FormData fields:', {
        file: filename,
        language: whisperLanguageCode,
        temperature: temperature.toString(),
        response_format: 'json',
        no_speech_thold: '0.8',
        no_timestamps: 'true',
        best_of: '1',
        beam_size: '1'
      });

      let transcriptionResult: string | null = null;

      try {
        console.log('Sending request to Whisper server...');
        const startTime = Date.now();
        
        // Use native FormData with fetch - fetch will automatically set Content-Type with boundary
        // Do NOT manually set Content-Type header - fetch handles it automatically
        const response = await fetch(url, {
          method: 'POST',
          body: formData
        });

        const elapsed = Date.now() - startTime;
        console.log(`Whisper server responded in ${elapsed}ms`);

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Whisper server ${url} returned ${response.status}: ${errorText}`);
          throw new Error(`Whisper server returned ${response.status}: ${errorText}`);
        }

        const responseContentType = response.headers.get('content-type');
        
        // Handle JSON response (as requested via response_format=json)
        if (responseContentType && responseContentType.includes('application/json')) {
          const json = await response.json();
          transcriptionResult = json.text || '';
        } else {
          // Fallback to plain text if not JSON
          transcriptionResult = await response.text();
        }

        if (!transcriptionResult || transcriptionResult.trim().length === 0) {
          throw new Error('Whisper server returned empty transcription result');
        }

        console.log(`Successfully transcribed using Whisper server endpoint: /inference`);
      } catch (fetchError) {
        console.error(`Error calling Whisper server endpoint /inference:`, fetchError);
        throw new Error(`Failed to transcribe audio via Whisper server: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
      }

      // Clean the transcription text
      console.log('Raw transcription before cleaning:', transcriptionResult);
      // const cleanedText = this.cleanTranscriptionText(transcriptionResult);
      // console.log('Cleaned transcription:', cleanedText);

      // if (!cleanedText || cleanedText.length === 0) {
      //   throw new Error('No speech detected in audio. Please speak more clearly or check your microphone.');
      // }

      console.log(`Transcription completed: "${transcriptionResult}"`);

      // Clean up temporary fixed file if it was created
      if (fileToTranscribe && fileToTranscribe !== filePath) {
        await fs.promises.unlink(fileToTranscribe);
      }

      return {
        text: transcriptionResult,
        language: whisperLanguageCode
      };

    } catch (error) {
      console.error('Transcription error:', error);
      
      if (this.isSpeechRecognitionError(error)) {
        throw error;
      }

      // Handle network errors
      if (error instanceof Error) {
        if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
          const speechError = new Error('Cannot connect to Whisper server. Please ensure it is running at http://127.0.0.1:8080') as SpeechRecognitionError;
          speechError.code = 'WHISPER_NOT_AVAILABLE';
          throw speechError;
        }
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
   * Get available models (models are managed by the server)
   */
  getAvailableModels(): string[] {
    // Models are managed by the Whisper server, so we return empty array
    // In the future, we could query the server for available models
    return [];
  }

  /**
   * Set model path (not applicable when using HTTP server)
   */
  async setModelPath(modelPath: string): Promise<void> {
    console.log(`Model path setting ignored - models are managed by Whisper server at ${this.whisperServerUrl}`);
  }

  /**
   * Get current model path (not applicable when using HTTP server)
   */
  getCurrentModelPath(): string {
    return ''; // Models are managed by the server
  }

  /**
   * Check if service is initialized
   */
  isServiceInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Check if Whisper server is available
   */
  private async checkWhisperServerAvailability(): Promise<void> {
    try {
      // Try to connect to the server (try common health check endpoints)
      const healthEndpoints = [
        '/health',
        '/',
        '/v1/health',
        '/api/health'
      ];

      let serverAvailable = false;
      
      for (const endpoint of healthEndpoints) {
        try {
          const response = await fetch(`${this.whisperServerUrl}${endpoint}`, {
            method: 'GET',
            signal: AbortSignal.timeout(5000) // 5 second timeout
          });
          
          if (response.ok || response.status === 404) {
            // 404 is fine - it means the server is responding
            serverAvailable = true;
            console.log(`Whisper server is available at: ${this.whisperServerUrl}`);
            break;
          }
        } catch (error) {
          // Continue to next endpoint
          continue;
        }
      }

      if (!serverAvailable) {
        // Last attempt: try the inference endpoint with a minimal request
        try {
          const testFormData = new FormData();
          // Create a tiny dummy blob for testing
          const dummyBlob = new Blob([Buffer.from([])], { type: 'audio/wav' });
          testFormData.append('file', dummyBlob, 'test.wav');
          
          const response = await fetch(`${this.whisperServerUrl}/inference`, {
            method: 'POST',
            body: testFormData,
            signal: AbortSignal.timeout(5000)
          });

          // If we get any response (even error), the server is there
          serverAvailable = true;
        } catch (error) {
          // Server might be there but not responding to this endpoint
          // We'll let the actual transcription attempt determine availability
          console.warn('Could not verify server availability, but will attempt to use it');
          serverAvailable = true; // Optimistically assume it's available
        }
      }

      if (!serverAvailable) {
        throw new Error(`Cannot connect to Whisper server at ${this.whisperServerUrl}. Please ensure the server is running.`);
      }
      
    } catch (error) {
      console.error('Whisper server availability check failed:', error);
      throw new Error(`Whisper server is not available at ${this.whisperServerUrl}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }





  /**
   * Clean transcription text by removing unwanted tokens and repetitions
   */
  private cleanTranscriptionText(text: string): string {
    console.log('Starting cleaning process with:', text);
    
    // Remove bracketed tokens like [Música], [Music], [Applause], etc.
    let cleaned = text.replace(/\[.*?\]/g, '');
    console.log('After removing brackets:', cleaned);
    
    // Remove extra whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    console.log('After whitespace cleanup:', cleaned);
    
    // Remove non-Latin characters that indicate hallucination (Tamil, Chinese, etc.)
    cleaned = cleaned.replace(/[\u0B80-\u0BFF\u4E00-\u9FFF\u0900-\u097F]/g, '');
    console.log('After removing non-Latin chars:', cleaned);
    
    // Split into words and validate each word
    console.log('Words before filtering:', cleaned.split(' '));
    const words = cleaned.split(' ').filter(word => {
      const trimmed = word.trim();
      if (trimmed.length === 0) return false;
      
      // Filter out words with mixed scripts or obvious garbage
      // Allow letters, numbers, spaces, and Spanish accented characters
      const hasInvalidChars = /[^\w\sáéíóúüñ¿¡.,;:]/i.test(trimmed);
      if (hasInvalidChars) {
        console.log(`Filtering out word with invalid chars: "${trimmed}"`);
        return false;
      }
      
      // Filter out very short fragments that don't make sense (but allow common Spanish words like "al", "el", "la", "en")
      const isSingleInvalidChar = trimmed.length === 1 && !/[aeiouáéíóúy]/i.test(trimmed);
      if (isSingleInvalidChar) {
        console.log(`Filtering out single invalid char: "${trimmed}"`);
        return false;
      }
      
      return true;
    });
    
    console.log('Words after filtering:', words);
    
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